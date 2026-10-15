import { describe, expect, it } from 'vitest'
import { deltaToPage, displayDims, stackTransform, toDisplay, toPage, turn, type Rotation } from './viewRotation'

const ROTATIONS: Rotation[] = [0, 90, 180, 270]
const size = { width: 600, height: 800 }

describe('viewRotation', () => {
  it('turn steps by 90 degrees and wraps', () => {
    expect(turn(0, 1)).toBe(90)
    expect(turn(270, 1)).toBe(0)
    expect(turn(0, -1)).toBe(270)
    expect(turn(90, -1)).toBe(0)
    expect(turn(turn(turn(turn(0, 1), 1), 1), 1)).toBe(0)
  })

  it('displayDims swaps width and height for 90 and 270 only', () => {
    expect(displayDims(size, 0)).toEqual(size)
    expect(displayDims(size, 180)).toEqual(size)
    expect(displayDims(size, 90)).toEqual({ width: 800, height: 600 })
    expect(displayDims(size, 270)).toEqual({ width: 800, height: 600 })
  })

  it.each(ROTATIONS)('toPage and toDisplay are inverses at %i degrees', (r) => {
    for (const [x, y] of [[0, 0], [10, 20], [600, 800], [123.5, 456.25]]) {
      const d = toDisplay(r, x, y, size)
      const p = toPage(r, d.u, d.v, size)
      expect(p.x).toBeCloseTo(x)
      expect(p.y).toBeCloseTo(y)
    }
  })

  it.each(ROTATIONS)('displayed points land inside the displayed box at %i degrees', (r) => {
    const dims = displayDims(size, r)
    const d = toDisplay(r, size.width, size.height, size)
    expect(d.u).toBeGreaterThanOrEqual(0)
    expect(d.v).toBeGreaterThanOrEqual(0)
    expect(d.u).toBeLessThanOrEqual(dims.width)
    expect(d.v).toBeLessThanOrEqual(dims.height)
  })

  it('maps the page origin to the expected corner', () => {
    expect(toDisplay(90, 0, 0, size)).toEqual({ u: 800, v: 0 })
    expect(toDisplay(180, 0, 0, size)).toEqual({ u: 600, v: 800 })
    expect(toDisplay(270, 0, 0, size)).toEqual({ u: 0, v: 600 })
  })

  it.each(ROTATIONS)('deltaToPage is consistent with toPage at %i degrees', (r) => {
    const a = toPage(r, 100, 100, size)
    const b = toPage(r, 130, 110, size)
    const d = deltaToPage(r, 30, 10)
    expect(b.x - a.x).toBeCloseTo(d.dx)
    expect(b.y - a.y).toBeCloseTo(d.dy)
  })

  it('stackTransform is undefined at 0 and set otherwise', () => {
    expect(stackTransform(0, 10, 20)).toBeUndefined()
    expect(stackTransform(90, 10, 20)).toContain('rotate(90deg)')
    expect(stackTransform(180, 10, 20)).toContain('rotate(180deg)')
    expect(stackTransform(270, 10, 20)).toContain('rotate(270deg)')
  })
})
