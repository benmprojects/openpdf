/**
 * Cutting a page into tiles: for Split pages (each tile becomes a page) and tiled printing (each tile a sheet of
 * paper). All rectangles are in points on the page as displayed (origin top left, y down).
 */

export interface Tile {
  col: number
  row: number
  x: number
  y: number
  w: number
  h: number
}

export interface TileGrid {
  cols: number
  rows: number
  tiles: Tile[]
}

const MM = 72 / 25.4
export const mmToPt = (mm: number): number => mm * MM

/** One dimension: `n` equal pieces that together cover `total` with each neighbouring pair sharing `overlap`. */
function span(total: number, n: number, overlap: number): { size: number; step: number } {
  const size = (total + (n - 1) * overlap) / n
  return { size, step: size - overlap }
}

/** A cap on the overlap so a tile is never swallowed by it. */
const capOverlap = (overlap: number, a: number, b: number): number => Math.max(0, Math.min(overlap, 0.45 * Math.min(a, b)))

/** The page cut into `cols` by `rows` equal tiles that overlap their neighbours by `overlap` points. Row by row, from the top left. */
export function gridTiles(pageW: number, pageH: number, cols: number, rows: number, overlap = 0): TileGrid {
  cols = Math.max(1, Math.round(cols))
  rows = Math.max(1, Math.round(rows))
  const ov = capOverlap(overlap, pageW / cols, pageH / rows)
  const sx = span(pageW, cols, cols > 1 ? ov : 0)
  const sy = span(pageH, rows, rows > 1 ? ov : 0)
  const tiles: Tile[] = []
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) tiles.push({ col: c, row: r, x: c * sx.step, y: r * sy.step, w: sx.size, h: sy.size })
  return { cols, rows, tiles }
}

/** How many sheets of `sheetW` by `sheetH` cover a length, when each neighbouring pair overlaps by `overlap`. */
export function piecesFor(length: number, sheet: number, overlap: number): number {
  // 1.5 mm of slack: an A1 sheet is 841 mm long and two A3 pieces cover 840.
  const slack = mmToPt(1.5)
  if (length <= sheet + slack) return 1
  const step = sheet - overlap
  if (step <= 0) return 1
  return Math.ceil((length - slack - overlap) / step)
}

export type PaperOrientation = 'auto' | 'portrait' | 'landscape'

/**
 * The page cut into pieces no bigger than a sheet of paper (at actual size), with an overlap. With `auto` the
 * orientation that needs fewer pieces is used (the one that matches the page when they tie).
 */
export function tilesForPaper(pageW: number, pageH: number, paperW: number, paperH: number, overlap = 0, orientation: PaperOrientation = 'auto'): TileGrid & { paperW: number; paperH: number } {
  const short = Math.min(paperW, paperH)
  const long = Math.max(paperW, paperH)
  const ov = capOverlap(overlap, short, short)
  const options: [number, number][] = orientation === 'portrait' ? [[short, long]] : orientation === 'landscape' ? [[long, short]] : [[short, long], [long, short]]
  const pageLandscape = pageW > pageH
  let best: { pw: number; ph: number; n: number; cols: number; rows: number } | null = null
  for (const [pw, ph] of options) {
    const cols = piecesFor(pageW, pw, ov)
    const rows = piecesFor(pageH, ph, ov)
    const n = cols * rows
    const matches = pw > ph === pageLandscape
    if (!best || n < best.n || (n === best.n && matches && !(best.pw > best.ph === pageLandscape))) best = { pw, ph, n, cols, rows }
  }
  const b = best!
  return { ...gridTiles(pageW, pageH, b.cols, b.rows, ov), paperW: b.pw, paperH: b.ph }
}

/**
 * Tiles for printing: the page at `scale` (1 = actual size) printed on sheets whose printable area is `areaW` by
 * `areaH` points, neighbours overlapping by `overlap` points on the paper. Every tile is a whole sheet (the last
 * row and column may reach past the page: that part prints blank). The rectangles are in page points.
 */
export function printTiles(pageW: number, pageH: number, areaW: number, areaH: number, scale: number, overlap = 0): TileGrid {
  const s = scale > 0 ? scale : 1
  const ov = capOverlap(overlap, areaW, areaH)
  const cols = piecesFor(pageW * s, areaW, ov)
  const rows = piecesFor(pageH * s, areaH, ov)
  const tiles: Tile[] = []
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) tiles.push({ col: c, row: r, x: (c * (areaW - ov)) / s, y: (r * (areaH - ov)) / s, w: areaW / s, h: areaH / s })
  return { cols, rows, tiles }
}

/** The orientation of the paper (true for landscape) that needs fewer sheets for the page. */
export function bestPrintLandscape(pageW: number, pageH: number, areaPortrait: { w: number; h: number }, scale: number, overlap: number): boolean {
  const p = printTiles(pageW, pageH, areaPortrait.w, areaPortrait.h, scale, overlap)
  const l = printTiles(pageW, pageH, areaPortrait.h, areaPortrait.w, scale, overlap)
  const np = p.tiles.length
  const nl = l.tiles.length
  return nl < np || (nl === np && pageW > pageH)
}

/** A short label for a tile: "Page 3, row 2 column 1 (of 2 x 3)". */
export function tileLabel(page: number, t: { row: number; col: number }, g: { rows: number; cols: number }): string {
  return `Page ${page + 1}, row ${t.row + 1} column ${t.col + 1} (of ${g.rows} x ${g.cols})`
}

/** A rows or columns count kept in a sensible range. */
export const clampGrid = (n: number): number => (Number.isFinite(n) ? Math.min(20, Math.max(1, Math.round(n))) : 1)

/** How a large page is tiled when printed. */
export interface TileOptions {
  /** Percent of actual size (100 = actual size). */
  scalePct: number
  /** Overlap between neighbouring sheets, in millimetres on the paper. */
  overlapMm: number
  /** Cut marks at the corners of the part of the page on each sheet. */
  marks: boolean
  /** A label on each sheet saying which tile it is. */
  labels: boolean
}

export const clampTileScale = (n: number): number => (Number.isFinite(n) ? Math.min(400, Math.max(10, Math.round(n))) : 100)

/** The sheets of tiled printing for a list of pages: each page's tiles in turn. */
export function tileSheets(
  sizes: { w: number; h: number }[],
  area: { w: number; h: number },
  tile: Pick<TileOptions, 'scalePct' | 'overlapMm'>
): { page: number; tile: Tile; grid: { rows: number; cols: number } }[] {
  const out: { page: number; tile: Tile; grid: { rows: number; cols: number } }[] = []
  sizes.forEach((s, page) => {
    const g = printTiles(s.w, s.h, area.w, area.h, clampTileScale(tile.scalePct) / 100, mmToPt(tile.overlapMm))
    for (const t of g.tiles) out.push({ page, tile: t, grid: { rows: g.rows, cols: g.cols } })
  })
  return out
}
