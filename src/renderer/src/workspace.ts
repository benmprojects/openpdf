/** Pure helpers for the loupe and the second pane of a split view. */

export type PaneZoom = 'fit-width' | 'fit-page' | number

export const PANE_MIN_ZOOM = 0.1
export const PANE_MAX_ZOOM = 4
export const PANE_STEPS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4]

/** The zoom a pane shows: a number as it is (within limits), or the fit of the widest or tallest page. */
export function paneZoom(mode: PaneZoom, view: { w: number; h: number }, dims: { width: number; height: number }[], pad: number): number {
  const clamp = (z: number) => Math.min(PANE_MAX_ZOOM, Math.max(PANE_MIN_ZOOM, z))
  if (typeof mode === 'number') return clamp(mode)
  if (!dims.length || view.w <= 0) return 1
  const maxW = Math.max(...dims.map((d) => d.width))
  const maxH = Math.max(...dims.map((d) => d.height))
  const byWidth = (view.w - 2 * pad) / maxW
  return clamp(mode === 'fit-width' ? byWidth : Math.min(byWidth, (view.h - 2 * pad) / maxH))
}

/** The next zoom step above or below `zoom`. */
export function stepPaneZoom(zoom: number, dir: 1 | -1): number {
  const next = dir > 0 ? PANE_STEPS.find((s) => s > zoom + 0.005) : [...PANE_STEPS].reverse().find((s) => s < zoom - 0.005)
  return next ?? (dir > 0 ? PANE_MAX_ZOOM : PANE_MIN_ZOOM)
}

export const LOUPE_FACTORS = [2, 3, 4, 6]
/** Side of the loupe window in CSS pixels. */
export const LOUPE_SIZE = 200
const MAX_LOUPE_SCALE = 24

/**
 * The part of a page the loupe shows: a square of `lens` CSS pixels centred on a point of the page (in points, in the
 * page's own frame), drawn `factor` times larger than the view shows it. `region` is in pixels of a render at `scale`.
 */
export function loupeRegion(
  at: { x: number; y: number },
  page: { width: number; height: number },
  lens: number,
  zoom: number,
  factor: number,
  dpr: number
): { scale: number; region: { x: number; y: number; w: number; h: number } } | null {
  const scale = Math.min(MAX_LOUPE_SCALE, zoom * factor * dpr)
  const side = Math.max(1, Math.round(lens * dpr))
  const pw = Math.floor(page.width * scale)
  const ph = Math.floor(page.height * scale)
  if (pw < 1 || ph < 1) return null
  const w = Math.min(side, pw)
  const h = Math.min(side, ph)
  const x = Math.min(pw - w, Math.max(0, Math.round(at.x * scale - w / 2)))
  const y = Math.min(ph - h, Math.max(0, Math.round(at.y * scale - h / 2)))
  return { scale, region: { x, y, w, h } }
}

/** Where the loupe window sits: just below and right of the pointer, moved to the other side near the window's edge. */
export function loupePosition(pointer: { x: number; y: number }, lens: number, win: { w: number; h: number }, gap = 18): { left: number; top: number } {
  let left = pointer.x + gap
  let top = pointer.y + gap
  if (left + lens > win.w) left = pointer.x - gap - lens
  if (top + lens > win.h) top = pointer.y - gap - lens
  return { left: Math.max(0, left), top: Math.max(0, top) }
}
