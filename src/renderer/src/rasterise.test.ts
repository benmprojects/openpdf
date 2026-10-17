import { PDFDocument } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import { rasterisePages, rasteriseScale } from './rasterise'

async function sample(): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const a = doc.addPage([200, 100])
  a.drawText('first')
  const b = doc.addPage([300, 400])
  b.drawText('second')
  b.setRotation({ type: 'degrees' as never, angle: 90 } as never)
  doc.addPage([100, 100]).drawText('third')
  const form = doc.getForm()
  const f = form.createTextField('name')
  f.addToPage(a, { x: 10, y: 10, width: 80, height: 20 })
  return doc.save()
}

describe('rasteriseScale', () => {
  it('caps the resolution and the pixel count', () => {
    expect(rasteriseScale(150, 595, 842)).toBeCloseTo(150 / 72)
    expect(rasteriseScale(5000, 595, 842)).toBeCloseTo(600 / 72)
    expect(rasteriseScale(600, 14000, 14000)).toBeLessThan(600 / 72)
  })
})

describe('rasterisePages', () => {
  it('replaces the chosen pages with one picture each, at their displayed size', async () => {
    const bytes = await sample()
    const out = await rasterisePages(
      bytes,
      { dpi: 72, pages: [0, 1], format: 'flate', quality: 0.8 },
      {
        pages: [{ width: 200, height: 100 }, { width: 400, height: 300 }, { width: 100, height: 100 }],
        render: async (p, scale) => {
          const size = p === 0 ? [200, 100] : [400, 300]
          const w = Math.round(size[0] * scale)
          const h = Math.round(size[1] * scale)
          return { width: w, height: h, data: new Uint8Array(w * h * 4) }
        },
      }
    )
    expect(out.pages).toBe(2)
    expect(out.annotationsFlattened).toBe(1)
    const doc = await PDFDocument.load(out.bytes)
    expect(doc.getPageCount()).toBe(3)
    expect(doc.getPage(0).getSize()).toEqual({ width: 200, height: 100 })
    expect(doc.getPage(1).getSize()).toEqual({ width: 400, height: 300 })
    expect(doc.getPage(1).getRotation().angle).toBe(0)
    expect(doc.getPage(0).node.Annots()?.size() ?? 0).toBe(0)
    // The form lost its only field; the untouched page is unchanged.
    expect(doc.getForm().getFields()).toHaveLength(0)
    expect(doc.getPage(2).getSize()).toEqual({ width: 100, height: 100 })
  })
})
