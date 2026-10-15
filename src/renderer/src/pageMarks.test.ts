import { PDFDocument, degrees } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import { addBackground, addHeaderFooter, addWatermark, batesNumber, cropPages, expandTokens, marksPresent, removeMarks, resizePages } from './pageMarks'

async function pdf(n = 3, rotate = 0): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  for (let i = 0; i < n; i++) {
    const p = doc.addPage([595, 842])
    p.drawText(`Page ${i + 1}`, { x: 50, y: 800 })
    if (rotate) p.setRotation(degrees(rotate))
  }
  return doc.save()
}

describe('tokens', () => {
  it('expands page, pages, label, date, file and Bates tokens', () => {
    expect(expandTokens('Page <<page>> of <<pages>> (<<label>>) <<file>> <<bates>> <<date>>', { page: 2, pages: 9, label: 'ii', date: '15/10/2026', file: 'a.pdf', bates: 'EPC000123' })).toBe(
      'Page 2 of 9 (ii) a.pdf EPC000123 15/10/2026'
    )
    expect(batesNumber({ prefix: 'EPC', suffix: '-A', start: 7, digits: 6 }, 3)).toBe('EPC000010-A')
  })
})

describe('marks', () => {
  it('adds a header and footer to chosen pages and removes them again', async () => {
    const out = await addHeaderFooter(
      await pdf(),
      { slots: { tc: 'Header <<file>>', br: 'Page <<page>> of <<pages>>' }, fontSize: 9, font: 'Helvetica', color: '#333333', margin: 24, pages: [0, 2], startNumber: 1 },
      { fileName: 'test.pdf', labels: null }
    )
    expect(await marksPresent(out)).toEqual(new Set(['HeaderFooter']))
    const doc = await PDFDocument.load(out)
    expect(doc.getPage(1).node.Contents()).toBeDefined()
    const { bytes, removed } = await removeMarks(out, ['HeaderFooter'])
    expect(removed).toBe(2)
    expect(await marksPresent(bytes)).toEqual(new Set())
  })
  it('adds text and image watermarks over or behind the content, and a background', async () => {
    let b = await addWatermark(await pdf(2, 90), { kind: 'text', text: 'DRAFT', font: 'Helvetica', fontSize: 72, color: '#ff0000', opacity: 0.3, angle: 45, scale: 0.5, behind: false, pages: [0, 1] })
    b = await addBackground(b, { color: '#fffbe0', opacity: 1, pages: [0] })
    expect(await marksPresent(b)).toEqual(new Set(['Watermark', 'Background']))
    expect((await removeMarks(b, ['Watermark'])).removed).toBe(2)
  })
})

describe('boxes', () => {
  it('crops by margins on a rotated page, measured as displayed', async () => {
    // /Rotate 90 turns the page clockwise: the displayed top is the left-hand side of the unrotated page.
    const out = await cropPages(await pdf(1, 90), [0], { top: 100, right: 0, bottom: 0, left: 0 })
    const cb = (await PDFDocument.load(out)).getPage(0).getCropBox()
    expect([cb.x, cb.y, cb.width, cb.height].map(Math.round)).toEqual([100, 0, 495, 842])
  })
  it('resizes A4 to A3 with the content scaled to fit', async () => {
    const out = await resizePages(await pdf(1), [0], 842, 1191, true)
    const mb = (await PDFDocument.load(out)).getPage(0).getMediaBox()
    expect([mb.width, mb.height].map(Math.round)).toEqual([842, 1191])
  })
})
