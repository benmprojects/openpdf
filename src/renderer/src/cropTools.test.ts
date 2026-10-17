import { describe, expect, it } from 'vitest'
import { PDFArray, PDFDocument, PDFName } from 'pdf-lib'
import { marginsForBox, oddEvenPlan, trimPlan } from './cropTools'
import { cropPages, cropPagesEach } from './pageMarks'
import { trimBox } from './contentBox'

const size = { width: 600, height: 800 }

describe('marginsForBox', () => {
  it('leaves the padding around the content', () => {
    const m = marginsForBox({ x0: 0.1, y0: 0.05, x1: 0.9, y1: 0.95 }, size, 10)!
    expect([m.left, m.right, m.top, m.bottom].map(Math.round)).toEqual([50, 50, 30, 30])
  })
  it('has nothing for a blank page and never crops a side away', () => {
    expect(marginsForBox(null, size, 0)).toBeNull()
    const m = marginsForBox({ x0: 0.5, y0: 0, x1: 0.5, y1: 1 }, size, 0)!
    expect(600 - m.left - m.right).toBeGreaterThanOrEqual(20)
  })
  it('works from the dark part of a bitmap', () => {
    const w = 10
    const h = 10
    const data = new Uint8ClampedArray(w * h * 4).fill(255)
    for (const [x, y] of [
      [2, 3],
      [6, 7]
    ])
      data.set([0, 0, 0, 255], (y * w + x) * 4)
    const box = trimBox(data, w, h)!
    const m = marginsForBox(box, { width: 100, height: 100 }, 0)!
    expect([m.left, m.top, m.right, m.bottom].map(Math.round)).toEqual([20, 30, 30, 20])
  })
})

describe('trimPlan', () => {
  const sizes = [size, size, size]
  const boxes = [
    { x0: 0.1, y0: 0.1, x1: 0.9, y1: 0.9 },
    { x0: 0.2, y0: 0.05, x1: 0.8, y1: 0.95 },
    null
  ]
  it('trims each page to its own content and skips blank ones', () => {
    const plan = trimPlan([0, 1, 2], boxes, sizes, 0, false)
    expect(plan.map((p) => p.page)).toEqual([0, 1])
    expect(Math.round(plan[1].margins.left)).toBe(120)
  })
  it('uses the least trimmed side of every page for all of them when asked', () => {
    const plan = trimPlan([0, 1, 2], boxes, sizes, 0, true)
    expect(plan).toHaveLength(3)
    for (const p of plan) expect([p.margins.left, p.margins.top].map(Math.round)).toEqual([60, 40])
  })
})

describe('oddEvenPlan', () => {
  it('gives odd page numbers one set of margins and even the other', () => {
    const a = { top: 1, right: 2, bottom: 3, left: 4 }
    const b = { top: 5, right: 6, bottom: 7, left: 8 }
    expect(oddEvenPlan([0, 1, 2, 3], a, b).map((x) => x.margins)).toEqual([a, b, a, b])
  })
})

describe('cropping with removal of the cropped content', () => {
  async function pdf(): Promise<Uint8Array> {
    const doc = await PDFDocument.create()
    const p = doc.addPage([600, 800])
    p.node.set(
      PDFName.of('Annots'),
      doc.context.obj([
        doc.context.register(doc.context.obj({ Type: 'Annot', Subtype: 'Text', Rect: [10, 10, 30, 30] })),
        doc.context.register(doc.context.obj({ Type: 'Annot', Subtype: 'Text', Rect: [300, 400, 320, 420] }))
      ])
    )
    return doc.save()
  }
  it('shrinks the page and drops notes outside it', async () => {
    const out = await PDFDocument.load(await cropPages(await pdf(), [0], { top: 100, right: 100, bottom: 100, left: 100 }, { removeContent: true }))
    const page = out.getPage(0)
    expect(page.getMediaBox()).toMatchObject({ x: 100, y: 100, width: 400, height: 600 })
    expect(page.node.lookup(PDFName.of('Annots'), PDFArray).size()).toBe(1)
  })
  it('only sets the crop box without removal', async () => {
    const out = await PDFDocument.load(await cropPages(await pdf(), [0], { top: 100, right: 100, bottom: 100, left: 100 }))
    expect(out.getPage(0).getMediaBox()).toMatchObject({ width: 600, height: 800 })
    expect(out.getPage(0).getCropBox()).toMatchObject({ width: 400, height: 600 })
  })
  it('crops each page by its own margins', async () => {
    const doc = await PDFDocument.create()
    doc.addPage([600, 800])
    doc.addPage([600, 800])
    const plan = oddEvenPlan([0, 1], { top: 0, right: 0, bottom: 0, left: 100 }, { top: 0, right: 100, bottom: 0, left: 0 })
    const out = await PDFDocument.load(await cropPagesEach(await doc.save(), plan))
    expect(out.getPage(0).getCropBox()).toMatchObject({ x: 100, width: 500 })
    expect(out.getPage(1).getCropBox()).toMatchObject({ x: 0, width: 500 })
  })
})
