/**
 * Object snapping to the vector content of a page: path end points, mid points, intersections and the nearest
 * point on a line. Pure geometry; the segments come from PDFium (`readPathGeometry` in pdfiumRaw.ts).
 */
import type { Pt } from './annotations'

/** Straight pieces of a page's painted paths, in points from the top left of the page as shown. */
export interface PathGeometry {
  /** Five numbers per piece: x0, y0, x1, y1, and 1 when it is a straight segment (0 for a piece of a curve). */
  segs: Float32Array
  /** Two numbers per true vertex (path corners and curve ends): x, y. */
  verts: Float32Array
  /** True when the page had more than the limit and the rest was left out. */
  truncated?: boolean
}

export type SnapKind = 'end' | 'mid' | 'inter' | 'near'
export type SnapKinds = Record<SnapKind, boolean>
export const ALL_SNAPS: SnapKinds = { end: true, mid: true, inter: true, near: true }
export interface SnapHit {
  pt: Pt
  kind: SnapKind
}

const CELL = 24
const MAX_CANDIDATES = 40
const key = (cx: number, cy: number) => (cx + 4096) * 16384 + (cy + 4096)

/** Distance from p to segment a-b and the closest point. */
export function closestOnSegment(p: Pt, ax: number, ay: number, bx: number, by: number): { pt: Pt; d: number } {
  const dx = bx - ax
  const dy = by - ay
  const len2 = dx * dx + dy * dy
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((p.x - ax) * dx + (p.y - ay) * dy) / len2)) : 0
  const x = ax + t * dx
  const y = ay + t * dy
  return { pt: { x, y }, d: Math.hypot(p.x - x, p.y - y) }
}

/** Where two segments cross (end points included, with a small tolerance), or null for parallel or apart. */
export function segmentIntersection(a: number[], b: number[]): Pt | null {
  const rx = a[2] - a[0]
  const ry = a[3] - a[1]
  const sx = b[2] - b[0]
  const sy = b[3] - b[1]
  const den = rx * sy - ry * sx
  if (Math.abs(den) < 1e-9) return null
  const qx = b[0] - a[0]
  const qy = b[1] - a[1]
  const t = (qx * sy - qy * sx) / den
  const u = (qx * ry - qy * rx) / den
  const eps = 1e-6
  if (t < -eps || t > 1 + eps || u < -eps || u > 1 + eps) return null
  return { x: a[0] + t * rx, y: a[1] + t * ry }
}

/** A grid over a page's segments and vertices so a query only looks at what is near the pointer. */
export class SnapIndex {
  private segCells = new Map<number, number[]>()
  private vertCells = new Map<number, number[]>()

  constructor(private geom: PathGeometry) {
    const { segs, verts } = geom
    for (let i = 0; i < segs.length / 5; i++) {
      const x0 = segs[i * 5]
      const y0 = segs[i * 5 + 1]
      const x1 = segs[i * 5 + 2]
      const y1 = segs[i * 5 + 3]
      const steps = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / (CELL / 2)))
      let last = -1
      for (let s = 0; s <= steps; s++) {
        const k = key(Math.floor((x0 + ((x1 - x0) * s) / steps) / CELL), Math.floor((y0 + ((y1 - y0) * s) / steps) / CELL))
        if (k === last) continue
        last = k
        const list = this.segCells.get(k)
        if (list) {
          if (list[list.length - 1] !== i) list.push(i)
        } else this.segCells.set(k, [i])
      }
    }
    for (let i = 0; i < verts.length / 2; i++) {
      const k = key(Math.floor(verts[i * 2] / CELL), Math.floor(verts[i * 2 + 1] / CELL))
      const list = this.vertCells.get(k)
      if (list) list.push(i)
      else this.vertCells.set(k, [i])
    }
  }

  private cells(p: Pt, reach: number): number[] {
    const out: number[] = []
    for (let cx = Math.floor((p.x - reach) / CELL); cx <= Math.floor((p.x + reach) / CELL); cx++) {
      for (let cy = Math.floor((p.y - reach) / CELL); cy <= Math.floor((p.y + reach) / CELL); cy++) out.push(key(cx, cy))
    }
    return out
  }

  /**
   * The best snap within `reach` of `p`: an end point beats an intersection, which beats a mid point, which
   * beats the nearest point on a line. Only the kinds switched on are considered.
   */
  query(p: Pt, reach: number, kinds: SnapKinds): SnapHit | null {
    const { segs, verts } = this.geom
    const cells = this.cells(p, reach)

    if (kinds.end) {
      let best: SnapHit | null = null
      let bestD = reach
      const seen = new Set<number>()
      for (const c of cells) {
        for (const i of this.vertCells.get(c) ?? []) {
          if (seen.has(i)) continue
          seen.add(i)
          const d = Math.hypot(verts[i * 2] - p.x, verts[i * 2 + 1] - p.y)
          if (d <= bestD) {
            bestD = d
            best = { pt: { x: verts[i * 2], y: verts[i * 2 + 1] }, kind: 'end' }
          }
        }
      }
      if (best) return best
    }

    // Segments that pass within reach of the pointer.
    const near: { i: number; pt: Pt; d: number }[] = []
    const seen = new Set<number>()
    for (const c of cells) {
      for (const i of this.segCells.get(c) ?? []) {
        if (seen.has(i)) continue
        seen.add(i)
        const r = closestOnSegment(p, segs[i * 5], segs[i * 5 + 1], segs[i * 5 + 2], segs[i * 5 + 3])
        if (r.d <= reach) near.push({ i, ...r })
      }
    }
    if (!near.length) return null
    near.sort((a, b) => a.d - b.d)
    const cand = near.slice(0, MAX_CANDIDATES)
    const seg = (i: number) => [segs[i * 5], segs[i * 5 + 1], segs[i * 5 + 2], segs[i * 5 + 3]]

    if (kinds.inter) {
      let best: SnapHit | null = null
      let bestD = reach
      for (let a = 0; a < cand.length; a++) {
        for (let b = a + 1; b < cand.length; b++) {
          const x = segmentIntersection(seg(cand[a].i), seg(cand[b].i))
          if (!x) continue
          const d = Math.hypot(x.x - p.x, x.y - p.y)
          if (d <= bestD) {
            bestD = d
            best = { pt: x, kind: 'inter' }
          }
        }
      }
      if (best) return best
    }

    if (kinds.mid) {
      let best: SnapHit | null = null
      let bestD = reach
      for (const c of cand) {
        if (!segs[c.i * 5 + 4]) continue // not a straight segment: a piece of a curve has no mid point
        const mx = (segs[c.i * 5] + segs[c.i * 5 + 2]) / 2
        const my = (segs[c.i * 5 + 1] + segs[c.i * 5 + 3]) / 2
        const d = Math.hypot(mx - p.x, my - p.y)
        if (d <= bestD) {
          bestD = d
          best = { pt: { x: mx, y: my }, kind: 'mid' }
        }
      }
      if (best) return best
    }

    if (kinds.near) return { pt: cand[0].pt, kind: 'near' }
    return null
  }
}
