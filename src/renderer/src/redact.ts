/**
 * Redaction: permanently remove what lies under marked areas. The page's content stream is edited, not covered up:
 * text objects, images and shapes under a mark are taken out (PDFium says which objects those are; the k-th text
 * object is the k-th text-showing operator, and so on), annotations under it are deleted, and a black box is drawn
 * where it was. Marks and boxes are in display space (the page as shown, y down).
 */
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, PDFRef, PDFStream, StandardFonts, concatTransformationMatrix, popGraphicsState, pushGraphicsState, rgb, type PDFFont, type PDFObject } from 'pdf-lib'
import { frameFor } from './annotWrite'
import { imageDraws, isShow, num, parseContent, pathDraws, showBytes, showOrigins, stringToBytes, type Op } from './content'
import { isImageXObject, pageContent, xobjectDict } from './pageContent'
import type { ImageObject, TextObject } from './pdfiumRaw'
import type { Rect } from './textLogic'

/** How a mark looks once applied: the box that covers the removed content, and the text on it. */
export interface RedactStyle {
  /** `#rrggbb` fill of the box; black when unset. */
  fill?: string
  /** `#rrggbb` outline of the box; none when unset. */
  outline?: string
  /** Text drawn on the box, for example REDACTED or a reason code. None when empty. */
  text?: string
  /** `#rrggbb`; white or black, whichever shows against the fill, when unset. */
  textColour?: string
  /** Points; fitted to the box when unset or 0. */
  fontSize?: number
  /** Repeat the text across the box as many times as fit. */
  repeat?: boolean
}

export interface RedactMark {
  page: number
  rect: Rect
  style?: RedactStyle
}

export const DEFAULT_REDACT_STYLE: Required<Pick<RedactStyle, 'fill'>> = { fill: '#000000' }

const hexRgb = (hex: string): [number, number, number] => {
  const n = parseInt(/^#[0-9a-f]{6}$/i.test(hex) ? hex.slice(1) : '000000', 16)
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
}

/** Black or white, whichever reads better on `fill`. */
export function contrastText(fill: string): string {
  const [r, g, b] = hexRgb(fill)
  return 0.299 * r + 0.587 * g + 0.114 * b > 0.55 ? '#000000' : '#ffffff'
}

export interface OverlayLayout {
  size: number
  rows: { x: number; baseline: number; text: string }[]
}

/**
 * Where the overlay text goes in a box (display space, y down). One line centred in the box, or, with `repeat`, as many
 * copies side by side and as many lines as fit. The text is made smaller when one copy would not fit the box.
 */
export function layoutOverlay(rect: Rect, text: string, width: (s: string, size: number) => number, fontSize = 0, repeat = false): OverlayLayout | null {
  const label = text.replace(/\s+/g, ' ').trim()
  if (!label || rect.w < 2 || rect.h < 2) return null
  let size = fontSize > 0 ? fontSize : Math.min(rect.h * 0.7, 12)
  // Never wider than the box or taller than it.
  size = Math.min(size, rect.h * 0.9)
  const w1 = width(label, size)
  if (w1 > rect.w) size = Math.max(2, size * (rect.w / w1))
  const w = width(label, size)
  const gap = size
  const perRow = repeat ? Math.max(1, Math.floor((rect.w + gap) / (w + gap))) : 1
  const lineH = size * 1.3
  const lines = repeat ? Math.max(1, Math.floor(rect.h / lineH)) : 1
  const rowText = Array(perRow).fill(label).join('   ')
  const rowW = perRow > 1 ? width(rowText, size) : w
  const x = rect.x + Math.max(0, (rect.w - rowW) / 2)
  const top = rect.y + (rect.h - lines * lineH) / 2
  return { size, rows: Array.from({ length: lines }, (_, i) => ({ x, baseline: top + i * lineH + lineH / 2 + size * 0.35, text: rowText })) }
}

/** Replaces what the standard font cannot show with a question mark. */
export function safeLabel(text: string, font: Pick<PDFFont, 'getCharacterSet'>): string {
  const ok = new Set(font.getCharacterSet())
  return [...text].map((c) => (ok.has(c.codePointAt(0)!) ? c : '?')).join('')
}

/** What PDFium found on one page, for deciding what lies under the marks. */
export interface PageObjects {
  texts: TextObject[]
  textTotal: number
  images: ImageObject[]
  imageTotal: number
  paths: ImageObject[]
  pathTotal: number
}

export interface RedactReport {
  /** Text objects, images and shapes taken out, and annotations deleted. */
  text: number
  images: number
  shapes: number
  annotations: number
  boxes: number
  /** Pages whose content could not be checked completely (it draws forms, or the content did not match). */
  unchecked: number[]
}

const overlap = (a: Rect, b: Rect): number => {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)
  return w > 0 && h > 0 ? w * h : 0
}

const centreIn = (r: Rect, m: Rect): boolean => {
  const cx = r.x + r.w / 2
  const cy = r.y + r.h / 2
  return cx >= m.x && cx <= m.x + m.w && cy >= m.y && cy <= m.y + m.h
}

/** An object is redacted when its centre lies in a mark or a tenth of its area does. */
export function hit(r: Rect, marks: Rect[]): boolean {
  const area = Math.max(r.w * r.h, 1e-6)
  return marks.some((m) => centreIn(r, m) || overlap(r, m) / area >= 0.1)
}

/** A shape or box is removed only when it lies wholly inside a mark (a little slack for stroke widths). */
export function inside(r: Rect, marks: Rect[], slack = 1): boolean {
  return marks.some((m) => r.x >= m.x - slack && r.y >= m.y - slack && r.x + r.w <= m.x + m.w + slack && r.y + r.h <= m.y + m.h + slack)
}

/**
 * Whether taking out show operation `idx` leaves later text where it was: the next text shown in the same text object
 * starts afresh, or is itself taken out cleanly (`removable` says which later ones are).
 */
function nextKeepsLayout(ops: Op[], idx: number, removing: ReadonlySet<number>, removable: ReadonlyMap<number, boolean>): boolean {
  for (let i = idx + 1; i < ops.length; i++) {
    const op = ops[i].op
    if (op === 'ET' || op === 'BT' || op === 'Td' || op === 'TD' || op === 'T*' || op === 'Tm' || op === "'" || op === '"') return true
    if ((op === 'Tj' || op === 'TJ') && showBytes(ops[i]).length > 0) return removing.has(i) && removable.get(i) === true
  }
  return true
}

export interface PageResult {
  src: string
  /** Resource names of the images taken out (the page may still draw them elsewhere). */
  removedImages: string[]
  report: Pick<RedactReport, 'text' | 'images' | 'shapes'>
  unchecked: boolean
  /** Whether the page draws forms (their content cannot be edited here). */
  forms: boolean
}

/**
 * The new content stream of a page with everything under `marks` removed. Pure apart from `isImage`, which says
 * whether an XObject name is an image. Throws when PDFium's objects and the stream disagree (nothing is then removed).
 */
export function redactContent(src: string, marks: Rect[], found: PageObjects, rotation: number, isImage: (name: string) => boolean): PageResult {
  const ops = parseContent(src)
  const edits: { start: number; end: number; text: string }[] = []
  /** Takes an operation out, with the whitespace before it. */
  const cut = (o: Op) => {
    let start = o.start
    while (start > 0 && /\s/.test(src[start - 1])) start--
    edits.push({ start, end: o.end, text: '' })
  }
  const report = { text: 0, images: 0, shapes: 0 }
  const removedImages: string[] = []

  // Text.
  const shows = ops.map((o, i) => (isShow(o) && showBytes(o).length > 0 ? i : -1)).filter((i) => i >= 0)
  const allShows = ops.map((o, i) => (isShow(o) ? i : -1)).filter((i) => i >= 0)
  const wanted = found.texts.filter((t) => hit(t.rect, marks))
  if (wanted.length) {
    if (shows.length !== found.textTotal) throw new Error('The text on this page cannot be redacted safely (its content did not match).')
    const origins = showOrigins(ops)
    const idxs = wanted.map((t) => shows[t.ordinal])
    wanted.forEach((t, k) => {
      const idx = idxs[k]
      if (idx === undefined) throw new Error('Text under a mark could not be found in the page content.')
      const origin = origins[allShows.indexOf(idx)]
      if (origin && Math.hypot(origin.x - t.matrix[4], origin.y - t.matrix[5]) > 1) throw new Error('The page content did not match what PDFium read.')
    })
    const removing = new Set(idxs)
    const removable = new Map<number, boolean>()
    for (const idx of [...idxs].sort((x, y) => y - x)) removable.set(idx, nextKeepsLayout(ops, idx, removing, removable))
    idxs.forEach((idx, k) => {
      const op = ops[idx]
      const t = wanted[k]
      report.text++
      if (removable.get(idx)) {
        if (op.op === "'" || op.op === '"') {
          // These also move to the next line (and " sets spacing): keep that part, drop the text.
          const spacing = op.op === '"' && op.operands.length >= 3 && op.operands[0].t === 'num' && op.operands[1].t === 'num' ? `${num(op.operands[0].v)} Tw ${num(op.operands[1].v)} Tc ` : ''
          edits.push({ start: op.start, end: op.end, text: `${spacing}T*` })
        } else cut(op)
      } else {
        // Later text on the line runs on from this one: keep its width as blank space so that it stays put.
        const scale = Math.hypot(t.matrix[0], t.matrix[1]) || 1
        const width = rotation % 180 !== 0 ? t.rect.h : t.rect.w
        const advance = Math.round((width / ((t.size || 12) * scale)) * 1000)
        edits.push({ start: op.start, end: op.end, text: `${op.op === "'" || op.op === '"' ? 'T* ' : ''}[${-advance}] TJ` })
      }
    })
  }

  // Images.
  const pics = found.images.filter((o) => hit(o.rect, marks))
  if (pics.length) {
    const draws = imageDraws(ops, isImage)
    if (draws.length !== found.imageTotal) throw new Error('The images on this page cannot be redacted safely (its content did not match).')
    for (const o of pics) {
      const d = draws[o.ordinal]
      if (!d) throw new Error('An image under a mark could not be found in the page content.')
      if (!d.ctm.every((v, i) => Math.abs(v - o.matrix[i]) <= 0.5 + Math.abs(v) * 1e-3)) throw new Error('The page content did not match what PDFium read.')
      cut(ops[d.index])
      if (d.name) removedImages.push(d.name)
      report.images++
    }
  }

  // Shapes wholly inside a mark (a shape only partly under one is left as it is).
  const inner = found.paths.filter((o) => inside(o.rect, marks))
  if (inner.length) {
    const paths = pathDraws(ops)
    if (paths.length !== found.pathTotal) throw new Error('The shapes on this page cannot be redacted safely (its content did not match).')
    for (const o of inner) {
      const p = paths[o.ordinal]
      if (!p || p.clips) continue
      // The whole run of construction operators and the painting one go; each is cut separately, so they stay ordered.
      for (let i = p.first; i <= p.paint; i++) cut(ops[i])
      report.shapes++
    }
  }

  let out = src
  for (const e of edits.sort((x, y) => y.start - x.start)) out = out.slice(0, e.start) + e.text + out.slice(e.end)
  const forms = ops.some((o) => o.op === 'Do' && o.operands[0]?.t === 'name' && !isImage(o.operands[0].v))
  return { src: out, removedImages, report, unchecked: forms, forms }
}

/**
 * Applies the marks of the pages in `byPage`. `objects(page)` reads the PDFium objects of a page. Annotations under
 * a mark are deleted and a black box is drawn over each mark. Returns the new file.
 */
export async function redactPages(
  bytes: Uint8Array,
  marks: RedactMark[],
  objects: (page: number) => Promise<PageObjects>,
  fill = '#000000'
): Promise<{ bytes: Uint8Array; report: RedactReport }> {
  if (!marks.length) return { bytes, report: { text: 0, images: 0, shapes: 0, annotations: 0, boxes: 0, unchecked: [] } }
  const doc = await PDFDocument.load(bytes, { updateMetadata: false })
  const report: RedactReport = { text: 0, images: 0, shapes: 0, annotations: 0, boxes: 0, unchecked: [] }
  const pageIndexes = [...new Set(marks.map((m) => m.page))].sort((a, b) => a - b)
  let font: PDFFont | null = null
  for (const pi of pageIndexes) {
    const pageMarks = marks.filter((m) => m.page === pi)
    const rects = pageMarks.map((m) => m.rect)
    const page = doc.getPage(pi)
    const rotation = page.getRotation().angle
    const found = await objects(pi)
    const r = redactContent(pageContent(page), rects, found, rotation, (name) => isImageXObject(page, name))
    report.text += r.report.text
    report.images += r.report.images
    report.shapes += r.report.shapes
    if (r.unchecked) report.unchecked.push(pi)
    const ctx = doc.context
    page.node.set(PDFName.of('Contents'), ctx.register(ctx.flateStream(stringToBytes(r.src))))
    // An image the page no longer draws must not stay in its resources, or its data stays in the file.
    if (r.removedImages.length) {
      const still = new Set(parseContent(r.src).filter((o) => o.op === 'Do' && o.operands[0]?.t === 'name').map((o) => (o.operands[0] as { v: string }).v))
      const xo = xobjectDict(page)
      for (const name of r.removedImages) if (xo && !still.has(name)) xo.delete(PDFName.of(name))
    }

    // Display rectangles to user space.
    const cb = page.getCropBox()
    const f = frameFor(cb.x, cb.y, cb.x + cb.width, cb.y + cb.height, rotation).m
    const toUser = (x: number, y: number): [number, number] => [f[0] * x + f[2] * y + f[4], f[1] * x + f[3] * y + f[5]]
    const user = rects.map((m) => {
      const a = toUser(m.x, m.y)
      const b = toUser(m.x + m.w, m.y + m.h)
      return { x0: Math.min(a[0], b[0]), y0: Math.min(a[1], b[1]), x1: Math.max(a[0], b[0]), y1: Math.max(a[1], b[1]) }
    })

    // Annotations under a mark go (their appearance would show what was under it, or hold the text itself).
    const annots = page.node.lookupMaybe(PDFName.of('Annots'), PDFArray)
    if (annots) {
      for (let i = annots.size() - 1; i >= 0; i--) {
        const a = annots.lookupMaybe(i, PDFDict)
        const rect = a?.lookupMaybe(PDFName.of('Rect'), PDFArray)
        if (!a || !rect || rect.size() < 4) continue
        const v = [0, 1, 2, 3].map((k) => rect.lookupMaybe(k, PDFNumber)?.asNumber() ?? 0)
        const x0 = Math.min(v[0], v[2])
        const x1 = Math.max(v[0], v[2])
        const y0 = Math.min(v[1], v[3])
        const y1 = Math.max(v[1], v[3])
        const under = user.some((u) => Math.min(x1, u.x1) - Math.max(x0, u.x0) > 0 && Math.min(y1, u.y1) - Math.max(y0, u.y0) > 0)
        if (under) {
          annots.remove(i)
          report.annotations++
        }
      }
    }
    if (!font && pageMarks.some((m) => m.style?.text?.trim())) font = await doc.embedFont(StandardFonts.HelveticaBold)
    user.forEach((u, k) => {
      const st = pageMarks[k].style ?? {}
      const fillHex = st.fill ?? fill
      const [fr, fg, fb] = hexRgb(fillHex)
      const outline = st.outline ? hexRgb(st.outline) : null
      page.drawRectangle({
        x: u.x0,
        y: u.y0,
        width: u.x1 - u.x0,
        height: u.y1 - u.y0,
        color: rgb(fr, fg, fb),
        ...(outline ? { borderColor: rgb(outline[0], outline[1], outline[2]), borderWidth: 1.5 } : { borderWidth: 0 })
      })
      report.boxes++
      const f2 = font
      if (f2 && st.text && st.text.trim()) {
        const label = safeLabel(st.text, f2)
        const lay = layoutOverlay(pageMarks[k].rect, label, (s, size) => f2.widthOfTextAtSize(s, size), st.fontSize ?? 0, !!st.repeat)
        if (lay) {
          const [tr, tg, tb] = hexRgb(st.textColour ?? contrastText(fillHex))
          // Drawn in display space (y down): move there, then flip so the text stands upright.
          page.pushOperators(pushGraphicsState(), concatTransformationMatrix(...f), concatTransformationMatrix(1, 0, 0, -1, 0, 0))
          for (const row of lay.rows) page.drawText(row.text, { x: row.x, y: -row.baseline, size: lay.size, font: f2, color: rgb(tr, tg, tb) })
          page.pushOperators(popGraphicsState())
        }
      }
    })
  }
  pruneUnreachable(doc)
  return { bytes: await doc.save(), report }
}

/**
 * Drops every object that nothing reachable from the trailer refers to. pdf-lib keeps objects that were cut loose
 * (a removed image, an old content stream), and they would otherwise be written out with their data.
 */
export function pruneUnreachable(doc: PDFDocument): number {
  const ctx = doc.context
  const seen = new Set<PDFRef>()
  const stack: PDFObject[] = []
  const push = (o: PDFObject | undefined) => o && stack.push(o)
  push(ctx.trailerInfo.Root)
  push(ctx.trailerInfo.Info)
  push(ctx.trailerInfo.Encrypt)
  while (stack.length) {
    const o = stack.pop()!
    if (o instanceof PDFRef) {
      if (seen.has(o)) continue
      seen.add(o)
      push(ctx.lookup(o))
    } else if (o instanceof PDFDict) o.values().forEach(push)
    else if (o instanceof PDFArray) for (let i = 0; i < o.size(); i++) push(o.get(i))
    else if (o instanceof PDFStream) o.dict.values().forEach(push)
  }
  let dropped = 0
  for (const [ref] of ctx.enumerateIndirectObjects()) {
    if (!seen.has(ref)) {
      ctx.delete(ref)
      dropped++
    }
  }
  return dropped
}
