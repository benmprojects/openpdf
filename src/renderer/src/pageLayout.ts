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
}

export const DEFAULT_MODE: PageMode = { twoUp: false, continuous: true, cover: false }

/** Page indices per row. */
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
  return rows
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
