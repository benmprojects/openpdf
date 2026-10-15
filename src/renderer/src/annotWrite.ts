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
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFString,
  type PDFObject,
  StandardFonts,
  type PDFContext,
  type PDFFont,
  type PDFPage,
  type PDFRef
} from 'pdf-lib'
import {
  hexToRgb,
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

export async function writeAnnotations(bytes: Uint8Array, annots: Annot[]): Promise<Uint8Array> {
  const pdf = await PDFDocument.load(bytes)
  const ctx = pdf.context
  let font: PDFFont | null = null
  const getFont = async () => (font ??= await pdf.embedFont(StandardFonts.Helvetica))
  const now = PDFString.fromDate(new Date())

  for (const a of annots) {
    if (a.page < 0 || a.page >= pdf.getPageCount() || !a.rects.length) continue
    const page: PDFPage = pdf.getPage(a.page)
    const cb = page.getCropBox()
    const f = frameFor(cb.x, cb.y, cb.x + cb.width, cb.y + cb.height, page.getRotation().angle)
    const bounds = userBounds(f, a.rects)
    const base: Record<string, Lit> = {
      Type: 'Annot',
      Rect: bounds,
      C: hexToRgb(a.color),
      F: 4,
      M: now
    }
    let dict: Record<string, Lit>

    if (a.kind === 'highlight' || a.kind === 'underline' || a.kind === 'strikeout') {
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
      if (a.kind === 'highlight') {
        body = `/GS gs ${rgb(a.color)} rg ` + a.rects.map((r) => `${n(r.x)} ${n(r.y)} ${n(r.w)} ${n(r.h)} re f`).join(' ')
        resources = { ExtGState: { GS: { Type: 'ExtGState', BM: 'Multiply', CA: 1, ca: 1 } } }
      } else {
        const at = a.kind === 'underline' ? UNDERLINE_AT : STRIKEOUT_AT
        body =
          `${rgb(a.color)} RG ${LINE_WIDTH} w ` +
          a.rects.map((r) => `${n(r.x)} ${n(r.y + r.h * at)} m ${n(r.x + r.w)} ${n(r.y + r.h * at)} l S`).join(' ')
      }
      const ap = makeForm(ctx, bounds, `q ${cm(f)} ${body} Q`, resources)
      dict = {
        ...base,
        Subtype: a.kind === 'highlight' ? 'Highlight' : a.kind === 'underline' ? 'Underline' : 'StrikeOut',
        QuadPoints: quads,
        Contents: PDFHexString.fromText(a.text),
        AP: { N: ap }
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
    } else {
      const r = a.rects[0]
      const fnt = await getFont()
      const size = a.fontSize
      const lines = wrapText(fnt, a.text, size, r.w - 2 * TEXTBOX_PADDING)
      const lh = size * TEXTBOX_LINE_HEIGHT
      const text = lines
        .map((ln, i) => `1 0 0 -1 ${n(r.x + TEXTBOX_PADDING)} ${n(r.y + TEXTBOX_PADDING + size * 0.95 + i * lh)} Tm ${fnt.encodeText(ln).toString()} Tj`)
        .join(' ')
      const body = `${n(r.x)} ${n(r.y)} ${n(r.w)} ${n(r.h)} re W n BT /Helv ${n(size)} Tf ${rgb(a.color)} rg ${text} ET`
      const ap = makeForm(ctx, bounds, `q ${cm(f)} ${body} Q`, { Font: { Helv: fnt.ref } })
      delete base.C // /C on a FreeText is the background fill; ours is transparent
      dict = {
        ...base,
        Subtype: 'FreeText',
        Contents: PDFHexString.fromText(a.text),
        DA: PDFString.of(`/Helv ${n(size)} Tf ${rgb(a.color)} rg`),
        Q: 0,
        AP: { N: ap }
      }
    }

    const ref = ctx.register(ctx.obj(dict as never))
    let list = page.node.lookupMaybe(PDFName.of('Annots'), PDFArray)
    if (!list) {
      list = ctx.obj([]) as PDFArray
      page.node.set(PDFName.of('Annots'), list)
    }
    list.push(ref)
  }

  return pdf.save()
}
