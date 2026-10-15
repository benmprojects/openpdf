import { describe, expect, it } from 'vitest'
import type { Annot } from './annotations'
import { alignAnnots, boundsOf, distributeAnnots, restack } from './arrange'

const box = (id: number, x: number, y: number, w: number, h: number, page = 0): Annot => ({ id, page, kind: 'rectangle', color: '#e5322d', rects: [{ x, y, w, h }], text: '', fontSize: 12, lineWidth: 1 })
const at = (list: Annot[], id: number) => boundsOf(list.find((a) => a.id === id)!)

describe('arrange', () => {
  const list = [box(1, 10, 10, 20, 20), box(2, 50, 40, 40, 10), box(3, 120, 25, 10, 30), box(4, 300, 300, 5, 5)]
  const sel = new Set([1, 2, 3])

  it('aligns edges and centres to the selection box, leaving other annotations alone', () => {
    expect(at(alignAnnots(list, sel, 'left'), 3).x).toBe(10)
    expect(at(alignAnnots(list, sel, 'right'), 1).x).toBe(110)
    expect(at(alignAnnots(list, sel, 'centre'), 2).x + 20).toBe(70)
    expect(at(alignAnnots(list, sel, 'top'), 3).y).toBe(10)
    expect(at(alignAnnots(list, sel, 'bottom'), 1).y).toBe(35)
    expect(at(alignAnnots(list, sel, 'middle'), 2).y + 5).toBe(32.5)
    expect(at(alignAnnots(list, sel, 'left'), 4)).toEqual({ x: 300, y: 300, w: 5, h: 5 })
  })

  it('needs two annotations to align and three to distribute, per page', () => {
    expect(alignAnnots(list, new Set([1]), 'left')).toEqual(list)
    expect(distributeAnnots(list, new Set([1, 2]), 'horizontal')).toEqual(list)
    const split = [box(1, 0, 0, 10, 10, 0), box(2, 40, 0, 10, 10, 1), box(3, 90, 0, 10, 10, 0)]
    expect(alignAnnots(split, new Set([1, 2, 3]), 'right').map((a) => boundsOf(a).x)).toEqual([90, 40, 90])
  })

  it('distributes with equal gaps and keeps the outer two in place', () => {
    const out = distributeAnnots(list, sel, 'horizontal')
    // Widths 20, 40, 10 between x 10 and 130: gap (120 - 70) / 2 = 25.
    expect(at(out, 1).x).toBe(10)
    expect(at(out, 2).x).toBe(55)
    expect(at(out, 3).x).toBe(120)
    const v = distributeAnnots(list, sel, 'vertical')
    // Heights 20, 30, 10 between y 10 and 50 overlap, so the gap is -10: 1 at 10, 3 at 20, 2 at 40.
    expect(at(v, 1).y).toBe(10)
    expect(at(v, 3).y).toBe(20)
    expect(at(v, 2).y).toBe(40)
  })

  it('changes the stacking order', () => {
    const order = (l: Annot[]) => l.map((a) => a.id)
    expect(order(restack(list, new Set([1]), 'front'))).toEqual([2, 3, 4, 1])
    expect(order(restack(list, new Set([4]), 'back'))).toEqual([4, 1, 2, 3])
    expect(order(restack(list, new Set([1]), 'forward'))).toEqual([2, 1, 3, 4])
    expect(order(restack(list, new Set([3]), 'backward'))).toEqual([1, 3, 2, 4])
    expect(order(restack(list, new Set([1, 2]), 'forward'))).toEqual([3, 1, 2, 4])
    expect(order(restack(list, new Set([4]), 'forward'))).toEqual([1, 2, 3, 4])
    expect(order(restack(list, new Set([1]), 'backward'))).toEqual([1, 2, 3, 4])
  })
})
