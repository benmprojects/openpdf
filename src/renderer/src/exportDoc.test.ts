import { describe, expect, it } from 'vitest'
import { bodySize, pageFileName, scaleFor, structurePage, toDocx, toHtml, toPlainText } from './exportDoc'
import type { TextBlock } from './textBlocks'

const block = (text: string, y: number, size = 12, over: Partial<TextBlock> = {}, x = 50): TextBlock => ({
  ordinals: [0],
  text,
  rect: { x, y, w: 200, h: size },
  font: 'Helvetica',
  flags: 0,
  weight: 400,
  italic: false,
  size,
  color: '#000000',
  matrix: [1, 0, 0, 1, x, 800 - y],
  origins: [{ x, y: 800 - y }],
  reflow: false,
  layout: { firstX: x, restX: x, baselineY: 800 - y, leading: 0, width: 200 },
  ...over
})

describe('structure', () => {
  it('finds the body size and picks out headings by their size', () => {
    const page = [block('Annual report', 40, 24), block('A paragraph of ordinary body text that goes on for a while.', 100), block('Section one', 140, 17), block('More body text in the usual size and weight.', 170)]
    const body = bodySize([page])
    expect(body).toBe(12)
    const out = structurePage(page, body)
    expect(out.map((b) => b.heading)).toEqual([1, 0, 2, 0])
  })

  it('reads blocks top to bottom and left to right along a line', () => {
    const page = [block('second line', 100), block('right', 50, 12, {}, 300), block('left', 50, 12, {}, 50)]
    expect(structurePage(page, 12).map((b) => b.text)).toEqual(['left', 'right', 'second line'])
  })

  it('joins lines of one paragraph that arrive as separate blocks, but not paragraphs a gap apart', () => {
    const page = [block('First line of a paragraph', 100), block('and its second line.', 113), block('A new paragraph after a gap.', 160)]
    expect(structurePage(page, 12).map((b) => b.text)).toEqual(['First line of a paragraph and its second line.', 'A new paragraph after a gap.'])
  })

  it('leaves long text as a paragraph however large, and notes bold and italic', () => {
    const long = 'x'.repeat(300)
    const out = structurePage([block(long, 10, 30), block('Bold note', 50, 12, { weight: 700 }), block('Slanted', 80, 12, { italic: true })], 12)
    expect(out[0].heading).toBe(0)
    expect(out[1].bold).toBe(true)
    expect(out[2].italic).toBe(true)
  })
})

describe('output', () => {
  const pages = [
    [
      { text: 'Title <one>', heading: 1 as const, size: 24, bold: true, italic: false },
      { text: 'Body & more', heading: 0 as const, size: 12, bold: false, italic: false }
    ],
    [{ text: 'Second page', heading: 0 as const, size: 12, bold: true, italic: true }]
  ]
  it('writes escaped HTML with a section per page', () => {
    const html = toHtml('My "doc"', pages)
    expect(html).toContain('<title>My &quot;doc&quot;</title>')
    expect(html).toContain('<h1>Title &lt;one&gt;</h1>')
    expect(html).toContain('<p>Body &amp; more</p>')
    expect(html).toContain('<section id="page-2"')
    expect(html).toContain('<p><em><strong>Second page</strong></em></p>')
  })
  it('writes plain text with paragraphs and a form feed between pages', () => {
    expect(toPlainText(pages)).toBe('Title <one>\n\nBody & more\n\f\nSecond page')
  })
  it('writes a Word file (a zip with the document inside)', async () => {
    const bytes = await toDocx('Doc', pages)
    expect(Array.from(bytes.slice(0, 2))).toEqual([0x50, 0x4b])
    expect(Buffer.from(bytes).includes(Buffer.from('word/document.xml'))).toBe(true)
  })
  it('names page images with padded numbers and keeps big renders under the pixel limit', () => {
    expect(pageFileName('report', 0, 7, 'png')).toBe('report-page-001.png')
    expect(pageFileName('report', 11, 1200, 'jpg')).toBe('report-page-0012.jpg')
    expect(scaleFor(150, 612, 792)).toBeCloseTo(150 / 72)
    const huge = scaleFor(600, 2000, 3000)
    expect(2000 * huge * 3000 * huge).toBeLessThanOrEqual(60_000_001)
  })
})
