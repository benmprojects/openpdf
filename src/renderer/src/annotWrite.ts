/**
 * Writes drawn annotations into a PDF as standard annotation dictionaries with appearance streams, so any
 * viewer (and PDFium, which renders our canvas) shows them. Runs on the main thread with pdf-lib.
 *
 * All appearance streams are authored in "display space": points from the top-left of the page as shown,
 * y pointing down. A single `cm` at the start of each stream maps display space onto the page's user space,
 * which takes care of CropBox offsets and /Rotate.
 */
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFString,
  type PDFObject,
  StandardFonts,
  type PDFContext,
  type PDFFont,
  PDFRef,
  type PDFPage
} from 'pdf-lib'
import {
  arrowHeadPoints,
  calloutAttach,
  parseWav,
  cloudCurves,
  dashArray,
  caretRectAfter,
  hexToRgb,
  squigglePoints,
  LINE_WIDTH,
  STRIKEOUT_AT,
  TEXTBOX_LINE_HEIGHT,
  TEXTBOX_PADDING,
  UNDERLINE_AT,
  type Annot
} from './annotations'
import type { Rect } from './textLogic'

/** What PDFContext.obj accepts: JS literals (strings become names) and pdf-lib objects. */
type Lit = string | number | boolean | null | PDFObject | Lit[] | { [key: string]: Lit }
type Matrix = [number, number, number, number, number, number]

export interface Frame {
  /** Maps display space (x right, y down, origin top-left) to user space. */
  m: Matrix
}

export function frameFor(x0: number, y0: number, x1: number, y1: number, rotation: number): Frame {
  switch (((rotation % 360) + 360) % 360) {
    case 90:
      return { m: [0, 1, 1, 0, x0, y0] }
    case 180:
      return { m: [-1, 0, 0, 1, x1, y0] }
    case 270:
      return { m: [0, -1, -1, 0, x1, y1] }
    default:
      return { m: [1, 0, 0, -1, x0, y1] }
  }
}

const toUser = (f: Frame, x: number, y: number): [number, number] => {
  const [a, b, c, d, e, g] = f.m
  return [a * x + c * y + e, b * x + d * y + g]
}

/** Bounding box in user space of display-space rectangles. */
function userBounds(f: Frame, rects: Rect[]): [number, number, number, number] {
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (const r of rects) {
    for (const [x, y] of [
      [r.x, r.y],
      [r.x + r.w, r.y],
      [r.x, r.y + r.h],
      [r.x + r.w, r.y + r.h]
    ]) {
      const [ux, uy] = toUser(f, x, y)
      x0 = Math.min(x0, ux)
      y0 = Math.min(y0, uy)
      x1 = Math.max(x1, ux)
      y1 = Math.max(y1, uy)
    }
  }
  return [x0, y0, x1, y1]
}

const n = (v: number) => (Math.round(v * 1000) / 1000).toString()
const rgb = (hex: string) => hexToRgb(hex).map(n).join(' ')
const cm = (f: Frame) => `${f.m.map(n).join(' ')} cm`
const stroke = (a: Annot) => {
  const d = dashArray(a.dash, a.lineWidth)
  return `${rgb(a.color)} RG ${n(a.lineWidth)} w 1 J 1 j${d ? ` [${d.map(n).join(' ')}] 0 d` : ''}`
}
/** Fill colour operator and the path-painting operator: fill and stroke, or stroke only. */
const paint = (a: Annot) => (a.fill ? { pre: `${rgb(a.fill)} rg `, op: 'B' } : { pre: '', op: 'S' })
/** /BS with the line style, and /IC for the fill, shared by the shape kinds. */
const border = (a: Annot): Record<string, Lit> => {
  const d = dashArray(a.dash, a.lineWidth)
  return {
    BS: d ? { W: a.lineWidth, S: 'D', D: d } : { W: a.lineWidth },
    Border: [0, 0, a.lineWidth],
    ...(a.fill ? { IC: hexToRgb(a.fill) } : {})
  }
}

/** Replace characters Helvetica (WinAnsi) cannot encode, so a note with e.g. emoji does not abort the save. */
function winAnsiSafe(font: PDFFont, s: string): string {
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

export function wrapText(font: PDFFont, text: string, size: number, maxWidth: number): string[] {
  const lines: string[] = []
  for (const para of winAnsiSafe(font, text).split(/\r\n|\r|\n/)) {
    let line = ''
    for (const word of para.split(' ')) {
      const next = line ? `${line} ${word}` : word
      if (!line || font.widthOfTextAtSize(next, size) <= maxWidth) line = next
      else {
        lines.push(line)
        line = word
      }
    }
    lines.push(line)
  }
  return lines
}

function makeForm(ctx: PDFContext, bbox: number[], content: string, resources: Lit = {}): PDFRef {
  const stream = ctx.stream(content, { Type: 'XObject', Subtype: 'Form', BBox: bbox, Resources: resources } as never)
  return ctx.register(stream)
}

type Origin = NonNullable<Annot['origin']>

/** Size of the result text written into a measurement's appearance, in points. */
export const MEASURE_LABEL_SIZE = 9

export interface DeletedAnnot {
  page: number
  origin: Origin
}

const SUBTYPE_NAMES: Record<number, string> = {
  1: 'Text',
  2: 'Link',
  16: 'Popup',
  17: 'FileAttachment',
  18: 'Sound',
  19: 'Movie',
  20: 'Widget',
  21: 'Screen',
  22: 'PrinterMark',
  23: 'TrapNet',
  24: 'Watermark',
  25: '3D',
  26: 'RichMedia',
  28: 'Redact',
  3: 'FreeText',
  4: 'Line',
  5: 'Square',
  6: 'Circle',
  9: 'Highlight',
  10: 'Underline',
  11: 'Squiggly',
  12: 'StrikeOut',
  7: 'Polygon',
  8: 'PolyLine',
  13: 'Stamp',
  14: 'Caret',
  15: 'Ink'
}

function rectOf(dict: PDFDict): number[] | null {
  const arr = dict.lookupMaybe(PDFName.of('Rect'), PDFArray)
  if (!arr || arr.size() < 4) return null
  const v = [0, 1, 2, 3].map((i) => arr.lookupMaybe(i, PDFNumber)?.asNumber() ?? NaN)
  return [Math.min(v[0], v[2]), Math.min(v[1], v[3]), Math.max(v[0], v[2]), Math.max(v[1], v[3])]
}

/** Finds an annotation that was already in the file: by its remembered index first, then by subtype and /Rect. */
function findExisting(page: PDFPage, origin: Origin): { index: number; dict: PDFDict } | null {
  const list = page.node.lookupMaybe(PDFName.of('Annots'), PDFArray)
  if (!list) return null
  const want = SUBTYPE_NAMES[origin.subtype]
  const matches = (i: number) => {
    const d = list.lookupMaybe(i, PDFDict)
    if (!d || d.lookupMaybe(PDFName.of('Subtype'), PDFName)?.decodeText() !== want) return false
    const r = rectOf(d)
    return !!r && r.every((x, k) => Math.abs(x - origin.rect[k]) < 1)
  }
  const order = [origin.index, ...Array.from({ length: list.size() }, (_, i) => i)]
  for (const i of order) {
    if (i >= 0 && i < list.size() && matches(i)) return { index: i, dict: list.lookup(i, PDFDict) }
  }
  return null
}

/**
 * Writes new annotations, updates edited ones that were already in the file (in place, keeping their other
 * properties) and removes deleted ones together with their popup. New replies in each annotation's thread are
 * added as Text annotations pointing at it (/IRT). When `rewrite` is given, only the annotations named in it
 * (and new ones) are rewritten; the rest are only there to receive new replies.
 */
export async function writeAnnotations(
  bytes: Uint8Array,
  annots: Annot[],
  deleted: DeletedAnnot[] = [],
  rewrite?: ReadonlySet<number>
): Promise<Uint8Array> {
  const pdf = await PDFDocument.load(bytes)
  const ctx = pdf.context
  let font: PDFFont | null = null
  const getFont = async () => (font ??= await pdf.embedFont(StandardFonts.Helvetica))
  // Text fonts by family, embedded on first use; `tag` is the resource name used in /DA and appearances.
  const textFonts = new Map<string, Promise<PDFFont>>()
  const FONT_FOR = { Helvetica: StandardFonts.Helvetica, Times: StandardFonts.TimesRoman, Courier: StandardFonts.Courier }
  const TAG_FOR = { Helvetica: 'Helv', Times: 'TiRo', Courier: 'Cour' }
  const textFont = async (a: Annot) => {
    const fam = a.fontFamily ?? 'Helvetica'
    let p = textFonts.get(fam)
    if (!p) {
      p = fam === 'Helvetica' ? getFont() : pdf.embedFont(FONT_FOR[fam])
      textFonts.set(fam, p)
    }
    return { fnt: await p, tag: TAG_FOR[fam] }
  }
  let boldFont: PDFFont | null = null
  const getBold = async () => (boldFont ??= await pdf.embedFont(StandardFonts.HelveticaBold))
  const now = PDFString.fromDate(new Date())
  // Image stamps: each picture is embedded once, however many times it is stamped.
  const images = new Map<string, Promise<{ ref: PDFRef }>>()
  const getImage = (dataUrl: string) => {
    let p = images.get(dataUrl)
    if (!p) {
      const bytes = Uint8Array.from(atob(dataUrl.slice(dataUrl.indexOf(',') + 1)), (c) => c.charCodeAt(0))
      p = (dataUrl.startsWith('data:image/png') ? pdf.embedPng(bytes) : pdf.embedJpg(bytes)) as Promise<{ ref: PDFRef }>
      images.set(dataUrl, p)
    }
    return p
  }

  // Resolve what to remove before anything is added, so remembered indices still point at the right entries.
  const removals = new Map<number, Set<number>>()
  for (const d of deleted) {
    if (d.page < 0 || d.page >= pdf.getPageCount()) continue
    const page = pdf.getPage(d.page)
    const found = findExisting(page, d.origin)
    if (!found) continue
    const set = removals.get(d.page) ?? new Set<number>()
    set.add(found.index)
    const list = page.node.lookupMaybe(PDFName.of('Annots'), PDFArray)
    const popup = found.dict.get(PDFName.of('Popup'))
    if (list && popup) {
      for (let i = 0; i < list.size(); i++) {
        const entry = list.get(i)
        if (entry && entry.toString() === popup.toString()) set.add(i)
      }
    }
    removals.set(d.page, set)
  }

  /** Adds the thread's new replies, as Text annotations in reply to `parent` (sharing its /Rect). */
  const writeReplies = (page: PDFPage, a: Annot, parent: PDFRef, rect: Lit) => {
    for (const r of a.replies ?? []) {
      if (r.origin) continue
      const when = PDFString.fromDate(new Date(r.date))
      const reply = ctx.register(
        ctx.obj({
          Type: 'Annot',
          Subtype: 'Text',
          Rect: rect,
          F: 32, // NoView: shown in comment lists, not drawn as a second icon
          Name: 'Comment',
          Open: false,
          Contents: PDFHexString.fromText(r.text),
          T: PDFHexString.fromText(r.author),
          M: when,
          CreationDate: when,
          IRT: parent,
          RT: 'R',
          ...(r.state ? { State: PDFHexString.fromText(r.state), StateModel: PDFHexString.fromText('Review') } : {})
        } as never)
      )
      let list = page.node.lookupMaybe(PDFName.of('Annots'), PDFArray)
      if (!list) {
        list = ctx.obj([]) as PDFArray
        page.node.set(PDFName.of('Annots'), list)
      }
      list.push(reply)
    }
  }

  for (const a of annots) {
    if (a.page < 0 || a.page >= pdf.getPageCount() || !a.rects.length) continue
    const page: PDFPage = pdf.getPage(a.page)
    // Unchanged annotations already in the file only receive their new replies.
    if (a.origin && rewrite && !rewrite.has(a.id)) {
      const existing = findExisting(page, a.origin)
      const list = page.node.lookupMaybe(PDFName.of('Annots'), PDFArray)
      const ref = existing && list ? list.get(existing.index) : null
      if (existing && ref instanceof PDFRef) writeReplies(page, a, ref, existing.dict.lookup(PDFName.of('Rect')) as never)
      continue
    }
    const cb = page.getCropBox()
    const f = frameFor(cb.x, cb.y, cb.x + cb.width, cb.y + cb.height, page.getRotation().angle)
    const bounds = userBounds(f, a.rects)
    const base: Record<string, Lit> = {
      Type: 'Annot',
      Rect: bounds,
      C: hexToRgb(a.color),
      F: 4,
      M: now,
      ...(a.author ? { T: PDFHexString.fromText(a.author) } : {}),
      ...(a.created && !a.origin ? { CreationDate: PDFString.fromDate(new Date(a.created)) } : {})
    }
    let dict: Record<string, Lit>

    /** A caret: a filled wedge pointing up, as Acrobat-style editors draw it. */
    const caretAp = (r: Rect, color: string) => {
      const body = `${rgb(color)} rg ${n(r.x)} ${n(r.y + r.h)} m ${n(r.x + r.w / 2)} ${n(r.y)} l ${n(r.x + r.w)} ${n(r.y + r.h)} l ${n(r.x + r.w / 2)} ${n(r.y + r.h * 0.7)} l h f`
      const bb = userBounds(f, [r])
      return { bb, ap: makeForm(ctx, bb, `q ${cm(f)} ${body} Q`) }
    }
    let groupWith: PDFRef | null = null

    if ((a.kind === 'fileattach' || a.kind === 'sound') && a.file) {
      const r = a.rects[0]
      // Icons: a paperclip, or a speaker, drawn in the annotation's colour.
      const icon =
        a.kind === 'fileattach'
          ? `${rgb(a.color)} RG 1.6 w 1 J 1 j ${n(r.x + r.w * 0.62)} ${n(r.y + r.h * 0.3)} m ${n(r.x + r.w * 0.62)} ${n(r.y + r.h * 0.78)} l ` +
            `${n(r.x + r.w * 0.62)} ${n(r.y + r.h * 0.95)} ${n(r.x + r.w * 0.3)} ${n(r.y + r.h * 0.95)} ${n(r.x + r.w * 0.3)} ${n(r.y + r.h * 0.78)} c ` +
            `${n(r.x + r.w * 0.3)} ${n(r.y + r.h * 0.18)} l ${n(r.x + r.w * 0.3)} ${n(r.y + r.h * 0.05)} ${n(r.x + r.w * 0.78)} ${n(r.y + r.h * 0.05)} ${n(r.x + r.w * 0.78)} ${n(r.y + r.h * 0.18)} c ` +
            `${n(r.x + r.w * 0.78)} ${n(r.y + r.h * 0.7)} l S`
          : `${rgb(a.color)} rg ${n(r.x + r.w * 0.12)} ${n(r.y + r.h * 0.36)} ${n(r.w * 0.22)} ${n(r.h * 0.28)} re f ` +
            `${n(r.x + r.w * 0.34)} ${n(r.y + r.h * 0.36)} m ${n(r.x + r.w * 0.62)} ${n(r.y + r.h * 0.12)} l ${n(r.x + r.w * 0.62)} ${n(r.y + r.h * 0.88)} l ${n(r.x + r.w * 0.34)} ${n(r.y + r.h * 0.64)} l h f ` +
            `${rgb(a.color)} RG 1.2 w ${n(r.x + r.w * 0.74)} ${n(r.y + r.h * 0.32)} m ${n(r.x + r.w * 0.86)} ${n(r.y + r.h * 0.5)} ${n(r.x + r.w * 0.74)} ${n(r.y + r.h * 0.68)} v S`
      const ap = makeForm(ctx, bounds, `q ${cm(f)} ${icon} Q`)
      if (a.kind === 'fileattach') {
        const ef = ctx.register(
          ctx.flateStream(a.file.data, { Type: 'EmbeddedFile', Params: { Size: a.file.data.length, ModDate: now } } as never)
        )
        dict = {
          ...base,
          Subtype: 'FileAttachment',
          Name: 'Paperclip',
          Contents: PDFHexString.fromText(a.text || a.file.name),
          FS: { Type: 'Filespec', F: PDFString.of(a.file.name.replace(/[^\x20-\x7e]/g, '_')), UF: PDFHexString.fromText(a.file.name), EF: { F: ef } },
          AP: { N: ap }
        }
      } else {
        const wav = parseWav(a.file.data)
        if (!wav) continue
        // PDF sound samples are big-endian; WAV's 16-bit samples are little-endian.
        const samples = new Uint8Array(wav.samples)
        if (wav.bits === 16) for (let k = 0; k + 1 < samples.length; k += 2) [samples[k], samples[k + 1]] = [samples[k + 1], samples[k]]
        const snd = ctx.register(
          ctx.flateStream(samples, { Type: 'Sound', R: wav.rate, C: wav.channels, B: wav.bits, E: wav.bits === 8 ? 'Raw' : 'Signed' } as never)
        )
        dict = { ...base, Subtype: 'Sound', Name: 'Speaker', Contents: PDFHexString.fromText(a.text || a.file.name), Sound: snd, AP: { N: ap } }
      }
    } else if (a.kind === 'link') {
      // No appearance: viewers show links as the page content under them.
      dict = { Type: 'Annot', Subtype: 'Link', Rect: bounds, Border: [0, 0, 0], F: 4, M: now }
      if (a.linkPage !== undefined && a.linkPage >= 0 && a.linkPage < pdf.getPageCount()) dict.Dest = [pdf.getPage(a.linkPage).ref, 'XYZ', null, null, null]
      else dict.A = { S: 'URI', URI: PDFString.of(a.linkUri ?? '') }
    } else if (a.kind === 'foreign') {
      if (!a.origin) continue
      dict = { Rect: bounds, M: now, Contents: PDFHexString.fromText(a.text), ...(a.author ? { T: PDFHexString.fromText(a.author) } : {}) }
    } else if (a.kind === 'caret') {
      const { bb, ap } = caretAp(a.rects[0], a.color)
      dict = {
        ...base,
        Rect: bb,
        Subtype: 'Caret',
        Contents: PDFHexString.fromText(a.text),
        Sy: 'None',
        RD: [0, 0, 0, 0],
        AP: { N: ap }
      }
    } else if (a.kind === 'highlight' || a.kind === 'underline' || a.kind === 'strikeout' || a.kind === 'squiggly') {
      const quads: number[] = []
      for (const r of a.rects) {
        // Top-left, top-right, bottom-left, bottom-right as the reader sees the page.
        for (const [x, y] of [
          [r.x, r.y],
          [r.x + r.w, r.y],
          [r.x, r.y + r.h],
          [r.x + r.w, r.y + r.h]
        ]) {
          quads.push(...toUser(f, x, y))
        }
      }
      let body: string
      let resources: Lit = {}
      if (a.kind === 'squiggly') {
        body =
          `${rgb(a.color)} RG ${LINE_WIDTH} w 1 j ` +
          a.rects.map((r) => squigglePoints(r).map((p, i) => `${n(p.x)} ${n(p.y)} ${i ? 'l' : 'm'}`).join(' ') + ' S').join(' ')
      } else if (a.kind === 'highlight') {
        body = `/GS gs ${rgb(a.color)} rg ` + a.rects.map((r) => `${n(r.x)} ${n(r.y)} ${n(r.w)} ${n(r.h)} re f`).join(' ')
        resources = { ExtGState: { GS: { Type: 'ExtGState', BM: 'Multiply', CA: a.opacity ?? 1, ca: a.opacity ?? 1 } } }
      } else {
        const at = a.kind === 'underline' ? UNDERLINE_AT : STRIKEOUT_AT
        body =
          `${rgb(a.color)} RG ${LINE_WIDTH} w ` +
          a.rects.map((r) => `${n(r.x)} ${n(r.y + r.h * at)} m ${n(r.x + r.w)} ${n(r.y + r.h * at)} l S`).join(' ')
      }
      const ap = makeForm(ctx, bounds, `q ${cm(f)} ${body} Q`, resources)
      dict = {
        ...base,
        Subtype: a.kind === 'highlight' ? 'Highlight' : a.kind === 'underline' ? 'Underline' : a.kind === 'squiggly' ? 'Squiggly' : 'StrikeOut',
        QuadPoints: quads,
        Contents: PDFHexString.fromText(a.text),
        AP: { N: ap }
      }
      // Replace text: a caret holding the new text, and the strikeout grouped with it (ISO 32000 12.5.6.10).
      if (a.kind === 'strikeout' && a.replace && !a.origin) {
        const last = a.rects[a.rects.length - 1]
        const { bb, ap: cap } = caretAp(caretRectAfter(last), a.color)
        const caret = ctx.register(
          ctx.obj({ ...base, Rect: bb, Subtype: 'Caret', Contents: PDFHexString.fromText(a.text), Sy: 'P', RD: [0, 0, 0, 0], AP: { N: cap } } as never)
        )
        let list = page.node.lookupMaybe(PDFName.of('Annots'), PDFArray)
        if (!list) {
          list = ctx.obj([]) as PDFArray
          page.node.set(PDFName.of('Annots'), list)
        }
        list.push(caret)
        groupWith = caret
        dict.IT = 'StrikeOutTextEdit'
      }
    } else if (a.kind === 'note') {
      const r = a.rects[0]
      const lines = [0.3, 0.5, 0.7]
        .map((t) => `${n(r.x + r.w * 0.2)} ${n(r.y + r.h * t)} m ${n(r.x + r.w * 0.8)} ${n(r.y + r.h * t)} l S`)
        .join(' ')
      const body = `${rgb(a.color)} rg 0.35 0.28 0 RG 0.8 w ${n(r.x)} ${n(r.y)} ${n(r.w)} ${n(r.h)} re B 0.35 0.28 0 RG 0.7 w ${lines}`
      const ap = makeForm(ctx, bounds, `q ${cm(f)} ${body} Q`)
      dict = {
        ...base,
        Subtype: 'Text',
        Name: 'Comment',
        Open: false,
        F: 4, // Print. NoZoom/NoRotate would make viewers re-anchor the icon on rotated pages
        Contents: PDFHexString.fromText(a.text),
        AP: { N: ap }
      }
    } else if (a.kind === 'line' || a.kind === 'arrow') {
      const [p0, p1] = a.points![0]
      let body = `${stroke(a)} ${n(p0.x)} ${n(p0.y)} m ${n(p1.x)} ${n(p1.y)} l S`
      if (a.kind === 'arrow') {
        const [l, tip, r] = arrowHeadPoints(p0, p1, a.lineWidth)
        body += ` ${n(l.x)} ${n(l.y)} m ${n(tip.x)} ${n(tip.y)} l ${n(r.x)} ${n(r.y)} l S`
      }
      const ap = makeForm(ctx, bounds, `q ${cm(f)} ${body} Q`)
      dict = {
        ...base,
        Subtype: 'Line',
        L: [...toUser(f, p0.x, p0.y), ...toUser(f, p1.x, p1.y)],
        LE: ['None', a.kind === 'arrow' ? 'OpenArrow' : 'None'],
        ...border(a),
        Subj: PDFHexString.fromText(a.kind === 'arrow' ? 'Arrow' : 'Line'),
        AP: { N: ap }
      }
    } else if (a.kind === 'rectangle') {
      const r = a.rects[0]
      const i = a.lineWidth / 2
      const pt = paint(a)
      const body = `${stroke(a)} ${pt.pre}${n(r.x + i)} ${n(r.y + i)} ${n(r.w - a.lineWidth)} ${n(r.h - a.lineWidth)} re ${pt.op}`
      const ap = makeForm(ctx, bounds, `q ${cm(f)} ${body} Q`)
      dict = {
        ...base,
        Subtype: 'Square',
        ...border(a),
        Subj: PDFHexString.fromText('Rectangle'),
        AP: { N: ap }
      }
    } else if (a.kind === 'ellipse') {
      const r = a.rects[0]
      const rx = (r.w - a.lineWidth) / 2
      const ry = (r.h - a.lineWidth) / 2
      const cx = r.x + r.w / 2
      const cy = r.y + r.h / 2
      const k = 0.5522847498
      const pt = paint(a)
      const body =
        `${stroke(a)} ${pt.pre}${n(cx + rx)} ${n(cy)} m ` +
        `${n(cx + rx)} ${n(cy + k * ry)} ${n(cx + k * rx)} ${n(cy + ry)} ${n(cx)} ${n(cy + ry)} c ` +
        `${n(cx - k * rx)} ${n(cy + ry)} ${n(cx - rx)} ${n(cy + k * ry)} ${n(cx - rx)} ${n(cy)} c ` +
        `${n(cx - rx)} ${n(cy - k * ry)} ${n(cx - k * rx)} ${n(cy - ry)} ${n(cx)} ${n(cy - ry)} c ` +
        `${n(cx + k * rx)} ${n(cy - ry)} ${n(cx + rx)} ${n(cy - k * ry)} ${n(cx + rx)} ${n(cy)} c ${pt.op}`
      const ap = makeForm(ctx, bounds, `q ${cm(f)} ${body} Q`)
      dict = {
        ...base,
        Subtype: 'Circle',
        ...border(a),
        Subj: PDFHexString.fromText('Ellipse'),
        AP: { N: ap }
      }
    } else if (a.kind === 'polygon' || a.kind === 'polyline' || a.kind === 'cloud') {
      const pts = a.points![0]
      const closed = a.kind !== 'polyline'
      const pt = closed ? paint(a) : { pre: '', op: 'S' }
      let path: string
      if (a.kind === 'cloud') {
        const { start, curves } = cloudCurves(pts, a.lineWidth)
        path = `${n(start.x)} ${n(start.y)} m ` + curves.map(([c1, c2, p]) => `${n(c1.x)} ${n(c1.y)} ${n(c2.x)} ${n(c2.y)} ${n(p.x)} ${n(p.y)} c`).join(' ') + ' h'
      } else {
        path = pts.map((p, i) => `${n(p.x)} ${n(p.y)} ${i ? 'l' : 'm'}`).join(' ') + (closed ? ' h' : '')
      }
      const ap = makeForm(ctx, bounds, `q ${cm(f)} ${stroke(a)} ${pt.pre}${path} ${pt.op} Q`)
      dict = {
        ...base,
        Subtype: a.kind === 'polyline' ? 'PolyLine' : 'Polygon',
        Vertices: pts.flatMap((p) => toUser(f, p.x, p.y)),
        ...border(a),
        ...(a.kind === 'cloud' ? { BE: { S: 'C', I: 1 } } : {}),
        Subj: PDFHexString.fromText(a.kind === 'cloud' ? 'Cloud' : a.kind === 'polyline' ? 'Polyline' : 'Polygon'),
        AP: { N: ap }
      }
    } else if (a.kind === 'ink') {
      const paths = a.points!.filter((p) => p.length >= 2)
      const body =
        `${stroke(a)} ` +
        paths.map((path) => path.map((p, i) => `${n(p.x)} ${n(p.y)} ${i ? 'l' : 'm'}`).join(' ') + ' S').join(' ')
      const ap = makeForm(ctx, bounds, `q ${cm(f)} ${body} Q`)
      dict = {
        ...base,
        Subtype: 'Ink',
        InkList: paths.map((path) => path.flatMap((p) => toUser(f, p.x, p.y))),
        BS: { W: a.lineWidth },
        Border: [0, 0, a.lineWidth],
        Subj: PDFHexString.fromText('Pencil'),
        AP: { N: ap }
      }
    } else if (a.kind === 'stamp' && a.image) {
      const r = a.rects[0]
      const img = await getImage(a.image)
      // Display space has y down, so the unit square is flipped to draw the picture upright.
      const body = `${n(r.w)} 0 0 ${n(-r.h)} ${n(r.x)} ${n(r.y + r.h)} cm /Im Do`
      const ap = makeForm(ctx, bounds, `q ${cm(f)} ${body} Q`, { XObject: { Im: img.ref } })
      dict = {
        ...base,
        Subtype: 'Stamp',
        Name: 'OpenPDFImageStamp',
        Subj: PDFHexString.fromText('Image stamp'),
        Contents: PDFHexString.fromText(a.text),
        AP: { N: ap }
      }
    } else if (a.kind === 'stamp') {
      const r = a.rects[0]
      const fnt = await getBold()
      const label = winAnsiSafe(fnt, a.text.toUpperCase())
      const unit = fnt.widthOfTextAtSize(label, 1) || 1
      const info = a.stampInfo ? winAnsiSafe(fnt, a.stampInfo) : ''
      // With an info line the label takes the top part of the box and the info line sits under it.
      const labelH = info ? r.h * 0.62 : r.h
      const size = Math.max(4, Math.min(labelH * (info ? 0.6 : 0.52), (r.w - 14) / unit))
      const tx = r.x + (r.w - unit * size) / 2
      const ty = r.y + labelH / 2 + size * 0.35 + (info ? r.h * 0.04 : 0)
      const i = a.lineWidth / 2
      let infoOps = ''
      let resources: Lit = { Font: { HelvB: fnt.ref } }
      if (info) {
        const reg = await getFont()
        const iu = reg.widthOfTextAtSize(info, 1) || 1
        const isz = Math.max(3, Math.min(r.h * 0.2, (r.w - 10) / iu))
        infoOps = ` BT /Helv ${n(isz)} Tf ${rgb(a.color)} rg 1 0 0 -1 ${n(r.x + (r.w - iu * isz) / 2)} ${n(r.y + r.h * 0.86)} Tm ${reg.encodeText(info).toString()} Tj ET`
        resources = { Font: { HelvB: fnt.ref, Helv: reg.ref } }
      }
      const body =
        `${stroke(a)} ${n(r.x + i)} ${n(r.y + i)} ${n(r.w - a.lineWidth)} ${n(r.h - a.lineWidth)} re S ` +
        `BT /HelvB ${n(size)} Tf ${rgb(a.color)} rg 1 0 0 -1 ${n(tx)} ${n(ty)} Tm ${fnt.encodeText(label).toString()} Tj ET` +
        infoOps
      const ap = makeForm(ctx, bounds, `q ${cm(f)} ${body} Q`, resources)
      dict = {
        ...base,
        Subtype: 'Stamp',
        Name: 'OpenPDFStamp',
        Contents: PDFHexString.fromText(info ? `${label}\n${info}` : label),
        OPLabel: PDFHexString.fromText(label),
        ...(info ? { OPInfo: PDFHexString.fromText(info) } : {}),
        AP: { N: ap }
      }
    } else if (a.kind === 'callout') {
      const box = a.rects[0]
      const { fnt, tag } = await textFont(a)
      const size = a.fontSize
      const tip = a.points?.[0]?.[0] ?? { x: box.x - 40, y: box.y + box.h / 2 }
      const knee = calloutAttach(box, tip)
      const lines = wrapText(fnt, a.text, size, box.w - 2 * TEXTBOX_PADDING - 2)
      const lh = size * TEXTBOX_LINE_HEIGHT
      const text = lines
        .map((ln, i) => `1 0 0 -1 ${n(box.x + TEXTBOX_PADDING + 1)} ${n(box.y + TEXTBOX_PADDING + 1 + size * 0.95 + i * lh)} Tm ${fnt.encodeText(ln).toString()} Tj`)
        .join(' ')
      const [l, at, rr] = arrowHeadPoints(knee, tip, 1)
      const body =
        `1 g ${rgb(a.color)} RG 1 w ${n(box.x + 0.5)} ${n(box.y + 0.5)} ${n(box.w - 1)} ${n(box.h - 1)} re B ` +
        `${n(knee.x)} ${n(knee.y)} m ${n(tip.x)} ${n(tip.y)} l S ${n(l.x)} ${n(l.y)} m ${n(at.x)} ${n(at.y)} l ${n(rr.x)} ${n(rr.y)} l S ` +
        `q ${n(box.x)} ${n(box.y)} ${n(box.w)} ${n(box.h)} re W n BT /${tag} ${n(size)} Tf ${rgb(a.color)} rg ${text} ET Q`
      const pad = 6
      const all = userBounds(f, [box, { x: tip.x - pad, y: tip.y - pad, w: 2 * pad, h: 2 * pad }])
      const inner = userBounds(f, [box])
      const ap = makeForm(ctx, all, `q ${cm(f)} ${body} Q`, { Font: { [tag]: fnt.ref } })
      dict = {
        ...base,
        Rect: all,
        Subtype: 'FreeText',
        IT: 'FreeTextCallout',
        Contents: PDFHexString.fromText(a.text),
        DA: PDFString.of(`/${tag} ${n(size)} Tf ${rgb(a.color)} rg ${rgb(a.color)} RG`),
        DR: { Font: { [tag]: fnt.ref } },
        CL: [...toUser(f, tip.x, tip.y), ...toUser(f, knee.x, knee.y)],
        LE: 'OpenArrow',
        RD: [inner[0] - all[0], inner[1] - all[1], all[2] - inner[2], all[3] - inner[3]],
        BS: { W: 1 },
        Q: 0,
        AP: { N: ap }
      }
      delete dict.C
    } else {
      const typewriter = a.kind === 'typewriter'
      const { fnt, tag } = await textFont(a)
      const size = a.fontSize
      // A typewriter box is as wide as its longest line (measured with the PDF font, so nothing is clipped).
      const lines = typewriter ? winAnsiSafe(fnt, a.text).split(/\r\n|\r|\n/) : wrapText(fnt, a.text, size, a.rects[0].w - 2 * TEXTBOX_PADDING)
      const r = typewriter
        ? { ...a.rects[0], w: Math.max(a.rects[0].w, Math.max(...lines.map((ln) => fnt.widthOfTextAtSize(ln, size))) + 2 * TEXTBOX_PADDING + 1) }
        : a.rects[0]
      const lh = size * TEXTBOX_LINE_HEIGHT
      const text = lines
        .map((ln, i) => `1 0 0 -1 ${n(r.x + TEXTBOX_PADDING)} ${n(r.y + TEXTBOX_PADDING + size * 0.95 + i * lh)} Tm ${fnt.encodeText(ln).toString()} Tj`)
        .join(' ')
      const body = `${n(r.x)} ${n(r.y)} ${n(r.w)} ${n(r.h)} re W n BT /${tag} ${n(size)} Tf ${rgb(a.color)} rg ${text} ET`
      const box = typewriter ? userBounds(f, [r]) : bounds
      const ap = makeForm(ctx, box, `q ${cm(f)} ${body} Q`, { Font: { [tag]: fnt.ref } })
      delete base.C // /C on a FreeText is the background fill; ours is transparent
      dict = {
        ...base,
        Rect: box,
        ...(typewriter ? { IT: 'FreeTextTypeWriter' } : {}),
        Subtype: 'FreeText',
        Contents: PDFHexString.fromText(a.text),
        DA: PDFString.of(`/${tag} ${n(size)} Tf ${rgb(a.color)} rg`),
        DR: { Font: { [tag]: fnt.ref } },
        Q: 0,
        AP: { N: ap }
      }
    }

    if (a.opacity !== undefined && a.opacity < 1 && a.kind !== 'foreign' && a.kind !== 'link') {
      dict.CA = a.opacity
      const apRef = (dict.AP as { N?: PDFRef } | undefined)?.N
      if (apRef && a.kind !== 'highlight') {
        const old = ctx.lookup(apRef) as unknown as { dict: PDFDict; getContents(): Uint8Array }
        const res = (old.dict.lookupMaybe(PDFName.of('Resources'), PDFDict) ?? (ctx.obj({}) as PDFDict)).clone(ctx)
        const ext = res.lookupMaybe(PDFName.of('ExtGState'), PDFDict) ?? (ctx.obj({}) as PDFDict)
        ext.set(PDFName.of('GSop'), ctx.obj({ Type: 'ExtGState', CA: a.opacity, ca: a.opacity }))
        res.set(PDFName.of('ExtGState'), ext)
        const bbox = old.dict.lookup(PDFName.of('BBox'))
        const prev = new TextDecoder('latin1').decode(old.getContents())
        ctx.delete(apRef)
        const stream = ctx.stream(`/GSop gs ${prev}`, { Type: 'XObject', Subtype: 'Form', BBox: bbox, Resources: res } as never)
        dict.AP = { N: ctx.register(stream) }
      }
    }

    if (a.origin) {
      const existing = findExisting(page, a.origin)
      if (existing) {
        const fresh = ctx.obj(dict as never) as unknown as PDFDict
        for (const [key, value] of fresh.entries()) existing.dict.set(key, value)
        const list = page.node.lookupMaybe(PDFName.of('Annots'), PDFArray)
        const ref = list?.get(existing.index)
        if (ref instanceof PDFRef) writeReplies(page, a, ref, dict.Rect)
        continue
      }
    }

    if (groupWith) {
      dict.IRT = groupWith
      dict.RT = 'Group'
    }
    // Measurements (ISO 32000 12.9): the intent, a rectilinear /Measure dictionary, and the result drawn in.
    if (a.measure && (a.kind === 'line' || a.kind === 'polyline' || a.kind === 'polygon')) {
      const m = a.measure
      const fmt = (u: string, c: number) => ({ Type: 'NumberFormat', U: PDFHexString.fromText(u), C: c, D: 100, RT: PDFString.of(''), SS: PDFString.of('') })
      dict.IT = m.kind === 'distance' ? 'LineDimension' : m.kind === 'perimeter' ? 'PolyLineDimension' : 'PolygonDimension'
      dict.Measure = {
        Type: 'Measure',
        Subtype: 'RL',
        R: PDFHexString.fromText(m.ratio ?? `1 pt = ${m.factor} ${m.unit}`),
        X: [fmt(m.unit, m.factor)],
        D: [fmt(m.unit, 1)],
        A: [fmt(`${m.unit}²`, 1)]
      }
      dict.Contents = PDFHexString.fromText(m.label)
      if (a.kind === 'line') {
        dict.Cap = true
        dict.CP = 'Top'
      }
      // Redraw the appearance with the label added.
      const fnt = await getFont()
      const pts = a.points![0]
      const at =
        m.kind === 'area'
          ? { x: pts.reduce((s, p) => s + p.x, 0) / pts.length, y: pts.reduce((s, p) => s + p.y, 0) / pts.length }
          : { x: (pts[Math.floor((pts.length - 1) / 2)].x + pts[Math.ceil((pts.length - 1) / 2) || 1]?.x) / 2, y: (pts[Math.floor((pts.length - 1) / 2)].y + pts[Math.ceil((pts.length - 1) / 2) || 1]?.y) / 2 }
      const label = winAnsiSafe(fnt, m.label.replace('²', '2'))
      const size = MEASURE_LABEL_SIZE
      const w = fnt.widthOfTextAtSize(label, size)
      const box = { x: at.x - w / 2 - 2, y: at.y - size - 4, w: w + 4, h: size + 3 }
      const old = (dict.AP as { N: PDFRef }).N
      const oldStream = ctx.lookup(old) as unknown as { getContents(): Uint8Array }
      const prev = new TextDecoder('latin1').decode(oldStream.getContents())
      const text = `q ${cm(f)} 1 g ${n(box.x)} ${n(box.y)} ${n(box.w)} ${n(box.h)} re f BT /Helv ${n(size)} Tf ${rgb(a.color)} rg 1 0 0 -1 ${n(box.x + 2)} ${n(box.y + size)} Tm ${fnt.encodeText(label).toString()} Tj ET Q`
      const all = userBounds(f, [...a.rects, box])
      dict.Rect = all
      ctx.delete(old)
      dict.AP = { N: makeForm(ctx, all, `${prev} ${text}`, { Font: { Helv: fnt.ref } }) }
    }
    const ref = ctx.register(ctx.obj(dict as never))
    let list = page.node.lookupMaybe(PDFName.of('Annots'), PDFArray)
    if (!list) {
      list = ctx.obj([]) as PDFArray
      page.node.set(PDFName.of('Annots'), list)
    }
    list.push(ref)
    writeReplies(page, a, ref, dict.Rect)
  }

  for (const [pageIdx, indices] of removals) {
    const list = pdf.getPage(pageIdx).node.lookupMaybe(PDFName.of('Annots'), PDFArray)
    if (!list) continue
    for (const i of [...indices].sort((x, y) => y - x)) {
      const entry = list.get(i)
      list.remove(i)
      if (entry instanceof PDFRef) ctx.delete(entry)
    }
  }

  return pdf.save()
}
