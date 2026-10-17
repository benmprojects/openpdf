/**
 * Bookmark tools beyond editing the tree: styles read from the file, expand and collapse, import and export as text
 * or CSV, and generating bookmarks from headings or pages. Pure apart from reading the styles with pdf-lib.
 */
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, type PDFObject } from 'pdf-lib'
import type { BookmarkNode, OutlineStyle } from './outlineEdit'

/**
 * Colour, style flags, open state and place-on-page of every bookmark, in the order of a depth-first walk of the tree
 * (the order PDFium reports them in), for adding to what PDFium read.
 */
export async function readOutlineStyles(bytes: Uint8Array): Promise<OutlineStyle[]> {
  const doc = await PDFDocument.load(bytes, {
    updateMetadata: false,
    ignoreEncryption: true
  })
  const root = doc.catalog.lookupMaybe(PDFName.of('Outlines'), PDFDict)
  const out: OutlineStyle[] = []
  const seen = new Set<PDFDict>()
  const num = (o: PDFObject | undefined) => (o instanceof PDFNumber ? o.asNumber() : null)
  const walk = (first: PDFDict | undefined, depth: number) => {
    for (let n = first; n && !seen.has(n) && depth < 40 && out.length < 20000; n = n.lookupMaybe(PDFName.of('Next'), PDFDict)) {
      seen.add(n)
      const st: OutlineStyle = {}
      const f = n.lookupMaybe(PDFName.of('F'), PDFNumber)?.asNumber() ?? 0
      if (f & 1) st.italic = true
      if (f & 2) st.bold = true
      const c = n.lookupMaybe(PDFName.of('C'), PDFArray)
      if (c && c.size() >= 3) {
        const v = [0, 1, 2].map((i) => Math.max(0, Math.min(255, Math.round((c.lookupMaybe(i, PDFNumber)?.asNumber() ?? 0) * 255))))
        const hex = '#' + v.map((x) => x.toString(16).padStart(2, '0')).join('')
        if (hex !== '#000000') st.color = hex
      }
      if ((n.lookupMaybe(PDFName.of('Count'), PDFNumber)?.asNumber() ?? 0) > 0) st.open = true
      let dest = n.lookup(PDFName.of('Dest'))
      if (!dest) dest = n.lookupMaybe(PDFName.of('A'), PDFDict)?.lookup(PDFName.of('D'))
      if (dest instanceof PDFArray && dest.size() >= 5) {
        const kind = dest.lookup(1)
        if (kind instanceof PDFName && kind.decodeText() === 'XYZ') {
          const left = num(dest.lookup(2))
          const top = num(dest.lookup(3))
          if (left !== null || top !== null) st.dest = { left, top }
        }
      }
      out.push(st)
      walk(n.lookupMaybe(PDFName.of('First'), PDFDict), depth + 1)
    }
  }
  walk(root?.lookupMaybe(PDFName.of('First'), PDFDict), 0)
  return out
}

/** Adds what {@link readOutlineStyles} found to the tree PDFium read. Nothing is added when the two disagree in size. */
export function mergeOutlineStyles<T extends { title: string; children: T[] }>(tree: T[], styles: OutlineStyle[]): (T & OutlineStyle)[] {
  const count = (t: T[]): number => t.reduce((n, x) => n + 1 + count(x.children), 0)
  if (count(tree) !== styles.length) return tree
  let i = 0
  const walk = (list: T[]): (T & OutlineStyle)[] =>
    list.map((n) => {
      const st = styles[i++]
      return { ...n, ...st, children: walk(n.children) }
    })
  return walk(tree)
}

// ---- Expand and collapse -------------------------------------------------------------------------------------

/** Every bookmark that has children opened or closed. */
export function setAllOpen(tree: BookmarkNode[], open: boolean): BookmarkNode[] {
  return tree.map((n) => ({
    ...n,
    open: n.children.length ? open : undefined,
    children: setAllOpen(n.children, open)
  }))
}

// ---- Import and export ---------------------------------------------------------------------------------------

const walkFlat = (tree: BookmarkNode[], depth = 0, out: { depth: number; node: BookmarkNode }[] = []) => {
  for (const n of tree) {
    out.push({ depth, node: n })
    walkFlat(n.children, depth + 1, out)
  }
  return out
}

const clean = (s: string) => s.replace(/[\t\r\n]+/g, ' ').trim()

/** An indented outline: a tab for each level, the title, a tab and the page number (from 1). */
export function outlineToText(tree: BookmarkNode[]): string {
  return walkFlat(tree)
    .map(({ depth, node }) => `${'\t'.repeat(depth)}${clean(node.title)}\t${node.page >= 0 ? node.page + 1 : ''}`)
    .join('\r\n')
}

const csvCell = (s: string) => (/[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s)

/** CSV with the columns Level (from 1), Title and Page (from 1). */
export function outlineToCsv(tree: BookmarkNode[]): string {
  const rows = walkFlat(tree).map(({ depth, node }) => [String(depth + 1), csvCell(clean(node.title)), node.page >= 0 ? String(node.page + 1) : ''].join(','))
  return ['Level,Title,Page', ...rows].join('\r\n')
}

/** Splits one CSV line; quotes may hold commas and doubled quotes. */
function csvFields(line: string): string[] {
  const out: string[] = []
  let cur = ''
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"'
        i++
      } else if (c === '"') quoted = false
      else cur += c
    } else if (c === '"') quoted = true
    else if (c === ',') {
      out.push(cur)
      cur = ''
    } else cur += c
  }
  out.push(cur)
  return out
}

/** Builds a tree from rows (level from 0, title, page from 0 or -1); a level that jumps ahead goes under the row before. */
function nestRows(rows: { depth: number; title: string; page: number }[]): BookmarkNode[] {
  const root: BookmarkNode[] = []
  const stack: BookmarkNode[][] = [root]
  for (const r of rows) {
    const depth = Math.min(Math.max(0, r.depth), stack.length - 1)
    const node: BookmarkNode = { title: r.title, page: r.page, children: [] }
    stack[depth].push(node)
    stack.length = depth + 1
    stack.push(node.children)
  }
  return root
}

export interface ParsedOutline {
  tree: BookmarkNode[]
  /** Lines that could not be used. */
  skipped: number
  /** Pages outside the document: those bookmarks were kept but left without a page. */
  outOfRange: number
}

/**
 * Reads an outline from text written by {@link outlineToText} or CSV written by {@link outlineToCsv}, or typed by hand:
 * indentation (tabs, or spaces) sets the level and a number after the last tab or comma is the page (from 1).
 */
export function parseOutline(input: string, pageCount: number): ParsedOutline {
  const lines = input
    .replace(/^\u{FEFF}/u, '')
    .split(/\r\n|\r|\n/)
    .filter((l) => l.trim())
  const rows: { depth: number; title: string; page: number }[] = []
  let skipped = 0
  let outOfRange = 0
  const asPage = (s: string): number => {
    if (!/^\s*\d+\s*$/.test(s)) return -1
    const n = Number(s)
    if (n < 1 || n > pageCount) {
      outOfRange++
      return -1
    }
    return n - 1
  }
  const isCsv = /^"?level"?\s*,\s*"?title"?/i.test(lines[0] ?? '') || (lines.length > 0 && lines.every((l) => /^\d+\s*,/.test(l)))
  if (isCsv) {
    for (const l of lines) {
      if (/^"?level"?\s*,/i.test(l)) continue
      const f = csvFields(l)
      const level = Number(f[0])
      if (!Number.isInteger(level) || level < 1 || !(f[1] ?? '').trim()) {
        skipped++
        continue
      }
      rows.push({
        depth: level - 1,
        title: f[1].trim(),
        page: asPage(f[2] ?? '')
      })
    }
  } else {
    // One indent step: the smallest run of leading spaces, or a tab.
    const spaces = lines.map((l) => /^( +)\S/.exec(l)?.[1].length ?? 0).filter((n) => n > 0)
    const step = spaces.length ? Math.max(1, Math.min(...spaces)) : 1
    for (const l of lines) {
      const lead = /^[\t ]*/.exec(l)![0]
      const depth = (lead.match(/\t/g)?.length ?? 0) + Math.floor(lead.replace(/\t/g, '').length / step)
      const body = l.slice(lead.length)
      const m = /^(.*?)\t+\s*(\d+)\s*$/.exec(body)
      const title = (m ? m[1] : body.replace(/\t+$/, '')).trim()
      if (!title) {
        skipped++
        continue
      }
      rows.push({ depth, title, page: m ? asPage(m[2]) : -1 })
    }
  }
  return { tree: nestRows(rows), skipped, outOfRange }
}

// ---- Generating bookmarks ------------------------------------------------------------------------------------

/** One line of text on a page with how it looks, for finding headings. */
export interface TextLine {
  page: number
  text: string
  /** Effective font size in points. */
  size: number
  bold: boolean
  /** Top of the line in points from the page's top-left as shown. */
  y: number
}

export interface Heading {
  title: string
  page: number
  /** From 0. */
  level: number
  y: number
}

export interface HeadingOptions {
  /** How many sizes above the body text become levels. */
  maxLevels: number
  /** A bold line at body size, on its own and short, is a heading of the last level. */
  includeBold: boolean
  /** A line is a heading only when this much larger than the body text (1.15 is 15% larger). */
  minRatio: number
}

export const DEFAULT_HEADING_OPTIONS: HeadingOptions = {
  maxLevels: 3,
  includeBold: true,
  minRatio: 1.15
}

/** Sizes within this many points count as one size. */
const SIZE_TOLERANCE = 0.6

const runningKey = (t: string) => t.trim().toLowerCase().replace(/\d+/g, '#')

/** Finds headings: lines set larger than the body text (or bold and short), leaving out running heads and page numbers. */
export function detectHeadings(lines: TextLine[], pageCount: number, opts: HeadingOptions = DEFAULT_HEADING_OPTIONS): Heading[] {
  const real = lines.filter((l) => l.text.trim().length > 0 && l.size > 0)
  if (!real.length) return []
  // Body size: the size with most characters.
  const weight = new Map<number, number>()
  for (const l of real) {
    const key = Math.round(l.size * 2) / 2
    weight.set(key, (weight.get(key) ?? 0) + l.text.length)
  }
  const body = [...weight.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0]
  // Lines that repeat on many pages (running heads, footers) are not headings.
  const pagesWith = new Map<string, Set<number>>()
  for (const l of real) {
    const k = runningKey(l.text)
    if (!pagesWith.has(k)) pagesWith.set(k, new Set())
    pagesWith.get(k)!.add(l.page)
  }
  const running = (l: TextLine) => pageCount >= 4 && (pagesWith.get(runningKey(l.text))?.size ?? 0) > Math.max(2, pageCount * 0.3)
  const plausible = (l: TextLine) => {
    const t = l.text.trim()
    return t.length >= 2 && t.length <= 140 && /\p{L}/u.test(t) && !/^page\s+\d+/i.test(t) && !running(l)
  }
  const bigger = new Set(real.filter((l) => l.size >= body * opts.minRatio && l.size - body > SIZE_TOLERANCE && plausible(l)))
  // Distinct heading sizes, largest first: each is a level.
  const sizes: number[] = []
  for (const s of [...bigger].map((l) => l.size).sort((a, b) => b - a)) if (!sizes.length || sizes[sizes.length - 1] - s > SIZE_TOLERANCE) sizes.push(s)
  const levelOfSize = (s: number) =>
    Math.min(
      sizes.findIndex((x) => Math.abs(x - s) <= SIZE_TOLERANCE),
      Math.max(1, opts.maxLevels) - 1
    )
  const boldLevel = Math.min(sizes.length, Math.max(1, opts.maxLevels) - 1)
  const picked: (Heading & { size: number })[] = []
  for (const l of real) {
    let level = -1
    if (bigger.has(l)) level = levelOfSize(l.size)
    else if (opts.includeBold && l.bold && Math.abs(l.size - body) <= SIZE_TOLERANCE && l.text.trim().length <= 70 && !/[.,;:]$/.test(l.text.trim()) && plausible(l)) level = boldLevel
    if (level >= 0)
      picked.push({
        title: l.text.trim().replace(/\s+/g, ' '),
        page: l.page,
        level,
        y: l.y,
        size: l.size
      })
  }
  // A heading wrapped over two lines: the next line of the same size just below joins it.
  const merged: Heading[] = []
  let prev: (typeof picked)[number] | null = null
  for (const h of picked) {
    if (prev && prev.page === h.page && prev.level === h.level && Math.abs(prev.size - h.size) <= SIZE_TOLERANCE && h.y - prev.y > 0 && h.y - prev.y < prev.size * 1.6) {
      merged[merged.length - 1].title += ` ${h.title}`
    } else merged.push({ title: h.title, page: h.page, level: h.level, y: h.y })
    prev = h
  }
  return merged
}

/** Headings as a tree, each pointing at its place on the page; a level that skips ahead goes under the heading before it. */
export function nestHeadings(headings: Heading[]): BookmarkNode[] {
  const tree = nestRows(headings.map((h) => ({ depth: h.level, title: h.title, page: h.page })))
  let i = 0
  const place = (list: BookmarkNode[]) => {
    for (const n of list) {
      n.view = { x: 0, y: Math.max(0, headings[i++].y - 4) }
      place(n.children)
    }
  }
  place(tree)
  return tree
}

/** One bookmark per page, named by the page label when the document has labels, otherwise "Page n". */
export function pageBookmarks(pageCount: number, labels: (string | undefined)[] | null, prefix = 'Page'): BookmarkNode[] {
  return Array.from({ length: pageCount }, (_, i) => ({
    title: labels?.[i] ? String(labels[i]) : `${prefix} ${i + 1}`,
    page: i,
    children: []
  }))
}

/** Text objects of a page as lines: objects on one baseline joined left to right, with the largest size and bold only if all of it is. */
export function linesFromObjects(
  page: number,
  objects: {
    rect: { x: number; y: number; w: number; h: number }
    text: string
    size: number
    weight: number
    font: string
    matrix: number[]
    mode: number
  }[]
): TextLine[] {
  const items = objects
    .filter((o) => o.mode !== 3 && o.text.trim())
    .map((o) => {
      const scale = Math.hypot(o.matrix[0], o.matrix[1])
      const size = o.size * (scale > 0.01 && scale < 100 ? scale : 1)
      return {
        x: o.rect.x,
        w: o.rect.w,
        y: o.rect.y,
        h: o.rect.h,
        text: o.text.replace(/[\r\n]+/g, ' '),
        size: size > 0 ? size : o.rect.h,
        bold: o.weight >= 700 || /bold|black|heavy|semibold/i.test(o.font)
      }
    })
    .sort((a, b) => a.y - b.y || a.x - b.x)
  const lines: { items: typeof items; y: number; h: number }[] = []
  for (const it of items) {
    const line = lines.find((l) => Math.abs(l.y + l.h / 2 - (it.y + it.h / 2)) < Math.min(l.h, it.h) * 0.5)
    if (line) line.items.push(it)
    else lines.push({ items: [it], y: it.y, h: it.h })
  }
  return lines
    .sort((a, b) => a.y - b.y)
    .map((l) => {
      const parts = [...l.items].sort((a, b) => a.x - b.x)
      return {
        page,
        text: parts
          .reduce((acc, p, i) => (i && p.x - (parts[i - 1].x + parts[i - 1].w) < p.size * 0.15 ? acc + p.text : `${acc} ${p.text}`), '')
          .replace(/\s+/g, ' ')
          .trim(),
        size: Math.max(...parts.map((p) => p.size)),
        bold: parts.every((p) => p.bold),
        y: l.y
      }
    })
}
