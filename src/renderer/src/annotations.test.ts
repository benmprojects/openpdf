import { describe, expect, it } from 'vitest'
import { cloudCurves, eraseFromPaths } from './annotations'

const line = Array.from({ length: 11 }, (_, i) => ({ x: i * 10, y: 0 }))

describe('eraseFromPaths', () => {
  it('splits a stroke where the eraser crosses it', () => {
    const out = eraseFromPaths([line], [{ x: 50, y: -20 }, { x: 50, y: 20 }], 6)!
    expect(out).toHaveLength(2)
    expect(out[0].at(-1)!.x).toBe(40)
    expect(out[1][0].x).toBe(60)
  })
  it('drops a stroke rubbed out entirely, and reports no change when missed', () => {
    expect(eraseFromPaths([line], line, 3)).toEqual([])
    expect(eraseFromPaths([line], [{ x: 0, y: 50 }], 5)).toBeNull()
  })
})

describe('cloudCurves', () => {
  it('bulges outwards whichever way the corners were clicked', () => {
    const square = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }]
    for (const pts of [square, [...square].reverse()]) {
      const { curves } = cloudCurves(pts, 2)
      // Every control point lies outside the square.
      const outside = curves.every(([c1]) => c1.x < 0 || c1.x > 100 || c1.y < 0 || c1.y > 100)
      expect(outside).toBe(true)
    }
  })
})
