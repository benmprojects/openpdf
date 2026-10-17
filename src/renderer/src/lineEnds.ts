/**
 * Line end styles (ISO 32000 12.5.6.7, /LE): what is drawn at the start and end of a line or polyline. The shapes are
 * worked out once here as plain geometry (page points, y down) and drawn by both the screen overlay and the PDF writer.
 */
import { arrowHeadPoints, type Pt } from './annotations'

export type LineEnd = 'None' | 'OpenArrow' | 'ClosedArrow' | 'ROpenArrow' | 'RClosedArrow' | 'Circle' | 'Square' | 'Diamond' | 'Slash' | 'Butt'

/** In the order offered to the person. */
export const LINE_ENDS: LineEnd[] = ['None', 'OpenArrow', 'ClosedArrow', 'ROpenArrow', 'RClosedArrow', 'Circle', 'Square', 'Diamond', 'Slash', 'Butt']

export const isLineEnd = (v: unknown): v is LineEnd => typeof v === 'string' && (LINE_ENDS as string[]).includes(v)

/** One piece of an end marker: a polygon (`closed`, filled with the line colour when `fill`) or an open polyline. */
export interface EndPath {
  pts: Pt[]
  closed: boolean
  fill: boolean
}

/** Size in points of a square, circle or diamond end marker for a line width. */
export const endSize = (lineWidth: number) => Math.max(6, lineWidth * 3.5)

/**
 * The marker at `tip`, for a line arriving from `from`. The open arrow is the same head the Arrow tool has always
 * drawn; the closed arrow is the same triangle, closed and filled.
 */
export function endShape(style: LineEnd, tip: Pt, from: Pt, lineWidth: number): EndPath[] {
  if (style === 'None') return []
  const dx = tip.x - from.x
  const dy = tip.y - from.y
  const len = Math.hypot(dx, dy) || 1
  const ux = dx / len
  const uy = dy / len
  // Along the line and across it.
  const at = (a: number, b: number): Pt => ({ x: tip.x + ux * a - uy * b, y: tip.y + uy * a + ux * b })
  const s = endSize(lineWidth)
  switch (style) {
    case 'OpenArrow':
    case 'ClosedArrow': {
      const [l, t, r] = arrowHeadPoints(from, tip, lineWidth)
      return [{ pts: [l, t, r], closed: style === 'ClosedArrow', fill: style === 'ClosedArrow' }]
    }
    case 'ROpenArrow':
    case 'RClosedArrow': {
      // Pointing back along the line, with the tip on the line end.
      const [l, , r] = arrowHeadPoints(tip, from, lineWidth)
      // arrowHeadPoints(tip, from) puts its tip at `from`; move the head so its tip sits at `tip`.
      const mv = (p: Pt): Pt => ({ x: p.x + (tip.x - from.x), y: p.y + (tip.y - from.y) })
      return [{ pts: [mv(l), tip, mv(r)], closed: style === 'RClosedArrow', fill: style === 'RClosedArrow' }]
    }
    case 'Circle': {
      const pts: Pt[] = []
      for (let i = 0; i < 24; i++) {
        const a = (i / 24) * Math.PI * 2
        pts.push(at((Math.cos(a) * s) / 2, (Math.sin(a) * s) / 2))
      }
      return [{ pts, closed: true, fill: false }]
    }
    case 'Square':
      return [{ pts: [at(-s / 2, -s / 2), at(s / 2, -s / 2), at(s / 2, s / 2), at(-s / 2, s / 2)], closed: true, fill: false }]
    case 'Diamond':
      return [{ pts: [at(-s / 2, 0), at(0, -s / 2), at(s / 2, 0), at(0, s / 2)], closed: true, fill: false }]
    case 'Butt':
      return [{ pts: [at(0, -s / 2), at(0, s / 2)], closed: false, fill: false }]
    case 'Slash': {
      // Across the line, leaning 30 degrees from square.
      const a = Math.PI / 6
      const h = s * 0.7
      return [{ pts: [at(-Math.sin(a) * h, -Math.cos(a) * h), at(Math.sin(a) * h, Math.cos(a) * h)], closed: false, fill: false }]
    }
  }
}

/** Both ends of a path: the start marker looks back along the first segment, the end marker along the last. */
export function pathEnds(pts: Pt[], start: LineEnd, end: LineEnd, lineWidth: number): EndPath[] {
  if (pts.length < 2) return []
  const out: EndPath[] = []
  // A line ends where the marker is drawn: the same two points, from the other side for the start.
  if (start !== 'None') out.push(...endShape(start, pts[0], pts[1], lineWidth))
  if (end !== 'None') out.push(...endShape(end, pts[pts.length - 1], pts[pts.length - 2], lineWidth))
  return out
}
