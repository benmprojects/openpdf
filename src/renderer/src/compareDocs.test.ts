import { describe, expect, it } from 'vitest'
import { diffTokens, groupChanges, padTo, tokenise, visualDiff } from './compareDocs'

const words = (a: string[], b: string[]) => groupChanges(diffTokens(tokenise(a), tokenise(b)))

describe('text comparison', () => {
  it('finds nothing in identical documents', () => {
    expect(words(['the cat sat'], ['the cat sat'])).toEqual([])
  })

  it('reports a changed word with its context and page', () => {
    const c = words(['Payment is due in thirty days from the invoice date.', 'Second page text.'], ['Payment is due in forty days from the invoice date.', 'Second page text.'])
    expect(c).toHaveLength(1)
    expect(c[0]).toMatchObject({ removed: 'thirty', added: 'forty', pageA: 0, pageB: 0, before: 'Payment is due in', after: 'days from the invoice date. Second page text.'.split(' ').slice(0, 6).join(' ') })
  })

  it('reports an insertion and a deletion separately, with their own pages', () => {
    const c = words(['one two three', 'four five six'], ['one two three extra words', 'four six'])
    expect(c.map((x) => [x.removed, x.added])).toEqual([
      ['', 'extra words'],
      ['five', '']
    ])
    expect(c[0].pageB).toBe(0)
    expect(c[1].pageA).toBe(1)
  })

  it('copes with whole paragraphs added in the middle and pages that shift', () => {
    const base = Array.from({ length: 200 }, (_, i) => `word${i}`).join(' ')
    const a = [base]
    const b = [base.replace('word100 ', 'word100 NEW PARAGRAPH HERE ')]
    const c = words(a, b)
    expect(c).toHaveLength(1)
    expect(c[0].added).toBe('NEW PARAGRAPH HERE')
  })

  it('gives up gracefully on documents with nothing in common', () => {
    const a = tokenise([Array.from({ length: 300 }, (_, i) => `a${i}`).join(' ')])
    const b = tokenise([Array.from({ length: 300 }, (_, i) => `b${i}`).join(' ')])
    const ops = diffTokens(a, b, 50)
    expect(ops.filter((o) => o.type === 'del')).toHaveLength(300)
    expect(ops.filter((o) => o.type === 'add')).toHaveLength(300)
  })

  it('handles an empty side', () => {
    expect(words([''], ['all new text'])).toEqual([expect.objectContaining({ removed: '', added: 'all new text' })])
    expect(words(['all old text'], [''])).toEqual([expect.objectContaining({ removed: 'all old text', added: '' })])
  })
})

const solid = (w: number, h: number, v: number) => new Uint8Array(w * h * 4).fill(v)

describe('visual comparison', () => {
  it('finds no difference in identical pictures', () => {
    const img = solid(10, 10, 255)
    expect(visualDiff(img, img, 10, 10).changed).toBe(0)
  })

  it('marks ink that only one side has, in different colours', () => {
    const a = solid(10, 10, 255)
    const b = solid(10, 10, 255)
    // a has a black pixel at (2,2); b has one at (7,7).
    for (const [img, x, y] of [[a, 2, 2], [b, 7, 7]] as const) {
      const i = (y * 10 + x) * 4
      img[i] = img[i + 1] = img[i + 2] = 0
    }
    const d = visualDiff(a, b, 10, 10)
    expect(d.changed).toBeCloseTo(0.02)
    const px = (x: number, y: number) => Array.from(d.overlay.slice((y * 10 + x) * 4, (y * 10 + x) * 4 + 3))
    expect(px(2, 2)[0]).toBeGreaterThan(px(2, 2)[2]) // red: only in the first
    expect(px(7, 7)[2]).toBeGreaterThan(px(7, 7)[0]) // blue: only in the second
  })

  it('pads a smaller picture with white before comparing', () => {
    const small = solid(4, 4, 0)
    const padded = padTo(small, 4, 4, 6, 5)
    expect(padded.length).toBe(6 * 5 * 4)
    expect(padded[(0 * 6 + 0) * 4]).toBe(0)
    expect(padded[(0 * 6 + 5) * 4]).toBe(255)
    expect(padded[(4 * 6 + 0) * 4]).toBe(255)
  })
})
