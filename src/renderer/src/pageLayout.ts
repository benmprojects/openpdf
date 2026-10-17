/**
 * How pages are arranged in the view. Pages sit in rows: one page per row, or two side by side (facing pages).
 * "Continuous" shows every row in one scrolling column; otherwise only the current row is shown and scrolling
 * past its end turns to the next one.
 */
export interface PageMode {
  /** Two pages per row. */
  twoUp: boolean
  /** Every row in one scrolling column, or one row at a time. */
  continuous: boolean
  /** With two-up: the first page sits alone, like a book's cover, so even pages fall on the left. */
  cover: boolean
  /** Right-to-left reading order: with two pages in a row the first page sits on the right. */
  rtl?: boolean
  /** Space between pages (and rows); false packs the pages edge to edge. Unset means true. */
  gaps?: boolean
}

export const DEFAULT_MODE: PageMode = { twoUp: false, continuous: true, cover: false, rtl: false, gaps: true }

/** Page indices per row, left to right as they appear on screen. */
export function layoutRows(count: number, mode: PageMode): number[][] {
  const rows: number[][] = []
  if (!mode.twoUp) {
    for (let i = 0; i < count; i++) rows.push([i])
    return rows
  }
  let i = 0
  if (mode.cover && count > 0) {
    rows.push([0])
    i = 1
  }
  for (; i < count; i += 2) rows.push(i + 1 < count ? [i, i + 1] : [i])
  // Right to left: each pair is shown the other way round (a lone page keeps its row to itself).
  return mode.rtl ? rows.map((r) => [...r].reverse()) : rows
}

/** Pixels between pages for a mode, given the usual gap. */
export function gapFor(mode: PageMode, gap: number): number {
  return mode.gaps === false ? 0 : gap
}

/** Reads a saved page-display default (from the settings file) into a PageMode, ignoring anything odd. */
export function modeFromDefaults(raw: unknown): PageMode {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const flag = (k: string, d: boolean) => (typeof r[k] === 'boolean' ? (r[k] as boolean) : d)
  return {
    twoUp: flag('twoUp', DEFAULT_MODE.twoUp),
    continuous: flag('continuous', DEFAULT_MODE.continuous),
    cover: flag('cover', DEFAULT_MODE.cover),
    rtl: flag('rtl', false),
    gaps: flag('gaps', true)
  }
}

/** Row index of each page. */
export function rowOfPage(rows: number[][]): number[] {
  const out: number[] = []
  rows.forEach((r, ri) => r.forEach((p) => (out[p] = ri)))
  return out
}

/** Widest and tallest row, in points, given each page's displayed size and the gap between pages in a row. */
export function rowExtent(
  rows: number[][],
  dims: { width: number; height: number }[],
  gapPt: number
): { maxWidth: number; maxHeight: number } {
  let maxWidth = 0
  let maxHeight = 0
  for (const r of rows) {
    const w = r.reduce((s, p) => s + dims[p].width, 0) + gapPt * (r.length - 1)
    const h = Math.max(...r.map((p) => dims[p].height))
    maxWidth = Math.max(maxWidth, w)
    maxHeight = Math.max(maxHeight, h)
  }
  return { maxWidth, maxHeight }
}
