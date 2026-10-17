import { PDFiumLibrary } from '@hyzyla/pdfium'
import { PDFDocument, PDFName, rgb } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import { gradientAxis, restylePath, type PathEditTarget } from './pathEdit'
import { pageContent } from './pageContent'

async function filled(): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const page = doc.addPage([200, 100])
  page.drawRectangle({ x: 20, y: 20, width: 160, height: 60, color: rgb(1, 0, 0), borderColor: rgb(0, 0, 0), borderWidth: 3 })
  return doc.save()
}

const target: PathEditTarget = { page: 0, ordinal: 0, total: 1, pageBounds: [20, 20, 180, 80] }

async function pixel(bytes: Uint8Array, x: number, y: number): Promise<[number, number, number]> {
  const lib = await PDFiumLibrary.init()
  const doc = await lib.loadDocument(bytes)
  const page = doc.getPage(0)
  const r = await page.render({ scale: 1, render: 'bitmap' })
  const i = (y * r.width + x) * 4
  const out: [number, number, number] = [r.data[i], r.data[i + 1], r.data[i + 2]]
  page.close()
  doc.destroy()
  lib.destroy()
  return out
}

describe('gradientAxis', () => {
  it('runs across the box through its centre', () => {
    expect(gradientAxis({ x0: 0, y0: 0, x1: 100, y1: 40 }, 0)).toEqual([0, 20, 100, 20])
    const down = gradientAxis({ x0: 0, y0: 0, x1: 100, y1: 40 }, 270)
    expect(down[0]).toBeCloseTo(50)
    expect(down[1]).toBeCloseTo(40)
    expect(down[3]).toBeCloseTo(0)
  })
})

describe('restylePath: dash and gradient', () => {
  it('writes a dash pattern in front of the path and refuses it on a path with no outline', async () => {
    const out = await restylePath(await filled(), target, { dash: { on: 6, off: 3 } })
    expect(pageContent((await PDFDocument.load(out)).getPage(0))).toContain('[6 3] 0 d')
    const back = await restylePath(out, target, { dash: 'solid' })
    expect(pageContent((await PDFDocument.load(back)).getPage(0))).toContain('[] 0 d')
    await expect(restylePath(await filled(), target, { dash: { on: 0, off: 3 } })).rejects.toThrow(/length above zero/)
  })

  it('fills the shape with a gradient that PDFium draws from one colour to the other, keeping the outline', async () => {
    const out = await restylePath(await filled(), target, { gradient: { from: '#ff0000', to: '#0000ff', angle: 0 } })
    const left = await pixel(out, 30, 50)
    const right = await pixel(out, 170, 50)
    expect(left[0]).toBeGreaterThan(200)
    expect(left[2]).toBeLessThan(60)
    expect(right[2]).toBeGreaterThan(200)
    expect(right[0]).toBeLessThan(60)
    // The black outline is still there.
    const edge = await pixel(out, 100, 100 - 20 - 1)
    expect(edge[0] + edge[1] + edge[2]).toBeLessThan(120)
    // Outside the shape is white.
    expect(await pixel(out, 5, 5)).toEqual([255, 255, 255])
  })

  it('handles writers that set colours and the width between the path and its paint', async () => {
    const doc = await PDFDocument.create()
    const ctx = doc.context
    const page = doc.addPage([200, 100])
    page.node.set(PDFName.of('Contents'), ctx.register(ctx.flateStream('20 20 160 60 re 1 0 0 rg 0 0 0 RG 3 w B')))
    const out = await restylePath(await doc.save(), target, { gradient: { from: '#ff0000', to: '#0000ff', angle: 0 }, dash: { on: 6, off: 3 } })
    expect(pageContent((await PDFDocument.load(out)).getPage(0))).toContain('[6 3] 0 d')
    const right = await pixel(out, 170, 50)
    expect(right[2]).toBeGreaterThan(200)
  })

  it('refuses a gradient on a shape that is only outlined', async () => {
    const doc = await PDFDocument.create()
    doc.addPage([200, 100]).drawRectangle({ x: 20, y: 20, width: 160, height: 60, borderColor: rgb(0, 0, 0), borderWidth: 2 })
    await expect(restylePath(await doc.save(), target, { gradient: { from: '#ff0000', to: '#0000ff', angle: 0 } })).rejects.toThrow(/not filled/)
  })
})
