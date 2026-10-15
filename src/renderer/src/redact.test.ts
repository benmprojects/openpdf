import { describe, expect, it } from 'vitest'
import { hit, inside, redactContent, type PageObjects } from './redact'
import type { TextObject } from './pdfiumRaw'

const text = (ordinal: number, x: number, y: number, w: number, str = ''): TextObject => ({
  ordinal,
  rect: { x, y: y - 10, w, h: 12 },
  text: str,
  font: 'Helvetica',
  flags: 0,
  weight: 400,
  italic: false,
  embedded: false,
  size: 10,
  color: '#000000',
  mode: 0,
  // Page space: the line sits at x, 100 up from the bottom of a 200 point page.
  matrix: [1, 0, 0, 1, x, 200 - y]
})

const none = (): PageObjects => ({ texts: [], textTotal: 0, images: [], imageTotal: 0, paths: [], pathTotal: 0 })
const notImage = () => false

describe('redaction geometry', () => {
  it('hits objects whose centre or a tenth of whose area is in a mark', () => {
    const mark = { x: 10, y: 10, w: 50, h: 20 }
    expect(hit({ x: 20, y: 12, w: 10, h: 10 }, [mark])).toBe(true)
    expect(hit({ x: 45, y: 12, w: 100, h: 10 }, [mark])).toBe(true)
    expect(hit({ x: 70, y: 12, w: 10, h: 10 }, [mark])).toBe(false)
  })
  it('only counts shapes wholly inside a mark', () => {
    const mark = { x: 0, y: 0, w: 100, h: 100 }
    expect(inside({ x: 10, y: 10, w: 20, h: 20 }, [mark])).toBe(true)
    expect(inside({ x: 90, y: 10, w: 20, h: 20 }, [mark])).toBe(false)
  })
})

describe('redactContent', () => {
  it('removes a line of text that sits under a mark and leaves the others', () => {
    const src = 'BT /F1 10 Tf 20 100 Td (Secret) Tj 0 -20 Td (Public) Tj ET'
    const found: PageObjects = { ...none(), textTotal: 2, texts: [text(0, 20, 100, 40, 'Secret'), text(1, 20, 120, 40, 'Public')] }
    const r = redactContent(src, [{ x: 15, y: 88, w: 60, h: 14 }], found, 0, notImage)
    expect(r.src).not.toContain('Secret')
    expect(r.src).toContain('(Public) Tj')
    expect(r.report.text).toBe(1)
  })

  it('keeps later text in place by leaving blank space when it runs on from the removed text', () => {
    const src = 'BT /F1 10 Tf 20 100 Td (Secret) Tj (tail) Tj ET'
    const found: PageObjects = { ...none(), textTotal: 2, texts: [text(0, 20, 100, 40, 'Secret'), text(1, 60, 100, 20, 'tail')] }
    const r = redactContent(src, [{ x: 15, y: 88, w: 40, h: 14 }], found, 0, notImage)
    expect(r.src).not.toContain('Secret')
    expect(r.src).toContain('[-4000] TJ')
    expect(r.src).toContain('(tail) Tj')
  })

  it('refuses when PDFium and the stream disagree on how much text there is', () => {
    const src = 'BT /F1 10 Tf 20 100 Td (Secret) Tj ET'
    const found: PageObjects = { ...none(), textTotal: 3, texts: [text(0, 20, 100, 40)] }
    expect(() => redactContent(src, [{ x: 15, y: 88, w: 60, h: 14 }], found, 0, notImage)).toThrow(/did not match/)
  })

  it('removes an image under a mark and a rectangle wholly inside one', () => {
    const src = 'q 100 0 0 50 10 10 cm /Im1 Do Q 1 0 0 rg 20 150 30 10 re f 0 0 1 rg 150 150 30 10 re f'
    const found: PageObjects = {
      ...none(),
      imageTotal: 1,
      images: [{ ordinal: 0, rect: { x: 10, y: 140, w: 100, h: 50 }, matrix: [100, 0, 0, 50, 10, 10], pageBounds: [10, 10, 110, 60] }],
      pathTotal: 2,
      paths: [
        { ordinal: 0, rect: { x: 20, y: 40, w: 30, h: 10 }, matrix: [1, 0, 0, 1, 0, 0], pageBounds: [20, 150, 50, 160] },
        { ordinal: 1, rect: { x: 150, y: 40, w: 30, h: 10 }, matrix: [1, 0, 0, 1, 0, 0], pageBounds: [150, 150, 180, 160] }
      ]
    }
    const r = redactContent(src, [{ x: 0, y: 30, w: 120, h: 170 }], found, 0, (n) => n === 'Im1')
    expect(r.src).not.toContain('Do')
    expect(r.src).not.toContain('20 150 30 10 re')
    expect(r.src).toContain('150 150 30 10 re')
    expect(r.report).toMatchObject({ images: 1, shapes: 1 })
  })

  it('flags pages that draw forms', () => {
    const r = redactContent('/Fm1 Do', [], none(), 0, notImage)
    expect(r.forms).toBe(true)
  })
})
