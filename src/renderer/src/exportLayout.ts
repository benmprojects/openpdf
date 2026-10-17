/**
 * Turns one page's text blocks, ruling lines and pictures into a reading order for the Word export: tables become
 * table items, side-by-side columns become a band with several columns, everything else flows top to bottom. Pure
 * logic in page display space (points from the top left).
 */
import { structurePage, type ExportBlock } from './exportDoc'
import { detectTables, type Box, type Rule, type Table } from './exportTables'
import type { TextBlock } from './textBlocks'

export interface PageImage {
  rect: Box
  /** Where the picture's bytes are kept (page and number). */
  key: string
  /** A picture covering most of the page (a scan): the flowing layout leaves it out when the page has text. */
  backdrop?: boolean
}

export interface PageData {
  width: number
  height: number
  /** Blocks of visible text, for the flowing layout (plus recognised text of a scanned page whose picture was left out). */
  blocks: TextBlock[]
  /** Blocks of visible text only, for the exact layout. */
  visible: TextBlock[]
  rules: Rule[]
  images: PageImage[]
}

export type FlowItem = { kind: 'text'; blocks: ExportBlock[] } | { kind: 'table'; table: Table } | { kind: 'image'; image: PageImage }

export interface Band {
  /** Number of text columns (1 for ordinary flowing text). */
  columns: number
  /** The items of each column, top to bottom. */
  items: FlowItem[][]
}

export interface PageLayout {
  width: number
  height: number
  /** Page margins in points, from where the content sits. */
  margin: { top: number; right: number; bottom: number; left: number }
  bands: Band[]
}

export interface LayoutOptions {
  tables: boolean
  columns: boolean
}

type Entry = { box: Box; kind: 'text'; block: TextBlock } | { box: Box; kind: 'table'; table: Table } | { box: Box; kind: 'image'; image: PageImage }

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

const order = (a: Entry, b: Entry) => (Math.abs(a.box.y - b.box.y) < Math.min(a.box.h, b.box.h, 10) * 0.5 ? a.box.x - b.box.x : a.box.y - b.box.y)

/** Entries as flow items: runs of text become paragraphs, tables and pictures stand alone. */
function toItems(entries: Entry[], body: number): FlowItem[] {
  const sorted = [...entries].sort(order)
  const out: FlowItem[] = []
  let run: TextBlock[] = []
  const flush = () => {
    if (run.length) out.push({ kind: 'text', blocks: structurePage(run, body) })
    run = []
  }
  for (const e of sorted) {
    if (e.kind === 'text') run.push(e.block)
    else {
      flush()
      out.push(e.kind === 'table' ? { kind: 'table', table: e.table } : { kind: 'image', image: e.image })
    }
  }
  flush()
  return out
}

/** Entries split into side-by-side columns when they plainly are: two to four columns that overlap vertically. */
function splitColumns(entries: Entry[]): Entry[][] | null {
  if (entries.length < 3) return null
  const iv = entries.map((e) => [e.box.x, e.box.x + e.box.w] as [number, number]).sort((a, b) => a[0] - b[0])
  const merged: [number, number][] = []
  for (const [a, b] of iv) {
    const last = merged[merged.length - 1]
    if (last && a < last[1] + 8) last[1] = Math.max(last[1], b)
    else merged.push([a, b])
  }
  if (merged.length < 2 || merged.length > 4) return null
  const cols: Entry[][] = merged.map(() => [])
  for (const e of entries) {
    const cx = e.box.x + e.box.w / 2
    cols[merged.findIndex(([a, b]) => cx >= a && cx <= b)]?.push(e)
  }
  if (cols.some((c) => !c.length)) return null
  const ext = cols.map((c) => [Math.min(...c.map((e) => e.box.y)), Math.max(...c.map((e) => e.box.y + e.box.h))])
  for (let i = 1; i < ext.length; i++) {
    const overlap = Math.min(ext[i - 1][1], ext[i][1]) - Math.max(ext[i - 1][0], ext[i][0])
    if (overlap < 0.5 * Math.min(ext[i - 1][1] - ext[i - 1][0], ext[i][1] - ext[i][0])) return null
  }
  // Columns of text read as columns only when each holds some text.
  if (cols.some((c) => !c.some((e) => e.kind === 'text'))) return null
  return cols
}

export function layoutPage(page: PageData, body: number, opts: LayoutOptions): PageLayout {
  const cands = page.blocks.filter((b) => b.text.trim())
  const entries: Entry[] = []
  let used = new Set<number>()
  if (opts.tables) {
    const r = detectTables(cands.map((b) => ({ ...b.rect, text: b.text, size: b.size })), page.rules)
    used = r.used
    for (const t of r.tables) entries.push({ box: t.rect, kind: 'table', table: t })
  }
  cands.forEach((b, i) => {
    if (!used.has(i)) entries.push({ box: b.rect, kind: 'text', block: b })
  })
  for (const im of page.images) if (!im.backdrop) entries.push({ box: im.rect, kind: 'image', image: im })

  const m = { top: 36, right: 36, bottom: 36, left: 36 }
  if (!entries.length) return { width: page.width, height: page.height, margin: m, bands: [] }
  const minX = Math.min(...entries.map((e) => e.box.x))
  const maxX = Math.max(...entries.map((e) => e.box.x + e.box.w))
  const minY = Math.min(...entries.map((e) => e.box.y))
  const maxY = Math.max(...entries.map((e) => e.box.y + e.box.h))
  const margin = { left: clamp(minX, 18, 120), right: clamp(page.width - maxX, 18, 120), top: clamp(minY, 18, 120), bottom: clamp(page.height - maxY, 18, 120) }
  const W = Math.max(1, maxX - minX)

  const sorted = [...entries].sort(order)
  const spanning = (e: Entry) => e.kind === 'table' || e.box.w >= 0.6 * W
  const groups: { span: boolean; entries: Entry[] }[] = []
  for (const e of sorted) {
    const span = spanning(e)
    const last = groups[groups.length - 1]
    if (last && last.span === span) last.entries.push(e)
    else groups.push({ span, entries: [e] })
  }
  const bands: Band[] = []
  const add = (items: FlowItem[][], columns: number) => {
    const last = bands[bands.length - 1]
    // Neighbouring single-column stretches are one band.
    if (columns === 1 && last && last.columns === 1) last.items[0].push(...items[0])
    else bands.push({ columns, items })
  }
  for (const g of groups) {
    const cols = !g.span && opts.columns ? splitColumns(g.entries) : null
    if (cols) add(cols.map((c) => toItems(c, body)), cols.length)
    else add([toItems(g.entries, body)], 1)
  }
  return { width: page.width, height: page.height, margin, bands }
}

/** A block of text to be placed at its own position on the page. */
export interface ExactText {
  text: string
  rect: Box
  size: number
  bold: boolean
  italic: boolean
  color: string
  font: string
  /** Distance between baselines, in points. */
  leading: number
}

/** Text blocks for the exact layout, top to bottom. */
export function exactTexts(blocks: TextBlock[]): ExactText[] {
  return blocks
    .filter((b) => b.text.trim())
    .map((b) => ({
      text: b.text.trim(),
      rect: b.rect,
      size: b.size,
      bold: b.weight >= 600 || /bold|black|heavy/i.test(b.font),
      italic: b.italic,
      color: b.color,
      font: b.font,
      leading: b.layout.leading > 0 ? b.layout.leading : b.size * 1.2
    }))
    .sort((a, b) => a.rect.y - b.rect.y || a.rect.x - b.rect.x)
}
