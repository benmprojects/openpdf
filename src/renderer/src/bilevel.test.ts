import { deflateSync } from 'node:zlib'
import { PDFiumLibrary } from '@hyzyla/pdfium'
import { PDFDocument, PDFName } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import { encodeG4, packInk, pictures8ToBilevel, toGreyBytes } from './bilevel'

describe('packInk', () => {
  it('packs ink as ones, most significant bit first, without row padding', () => {
    expect([...packInk(Uint8Array.of(0, 255, 0, 255, 255, 255, 255, 0, 0), 128)]).toEqual([0b10100001, 0b10000000])
  })
})

describe('toGreyBytes', () => {
  it('weights RGB and passes grey through', () => {
    expect([...toGreyBytes(Uint8Array.of(255, 255, 255, 0, 0, 0), 3, 2)]).toEqual([255, 0])
    expect([...toGreyBytes(Uint8Array.of(7, 9), 1, 2)]).toEqual([7, 9])
  })
})

/** A test picture: black text-like bars on white, odd width so rows do not end on a byte. */
function bars(w: number, h: number): Uint8Array {
  const g = new Uint8Array(w * h).fill(255)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if ((Math.floor(x / 7) % 3 === 0 && y % 5 < 3) || (y > h - 6 && x > w / 3)) g[y * w + x] = 0
  return g
}

describe('G4 pictures in a PDF', () => {
  it('round-trips through PDFium: the decoded picture matches the one encoded', async () => {
    const w = 203
    const h = 61
    const grey = bars(w, h)
    const { data } = encodeG4(grey, w, h)
    const doc = await PDFDocument.create()
    const ctx = doc.context
    const img = ctx.register(ctx.stream(data, { Type: 'XObject', Subtype: 'Image', Width: w, Height: h, ColorSpace: 'DeviceGray', BitsPerComponent: 1, Filter: 'CCITTFaxDecode', DecodeParms: { K: -1, Columns: w, Rows: h } }))
    const page = doc.addPage([w, h])
    page.node.setXObject(PDFName.of('Im0'), img)
    page.node.set(PDFName.of('Contents'), ctx.register(ctx.flateStream(`q ${w} 0 0 ${h} 0 0 cm /Im0 Do Q`)))
    const lib = await PDFiumLibrary.init()
    const pdf = await lib.loadDocument(await doc.save())
    const p = pdf.getPage(0)
    const r = await p.render({ scale: 1, render: 'bitmap' })
    let wrong = 0
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if ((r.data[(y * r.width + x) * 4] < 128) !== (grey[y * w + x] < 128)) wrong++
    expect(r.width).toBe(w)
    expect(wrong).toBeLessThan(w * h * 0.002)
    p.close()
    pdf.destroy()
    lib.destroy()
  })

  it('replaces large pictures in a document and reports the saving', async () => {
    const w = 400
    const h = 300
    const rgb = new Uint8Array(w * h * 3)
    const g = bars(w, h)
    // Scanner noise on top of the bars, as a real scan has.
    for (let i = 0; i < w * h; i++) rgb.fill(Math.min(255, g[i] + ((i * 7919) % 23)), i * 3, i * 3 + 3)
    const doc = await PDFDocument.create()
    const ctx = doc.context
    const img = ctx.register(ctx.stream(deflateSync(rgb), { Type: 'XObject', Subtype: 'Image', Width: w, Height: h, ColorSpace: 'DeviceRGB', BitsPerComponent: 8, Filter: 'FlateDecode' }))
    const small = ctx.register(ctx.stream(deflateSync(new Uint8Array(30 * 30)), { Type: 'XObject', Subtype: 'Image', Width: 30, Height: 30, ColorSpace: 'DeviceGray', BitsPerComponent: 8, Filter: 'FlateDecode' }))
    const page = doc.addPage([w, h])
    page.node.setXObject(PDFName.of('Im0'), img)
    page.node.setXObject(PDFName.of('Im1'), small)
    page.node.set(PDFName.of('Contents'), ctx.register(ctx.flateStream(`q ${w} 0 0 ${h} 0 0 cm /Im0 Do Q`)))
    const r = await pictures8ToBilevel(await doc.save())
    expect(r.pictures).toBe(1)
    expect(r.after).toBeGreaterThan(0)
    expect((await PDFDocument.load(r.bytes)).getPageCount()).toBe(1)
  })
})
