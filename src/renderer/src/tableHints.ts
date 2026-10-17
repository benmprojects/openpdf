/**
 * Table hints for recognised pages: finds runs of lines that split into the same columns, so the person is told where
 * a page seems to hold a table (Excel and Word export treat those regions better when they are real text, and a table
 * read from a scan is worth a second look). It reads word boxes only; it does not draw cells or change the page.
 */
export interface HintWord {
  x0: number
  y0: number
  x1: number
  y1: number
}

export interface HintLine {
  words: HintWord[]
}

export interface TableHint {
  /** Zero-based page. */
  page: number
  /** Number of lines in the table-like run. */
  rows: number
  /** Number of columns found. */
  cols: number
  /** Pixel box of the run on the page. */
  box: { x0: number; y0: number; x1: number; y1: number }
}

/** Splits one line into cells: words separated by a gap wider than `gap` start a new cell. Returns the cell start x values and the cell boxes. */
function cellsOf(words: HintWord[], gap: number): { x0: number; x1: number }[] {
  const sorted = [...words].sort((a, b) => a.x0 - b.x0)
  const cells: { x0: number; x1: number }[] = []
  for (const w of sorted) {
    const last = cells[cells.length - 1]
    if (last && w.x0 - last.x1 <= gap) last.x1 = Math.max(last.x1, w.x1)
    else cells.push({ x0: w.x0, x1: w.x1 })
  }
  return cells
}

/**
 * Runs of at least `minRows` lines whose cells line up. Two cells line up when their left edges are within a line
 * height; a column counts when it appears on at least 70 % of the lines of the run.
 */
export function findTables(page: number, lines: HintLine[], minRows = 3): TableHint[] {
  const heights = lines.flatMap((l) => l.words.map((w) => w.y1 - w.y0)).sort((a, b) => a - b)
  const h = heights.length ? heights[Math.floor(heights.length / 2)] : 0
  if (!h) return []
  const tol = h * 1.0
  const rows = lines
    .filter((l) => l.words.length)
    .map((l) => ({ cells: cellsOf(l.words, h * 1.6), y0: Math.min(...l.words.map((w) => w.y0)), y1: Math.max(...l.words.map((w) => w.y1)) }))
    .sort((a, b) => a.y0 - b.y0)
  const out: TableHint[] = []
  let run: typeof rows = []
  const flush = () => {
    if (run.length >= minRows) {
      // Columns: left edges that recur on enough lines of the run.
      const edges = run.flatMap((r) => r.cells.map((c) => c.x0)).sort((a, b) => a - b)
      const cols: number[][] = []
      for (const e of edges) {
        const last = cols[cols.length - 1]
        if (last && e - last[last.length - 1] <= tol) last.push(e)
        else cols.push([e])
      }
      const real = cols.filter((c) => c.length >= Math.ceil(run.length * 0.7))
      if (real.length >= 2) {
        out.push({
          page,
          rows: run.length,
          cols: real.length,
          box: { x0: Math.min(...run.map((r) => r.cells[0].x0)), y0: run[0].y0, x1: Math.max(...run.map((r) => r.cells[r.cells.length - 1].x1)), y1: run[run.length - 1].y1 }
        })
      }
    }
    run = []
  }
  for (const r of rows) {
    if (r.cells.length >= 2) {
      const prev = run[run.length - 1]
      // A big vertical jump ends the run.
      if (prev && r.y0 - prev.y1 > h * 3) flush()
      run.push(r)
    } else flush()
  }
  flush()
  return out
}

/** One sentence for the person. */
export function describeHint(t: TableHint): string {
  return `Page ${t.page + 1} seems to hold a table (about ${t.rows} rows by ${t.cols} columns). Check it after recognition.`
}
