/**
 * Finding tables on a page from the positions of its text and the ruling lines drawn on it, and reading cell text as
 * numbers, percentages, currency or dates (Australian forms: 1,234.56, $1,234.50, 12.5 %, 31/12/2026). Pure logic, in
 * page display space (points from the top left), used by the Word, Excel and PowerPoint exports.
 */

export interface Box {
  x: number
  y: number
  w: number
  h: number
}

/** A piece of text that could be a table cell. */
export interface CellItem extends Box {
  text: string
  size: number
}

/** A straight horizontal or vertical line. */
export interface Rule {
  x0: number
  y0: number
  x1: number
  y1: number
  horizontal: boolean
}

export interface Table {
  rect: Box
  /** Cell text, row by row; every row has the same number of cells. */
  rows: string[][]
  /** Column widths in points, left to right. */
  colWidths: number[]
  ruled: boolean
}

export interface TableResult {
  tables: Table[]
  /** Indexes (into the items given) of the items that sit in a table. */
  used: Set<number>
}

const MAX_RULES = 3000

/** Horizontal and vertical lines from the straight pieces of a page's paths (five numbers each: x0, y0, x1, y1, straight). */
export function rulesFromSegments(segs: ArrayLike<number>): Rule[] {
  const out: Rule[] = []
  for (let i = 0; i + 4 < segs.length && out.length < MAX_RULES * 4; i += 5) {
    if (!segs[i + 4]) continue
    const x0 = segs[i]
    const y0 = segs[i + 1]
    const x1 = segs[i + 2]
    const y1 = segs[i + 3]
    if (Math.abs(y1 - y0) <= 0.6 && Math.abs(x1 - x0) >= 6) out.push({ x0: Math.min(x0, x1), x1: Math.max(x0, x1), y0: (y0 + y1) / 2, y1: (y0 + y1) / 2, horizontal: true })
    else if (Math.abs(x1 - x0) <= 0.6 && Math.abs(y1 - y0) >= 6) out.push({ y0: Math.min(y0, y1), y1: Math.max(y0, y1), x0: (x0 + x1) / 2, x1: (x0 + x1) / 2, horizontal: false })
  }
  return out
}

/** Positions closer than `tol` become one (their average). */
function mergePositions(values: number[], tol: number): number[] {
  const s = [...values].sort((a, b) => a - b)
  const out: number[][] = []
  for (const v of s) {
    const last = out[out.length - 1]
    if (last && v - last[last.length - 1] <= tol) last.push(v)
    else out.push([v])
  }
  return out.map((g) => g.reduce((a, b) => a + b, 0) / g.length)
}

/** Cut positions between columns: gaps in the horizontal projection of the items. */
function columnCuts(items: CellItem[]): number[] {
  const iv = items.map((i) => [i.x, i.x + i.w] as [number, number]).sort((a, b) => a[0] - b[0])
  const merged: [number, number][] = []
  for (const [a, b] of iv) {
    const last = merged[merged.length - 1]
    if (last && a < last[1] + 3) last[1] = Math.max(last[1], b)
    else merged.push([a, b])
  }
  const cuts: number[] = []
  for (let i = 1; i < merged.length; i++) cuts.push((merged[i - 1][1] + merged[i][0]) / 2)
  return cuts
}

const cellIndex = (cuts: number[], v: number) => cuts.filter((c) => c <= v).length

const reading = (a: CellItem, b: CellItem) => (Math.abs(a.y + a.h / 2 - (b.y + b.h / 2)) < Math.min(a.h, b.h) * 0.5 ? a.x - b.x : a.y - b.y)

/** Rows of items by vertical centre. */
function textRows(items: CellItem[]): CellItem[][] {
  const sorted = [...items].sort((a, b) => a.y + a.h / 2 - (b.y + b.h / 2))
  const rows: CellItem[][] = []
  for (const it of sorted) {
    const row = rows[rows.length - 1]
    const cy = it.y + it.h / 2
    if (row) {
      const rcy = row.reduce((s, r) => s + r.y + r.h / 2, 0) / row.length
      if (Math.abs(cy - rcy) <= Math.min(it.h, ...row.map((r) => r.h)) * 0.5) {
        row.push(it)
        continue
      }
    }
    rows.push([it])
  }
  return rows.map((r) => r.sort((a, b) => a.x - b.x))
}

/** Fills a grid from items, given the interior cuts of rows (y) and columns (x). Empty rows and columns are dropped. */
function fill(items: CellItem[], rowCuts: number[], colCuts: number[]): { rows: string[][]; colWidths: number[]; left: number } | null {
  const nr = rowCuts.length + 1
  const nc = colCuts.length + 1
  const cells: CellItem[][][] = Array.from({ length: nr }, () => Array.from({ length: nc }, () => []))
  for (const it of items) cells[cellIndex(rowCuts, it.y + it.h / 2)][cellIndex(colCuts, it.x + it.w / 2)].push(it)
  const text = cells.map((r) => r.map((c) => c.sort(reading).map((i) => i.text.trim()).join(' ').replace(/\s+/g, ' ').trim()))
  const keepRows = text.map((r) => r.some(Boolean))
  const keepCols = Array.from({ length: nc }, (_, c) => text.some((r) => r[c]))
  const rows = text.filter((_, r) => keepRows[r]).map((r) => r.filter((_, c) => keepCols[c]))
  if (rows.length < 2 || !rows[0] || rows[0].length < 2) return null
  // Column widths: from each kept column's own items (the grid's edges are not all known).
  const colWidths: number[] = []
  let left = Infinity
  for (let c = 0; c < nc; c++) {
    if (!keepCols[c]) continue
    const xs = cells.flatMap((r) => r[c])
    const x0 = Math.min(...xs.map((i) => i.x))
    const x1 = Math.max(...xs.map((i) => i.x + i.w))
    left = Math.min(left, x0)
    colWidths.push(Math.max(20, x1 - x0))
  }
  return { rows, colWidths, left }
}

function bounds(items: CellItem[]): Box {
  const x0 = Math.min(...items.map((i) => i.x))
  const y0 = Math.min(...items.map((i) => i.y))
  const x1 = Math.max(...items.map((i) => i.x + i.w))
  const y1 = Math.max(...items.map((i) => i.y + i.h))
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}

const filledShare = (rows: string[][]) => rows.flat().filter(Boolean).length / Math.max(1, rows.flat().length)

/**
 * Tables from ruling lines: lines that touch form a group; a group with three or more horizontal lines is a grid.
 * Its columns come from the vertical lines when there are three or more of them, else from where the text lines up.
 */
function ruledTables(items: CellItem[], rules: Rule[], taken: Set<number>): Table[] {
  if (!rules.length || rules.length > MAX_RULES) return []
  const n = rules.length
  const parent = Array.from({ length: n }, (_, i) => i)
  const find = (a: number): number => (parent[a] === a ? a : (parent[a] = find(parent[a])))
  const T = 2
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++) {
      const a = rules[i]
      const b = rules[j]
      if (a.x0 - T <= b.x1 && b.x0 - T <= a.x1 && a.y0 - T <= b.y1 && b.y0 - T <= a.y1) parent[find(i)] = find(j)
    }
  const groups = new Map<number, Rule[]>()
  rules.forEach((r, i) => groups.set(find(i), [...(groups.get(find(i)) ?? []), r]))
  const out: Table[] = []
  for (const g of groups.values()) {
    const hs = mergePositions(g.filter((r) => r.horizontal && r.x1 - r.x0 >= 10).map((r) => r.y0), 2)
    const vs = mergePositions(g.filter((r) => !r.horizontal && r.y1 - r.y0 >= 10).map((r) => r.x0), 2)
    if (hs.length < 3) continue
    const region: Box = { x: Math.min(...g.map((r) => r.x0)) - 1, y: Math.min(...g.map((r) => r.y0)) - 1, w: 0, h: 0 }
    region.w = Math.max(...g.map((r) => r.x1)) + 1 - region.x
    region.h = Math.max(...g.map((r) => r.y1)) + 1 - region.y
    const inside = items.map((it, k) => ({ it, k })).filter(({ it, k }) => !taken.has(k) && it.x + it.w / 2 >= region.x && it.x + it.w / 2 <= region.x + region.w && it.y + it.h / 2 >= region.y && it.y + it.h / 2 <= region.y + region.h)
    if (inside.length < 3) continue
    const sel = inside.map((e) => e.it)
    const colCuts = vs.length >= 3 ? vs.slice(1, -1) : columnCuts(sel.filter((i) => i.w < region.w * 0.7))
    const filled = fill(sel, hs.slice(1, -1), colCuts)
    if (!filled || filledShare(filled.rows) < 0.25 || filled.rows[0].length > 40) continue
    inside.forEach((e) => taken.add(e.k))
    out.push({ rect: region, rows: filled.rows, colWidths: filled.colWidths, ruled: true })
  }
  return out
}

/** Tables with no lines: three or more rows in a row that each have two or more short cells in separate columns. */
function alignedTables(items: CellItem[], taken: Set<number>): Table[] {
  const free = items.map((it, k) => ({ it, k })).filter(({ it, k }) => !taken.has(k) && it.h < it.size * 1.8 && it.text.trim())
  const rows = textRows(free.map((f) => f.it))
  const indexOf = new Map(free.map((f) => [f.it, f.k]))
  const tabular = rows.map((r) => {
    if (r.length < 2) return false
    const size = r.reduce((s, i) => s + i.size, 0) / r.length
    for (let i = 1; i < r.length; i++) if (r[i].x - (r[i - 1].x + r[i - 1].w) < size * 0.8) return false
    return true
  })
  const out: Table[] = []
  let i = 0
  while (i < rows.length) {
    if (!tabular[i]) {
      i++
      continue
    }
    let j = i
    while (j + 1 < rows.length && tabular[j + 1]) {
      const step = rows[j + 1][0].y + rows[j + 1][0].h / 2 - (rows[j][0].y + rows[j][0].h / 2)
      if (step > Math.max(...rows[j].map((r) => r.size)) * 3) break
      j++
    }
    const run = rows.slice(i, j + 1)
    i = j + 1
    if (run.length < 3) continue
    const sel = run.flat()
    const cuts = columnCuts(sel)
    const rowCuts = run.slice(1).map((r, k) => (run[k].reduce((s, x) => s + x.y + x.h, 0) / run[k].length + r.reduce((s, x) => s + x.y, 0) / r.length) / 2)
    const filled = fill(sel, rowCuts, cuts)
    if (!filled || filled.rows[0].length > 25) continue
    const cells = filled.rows.flat().filter(Boolean)
    if (cells.reduce((s, c) => s + c.length, 0) / cells.length > 40) continue
    // Columns that are all running sentences are text columns of a page, not a table.
    const wordy = (c: string) => c.split(/\s+/).length >= 4
    const nc = filled.rows[0].length
    if (Array.from({ length: nc }, (_, c) => filled.rows.filter((r) => wordy(r[c] ?? '')).length >= filled.rows.length * 0.6).every(Boolean)) continue
    // Most rows must use more than one column, or it is a list with a stray gap.
    if (filled.rows.filter((r) => r.filter(Boolean).length >= 2).length < filled.rows.length * 0.6) continue
    sel.forEach((it) => taken.add(indexOf.get(it)!))
    const b = bounds(sel)
    out.push({ rect: b, rows: filled.rows, colWidths: filled.colWidths, ruled: false })
  }
  return out
}

/** The tables of a page, top to bottom, and which items they took. */
export function detectTables(items: CellItem[], rules: Rule[]): TableResult {
  const taken = new Set<number>()
  const tables = [...ruledTables(items, rules, taken), ...alignedTables(items, taken)].sort((a, b) => a.rect.y - b.rect.y)
  return { tables, used: taken }
}

// ---- Cell values ---------------------------------------------------------------------------------------

export type CellValue = { kind: 'text'; text: string } | { kind: 'number'; value: number; format: string } | { kind: 'date'; value: number; format: string }

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

/** Excel's serial number for a calendar date (1900 date system), or null for a date that does not exist. */
export function excelSerial(y: number, m: number, d: number): number | null {
  const t = new Date(Date.UTC(y, m - 1, d))
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== m - 1 || t.getUTCDate() !== d) return null
  return Date.UTC(y, m - 1, d) / 86400000 + 25569
}

const year = (s: string) => (s.length === 2 ? (Number(s) < 70 ? 2000 : 1900) + Number(s) : Number(s))

/** A cell's text as a number, percentage, currency amount or date where it plainly is one; otherwise text. */
export function parseCell(raw: string): CellValue {
  const s = raw.trim().replaceAll(String.fromCharCode(160), ' ')
  const text: CellValue = { kind: 'text', text: raw.trim() }
  if (!s) return text
  let m = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4}|\d{2})$/.exec(s)
  if (m) {
    const v = excelSerial(year(m[3]), Number(m[2]), Number(m[1]))
    return v === null ? text : { kind: 'date', value: v, format: 'dd/mm/yyyy' }
  }
  m = /^(\d{1,2}) ([A-Za-z]{3})[a-z]* (\d{4})$/.exec(s)
  if (m && MONTHS.includes(m[2].toLowerCase())) {
    const v = excelSerial(Number(m[3]), MONTHS.indexOf(m[2].toLowerCase()) + 1, Number(m[1]))
    return v === null ? text : { kind: 'date', value: v, format: 'dd/mm/yyyy' }
  }
  // Brackets mean negative; a sign or the dollar sign may come first.
  let body = s
  let negative = false
  if (/^\(.*\)$/.test(body)) {
    negative = true
    body = body.slice(1, -1).trim()
  }
  if (body.startsWith('-') || body.startsWith('−')) {
    negative = !negative
    body = body.slice(1).trim()
  } else if (body.startsWith('+')) body = body.slice(1).trim()
  let currency = false
  if (body.startsWith('$')) {
    currency = true
    body = body.slice(1).trim()
    if (body.startsWith('-')) {
      negative = !negative
      body = body.slice(1).trim()
    }
  }
  let percent = false
  if (body.endsWith('%')) {
    percent = true
    body = body.slice(0, -1).trim()
  }
  if (!/^(\d{1,3}(,\d{3})+|\d+)(\.\d+)?$/.test(body)) return text
  if (percent && currency) return text
  if (/^0\d/.test(body)) return text // codes such as 007
  const digits = body.replace(/[,.]/g, '')
  if (digits.length > 15) return text
  const thousands = body.includes(',')
  const decimals = body.includes('.') ? body.split('.')[1].length : 0
  let value = Number(body.replace(/,/g, ''))
  if (negative) value = -value
  if (percent) return { kind: 'number', value: value / 100, format: decimals ? `0.${'0'.repeat(decimals)}%` : '0%' }
  const core = `${thousands ? '#,##0' : '0'}${decimals ? '.' + '0'.repeat(decimals) : ''}`
  return { kind: 'number', value, format: currency ? `"$"${core}` : core }
}
