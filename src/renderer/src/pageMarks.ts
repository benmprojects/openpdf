/**
 * Page marks written into page content: headers, footers, page numbers, Bates numbers, watermarks and backgrounds,
 * plus crop and resize. Each mark goes into its own content stream tagged /OPMarks, so it can be removed again
 * without touching the page's own content. Marks are laid out in display space (the page as shown, after /Rotate).
 */
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFRawStream, PDFRef, PDFStream, StandardFonts, type PDFFont, type PDFPage } from 'pdf-lib'
import { frameFor, type Frame } from './annotWrite'
import type { FontFamily } from './annotations'
import { formatDate } from './stampLogic'

export type Slot = 'tl' | 'tc' | 'tr' | 'bl' | 'bc' | 'br'
export type MarkKind = 'HeaderFooter' | 'Watermark' | 'Background' | 'Overlay'

export interface HeaderFooterSpec {
  /** Text per position; tokens: <<page>> <<pages>> <<label>> <<date>> <<file>> <<bates>>. */
  slots: Partial<Record<Slot, string>>
  fontSize: number
  font: FontFamily
  color: string
  /** Distance from the page edges, in points. */
  margin: number
  /** Zero-based pages to mark. */
  pages: number[]
  /** First number for <<page>> (on the first marked page). */
  startNumber: number
  bates?: { prefix: string; suffix: string; start: number; digits: number }
  /** What <<pages>> shows, when the numbering runs on across several files. */
  totalPages?: number
  /** Text per position for the first marked page when it differs from the rest (an empty object leaves it bare). */
  firstSlots?: Partial<Record<Slot, string>>
  /** Distance from each page edge in points; `margin` is used for a side not given. */
  margins?: Partial<Record<'top' | 'right' | 'bottom' | 'left', number>>
  /** Shifts every piece of text, in points: right and down are positive. */
  offset?: { x: number; y: number }
  /** Make text smaller when it does not fit the room it has. */
  shrink?: boolean
  /** How <<date>> is written (a format from DATE_FORMATS in stampLogic); DD/MM/YYYY when unset. */
  dateFormat?: string
}

export interface DocInfo {
  fileName: string
  /** Page labels or null. */
  labels: string[] | null
}

const n = (v: number) => (Math.round(v * 1000) / 1000).toString()
const rgb = (hex: string) => {
  const v = parseInt(hex.replace('#', ''), 16)
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255].map(n).join(' ')
}
const STANDARD: Record<FontFamily, StandardFonts> = {
  Helvetica: StandardFonts.Helvetica,
  Times: StandardFonts.TimesRoman,
  Courier: StandardFonts.Courier
}

/** dd/mm/yyyy, the Australian way. */
export function todayAu(d = new Date()): string {
  const p = (x: number) => String(x).padStart(2, '0')
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`
}

export function expandTokens(
  template: string,
  t: { page: number; pages: number; label: string; date: string; file: string; bates: string }
): string {
  return template
    .replace(/<<page>>/gi, String(t.page))
    .replace(/<<pages>>/gi, String(t.pages))
    .replace(/<<label>>/gi, t.label)
    .replace(/<<date>>/gi, t.date)
    .replace(/<<file>>/gi, t.file)
    .replace(/<<bates>>/gi, t.bates)
}

export function batesNumber(b: NonNullable<HeaderFooterSpec['bates']>, index: number): string {
  return `${b.prefix}${String(b.start + index).padStart(b.digits, '0')}${b.suffix}`
}

export function frameOf(page: PDFPage): { f: Frame; w: number; h: number } {
  const cb = page.getCropBox()
  const rot = ((page.getRotation().angle % 360) + 360) % 360
  const turned = rot === 90 || rot === 270
  return { f: frameFor(cb.x, cb.y, cb.x + cb.width, cb.y + cb.height, rot), w: turned ? cb.height : cb.width, h: turned ? cb.width : cb.height }
}
const cm = (f: Frame) => `${f.m.map(n).join(' ')} cm`

function safeText(font: PDFFont, s: string): string {
  let out = ''
  for (const ch of s) {
    try {
      font.encodeText(ch)
      out += ch
    } catch {
      out += '?'
    }
  }
  return out
}

/** Contents as a list of stream references (wrapping a single stream). */
function contentsOf(doc: PDFDocument, page: PDFPage): PDFArray {
  const c = page.node.get(PDFName.of('Contents'))
  if (c instanceof PDFArray) return c
  const arr = doc.context.obj([]) as PDFArray
  if (c) arr.push(c)
  page.node.set(PDFName.of('Contents'), arr)
  return arr
}

const markOf = (doc: PDFDocument, ref: unknown): string | undefined => {
  if (!(ref instanceof PDFRef)) return undefined
  const s = doc.context.lookup(ref)
  const dict = s instanceof PDFRawStream || s instanceof PDFStream ? (s as unknown as { dict: PDFDict }).dict : undefined
  return dict?.lookupMaybe(PDFName.of('OPMarks'), PDFName)?.decodeText()
}

/**
 * Adds a mark stream to a page. Over the content: the page's own content is wrapped in q/Q first (guard streams)
 * so its graphics state cannot shift the mark. Behind the content: the stream goes first.
 */
export function addMarkStream(doc: PDFDocument, page: PDFPage, kind: MarkKind, ops: string, behind: boolean) {
  const ctx = doc.context
  const arr = contentsOf(doc, page)
  const ref = ctx.register(ctx.flateStream(ops, { OPMarks: kind } as never))
  if (behind) {
    arr.insert(0, ref)
    return
  }
  const hasGuard = Array.from({ length: arr.size() }, (_, i) => markOf(doc, arr.get(i))).includes('GuardOpen')
  if (!hasGuard) {
    arr.insert(0, ctx.register(ctx.stream('q', { OPMarks: 'GuardOpen' } as never)))
    arr.push(ctx.register(ctx.stream('Q', { OPMarks: 'GuardClose' } as never)))
  }
  arr.push(ref)
}

/** Registers a font under a fresh name in the page's resources and returns that name. */
function fontOn(page: PDFPage, font: PDFFont): string {
  return page.node.newFontDictionary('OPMF', font.ref).decodeText().replace(/^\//, '')
}

export async function addHeaderFooter(bytes: Uint8Array, spec: HeaderFooterSpec, info: DocInfo): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false })
  const font = await doc.embedFont(STANDARD[spec.font])
  const total = doc.getPageCount()
  const date = formatDate(spec.dateFormat || 'DD/MM/YYYY', new Date())
  const pages = [...new Set(spec.pages)].filter((p) => p >= 0 && p < total).sort((a, b) => a - b)
  const side = (k: 'top' | 'right' | 'bottom' | 'left') => spec.margins?.[k] ?? spec.margin
  const dx = spec.offset?.x ?? 0
  const dy = spec.offset?.y ?? 0
  pages.forEach((pi, k) => {
    const page = doc.getPage(pi)
    const { f, w, h } = frameOf(page)
    const name = fontOn(page, font)
    const ops: string[] = []
    const slots = k === 0 && spec.firstSlots ? spec.firstSlots : spec.slots
    const entries = (Object.entries(slots) as [Slot, string][]).filter(([, template]) => template?.trim())
    for (const [slot, template] of entries) {
      const text = safeText(
        font,
        expandTokens(template, {
          page: spec.startNumber + k,
          pages: spec.totalPages ?? spec.startNumber + pages.length - 1,
          label: info.labels?.[pi] || String(pi + 1),
          date,
          file: info.fileName,
          bates: spec.bates ? batesNumber(spec.bates, k) : ''
        })
      )
      let size = spec.fontSize
      let tw = font.widthOfTextAtSize(text, size)
      if (spec.shrink) {
        // The room a text has is the line between the margins, shared by the texts on the same line.
        const sharing = entries.filter(([other]) => other[0] === slot[0]).length
        const room = Math.max(10, (w - side('left') - side('right')) / sharing)
        if (tw > room) {
          size = Math.max(4, (size * room) / tw)
          tw = font.widthOfTextAtSize(text, size)
        }
      }
      const x = (slot[1] === 'l' ? side('left') : slot[1] === 'c' ? (w - tw) / 2 : w - side('right') - tw) + dx
      const y = (slot[0] === 't' ? side('top') + size * 0.8 : h - side('bottom')) + dy
      ops.push(`BT /${name} ${n(size)} Tf ${rgb(spec.color)} rg 1 0 0 -1 ${n(x)} ${n(y)} Tm ${font.encodeText(text).toString()} Tj ET`)
    }
    if (ops.length) addMarkStream(doc, page, 'HeaderFooter', `q ${cm(f)} ${ops.join(' ')} Q`, false)
  })
  return doc.save()
}

export type WatermarkAlign = 'tl' | 'tc' | 'tr' | 'ml' | 'mc' | 'mr' | 'bl' | 'bc' | 'br'

export interface WatermarkSpec {
  kind: 'text' | 'image'
  /** The text; the codes of header text (<<page>>, <<date>>, <<file>> ...) are allowed. */
  text?: string
  /** PNG or JPEG for an image watermark. */
  image?: Uint8Array
  font: FontFamily
  fontSize: number
  color: string
  /** 0 to 1. */
  opacity: number
  /** Degrees anticlockwise, as seen on the page. */
  angle: number
  /** Image width as a fraction of the page width. */
  scale: number
  /** Behind the page content (a watermark that text sits on top of) or over it. */
  behind: boolean
  pages: number[]
  /** Where on the page the mark sits: middle centre when unset. */
  align?: WatermarkAlign
  /** Distance from the page edge for a mark that is not in the middle, in points (20 when unset). */
  margin?: number
  /** Shifts the mark, in points: right and down are positive. */
  offset?: { x: number; y: number }
  /** Repeat the mark across the page with these gaps between the copies, in points. */
  tile?: { gapX: number; gapY: number } | null
  /** Make a mark that is bigger than the page (less its margins) smaller until it fits. */
  shrink?: boolean
  /** How <<date>> is written; DD/MM/YYYY when unset. */
  dateFormat?: string
}

/** Where the copies of a mark go: centres in display space (y down), for a mark whose turned box is `bw` x `bh`. */
export function watermarkCentres(
  page: { w: number; h: number },
  box: { bw: number; bh: number },
  o: { align?: WatermarkAlign; margin?: number; offset?: { x: number; y: number }; tile?: { gapX: number; gapY: number } | null }
): { x: number; y: number }[] {
  const m = o.margin ?? 20
  const align = o.align ?? 'mc'
  const cx = (align[1] === 'l' ? m + box.bw / 2 : align[1] === 'r' ? page.w - m - box.bw / 2 : page.w / 2) + (o.offset?.x ?? 0)
  const cy = (align[0] === 't' ? m + box.bh / 2 : align[0] === 'b' ? page.h - m - box.bh / 2 : page.h / 2) + (o.offset?.y ?? 0)
  if (!o.tile) return [{ x: cx, y: cy }]
  const stepX = Math.max(4, box.bw + o.tile.gapX)
  const stepY = Math.max(4, box.bh + o.tile.gapY)
  const out: { x: number; y: number }[] = []
  const i0 = -Math.ceil(cx / stepX) - 1
  const i1 = Math.ceil((page.w - cx) / stepX) + 1
  const j0 = -Math.ceil(cy / stepY) - 1
  const j1 = Math.ceil((page.h - cy) / stepY) + 1
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) {
      const x = cx + i * stepX
      const y = cy + j * stepY
      // Only copies that touch the page.
      if (x + box.bw / 2 > 0 && x - box.bw / 2 < page.w && y + box.bh / 2 > 0 && y - box.bh / 2 < page.h) out.push({ x, y })
      if (out.length >= 600) return out
    }
  }
  return out
}

export async function addWatermark(bytes: Uint8Array, spec: WatermarkSpec, info: DocInfo = { fileName: '', labels: null }): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false })
  const total = doc.getPageCount()
  const font = spec.kind === 'text' ? await doc.embedFont(STANDARD[spec.font]) : null
  const img = spec.kind === 'image' && spec.image ? (spec.image[0] === 0x89 ? await doc.embedPng(spec.image) : await doc.embedJpg(spec.image)) : null
  const a = (spec.angle * Math.PI) / 180
  const date = formatDate(spec.dateFormat || 'DD/MM/YYYY', new Date())
  const pages = [...new Set(spec.pages)].filter((p) => p >= 0 && p < total).sort((x, y) => x - y)
  for (const pi of pages) {
    const page = doc.getPage(pi)
    const { f, w, h } = frameOf(page)
    // Transparency through an ExtGState in the page resources.
    const gs = page.node.newExtGState('OPGS', doc.context.obj({ Type: 'ExtGState', CA: spec.opacity, ca: spec.opacity }) as never).decodeText().replace(/^\//, '')
    // Rotate about the centre of the mark; display space has y down, so a positive (anticlockwise) angle turns by -a.
    const c = Math.cos(-a)
    const s = Math.sin(-a)
    const turn = `${n(c)} ${n(s)} ${n(-s)} ${n(c)} 0 0 cm`
    // The mark's own size, then how much of the page its turned box takes.
    let size = spec.fontSize
    let text = ''
    let tw = 0
    let iw = 0
    let ih = 0
    if (font && spec.text) {
      text = safeText(font, expandTokens(spec.text, { page: pi + 1, pages: total, label: info.labels?.[pi] || String(pi + 1), date, file: info.fileName, bates: '' }))
      tw = font.widthOfTextAtSize(text, size)
    } else if (img) {
      iw = w * spec.scale
      ih = (iw * img.height) / img.width
    }
    const m = spec.margin ?? 20
    const boxOf = (w0: number, h0: number) => ({ bw: Math.abs(w0 * c) + Math.abs(h0 * s), bh: Math.abs(w0 * s) + Math.abs(h0 * c) })
    let box = text ? boxOf(tw, size * 0.72) : boxOf(iw, ih)
    if (spec.shrink && box.bw > 0 && box.bh > 0) {
      const k = Math.min(1, Math.max(10, w - 2 * m) / box.bw, Math.max(10, h - 2 * m) / box.bh)
      if (k < 1) {
        if (text) {
          size *= k
          tw = font!.widthOfTextAtSize(text, size)
        } else {
          iw *= k
          ih *= k
        }
        box = text ? boxOf(tw, size * 0.72) : boxOf(iw, ih)
      }
    }
    let body = ''
    if (font && text) {
      const name = fontOn(page, font)
      body = `BT /${name} ${n(size)} Tf ${rgb(spec.color)} rg 1 0 0 -1 ${n(-tw / 2)} ${n(size * 0.35)} Tm ${font.encodeText(text).toString()} Tj ET`
    } else if (img) {
      const name = page.node.newXObject('OPImg', img.ref).decodeText().replace(/^\//, '')
      body = `${n(iw)} 0 0 ${n(-ih)} ${n(-iw / 2)} ${n(ih / 2)} cm /${name} Do`
    }
    if (!body) continue
    const copies = watermarkCentres({ w, h }, box, spec)
      .map((p) => `q 1 0 0 1 ${n(p.x)} ${n(p.y)} cm ${turn} ${body} Q`)
      .join(' ')
    addMarkStream(doc, page, spec.behind ? 'Background' : 'Watermark', `q ${cm(f)} /${gs} gs ${copies} Q`, spec.behind)
  }
  return doc.save()
}

export interface BackgroundSpec {
  color?: string
  image?: Uint8Array
  /** 0 to 1. */
  opacity: number
  pages: number[]
}

/** A colour (and/or picture stretched over the page) behind the page content. */
export async function addBackground(bytes: Uint8Array, spec: BackgroundSpec): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false })
  const total = doc.getPageCount()
  const img = spec.image ? (spec.image[0] === 0x89 ? await doc.embedPng(spec.image) : await doc.embedJpg(spec.image)) : null
  for (const pi of [...new Set(spec.pages)].filter((p) => p >= 0 && p < total)) {
    const page = doc.getPage(pi)
    const { f, w, h } = frameOf(page)
    const gs = page.node.newExtGState('OPGS', doc.context.obj({ Type: 'ExtGState', CA: spec.opacity, ca: spec.opacity }) as never).decodeText().replace(/^\//, '')
    let body = ''
    if (spec.color) body += `${rgb(spec.color)} rg 0 0 ${n(w)} ${n(h)} re f `
    if (img) body += `q ${n(w)} 0 0 ${n(-h)} 0 ${n(h)} cm /${page.node.newXObject('OPImg', img.ref).decodeText().replace(/^\//, '')} Do Q`
    if (body) addMarkStream(doc, page, 'Background', `q ${cm(f)} /${gs} gs ${body} Q`, true)
  }
  return doc.save()
}

/** Removes marks of the given kinds that OpenPDF added (and the q/Q guards once no overlay marks remain). */
export async function removeMarks(bytes: Uint8Array, kinds: MarkKind[]): Promise<{ bytes: Uint8Array; removed: number }> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false })
  let removed = 0
  for (const page of doc.getPages()) {
    const c = page.node.get(PDFName.of('Contents'))
    if (!(c instanceof PDFArray)) continue
    for (let i = c.size() - 1; i >= 0; i--) {
      const m = markOf(doc, c.get(i))
      if (m && (kinds as string[]).includes(m)) {
        c.remove(i)
        removed++
      }
    }
    const left = Array.from({ length: c.size() }, (_, i) => markOf(doc, c.get(i)))
    if (!left.some((m) => m === 'HeaderFooter' || m === 'Watermark' || m === 'Overlay')) {
      for (let i = c.size() - 1; i >= 0; i--) if (left[i] === 'GuardOpen' || left[i] === 'GuardClose') c.remove(i)
    }
  }
  return { bytes: await doc.save(), removed }
}

/** Which kinds of OpenPDF marks the document has. */
export async function marksPresent(bytes: Uint8Array): Promise<Set<MarkKind>> {
  const out = new Set<MarkKind>()
  try {
    const doc = await PDFDocument.load(bytes, { updateMetadata: false })
    for (const page of doc.getPages()) {
      const c = page.node.get(PDFName.of('Contents'))
      if (!(c instanceof PDFArray)) continue
      for (let i = 0; i < c.size(); i++) {
        const m = markOf(doc, c.get(i))
        if (m === 'HeaderFooter' || m === 'Watermark' || m === 'Background' || m === 'Overlay') out.add(m)
      }
    }
  } catch {
    // unreadable: report none
  }
  return out
}

export interface CropMargins {
  top: number
  right: number
  bottom: number
  left: number
}

export interface CropOptions {
  /**
   * Cut the cropped area off for good: the page itself shrinks to the crop box (so "Remove cropping" cannot bring the
   * edges back), the other page boxes and the thumbnail go, and comments lying wholly outside are deleted. Text and
   * pictures that were outside stay inside the file's content, unseen; for sensitive material use redaction.
   */
  removeContent?: boolean
}

function cropOne(doc: PDFDocument, pi: number, crop: CropMargins | { rect: { x: number; y: number; w: number; h: number } }, opts: CropOptions): void {
  const page = doc.getPage(pi)
  const { f, w, h } = frameOf(page)
  const r = 'rect' in crop ? crop.rect : { x: crop.left, y: crop.top, w: w - crop.left - crop.right, h: h - crop.top - crop.bottom }
  if (r.w < 10 || r.h < 10) throw new Error('That would leave less than 10 points of the page.')
  const [a, b, c, d, e, g] = f.m
  const pts = [
    [r.x, r.y],
    [r.x + r.w, r.y],
    [r.x, r.y + r.h],
    [r.x + r.w, r.y + r.h]
  ].map(([x, y]) => [a * x + c * y + e, b * x + d * y + g])
  const mb = page.getMediaBox()
  const x0 = Math.max(mb.x, Math.min(...pts.map((p) => p[0])))
  const y0 = Math.max(mb.y, Math.min(...pts.map((p) => p[1])))
  const x1 = Math.min(mb.x + mb.width, Math.max(...pts.map((p) => p[0])))
  const y1 = Math.min(mb.y + mb.height, Math.max(...pts.map((p) => p[1])))
  page.setCropBox(x0, y0, x1 - x0, y1 - y0)
  if (!opts.removeContent) return
  page.setMediaBox(x0, y0, x1 - x0, y1 - y0)
  for (const key of ['TrimBox', 'BleedBox', 'ArtBox', 'Thumb']) page.node.delete(PDFName.of(key))
  const annots = page.node.lookupMaybe(PDFName.of('Annots'), PDFArray)
  for (let i = (annots?.size() ?? 0) - 1; annots && i >= 0; i--) {
    const rect = annots.lookupMaybe(i, PDFDict)?.lookupMaybe(PDFName.of('Rect'), PDFArray)
    if (!rect || rect.size() < 4) continue
    const v = [0, 1, 2, 3].map((k) => (rect.lookup(k) as unknown as { asNumber(): number }).asNumber())
    const [ax0, ax1] = [Math.min(v[0], v[2]), Math.max(v[0], v[2])]
    const [ay0, ay1] = [Math.min(v[1], v[3]), Math.max(v[1], v[3])]
    if (ax1 < x0 || ax0 > x1 || ay1 < y0 || ay0 > y1) annots.remove(i)
  }
}

/**
 * Crops pages by margins measured on the page as displayed (points), or to `rect` (display space) when given.
 * The crop box never grows beyond the media box.
 */
export async function cropPages(
  bytes: Uint8Array,
  pages: number[],
  crop: CropMargins | { rect: { x: number; y: number; w: number; h: number } },
  opts: CropOptions = {}
): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false })
  for (const pi of [...new Set(pages)]) {
    if (pi < 0 || pi >= doc.getPageCount()) continue
    cropOne(doc, pi, crop, opts)
  }
  return doc.save()
}

/** Crops each page by its own margins (as displayed, points): for odd and even pages apart, or content trimmed page by page. */
export async function cropPagesEach(bytes: Uint8Array, items: { page: number; margins: CropMargins }[], opts: CropOptions = {}): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false })
  for (const it of items) {
    if (it.page < 0 || it.page >= doc.getPageCount()) continue
    cropOne(doc, it.page, it.margins, opts)
  }
  return doc.save()
}

/** Puts back the full page (crop box = media box). */
export async function uncropPages(bytes: Uint8Array, pages: number[]): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false })
  for (const pi of pages) {
    if (pi < 0 || pi >= doc.getPageCount()) continue
    const page = doc.getPage(pi)
    page.node.delete(PDFName.of('CropBox'))
  }
  return doc.save()
}

/**
 * Changes the paper size of pages (unrotated width and height, points). The content is scaled to fit and
 * centred when `fit`, or kept at its size and centred otherwise.
 */
export async function resizePages(bytes: Uint8Array, pages: number[], width: number, height: number, fit: boolean): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false })
  for (const pi of [...new Set(pages)]) {
    if (pi < 0 || pi >= doc.getPageCount()) continue
    const page = doc.getPage(pi)
    page.node.delete(PDFName.of('CropBox'))
    const mb = page.getMediaBox()
    // Match the page's orientation: a landscape page gets the landscape version of the size.
    const landscape = mb.width > mb.height
    const W = landscape ? Math.max(width, height) : Math.min(width, height)
    const H = landscape ? Math.min(width, height) : Math.max(width, height)
    const s = fit ? Math.min(W / mb.width, H / mb.height) : 1
    if (s !== 1) page.scale(s, s)
    const after = page.getMediaBox()
    page.setMediaBox(0, 0, W, H)
    const dx = (W - after.width) / 2 - after.x
    const dy = (H - after.height) / 2 - after.y
    page.translateContent(dx, dy)
    // Annotations move with the content.
    const annots = page.node.lookupMaybe(PDFName.of('Annots'), PDFArray)
    for (let i = 0; i < (annots?.size() ?? 0); i++) {
      const d = annots!.lookupMaybe(i, PDFDict)
      const rect = d?.lookupMaybe(PDFName.of('Rect'), PDFArray)
      if (!rect || rect.size() < 4) continue
      const v = [0, 1, 2, 3].map((k) => (rect.lookup(k) as unknown as { asNumber(): number }).asNumber())
      d!.set(PDFName.of('Rect'), doc.context.obj([v[0] + dx, v[1] + dy, v[2] + dx, v[3] + dy]))
    }
  }
  return doc.save()
}
