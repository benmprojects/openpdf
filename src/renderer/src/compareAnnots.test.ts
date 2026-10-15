import { describe, expect, it } from 'vitest'
import type { Annot, AnnotKind } from './annotations'
import { compareAnnots, takeTheirs } from './compareAnnots'

let id = 1
const mk = (kind: AnnotKind, x: number, extra: Partial<Annot> = {}): Annot => ({
  id: id++,
  page: 0,
  kind,
  color: '#e5322d',
  rects: [{ x, y: 100, w: 60, h: 20 }],
  text: '',
  fontSize: 12,
  lineWidth: 1,
  ...extra
})

describe('compareAnnots', () => {
  it('pairs matching comments and reports changes and comments only in one copy', () => {
    const mine = [mk('rectangle', 50, { text: 'a' }), mk('note', 200, { text: 'same' }), mk('highlight', 400)]
    const theirs = [
      mk('rectangle', 51, { text: 'a, revised' }), // moved 1 pt, text changed
      mk('note', 200, { text: 'same', replies: [{ id: 50, author: 'B', text: 'ok', date: '2026-10-15T00:00:00Z' }] }),
      mk('ellipse', 600) // only theirs
    ]
    const c = compareAnnots(mine, theirs)
    expect(c.same).toBe(0)
    expect(c.changed.map((x) => [x.mine.kind, x.diffs])).toEqual([
      ['rectangle', ['text']],
      ['note', ['replies']]
    ])
    expect(c.onlyMine.map((a) => a.kind)).toEqual(['highlight'])
    expect(c.onlyTheirs.map((a) => a.kind)).toEqual(['ellipse'])
  })
  it('does not pair comments on different pages or of different kinds', () => {
    const c = compareAnnots([mk('rectangle', 50)], [mk('ellipse', 50), mk('rectangle', 50, { page: 1 })])
    expect(c.onlyMine).toHaveLength(1)
    expect(c.onlyTheirs).toHaveLength(2)
  })
  it('takes their text and adds their missing replies', () => {
    const mine = mk('note', 0, { text: 'old', replies: [{ id: 1, author: 'A', text: 'x', date: '2026-01-01T00:00:00Z' }] })
    const theirs = mk('note', 0, { text: 'new', replies: [{ id: 9, author: 'A', text: 'x', date: '2026-01-01T00:00:00Z' }, { id: 10, author: 'B', text: 'y', date: '2026-01-02T00:00:00Z' }] })
    let n = 100
    const out = takeTheirs(mine, theirs, () => n++)
    expect(out.text).toBe('new')
    expect(out.replies?.map((r) => r.text)).toEqual(['x', 'y'])
    expect(out.replies?.[1].id).toBe(100)
  })
})
