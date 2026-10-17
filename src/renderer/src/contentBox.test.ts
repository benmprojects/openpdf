import { describe, expect, it } from 'vitest'
import { fitVisible, rotateFrac, samplePages, trimBox } from './contentBox'

/** A white RGBA bitmap with a black rectangle (pixel coordinates, end exclusive). */
function bitmap(w: number, h: number, ink?: { x0: number; y0: number; x1: number; y1: number }): Uint8Array {
  const d = new Uint8Array(w * h * 4).fill(255)
  if (ink) {
    for (let y = ink.y0; y < ink.y1; y++) {
      for (let x = ink.x0; x < ink.x1; x++) {
        const i = (y * w + x) * 4
        d[i] = d[i + 1] = d[i + 2] = 0
      }
    }
  }
  return d
}

describe('content box', () => {
  it('trims the white margins', () => {
    const b = trimBox(bitmap(100, 200, { x0: 10, y0: 20, x1: 60, y1: 120 }), 100, 200)!
    expect(b).toEqual({ x0: 0.1, y0: 0.1, x1: 0.6, y1: 0.6 })
  })

  it('returns null for a blank page, and ignores transparent pixels', () => {
    expect(trimBox(bitmap(50, 50), 50, 50)).toBeNull()
    const d = bitmap(10, 10, { x0: 0, y0: 0, x1: 10, y1: 10 })
    for (let i = 3; i < d.length; i += 4) d[i] = 0
    expect(trimBox(d, 10, 10)).toBeNull()
  })

  it('turns a box with the view', () => {
    const b = { x0: 0.1, y0: 0.2, x1: 0.5, y1: 0.4 }
    const r90 = rotateFrac(b, 90)
    expect(r90.x0).toBeCloseTo(0.6)
    expect(r90.x1).toBeCloseTo(0.8)
    expect(r90.y0).toBeCloseTo(0.1)
    expect(r90.y1).toBeCloseTo(0.5)
    expect(rotateFrac(rotateFrac(b, 90), 90)).toEqual(expect.objectContaining({ x0: expect.closeTo(0.5), x1: expect.closeTo(0.9) }))
    expect(rotateFrac(b, 0)).toBe(b)
  })

  it('works out how much of the width the content takes', () => {
    const fit = fitVisible([{ x0: 0.2, y0: 0, x1: 0.7, y1: 1 }, null, { x0: 0.25, y0: 0, x1: 0.8, y1: 1 }], 0)!
    expect(fit.left).toBeCloseTo(0.18)
    expect(fit.ratio).toBeCloseTo(0.8 + 0.02 - 0.18)
    expect(fitVisible([null, null], 0)).toBeNull()
  })

  it('never zooms in on a sliver', () => {
    expect(fitVisible([{ x0: 0.5, y0: 0, x1: 0.52, y1: 1 }], 0)!.ratio).toBe(0.25)
  })

  it('samples a long document evenly, keeping the current page', () => {
    expect(samplePages(5, 2)).toEqual([0, 1, 2, 3, 4])
    const s = samplePages(500, 123, 40)
    expect(s.length).toBeLessThanOrEqual(40)
    expect(s).toContain(123)
    expect(s[0]).toBe(0)
    expect(s[s.length - 1]).toBe(499)
  })
})
