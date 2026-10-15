/**
 * Finding where form fields should go on a page that has none: underscore and dotted blanks in the text, horizontal
 * rules, empty boxes and small squares among the drawn paths, each named from the label printed next to it. The page's
 * drawing comes from its content stream, its text and glyph positions from PDFium; everything here works in display
 * space (points from the top-left of the page as shown).
 */
import { PDFDocument } from 'pdf-lib'
import { frameFor } from './annotWrite'
import { parseContent, pathDraws, type PathDraw } from './content'
import { pageContent } from './pageContent'
import type { PageText } from './pdfiumRaw'
import type { Rect } from './textLogic'

export interface Glyph {
  ch: string
  x0: number
  y0: number
  x1: number
  y1: number
}

export interface Detected {
  type: 'text' | 'checkbox'
  page: number
  rect: Rect
  /** The label found next to it, if any. */
  label: string
  /** A proposed field name, unique among the document's fields and the other suggestions. */
  name: string
  source: 'blank' | 'rule' | 'box' | 'square'
}

export interface DetectPage {
  page: number
  /** Painted paths, page space (as `pathDraws` returns them). */
  draws: PathDraw[]
  /** Page space to display space. */
  toDisplay: (x: number, y: number) => [number, number]
  glyphs: Glyph[]
  /** Fields already on the page (display space). */
  existing: Rect[]
}

const overlapX = (a: Rect, b: Rect) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x))
const overlapY = (a: Rect, b: Rect) => Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y))
const area = (r: Rect) => r.w * r.h
const iou = (a: Rect, b: Rect) => {
  const i = overlapX(a, b) * overlapY(a, b)
  return i / (area(a) + area(b) - i || 1)
}
const near1 = (a: number, b: number, t: number) => Math.abs(a - b) <= t

/** Glyphs of PDFium page text as rectangles with their character. */
export function glyphsOf(t: PageText): Glyph[] {
  const out: Glyph[] = []
  for (let u = 0; u < t.text.length; u++) {
    const c = t.charOf[u]
    if (c === undefined || c < 0) continue
    const x0 = t.boxes[c * 4]
    const y0 = t.boxes[c * 4 + 1]
    const x1 = t.boxes[c * 4 + 2]
    const y1 = t.boxes[c * 4 + 3]
    if (x1 > x0 && y1 > y0) out.push({ ch: t.text[u], x0, y0, x1, y1 })
  }
  return out
}

/** The text of glyphs read left to right, with a space where the gap is wide. */
function textOf(gs: Glyph[]): string {
  let s = ''
  let prev: Glyph | null = null
  for (const g of [...gs].sort((a, b) => a.x0 - b.x0)) {
    if (prev && g.x0 - prev.x1 > (g.y1 - g.y0) * 0.2 && !s.endsWith(' ') && g.ch !== ' ') s += ' '
    s += g.ch
    prev = g
  }
  return s.replace(/\s+/g, ' ').trim()
}

/** A label to the left of the box on its line: glyphs whose vertical extent overlaps the box's lower band, up to the first wide gap. */
function labelLeft(r: Rect, glyphs: Glyph[]): string {
  const band: Rect = { x: 0, y: r.y + r.h - Math.min(r.h, 14), w: 1, h: Math.min(r.h, 14) }
  const line = glyphs.filter((g) => g.x1 <= r.x + 2 && g.x1 >= r.x - 160 && overlapY({ x: g.x0, y: g.y0, w: 1, h: g.y1 - g.y0 }, band) >= (g.y1 - g.y0) * 0.4 && g.ch !== '_')
  const picked: Glyph[] = []
  let edge = r.x
  for (const g of [...line].sort((a, b) => b.x1 - a.x1)) {
    if (edge - g.x1 > Math.max(8, (g.y1 - g.y0) * 1.3) && picked.length) break
    picked.push(g)
    edge = g.x0
    if (picked.length >= 60) break
  }
  return textOf(picked).replace(/[:.\s]+$/, '').trim()
}

/** A caption just above or below the box, over the same stretch of the page. */
function labelVertical(r: Rect, glyphs: Glyph[], where: 'above' | 'below'): string {
  const y0 = where === 'above' ? r.y - 16 : r.y + r.h - 1
  const y1 = where === 'above' ? r.y + 1 : r.y + r.h + 15
  const gs = glyphs.filter((g) => g.ch !== '_' && g.y1 >= y0 && g.y0 <= y1 && g.x1 > r.x - 4 && g.x0 < r.x + r.w + 4 && (g.y0 + g.y1) / 2 > y0 && (g.y0 + g.y1) / 2 < y1)
  if (!gs.length) return ''
  // The nearest line of text only.
  const lineY = where === 'above' ? Math.max(...gs.map((g) => g.y1)) : Math.min(...gs.map((g) => g.y0))
  return textOf(gs.filter((g) => near1(where === 'above' ? g.y1 : g.y0, lineY, 3))).replace(/[:.\s]+$/, '').trim()
}

/** A label to the right of a small square, up to the first wide gap. */
function labelRight(r: Rect, glyphs: Glyph[]): string {
  const line = glyphs.filter((g) => g.x0 >= r.x + r.w - 1 && overlapY({ x: g.x0, y: g.y0, w: 1, h: g.y1 - g.y0 }, r) >= (g.y1 - g.y0) * 0.4)
  const picked: Glyph[] = []
  let edge = r.x + r.w
  for (const g of [...line].sort((a, b) => a.x0 - b.x0)) {
    // The label starts close to the square, then runs on until a wide gap.
    if (!picked.length && g.x0 - edge > 14) return ''
    if (g.x0 - edge > Math.max(8, (g.y1 - g.y0) * 1.3) && picked.length) break
    picked.push(g)
    edge = g.x1
    if (picked.length >= 60) break
  }
  return textOf(picked).trim()
}

/** A field name from a label: letters and digits, words joined by underscores. */
export function nameFromLabel(label: string, fallback: string): string {
  const n = label
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .trim()
    .replace(/\s+/g, '_')
    .slice(0, 40)
  if (!n) return fallback
  return /^\d/.test(n) ? `f${n}` : n
}

/**
 * Suggestions for one page. A rule or box is only taken when a label can be found for it (to the left, or a caption
 * below or above), so page furniture such as header rules and frames is left alone.
 */
export function detectFields(p: DetectPage): Omit<Detected, 'name'>[] {
  const out: Omit<Detected, 'name'>[] = []
  const taken: Rect[] = [...p.existing]
  const add = (d: Omit<Detected, 'name'>) => {
    if (taken.some((t) => iou(t, d.rect) > 0.3 || (overlapX(t, d.rect) * overlapY(t, d.rect)) / area(d.rect) > 0.6)) return
    taken.push(d.rect)
    out.push(d)
  }

  // Blanks printed in the text: runs of underscores or dotted leaders on one line.
  const gs = p.glyphs
  for (let i = 0; i < gs.length; ) {
    const ch = gs[i].ch
    if (ch !== '_' && ch !== '.') {
      i++
      continue
    }
    let j = i
    while (j + 1 < gs.length && gs[j + 1].ch === ch && near1(gs[j + 1].y1, gs[i].y1, 2) && gs[j + 1].x0 - gs[j].x1 < 4) j++
    const len = j - i + 1
    if (len >= (ch === '_' ? 3 : 8)) {
      const h = Math.max(14, (gs[i].y1 - gs[i].y0) * 1.6)
      const rect: Rect = { x: gs[i].x0, y: gs[j].y1 - h + 1, w: gs[j].x1 - gs[i].x0, h }
      if (rect.w >= 24) add({ type: 'text', page: p.page, rect, label: labelLeft(rect, gs) || labelVertical(rect, gs, 'below'), source: 'blank' })
    }
    i = j + 1
  }

  // Drawn rules, boxes and squares.
  for (const d of p.draws) {
    if (d.clips || (d.shape !== 'rect' && d.shape !== 'line')) continue
    const [ax, ay] = p.toDisplay(d.bbox.x0, d.bbox.y0)
    const [bx, by] = p.toDisplay(d.bbox.x1, d.bbox.y1)
    const box: Rect = { x: Math.min(ax, bx), y: Math.min(ay, by), w: Math.abs(bx - ax), h: Math.abs(by - ay) }
    if (d.shape === 'line') {
      if (!d.stroked || box.h > 1.5 || box.w < 36 || box.w > 400) continue
      const rect: Rect = { x: box.x, y: box.y - 16, w: box.w, h: 17 }
      const label = labelLeft(rect, gs) || labelVertical({ ...rect, y: box.y - 1, h: 1 }, gs, 'below')
      if (label) add({ type: 'text', page: p.page, rect, label, source: 'rule' })
    } else {
      const light = !d.filled || (d.fill !== null && d.fill.every((v) => v > 0.85))
      if (!d.stroked || !light) continue
      if (box.w >= 6 && box.w <= 18 && box.h >= 6 && box.h <= 18 && near1(box.w, box.h, 1.5)) {
        const label = labelRight(box, gs)
        if (label) add({ type: 'checkbox', page: p.page, rect: box, label, source: 'square' })
      } else if (box.w >= 36 && box.w <= 520 && box.h >= 10 && box.h <= 90) {
        const label = labelLeft(box, gs) || labelVertical(box, gs, 'above')
        if (label) add({ type: 'text', page: p.page, rect: box, label, source: 'box' })
      }
    }
  }
  return out
}

/** Gives suggestions names that are unique among `used` and each other. */
export function nameSuggestions(found: Omit<Detected, 'name'>[], used: string[]): Detected[] {
  const taken = new Set(used)
  const counters: Record<string, number> = { text: 0, checkbox: 0 }
  return found.map((d) => {
    const fallback = d.type === 'text' ? 'Text' : 'Check'
    let base = nameFromLabel(d.label, '')
    if (!base) base = `${fallback}${++counters[d.type]}`
    let name = base
    for (let n = 2; taken.has(name); n++) name = `${base}_${n}`
    taken.add(name)
    return { ...d, name }
  })
}

/** Runs detection over a whole document. `getText` supplies each page's text (from PDFium). */
export async function detectInDocument(bytes: Uint8Array, getText: (page: number) => Promise<PageText>, existing: { name: string; page: number; rect: Rect }[]): Promise<Detected[]> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false })
  const all: Omit<Detected, 'name'>[] = []
  for (let i = 0; i < doc.getPageCount(); i++) {
    const page = doc.getPage(i)
    const cb = page.getCropBox()
    const m = frameFor(cb.x, cb.y, cb.x + cb.width, cb.y + cb.height, page.getRotation().angle).m
    const det = m[0] * m[3] - m[1] * m[2]
    const toDisplay = (x: number, y: number): [number, number] => [(m[3] * (x - m[4]) - m[2] * (y - m[5])) / det, (-m[1] * (x - m[4]) + m[0] * (y - m[5])) / det]
    all.push(
      ...detectFields({
        page: i,
        draws: pathDraws(parseContent(pageContent(page))),
        toDisplay,
        glyphs: glyphsOf(await getText(i)),
        existing: existing.filter((e) => e.page === i).map((e) => e.rect)
      })
    )
  }
  return nameSuggestions(all, existing.map((e) => e.name))
}
