import { PDFDocument } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import { blankPages, inkPercent, pagesToDelete } from './blankPages'
import { swapPages } from './pageOps'

const image = (w: number, h: number, paint: (x: number, y: number) => boolean) => {
  const d = new Uint8Array(w * h * 4).fill(255)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (paint(x, y)) d.fill(0, (y * w + x) * 4, (y * w + x) * 4 + 3)
  return d
}

describe('inkPercent', () => {
  it('is zero for a white page and counts dark pixels', () => {
    expect(
      inkPercent(
        image(10, 10, () => false),
        10,
        10
      )
    ).toBe(0)
    expect(
      inkPercent(
        image(10, 10, (x) => x < 5),
        10,
        10
      )
    ).toBe(50)
  })
  it('leaves the margin out', () => {
    // A dark frame two pixels wide on a 50 x 50 page: ignored with a 5% margin (2 px).
    const framed = image(50, 50, (x, y) => x < 2 || y < 2 || x >= 48 || y >= 48)
    expect(inkPercent(framed, 50, 50, 0)).toBeGreaterThan(10)
    expect(inkPercent(framed, 50, 50, 5)).toBe(0)
  })
  it('does not count transparent pixels or light grey', () => {
    const t = new Uint8Array(4 * 4).fill(0)
    expect(inkPercent(t, 2, 2)).toBe(0)
    expect(inkPercent(new Uint8Array(4 * 4).fill(230), 2, 2)).toBe(0)
  })
})

describe('choosing the pages to delete', () => {
  const ink = [5, 0, 0.05, 12, 0.5]
  it('takes pages under the threshold', () => {
    expect(blankPages(ink, 0.1)).toEqual([1, 2])
    expect(blankPages(ink, 1)).toEqual([1, 2, 4])
  })
  it('leaves out pages kept by hand and says when nothing is left to delete', () => {
    expect(pagesToDelete(ink, 0.1, new Set([2])).pages).toEqual([1])
    expect(pagesToDelete(ink, 0.1, new Set([1, 2])).error).toMatch(/No pages/)
  })
  it('refuses to delete everything', () => {
    expect(pagesToDelete([0, 0], 1, new Set()).error).toMatch(/at least one page/)
  })
})

describe('swapPages', () => {
  it('exchanges two pages and keeps the others', async () => {
    const d = await PDFDocument.create()
    for (const w of [100, 200, 300, 400]) d.addPage([w, 50])
    const out = await PDFDocument.load(await swapPages(await d.save(), 0, 2))
    expect(out.getPages().map((p) => p.getWidth())).toEqual([300, 200, 100, 400])
  })
  it('refuses the same page or a page that is not there', async () => {
    const d = await PDFDocument.create()
    d.addPage()
    d.addPage()
    const bytes = await d.save()
    await expect(swapPages(bytes, 1, 1)).rejects.toThrow()
    await expect(swapPages(bytes, 0, 5)).rejects.toThrow()
  })
})
