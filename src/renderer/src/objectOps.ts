/**
 * Small pure helpers for editing page objects: transforms about a point (display space, y down), the crop outline of
 * a picture, line widths seen through an object's matrix, and colours as content-stream operators.
 */
import type { Matrix6 } from './content'

const rad = (deg: number) => (deg * Math.PI) / 180

/** Turns an object clockwise by `deg` (as seen on screen) about (cx, cy). Display space has y pointing down. */
export function rotateAbout(deg: number, cx: number, cy: number): Matrix6 {
  const c = Math.cos(rad(deg))
  const s = Math.sin(rad(deg))
  return [c, s, -s, c, cx - c * cx + s * cy, cy - s * cx - c * cy]
}

/** Mirrors left to right about the vertical line x = cx. */
export const flipHorizontal = (cx: number): Matrix6 => [-1, 0, 0, 1, 2 * cx, 0]

/** Mirrors top to bottom about the horizontal line y = cy. */
export const flipVertical = (cy: number): Matrix6 => [1, 0, 0, -1, 0, 2 * cy]

export type Pt = [number, number]

/** A point through an affine matrix (PDF order: x' = ax + cy + e, y' = bx + dy + f). */
export function applyMatrix(m: Matrix6, p: Pt): Pt {
  return [m[0] * p[0] + m[2] * p[1] + m[4], m[1] * p[0] + m[3] * p[1] + m[5]]
}

export interface Inset {
  left: number
  top: number
  right: number
  bottom: number
}

/**
 * The four corners, in page space, of a display-space rectangle (points from the top-left of the page as shown)
 * trimmed by `inset` on each side. `toPage` maps display space to page space. Null when nothing would be left.
 */
export function insetCornersToPage(rect: { x: number; y: number; w: number; h: number }, inset: Inset, toPage: Matrix6): Pt[] | null {
  const x0 = rect.x + inset.left
  const y0 = rect.y + inset.top
  const x1 = rect.x + rect.w - inset.right
  const y1 = rect.y + rect.h - inset.bottom
  if (!(x1 - x0 > 0.01) || !(y1 - y0 > 0.01)) return null
  return ([[x0, y0], [x1, y0], [x1, y1], [x0, y1]] as Pt[]).map((p) => applyMatrix(toPage, p))
}

/** Operators that clip to a polygon: `m l l l h W n`. */
export function clipPolygonOps(points: Pt[], num: (n: number) => string): string {
  return `${points.map((p, i) => `${num(p[0])} ${num(p[1])} ${i === 0 ? 'm' : 'l'}`).join(' ')} h W n`
}

/** A picture's corners (page space) in its own unit square, given the matrix that maps the unit square to the page. */
export function pagePointsToUnitSquare(points: Pt[], inverseCtm: Matrix6): Pt[] {
  return points.map((p) => applyMatrix(inverseCtm, p))
}

/** The scale an object's matrix applies to lengths (square root of its area factor); 1 for a degenerate matrix. */
export function matrixScale(m: Matrix6): number {
  const s = Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]))
  return s > 1e-9 ? s : 1
}

/** A line width in points as the user-space width to write into the stream for an object with this matrix. */
export const lineWidthForWrite = (points: number, m: Matrix6): number => points / matrixScale(m)

/** A line width as written in the stream, in points on the page. */
export const lineWidthInPoints = (written: number, m: Matrix6): number => written * matrixScale(m)

/** `#rrggbb` as three numbers from 0 to 1, or null when it is not a colour. */
export function hexToUnit(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return null
  const n = parseInt(m[1], 16)
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
}

/** Clamps an opacity (0 to 1). */
export const clampOpacity = (v: number): number => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 1)
