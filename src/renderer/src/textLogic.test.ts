import { describe, expect, it } from 'vitest'
import { comparePos, findInPage, hitTest, normaliseNewlines, rangeRects, sliceText } from './textLogic'
import type { PageText } from './pdfiumRaw'

/** Boxes for `count` characters laid out on one line, 10 wide and 10 high each, starting at (x0, y0). */
function lineBoxes(count: number, x0: number, y0: number): number[] {
  const out: number[] = []
  for (let i = 0; i < count; i++) out.push(x0 + i * 10, y0, x0 + i * 10 + 10, y0 + 10)
  return out
}

function pageText(text: string, boxes: number[]): PageText {
  return { text, boxes: new Float32Array(boxes), charOf: Int32Array.from({ length: text.length }, (_, i) => i) }
}

describe('hitTest', () => {
  const boxes = new Float32Array([...lineBoxes(3, 0, 0), ...lineBoxes(3, 0, 30)])
  it('returns the character under the pointer', () => {
    expect(hitTest(boxes, 15, 5)).toBe(1)
    expect(hitTest(boxes, 25, 35)).toBe(5)
  })
  it('picks the nearest character outside any box, preferring the same line', () => {
    expect(hitTest(boxes, 100, 5)).toBe(2)
    expect(hitTest(boxes, -20, 36)).toBe(3)
  })
  it('returns -1 for a page with no text', () => {
    expect(hitTest(new Float32Array(), 5, 5)).toBe(-1)
  })
  it('skips characters with empty boxes', () => {
    const b = new Float32Array([0, 0, 0, 0, 10, 0, 20, 10])
    expect(hitTest(b, 1, 1)).toBe(1)
  })
})

describe('rangeRects', () => {
  it('merges adjacent characters on a line into one rectangle', () => {
    const boxes = new Float32Array(lineBoxes(5, 0, 0))
    expect(rangeRects(boxes, 1, 3)).toEqual([{ x: 10, y: 0, w: 30, h: 10 }])
  })
  it('returns one rectangle per line', () => {
    const boxes = new Float32Array([...lineBoxes(3, 0, 0), ...lineBoxes(3, 0, 30)])
    expect(rangeRects(boxes, 0, 5)).toEqual([
      { x: 0, y: 0, w: 30, h: 10 },
      { x: 0, y: 30, w: 30, h: 10 }
    ])
  })
  it('splits when there is a large horizontal gap on the same line', () => {
    const boxes = new Float32Array([0, 0, 10, 10, 100, 0, 110, 10])
    expect(rangeRects(boxes, 0, 1)).toHaveLength(2)
  })
  it('clamps out-of-range indices and skips empty boxes', () => {
    const boxes = new Float32Array([0, 0, 10, 10, 0, 0, 0, 0, 10, 0, 20, 10])
    expect(rangeRects(boxes, -5, 99)).toEqual([{ x: 0, y: 0, w: 20, h: 10 }])
    expect(rangeRects(boxes, 3, 2)).toEqual([])
  })
})

describe('comparePos', () => {
  it('orders by page then character', () => {
    expect(comparePos({ page: 0, char: 9 }, { page: 1, char: 0 })).toBeLessThan(0)
    expect(comparePos({ page: 1, char: 2 }, { page: 1, char: 5 })).toBeLessThan(0)
    expect(comparePos({ page: 2, char: 2 }, { page: 2, char: 2 })).toBe(0)
    expect(comparePos({ page: 3, char: 0 }, { page: 2, char: 9 })).toBeGreaterThan(0)
  })
})

describe('sliceText', () => {
  it('returns text for an inclusive character range', () => {
    const pt = pageText('Hello world', lineBoxes(11, 0, 0))
    expect(sliceText(pt, 0, 4)).toBe('Hello')
    expect(sliceText(pt, 6, 10)).toBe('world')
  })
  it('keeps all UTF-16 units that belong to a character', () => {
    const pt: PageText = { text: 'a\u{1F600}b', boxes: new Float32Array(12), charOf: Int32Array.from([0, 1, 1, 2]) }
    expect(sliceText(pt, 1, 1)).toBe('\u{1F600}')
    expect(sliceText(pt, 0, 2)).toBe('a\u{1F600}b')
  })
  it('returns an empty string outside the page text', () => {
    expect(sliceText(pageText('abc', lineBoxes(3, 0, 0)), 10, 12)).toBe('')
  })
})

describe('normaliseNewlines', () => {
  it('converts CRLF and CR to LF', () => {
    expect(normaliseNewlines('a\r\nb\rc\nd')).toBe('a\nb\nc\nd')
  })
})

describe('findInPage', () => {
  const text = 'The quick brown fox. Foxes and FOX, a fox!'
  const pt = pageText(text, lineBoxes(text.length, 0, 0))
  it('finds matches case-insensitively by default', () => {
    const m = findInPage(pt, 2, 'fox', false, false)
    expect(m.map((x) => x.from)).toEqual([16, 21, 31, 38])
    expect(m[0]).toEqual({ page: 2, from: 16, to: 18 })
  })
  it('honours match case', () => {
    expect(findInPage(pt, 0, 'fox', true, false).map((x) => x.from)).toEqual([16, 38])
  })
  it('honours whole word', () => {
    expect(findInPage(pt, 0, 'fox', false, true).map((x) => x.from)).toEqual([16, 31, 38])
  })
  it('returns nothing for an empty query or no match', () => {
    expect(findInPage(pt, 0, '', false, false)).toEqual([])
    expect(findInPage(pt, 0, 'zebra', false, false)).toEqual([])
  })
  it('maps matches through charOf', () => {
    const p: PageText = { text: 'ab', boxes: new Float32Array(8), charOf: Int32Array.from([5, 9]) }
    expect(findInPage(p, 0, 'ab', false, false)).toEqual([{ page: 0, from: 5, to: 9 }])
  })
})
