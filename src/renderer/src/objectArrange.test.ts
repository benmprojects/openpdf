import { describe, expect, it } from 'vitest'
import { alignBoxes, displayMoveToPage, distributeBoxes, type Box } from './objectArrange'

const boxes: Box[] = [
  { id: 'a', x: 10, y: 10, w: 20, h: 10 },
  { id: 'b', x: 50, y: 40, w: 40, h: 30 },
  { id: 'c', x: 120, y: 5, w: 10, h: 10 }
]

describe('alignBoxes', () => {
  it('lines edges up with the outer box', () => {
    expect(alignBoxes(boxes, 'left').get('b')).toEqual({ dx: -40, dy: 0 })
    expect(alignBoxes(boxes, 'right').get('a')).toEqual({ dx: 100, dy: 0 })
    expect(alignBoxes(boxes, 'top').get('a')).toEqual({ dx: 0, dy: -5 })
    expect(alignBoxes(boxes, 'bottom').get('a')).toEqual({ dx: 0, dy: 50 })
  })
  it('centres on the outer box and leaves a box that is already there', () => {
    const m = alignBoxes(boxes, 'centre')
    expect(m.has('b')).toBe(false)
    expect(m.get('a')).toEqual({ dx: 50, dy: 0 })
    expect(alignBoxes(boxes, 'middle').get('a')?.dy).toBeCloseTo(37.5 - 15)
  })
  it('does nothing for fewer than two boxes', () => {
    expect(alignBoxes([boxes[0]], 'left').size).toBe(0)
  })
})

describe('distributeBoxes', () => {
  it('makes the gaps equal and keeps the outer two', () => {
    const m = distributeBoxes(boxes, 'horizontal')
    // Widths 20, 40, 10 span 10..130: gaps are (120 - 70) / 2 = 25, so b starts at 10 + 20 + 25 = 55.
    expect(m.get('b')).toEqual({ dx: 5, dy: 0 })
    expect(m.has('a')).toBe(false)
    expect(m.has('c')).toBe(false)
  })
  it('needs three boxes', () => {
    expect(distributeBoxes(boxes.slice(0, 2), 'vertical').size).toBe(0)
  })
})

describe('displayMoveToPage', () => {
  it('flips the vertical move for an upright page (display y runs down, page y runs up)', () => {
    // Display to page for a 100 high page: x stays, y -> 100 - y.
    const m = displayMoveToPage([1, 0, 0, -1, 0, 100], { dx: 5, dy: 8 })!
    expect(m[4]).toBeCloseTo(5)
    expect(m[5]).toBeCloseTo(-8)
  })
})
