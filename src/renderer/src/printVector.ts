/**
 * Text-preserving "Print to PDF": the chosen pages are written with pdf-lib as vector content (each page becomes a
 * form XObject placed on a sheet), so text stays text and can be searched and copied, instead of being rasterised.
 * Page handling follows the Print dialog: pages per sheet, booklet, scaling, auto-rotate, centring and borders.
 * Annotations (comments, form fields) are drawn from their appearance streams, as flattening does.
 *
 * It works inside the document it is given, so layers (optional content) keep their state; the original pages are
 * removed at the end, together with what only makes sense for them (bookmarks, form, named destinations).
 */
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFRef,
  PDFStream,
  type PDFOperator,
  clip,
  concatTransformationMatrix,
  drawObject,
  endPath,
  popGraphicsState,
  pushGraphicsState,
  rectangle,
  setLineWidth,
  setStrokingRgbColor,
  stroke,
  type PDFPage
} from 'pdf-lib'
import { sheetGrid, sheetSlots, type PrintLayout } from '../../shared/printLayout'
import { effectiveScaling, paperPoints, placePage, type PaperId, type Scaling } from '../../shared/printPlan'
import { appearanceMatrix } from './flatten'

export interface VectorPrintOptions {
  /** 0-based pages, in print order. */
  pages: number[]
  layout: PrintLayout
  scaling: Scaling
  centre: boolean
  /** Whether the sheets are landscape (already resolved by the dialog). */
  landscape: boolean
  paper: PaperId
  /** Turn landscape pages a quarter turn so they fill portrait paper (one page per sheet only). */
  autoRotate: boolean
}

/** What a vector printout cannot do: tiled printing of large pages stays on the raster path. */
export const vectorUnsupported = (o: { tile?: unknown }): string | null => (o.tile ? 'Tiled printing is drawn as pictures.' : null)

export type M = [number, number, number, number, number, number]

/** a then b (apply `a` to a point first). */
export const mul = (a: M, b: M): M => [
  a[0] * b[0] + a[1] * b[2],
  a[0] * b[1] + a[1] * b[3],
  a[2] * b[0] + a[3] * b[2],
  a[2] * b[1] + a[3] * b[3],
  a[4] * b[0] + a[5] * b[2] + b[4],
  a[4] * b[1] + a[5] * b[3] + b[5]
]

/**
 * Turns a box of `w` x `h` clockwise by `turn` degrees (0, 90, 180 or 270), so that the turned box sits on the origin:
 * the result occupies 0..W and 0..H, where W and H swap for quarter turns.
 */
export function turnMatrix(w: number, h: number, turn: number): M {
  switch (((turn % 360) + 360) % 360) {
    case 90:
      return [0, -1, 1, 0, 0, w]
    case 180:
      return [-1, 0, 0, -1, w, h]
    case 270:
      return [0, 1, -1, 0, h, 0]
    default:
      return [1, 0, 0, 1, 0, 0]
  }
}

const nums = (a: PDFArray | undefined, n: number): number[] | null => {
  if (!a || a.size() < n) return null
  const out: number[] = []
  for (let i = 0; i < n; i++) {
    const v = a.lookupMaybe(i, PDFNumber)
    if (!v) return null
    out.push(v.asNumber())
  }
  return out
}

/** Draws every annotation that has an appearance (not links or pop-ups, nor hidden ones) into the page content. */
export function drawAnnotations(doc: PDFDocument, page: PDFPage): void {
  const annots = page.node.lookupMaybe(PDFName.of('Annots'), PDFArray)
  if (!annots) return
  for (let i = 0; i < annots.size(); i++) {
    const dict = annots.lookupMaybe(i, PDFDict)
    if (!dict) continue
    const subtype = dict.lookupMaybe(PDFName.of('Subtype'), PDFName)?.decodeText()
    if (subtype === 'Link' || subtype === 'Popup') continue
    const flags = dict.lookupMaybe(PDFName.of('F'), PDFNumber)?.asNumber() ?? 0
    if (flags & (2 | 32)) continue // Hidden or NoView
    const ap = dict.lookupMaybe(PDFName.of('AP'), PDFDict)
    let n = ap?.get(PDFName.of('N'))
    const states = n instanceof PDFRef ? doc.context.lookup(n) : n
    if (states && !(states instanceof PDFStream) && states instanceof PDFDict) {
      const as = dict.lookupMaybe(PDFName.of('AS'), PDFName)
      n = as ? states.get(as) : undefined
    }
    const stream = n instanceof PDFRef ? doc.context.lookup(n) : undefined
    const rect = nums(dict.lookupMaybe(PDFName.of('Rect'), PDFArray), 4)
    if (!(n instanceof PDFRef) || !(stream instanceof PDFStream) || !rect) continue
    const bbox = nums(stream.dict.lookupMaybe(PDFName.of('BBox'), PDFArray), 4) ?? [0, 0, 1, 1]
    const matrix = nums(stream.dict.lookupMaybe(PDFName.of('Matrix'), PDFArray), 6) ?? [1, 0, 0, 1, 0, 0]
    const m = appearanceMatrix(bbox, matrix, rect)
    const key = page.node.newXObject('PrintAnnot', n)
    page.pushOperators(pushGraphicsState(), concatTransformationMatrix(m[0], m[1], m[2], m[3], m[4], m[5]), drawObject(key), popGraphicsState())
  }
}

/** Parts of the catalogue that belong to the original pages and mean nothing for the printout. */
const PAGE_BOUND = ['Outlines', 'Names', 'Dests', 'AcroForm', 'OpenAction', 'AA', 'StructTreeRoot', 'PageLabels', 'Threads', 'MarkInfo', 'ViewerPreferences', 'PageMode']

export interface PageGeometry {
  /** Visible (crop) box size in the page's own space, before /Rotate. */
  w: number
  h: number
  /** /Rotate, a multiple of 90. */
  rot: number
  box: { left: number; bottom: number; right: number; top: number }
}

/** The visible box of a page (crop box inside the media box) and its rotation. */
export function pageGeometry(page: PDFPage): PageGeometry {
  const mb = page.getMediaBox()
  const cb = page.getCropBox()
  const left = Math.max(mb.x, cb.x)
  const bottom = Math.max(mb.y, cb.y)
  const right = Math.min(mb.x + mb.width, cb.x + cb.width)
  const top = Math.min(mb.y + mb.height, cb.y + cb.height)
  const box = right > left && top > bottom ? { left, bottom, right, top } : { left: mb.x, bottom: mb.y, right: mb.x + mb.width, top: mb.y + mb.height }
  return { w: box.right - box.left, h: box.top - box.bottom, rot: ((page.getRotation().angle % 360) + 360) % 360, box }
}

/** A new PDF holding `opts.pages` laid out on sheets. Throws when there is nothing to print. */
export async function buildVectorPrint(bytes: Uint8Array, opts: VectorPrintOptions, onProgress?: (done: number, total: number) => void): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false })
  const originals = doc.getPages()
  const list = opts.pages.filter((p) => p >= 0 && p < originals.length)
  if (!list.length) throw new Error('There are no pages to print.')

  // Appearances first (they go into the page content), then each page becomes a form XObject.
  const geometry = new Map<number, PageGeometry>()
  for (const p of new Set(list)) {
    const page = originals[p]
    if (!page.node.has(PDFName.of('Contents'))) page.node.set(PDFName.of('Contents'), doc.context.register(doc.context.stream('')))
    drawAnnotations(doc, page)
    geometry.set(p, pageGeometry(page))
  }
  const unique = [...geometry.keys()]
  const embedded = await doc.embedPages(
    unique.map((p) => originals[p]),
    unique.map((p) => geometry.get(p)!.box)
  )
  const embeddedOf = new Map(unique.map((p, i) => [p, embedded[i]]))

  const sheetPt = paperPoints(opts.paper, opts.landscape)
  const sc = effectiveScaling(opts.layout, opts.scaling)
  const inset = sc.kind === 'fit' ? 18 : 0 // a printer's unprintable edge, as in the print job and its preview
  const { cols, rows } = sheetGrid(opts.layout)
  const areaW = sheetPt.w - 2 * inset
  const areaH = sheetPt.h - 2 * inset
  const gap = cols > 1 ? 0.02 * areaW : 0
  const cw = (areaW - gap * (cols - 1)) / cols
  const ch = (areaH - gap * (rows - 1)) / rows
  const border = opts.layout.kind === 'nup' && opts.layout.border === true
  const turnExtra = opts.autoRotate && opts.layout.kind === 'single' && !opts.landscape

  const sheets = sheetSlots(list.length, opts.layout)
  for (const [si, slots] of sheets.entries()) {
    const sheet = doc.addPage([sheetPt.w, sheetPt.h])
    const ops: PDFOperator[] = []
    slots.forEach((slot, i) => {
      if (slot === null) return
      const pageIndex = list[slot]
      const g = geometry.get(pageIndex)!
      const quarter = g.rot === 90 || g.rot === 270
      const shownW = quarter ? g.h : g.w
      const shownH = quarter ? g.w : g.h
      const extra = turnExtra && shownW > shownH ? 90 : 0
      const total = (g.rot + extra) % 360
      const wholeTurn = total === 90 || total === 270
      const rotW = wholeTurn ? g.h : g.w
      const rotH = wholeTurn ? g.w : g.h
      const p = placePage({ w: cw, h: ch }, { w: rotW, h: rotH }, sc, opts.centre)
      const cellLeft = inset + (i % cols) * (cw + gap)
      const cellTop = inset + Math.floor(i / cols) * (ch + gap)
      const s = p.w / rotW
      const turned = turnMatrix(g.w, g.h, total)
      // y runs up on the sheet, down in the cell: the page's bottom edge sits `cellTop + p.y + p.h` from the top.
      const place: M = [s, 0, 0, s, cellLeft + p.x, sheetPt.h - (cellTop + p.y + p.h)]
      const m = mul(turned, place)
      const key = sheet.node.newXObject('PrintPage', embeddedOf.get(pageIndex)!.ref)
      // Clip to the cell: a page at actual size or enlarged may be bigger than the room it has.
      ops.push(
        pushGraphicsState(),
        ...clipRect(cellLeft, sheetPt.h - cellTop - ch, cw, ch),
        concatTransformationMatrix(m[0], m[1], m[2], m[3], m[4], m[5]),
        drawObject(key),
        popGraphicsState()
      )
      if (border) {
        const x = cellLeft + p.x
        const y = sheetPt.h - (cellTop + p.y + p.h)
        ops.push(...strokeRect(x, y, p.w, p.h))
      }
    })
    sheet.pushOperators(...ops)
    onProgress?.(si + 1, sheets.length)
  }

  // The original pages go; the form XObjects made from them stay.
  for (let i = originals.length - 1; i >= 0; i--) doc.removePage(i)
  for (const key of PAGE_BOUND) doc.catalog.delete(PDFName.of(key))
  return doc.save()
}

function clipRect(x: number, y: number, w: number, h: number): PDFOperator[] {
  return [rectangle(x, y, w, h), clip(), endPath()]
}

function strokeRect(x: number, y: number, w: number, h: number): PDFOperator[] {
  return [pushGraphicsState(), setLineWidth(0.5), setStrokingRgbColor(0.47, 0.47, 0.47), rectangle(x, y, w, h), stroke(), popGraphicsState()]
}
