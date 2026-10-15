import { PDFDocument } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import { imagesToPdf, pageFor, textToPdf } from './createPdf'

/** A 1 x 1 red PNG. */
const PNG = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64'))

describe('pageFor', () => {
  it('gives a picture its own size at 96 dpi', () => {
    const { page, box } = pageFor(800, 600, 'image')
    expect(page).toEqual([600, 450])
    expect(box).toEqual({ x: 0, y: 0, w: 600, h: 450 })
  })
  it('fits a picture inside a standard page, turning the page sideways for a wide picture', () => {
    const wide = pageFor(1000, 500, 'a4')
    expect(wide.page[0]).toBeGreaterThan(wide.page[1])
    expect(wide.box.x).toBeGreaterThanOrEqual(18)
    expect(wide.box.w / wide.box.h).toBeCloseTo(2)
    const tall = pageFor(500, 1000, 'letter')
    expect(tall.page).toEqual([612, 792])
    expect(tall.box.y).toBeGreaterThanOrEqual(18)
  })
  it('keeps huge pictures inside the PDF page size limit', () => {
    expect(Math.max(...pageFor(50000, 40000, 'image').page)).toBeCloseTo(14000, 3)
  })
})

describe('imagesToPdf', () => {
  it('makes one page per picture', async () => {
    const out = await imagesToPdf(
      [
        { name: 'a.png', data: PNG },
        { name: 'b.png', data: PNG }
      ],
      'a4'
    )
    const doc = await PDFDocument.load(out)
    expect(doc.getPageCount()).toBe(2)
    expect(doc.getPage(0).getSize().width).toBeCloseTo(595.28, 1)
  })
})

describe('textToPdf', () => {
  it('wraps long lines and starts a new page when one is full', async () => {
    const text = Array.from({ length: 200 }, (_, i) => `Line ${i + 1} ` + 'word '.repeat(40)).join('\n')
    const doc = await PDFDocument.load(await textToPdf(text, { font: 'Helvetica', size: 11 }))
    expect(doc.getPageCount()).toBeGreaterThan(3)
  })
  it('does not stop at a character the font cannot show', async () => {
    const doc = await PDFDocument.load(await textToPdf('Price: 5 € and 中文 done\n\n\tIndented', { font: 'Times', size: 12 }))
    expect(doc.getPageCount()).toBe(1)
  })
  it('makes a page even for empty text', async () => {
    expect((await PDFDocument.load(await textToPdf('', { font: 'Courier', size: 10 }))).getPageCount()).toBe(1)
  })
})
