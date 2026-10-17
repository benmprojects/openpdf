import { describe, expect, it } from 'vitest'
import { alreadyLinked, matchLinksForPage, urlLinksForPage } from './linkMake'
import type { PageText } from './pdfiumRaw'

/** A page of one line of text, every character 6 wide and 10 high, starting at x = 10, y = 20. */
function pageOf(text: string): PageText {
  const boxes = new Float32Array(text.length * 4)
  const charOf = new Int32Array(text.length)
  for (let i = 0; i < text.length; i++) {
    boxes.set([10 + i * 6, 20, 16 + i * 6, 30], i * 4)
    charOf[i] = i
  }
  return { text, boxes, charOf }
}

const opts = { regex: false, matchCase: false, wholeWord: false }

describe('links made from page text', () => {
  const pt = pageOf('Visit https://example.com/specs now, or www.example.org.')

  it('puts a box over each web address and not over the punctuation after it', () => {
    const links = urlLinksForPage(0, pt, [])
    expect(links.map((l) => l.target.linkUri)).toEqual(['https://example.com/specs', 'https://www.example.org'])
    const first = links[0].rect
    expect(first.x).toBe(10 + 6 * 6)
    expect(first.w).toBe('https://example.com/specs'.length * 6)
    expect(first.y).toBe(20)
    expect(first.h).toBe(10)
  })

  it('leaves addresses that already have a link', () => {
    const existing = [{ page: 0, rects: [{ x: 46, y: 20, w: 150, h: 10 }] }]
    expect(urlLinksForPage(0, pt, existing).map((l) => l.target.linkUri)).toEqual(['https://www.example.org'])
    expect(urlLinksForPage(1, pt, existing)).toHaveLength(2)
  })

  it('links every place a phrase appears, to one target', () => {
    const text = pageOf('See Section 4 and section 4 again; subsection 4.')
    const hits = matchLinksForPage(0, text, 'section 4', { ...opts, matchCase: false }, { linkPage: 3 }, [])
    expect(hits).toHaveLength(3)
    expect(hits.every((h) => h.target.linkPage === 3)).toBe(true)
    expect(matchLinksForPage(0, text, 'section 4', { ...opts, matchCase: true }, { linkPage: 3 }, [])).toHaveLength(2)
    expect(matchLinksForPage(0, text, 'section 4', { ...opts, wholeWord: true }, { linkPage: 3 }, [])).toHaveLength(2)
  })

  it('accepts a pattern', () => {
    const text = pageOf('Drawings C-101, C-102 and D-7.')
    const hits = matchLinksForPage(0, text, 'C-\\d+', { ...opts, regex: true }, { linkUri: 'https://example.com/' }, [])
    expect(hits).toHaveLength(2)
  })

  it('treats a box that is mostly under a link as linked', () => {
    const rect = { x: 0, y: 0, w: 30, h: 10 }
    expect(alreadyLinked(rect, 0, [{ page: 0, rects: [{ x: 0, y: 0, w: 15, h: 10 }] }])).toBe(true)
    expect(alreadyLinked(rect, 0, [{ page: 0, rects: [{ x: 25, y: 0, w: 15, h: 10 }] }])).toBe(false)
    expect(alreadyLinked(rect, 1, [{ page: 0, rects: [rect] }])).toBe(false)
  })
})
