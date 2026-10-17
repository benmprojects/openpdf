import { describe, expect, it } from 'vitest'
import { ALL_SNAPS, closestOnSegment, segmentIntersection, SnapIndex, type PathGeometry } from './snap'

/** A 100 x 100 square with corners at (100,100) and a diagonal from its corner to the opposite one. */
function square(): PathGeometry {
  const lines = [
    [100, 100, 200, 100],
    [200, 100, 200, 200],
    [200, 200, 100, 200],
    [100, 200, 100, 100],
    [100, 100, 200, 200]
  ]
  return {
    segs: new Float32Array(lines.flatMap((l) => [...l, 1])),
    verts: new Float32Array([100, 100, 200, 100, 200, 200, 100, 200])
  }
}

describe('geometry', () => {
  it('finds the closest point on a segment, clamped to its ends', () => {
    expect(closestOnSegment({ x: 5, y: 3 }, 0, 0, 10, 0)).toEqual({ pt: { x: 5, y: 0 }, d: 3 })
    expect(closestOnSegment({ x: -4, y: 3 }, 0, 0, 10, 0).pt).toEqual({ x: 0, y: 0 })
  })
  it('intersects crossing segments and ignores parallel or apart ones', () => {
    expect(segmentIntersection([0, 0, 10, 10], [0, 10, 10, 0])).toEqual({ x: 5, y: 5 })
    expect(segmentIntersection([0, 0, 10, 0], [0, 1, 10, 1])).toBeNull()
    expect(segmentIntersection([0, 0, 1, 1], [5, 0, 5, 10])).toBeNull()
  })
})

describe('SnapIndex', () => {
  const idx = new SnapIndex(square())
  it('snaps to a corner first', () => {
    expect(idx.query({ x: 103, y: 102 }, 8, ALL_SNAPS)).toEqual({ pt: { x: 100, y: 100 }, kind: 'end' })
  })
  it('snaps to a mid point', () => {
    expect(idx.query({ x: 150, y: 103 }, 8, ALL_SNAPS)).toEqual({ pt: { x: 150, y: 100 }, kind: 'mid' })
  })
  it('snaps to the intersection of the diagonal with the square (corner end points off)', () => {
    const noEnd = { ...ALL_SNAPS, end: false }
    const hit = idx.query({ x: 197, y: 199 }, 8, noEnd)
    expect(hit?.kind).toBe('inter')
    expect(hit?.pt.x).toBeCloseTo(200)
    expect(hit?.pt.y).toBeCloseTo(200)
  })
  it('snaps to the nearest point on a line when nothing else is close', () => {
    const hit = idx.query({ x: 130, y: 104 }, 8, ALL_SNAPS)
    expect(hit?.kind).toBe('near')
    expect(hit?.pt.x).toBeCloseTo(130)
    expect(hit?.pt.y).toBeCloseTo(100)
  })
  it('respects the switches and the reach', () => {
    expect(idx.query({ x: 103, y: 102 }, 8, { end: false, mid: false, inter: false, near: false })).toBeNull()
    expect(idx.query({ x: 150, y: 150 }, 3, { ...ALL_SNAPS, inter: false })?.kind).toBe('mid') // the diagonal's mid point
    expect(idx.query({ x: 150, y: 155 }, 3, ALL_SNAPS)).toBeNull() // 3.5 from the diagonal: out of reach
    expect(idx.query({ x: 400, y: 400 }, 8, ALL_SNAPS)).toBeNull()
    expect(idx.query({ x: 150, y: 103 }, 8, { end: true, mid: false, inter: false, near: false })).toBeNull()
  })
  it('does not offer a mid point on a piece of a curve', () => {
    const curve = new SnapIndex({ segs: new Float32Array([0, 0, 10, 0, 0]), verts: new Float32Array([0, 0, 10, 0]) })
    expect(curve.query({ x: 5, y: 1 }, 4, { end: false, mid: true, inter: false, near: false })).toBeNull()
    expect(curve.query({ x: 5, y: 1 }, 4, ALL_SNAPS)?.kind).toBe('near')
  })
})
