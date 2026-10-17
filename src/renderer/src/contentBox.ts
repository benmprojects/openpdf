/**
 * "Fit visible": zoom so the printed content, not the whole page, fills the window width. The content box of a
 * page is found by trimming the white margins off a small render of it.
 */
import type { Rotation } from './viewRotation'

/** A box as fractions (0 to 1) of a page's width and height, measured from its top left. */
export interface Frac {
  x0: number
  y0: number
  x1: number
  y1: number
}

/** The part of an RGBA bitmap that is not white (or transparent), or null when the whole page is blank. */
export function trimBox(data: ArrayLike<number>, w: number, h: number, threshold = 235): Frac | null {
  let x0 = w
  let y0 = h
  let x1 = -1
  let y1 = -1
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      if (data[i + 3] < 10) continue
      if (Math.min(data[i], data[i + 1], data[i + 2]) < threshold) {
        if (x < x0) x0 = x
        if (x > x1) x1 = x
        if (y < y0) y0 = y
        if (y > y1) y1 = y
      }
    }
  }
  if (x1 < 0) return null
  return { x0: x0 / w, y0: y0 / h, x1: (x1 + 1) / w, y1: (y1 + 1) / h }
}

/** The box as it appears when the page is shown turned by the view rotation. */
export function rotateFrac(b: Frac, r: Rotation): Frac {
  if (r === 90) return { x0: 1 - b.y1, x1: 1 - b.y0, y0: b.x0, y1: b.x1 }
  if (r === 180) return { x0: 1 - b.x1, x1: 1 - b.x0, y0: 1 - b.y1, y1: 1 - b.y0 }
  if (r === 270) return { x0: b.y0, x1: b.y1, y0: 1 - b.x1, y1: 1 - b.x0 }
  return b
}

/** The smallest share of the page width the content may be zoomed to fill, so a nearly blank page does not zoom in absurdly. */
const MIN_RATIO = 0.25
/** Breathing room kept around the content, as a share of the page width. */
const MARGIN = 0.02

/**
 * How much of the displayed page width the widest content takes (`ratio`), and where the leftmost content starts
 * (`left`, as a share of the page width). Null when every sampled page is blank.
 */
export function fitVisible(boxes: (Frac | null)[], rotation: Rotation): { ratio: number; left: number } | null {
  let widest = 0
  let left = 1
  let any = false
  for (const b of boxes) {
    if (!b) continue
    const d = rotateFrac(b, rotation)
    any = true
    widest = Math.max(widest, d.x1 - d.x0)
    left = Math.min(left, d.x0)
  }
  if (!any) return null
  const lo = Math.max(0, left - MARGIN)
  // The span from the leftmost to the rightmost content over all pages, so no page is cut off when scrolled to `left`.
  let right = 0
  for (const b of boxes) if (b) right = Math.max(right, rotateFrac(b, rotation).x1)
  const hi = Math.min(1, Math.max(right, left + widest) + MARGIN)
  return { ratio: Math.min(1, Math.max(MIN_RATIO, hi - lo)), left: lo }
}

/** Page numbers (0-based) to sample: at most `max`, spread over the document, always including `current`. */
export function samplePages(count: number, current: number, max = 40): number[] {
  if (count <= max) return Array.from({ length: count }, (_, i) => i)
  const out = new Set<number>([Math.min(count - 1, Math.max(0, current))])
  const n = max - 1
  for (let k = 0; k < n; k++) out.add(Math.round((k * (count - 1)) / (n - 1)))
  return [...out].sort((a, b) => a - b)
}
