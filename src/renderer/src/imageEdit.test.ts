import { deflateSync } from 'node:zlib'
import { PDFDocument } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import { imageDraws, parseContent } from './content'
import { replaceImage, transformImage, type ImageEditTarget } from './imageEdit'
import { isImageXObject, pageContent } from './pageContent'

/** A solid-colour PNG, built by hand (signature, IHDR, IDAT, IEND with CRCs). */
function png(w: number, h: number): Uint8Array {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    return c >>> 0
  })
  const crc = (b: Uint8Array) => {
    let c = 0xffffffff
    for (const x of b) c = crcTable[(c ^ x) & 255] ^ (c >>> 8)
    return (c ^ 0xffffffff) >>> 0
  }
  const chunk = (type: string, data: Uint8Array) => {
    const out = new Uint8Array(12 + data.length)
    const v = new DataView(out.buffer)
    v.setUint32(0, data.length)
    for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i)
    out.set(data, 8)
    v.setUint32(8 + data.length, crc(out.subarray(4, 8 + data.length)))
    return out
  }
  const ihdr = new Uint8Array(13)
  const hv = new DataView(ihdr.buffer)
  hv.setUint32(0, w)
  hv.setUint32(4, h)
  ihdr.set([8, 2, 0, 0, 0], 8)
  const raw = new Uint8Array(h * (1 + w * 3))
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) raw.set([200, 60, 60], y * (1 + w * 3) + 1 + x * 3)
  const parts = [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', new Uint8Array())]
  const all = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const p of parts) {
    all.set(p, at)
    at += p.length
  }
  return all
}

async function makePdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const page = doc.addPage([400, 400])
  const img = await doc.embedPng(png(4, 2))
  page.drawImage(img, { x: 50, y: 60, width: 200, height: 100 })
  page.drawImage(img, { x: 50, y: 250, width: 80, height: 40 })
  return doc.save()
}

const target = (ordinal: number, matrix: ImageEditTarget['matrix']): ImageEditTarget => ({ page: 0, ordinal, total: 2, matrix })
const first = target(0, [200, 0, 0, 100, 50, 60])

async function draws(bytes: Uint8Array) {
  const doc = await PDFDocument.load(bytes)
  const page = doc.getPage(0)
  return imageDraws(parseContent(pageContent(page)), (n) => isImageXObject(page, n))
}

describe('imageEdit', () => {
  it('moves an image and leaves the other where it was', async () => {
    const out = await transformImage(await makePdf(), first, [1, 0, 0, 1, 10, 20])
    const d = await draws(out)
    expect(d).toHaveLength(2)
    expect(d[0].ctm.map((v) => Math.round(v * 100) / 100)).toEqual([200, 0, 0, 100, 60, 80])
    expect(d[1].ctm.map((v) => Math.round(v * 100) / 100)).toEqual([80, 0, 0, 40, 50, 250])
  })

  it('resizes about the top-left corner when given a scale about that point', async () => {
    // Scale by 1.5 about the image's own bottom-left corner (50, 60): x' = 50 + (x - 50) * 1.5.
    const out = await transformImage(await makePdf(), first, [1.5, 0, 0, 1.5, 50 - 50 * 1.5, 60 - 60 * 1.5])
    const d = await draws(out)
    expect(d[0].ctm.map((v) => Math.round(v * 100) / 100)).toEqual([300, 0, 0, 150, 50, 60])
  })

  it('deletes an image', async () => {
    const out = await transformImage(await makePdf(), first, null)
    const d = await draws(out)
    expect(d).toHaveLength(1)
    expect(d[0].ctm[4]).toBe(50)
    expect(d[0].ctm[5]).toBe(250)
  })

  it('replaces an image with a picture of another shape, fitted inside the old box', async () => {
    const out = await replaceImage(await makePdf(), first, { data: png(2, 2), kind: 'png' })
    const d = await draws(out)
    expect(d).toHaveLength(2)
    // The 200 x 100 box holds a square: 100 x 100, centred horizontally.
    expect(d[0].ctm.map((v) => Math.round(v * 100) / 100)).toEqual([100, 0, 0, 100, 100, 60])
    expect(d[0].name).not.toBe(d[1].name)
  })

  it('refuses when the count or the position does not match PDFium', async () => {
    await expect(transformImage(await makePdf(), { ...first, total: 3 }, null)).rejects.toThrow(/cannot be edited safely/)
    await expect(transformImage(await makePdf(), target(0, [200, 0, 0, 100, 51, 60]), null)).rejects.toThrow(/page changed/)
  })
})
