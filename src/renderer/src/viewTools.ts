/** Pure helpers for the view tools: the page size and position readout, and the pan and zoom window. */

export type ReadoutUnit = 'mm' | 'cm' | 'in' | 'pt'

const PT_PER_UNIT: Record<ReadoutUnit, number> = { mm: 72 / 25.4, cm: 72 / 2.54, in: 72, pt: 1 }
const DECIMALS: Record<ReadoutUnit, number> = { mm: 1, cm: 2, in: 2, pt: 1 }

export function fromPoints(pt: number, unit: ReadoutUnit): number {
  return pt / PT_PER_UNIT[unit]
}

/** "210.0" for 595.28 pt in millimetres; no trailing unit. */
export function formatLength(pt: number, unit: ReadoutUnit): string {
  return fromPoints(pt, unit).toFixed(DECIMALS[unit])
}

/** "210.0 × 297.0 mm" */
export function formatPageSize(widthPt: number, heightPt: number, unit: ReadoutUnit): string {
  return `${formatLength(widthPt, unit)} × ${formatLength(heightPt, unit)} ${unit}`
}

/** "x 12.5, y 40.2 mm" */
export function formatPosition(u: number, v: number, unit: ReadoutUnit): string {
  return `x ${formatLength(u, unit)}, y ${formatLength(v, unit)} ${unit}`
}

/** The standard paper name for a size in points (either orientation), or null. */
export function paperName(widthPt: number, heightPt: number): string | null {
  const papers: [string, number, number][] = [
    ['A0', 841, 1189],
    ['A1', 594, 841],
    ['A2', 420, 594],
    ['A3', 297, 420],
    ['A4', 210, 297],
    ['A5', 148, 210],
    ['Letter', 215.9, 279.4],
    ['Legal', 215.9, 355.6]
  ]
  const wmm = Math.min(widthPt, heightPt) / PT_PER_UNIT.mm
  const hmm = Math.max(widthPt, heightPt) / PT_PER_UNIT.mm
  for (const [name, w, h] of papers) if (Math.abs(wmm - w) <= 2 && Math.abs(hmm - h) <= 2) return name
  return null
}

// ---- Pan and zoom window ----------------------------------------------------------------------------

export interface Rect4 {
  x: number
  y: number
  w: number
  h: number
}

/** Scale that fits a page of `pageW` by `pageH` points into a `boxW` by `boxH` pixel overview. */
export function overviewScale(pageW: number, pageH: number, boxW: number, boxH: number): number {
  if (pageW <= 0 || pageH <= 0) return 1
  return Math.min(boxW / pageW, boxH / pageH)
}

/** The visible part of a page (page points) as a rectangle in overview pixels. */
export function viewportRect(vp: { u: number; v: number; w: number; h: number }, scale: number): Rect4 {
  return { x: vp.u * scale, y: vp.v * scale, w: vp.w * scale, h: vp.h * scale }
}

/** An overview pixel position to page points, kept on the page. */
export function overviewToPage(px: number, py: number, scale: number, pageW: number, pageH: number): { u: number; v: number } {
  return { u: Math.min(pageW, Math.max(0, px / scale)), v: Math.min(pageH, Math.max(0, py / scale)) }
}

/**
 * The zoom that makes a viewport rectangle `newW` points wide fill the same screen width the current one does.
 * `zoom` is the current zoom and `vpW` the points now visible across.
 */
export function zoomForWidth(zoom: number, vpW: number, newW: number, min = 0.05, max = 8): number {
  if (vpW <= 0 || newW <= 0) return zoom
  return Math.min(max, Math.max(min, (zoom * vpW) / newW))
}
