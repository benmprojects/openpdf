/**
 * Writing barcodes into a PDF as vector drawings: as page content, as a stamp-like annotation, or as the appearance of a
 * text field (a barcode field). The drawing is a form XObject authored in display space (points from the top-left of
 * the page as shown) and placed with one matrix, so it stays upright on rotated pages.
 */
import { PDFBool, PDFDict, PDFDocument, PDFFont, PDFHexString, PDFName, PDFRef, StandardFonts, concatTransformationMatrix, drawObject, popGraphicsState, pushGraphicsState, type PDFField, type PDFPage } from 'pdf-lib'
import { barcodeShape, quietZone, type BarcodeKind, type BarcodeShape, type QrEcc } from './barcode'
import { frameFor } from './annotWrite'
import { matMul, type Matrix6 } from './content'
import type { Rect } from './textLogic'

export interface BarcodeStyle {
  kind: BarcodeKind
  text: string
  ecc?: QrEcc
  /** Print the text under a bar code. */
  showText?: boolean
  /** #rrggbb; black when unset. */
  colour?: string
  /** A white background (and quiet zone) behind the symbol; on unless false. */
  background?: boolean
}

export interface BarcodePlacement {
  page: number
  /** Display-space box. A QR code is drawn square, centred in it. */
  rect: Rect
  style: BarcodeStyle
  as: 'content' | 'annotation'
}

const n = (v: number) => (Math.round(v * 1000) / 1000).toString()

function colourOp(hex: string | undefined): string {
  const v = /^#[0-9a-f]{6}$/i.test(hex ?? '') ? parseInt(hex!.slice(1), 16) : 0
  return `${n(((v >> 16) & 255) / 255)} ${n(((v >> 8) & 255) / 255)} ${n((v & 255) / 255)} rg`
}

const pdfText = (s: string) => `(${s.replace(/[^\x20-\x7e]/g, '?').replace(/[\\()]/g, '\\$&')})`

/** Drawing operators for a symbol in a `w` by `h` box (y down), and whether they use the label font. */
export function drawingOps(shape: BarcodeShape, kind: BarcodeKind, w: number, h: number, style: BarcodeStyle, font?: PDFFont): { ops: string; usesFont: boolean } {
  const q = quietZone(kind)
  const out: string[] = []
  if (style.background !== false) out.push(`1 1 1 rg 0 0 ${n(w)} ${n(h)} re f`)
  out.push(colourOp(style.colour))
  const label = style.showText && !shape.is2d && shape.label && font ? shape.label : ''
  const modules = shape.width + 2 * q
  if (shape.is2d) {
    const side = Math.min(w, h)
    const s = side / modules
    const ox = (w - side) / 2 + q * s
    const oy = (h - side) / 2 + q * s
    for (const r of shape.rects) out.push(`${n(ox + r.x * s)} ${n(oy + r.y * s)} ${n(r.w * s)} ${n(r.h * s)} re`)
  } else {
    const sx = w / modules
    const barH = label ? h * 0.78 : h
    for (const r of shape.rects) out.push(`${n((q + r.x) * sx)} 0 ${n(r.w * sx)} ${n(barH)} re`)
  }
  out.push('f')
  let usesFont = false
  if (label && font) {
    const room = h - h * 0.78
    let size = Math.max(4, room * 0.85)
    const width = font.widthOfTextAtSize(label, size)
    if (width > w * 0.95) size = (size * w * 0.95) / width
    const tw = font.widthOfTextAtSize(label, size)
    // The form is drawn y down, so the text matrix flips it back upright.
    out.push(`BT /Lbl ${n(size)} Tf 1 0 0 -1 ${n((w - tw) / 2)} ${n(h - room * 0.2)} Tm ${pdfText(label)} Tj ET`)
    usesFont = true
  }
  return { ops: out.join('\n'), usesFont }
}

/** A form XObject holding the symbol, `w` by `h` points in display space. */
export function barcodeForm(doc: PDFDocument, style: BarcodeStyle, w: number, h: number, font: PDFFont, linear?: Matrix6): PDFRef {
  const shape = barcodeShape(style.kind, style.text, style.ecc ?? 'M')
  const { ops, usesFont } = drawingOps(shape, style.kind, w, h, style, font)
  const dict: Record<string, unknown> = { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, w, h] }
  if (usesFont) dict.Resources = { Font: { Lbl: font.ref } }
  if (linear) dict.Matrix = [linear[0], linear[1], linear[2], linear[3], 0, 0]
  return doc.context.register(doc.context.stream(ops, dict as never))
}

function frameOf(page: PDFPage): Matrix6 {
  const cb = page.getCropBox()
  return frameFor(cb.x, cb.y, cb.x + cb.width, cb.y + cb.height, page.getRotation().angle).m as Matrix6
}

/** Draws or annotates every placement. Returns the new file. */
export async function placeBarcodes(bytes: Uint8Array, items: BarcodePlacement[]): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false })
  const font = await doc.embedFont(StandardFonts.Helvetica)
  for (const it of items) {
    const page = doc.getPage(it.page)
    const f = frameOf(page)
    const { x, y, w, h } = { x: it.rect.x, y: it.rect.y, w: it.rect.w, h: it.rect.h }
    if (w < 4 || h < 4) throw new Error('The barcode box is too small.')
    if (it.as === 'content') {
      const form = barcodeForm(doc, it.style, w, h, font)
      const key = `OPBar${Math.random().toString(36).slice(2, 10)}`
      page.node.setXObject(PDFName.of(key), form)
      const m = matMul([1, 0, 0, 1, x, y], f)
      page.pushOperators(pushGraphicsState(), concatTransformationMatrix(m[0], m[1], m[2], m[3], m[4], m[5]), drawObject(key), popGraphicsState())
    } else {
      const form = barcodeForm(doc, it.style, w, h, font, f)
      const at = (px: number, py: number): [number, number] => [f[0] * px + f[2] * py + f[4], f[1] * px + f[3] * py + f[5]]
      const corners = [at(x, y), at(x + w, y), at(x, y + h), at(x + w, y + h)]
      const xs = corners.map((c) => c[0])
      const ys = corners.map((c) => c[1])
      const ctx = doc.context
      const annot = ctx.obj({
        Type: 'Annot',
        Subtype: 'Stamp',
        Rect: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)],
        F: 4,
        Name: 'Barcode',
        Subj: PDFHexString.fromText('Barcode'),
        Contents: PDFHexString.fromText(it.style.text),
        NM: PDFHexString.fromText(`openpdf-barcode-${Math.random().toString(36).slice(2, 12)}`),
        P: page.ref,
        AP: { N: form }
      } as never)
      page.node.addAnnot(ctx.register(annot))
    }
  }
  return doc.save({ updateFieldAppearances: false })
}

// ---- Barcode fields ------------------------------------------------------------------------------------------

export interface BarcodeFieldMeta {
  kind: BarcodeKind
  ecc: QrEcc
  showText: boolean
}

const META_KEY = PDFName.of('OpenPDFBarcode')

/** The barcode settings of a text field written by OpenPDF, or undefined for an ordinary field. */
export function readBarcodeMeta(dict: PDFDict): BarcodeFieldMeta | undefined {
  const m = dict.lookupMaybe(META_KEY, PDFDict)
  if (!m) return undefined
  const kind = m.lookupMaybe(PDFName.of('K'), PDFName)?.decodeText()
  if (kind !== 'qr' && kind !== 'code128' && kind !== 'code39' && kind !== 'ean13') return undefined
  const ecc = m.lookupMaybe(PDFName.of('E'), PDFName)?.decodeText()
  const t = m.lookup(PDFName.of('T'))
  return { kind, ecc: ecc === 'L' || ecc === 'Q' || ecc === 'H' ? ecc : 'M', showText: t instanceof PDFBool ? t.asBoolean() : true }
}

export function writeBarcodeMeta(doc: PDFDocument, field: PDFField, meta: BarcodeFieldMeta): void {
  field.acroField.dict.set(META_KEY, doc.context.obj({ K: meta.kind, E: meta.ecc, T: meta.showText }))
}

/**
 * Draws the field's value as a barcode in every widget (its appearance); the value itself stays plain text, so a viewer
 * that regenerates field appearances shows the text instead. A value the symbology cannot hold leaves the widget empty.
 */
export async function setBarcodeAppearance(doc: PDFDocument, field: PDFField, meta: BarcodeFieldMeta, text: string): Promise<void> {
  const font = await doc.embedFont(StandardFonts.Helvetica)
  for (const w of field.acroField.getWidgets()) {
    const r = w.getRectangle()
    const page = doc.getPages().find((p) => p.ref === w.P()) ?? doc.getPages().find((p) => p.node.Annots()?.asArray().some((a) => doc.context.lookup(a) === w.dict))
    const angle = page ? page.getRotation().angle : 0
    const sideways = angle % 180 !== 0
    const dw = sideways ? r.height : r.width
    const dh = sideways ? r.width : r.height
    const f = page ? frameOf(page) : ([1, 0, 0, -1, 0, 0] as Matrix6)
    let form: PDFRef
    try {
      form = barcodeForm(doc, { kind: meta.kind, text, ecc: meta.ecc, showText: meta.showText }, dw, dh, font, f)
    } catch {
      form = doc.context.register(doc.context.stream('', { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, dw, dh], Matrix: [f[0], f[1], f[2], f[3], 0, 0] } as never))
    }
    w.dict.set(PDFName.of('AP'), doc.context.obj({ N: form }))
  }
}
