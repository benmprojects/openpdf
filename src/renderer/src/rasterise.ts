/**
 * Rasterise pages: each chosen page is drawn by PDFium at a resolution and put back as one picture, so text, vector
 * drawing, form fields and comments become part of the picture. The page itself stays (same object, so bookmarks and
 * links to it keep working); its content, annotations and resources are replaced, and the page is shown upright at
 * its displayed size. Text can no longer be searched or copied until the pages are recognised (OCR). Also used to
 * clean up pages that are already scans (straighten, remove specks, crop) before the picture is written back.
 */
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFRef } from 'pdf-lib'
import { encodeG4 } from './bilevel'
import { pruneUnreachable } from './redact'
import { setPageContent } from './pageContent'

export interface RasteriseOptions {
  /** Pixels per inch, 36 to 600. */
  dpi: number
  /** Zero-based pages to replace. */
  pages: number[]
  /** JPEG (smaller, lossy), Flate (lossless colour) or CCITT G4 (black and white, for text scans: all grey and colour is lost). */
  format: 'jpeg' | 'flate' | 'g4'
  /** JPEG quality, 0 to 1. */
  quality: number
}

export interface RasteriseDeps {
  /** Renders a page of the document as it is (annotations and form fields drawn) at a scale of pixels per point. */
  render(page: number, scale: number): Promise<{ width: number; height: number; data: Uint8Array }>
  /** Displayed page sizes in points. */
  pages: { width: number; height: number }[]
  /** JPEG file for RGBA pixels (needed for the JPEG format). */
  encodeJpeg?(rgba: Uint8Array, w: number, h: number, quality: number): Promise<Uint8Array>
  /** An optional step on each page picture (clean-up): returns new RGBA pixels, possibly of another size. */
  enhance?(rgba: Uint8Array, w: number, h: number, dpi: number): Promise<{ data: Uint8Array; width: number; height: number }>
  progress?(done: number, total: number): void
}

export interface RasteriseResult {
  bytes: Uint8Array
  pages: number
  /** Annotations that were drawn into the pictures and no longer exist as objects (links, comments, form fields). */
  annotationsFlattened: number
}

/** The render scale for a dpi, kept under about 60 million pixels a page. */
export function rasteriseScale(dpi: number, widthPt: number, heightPt: number): number {
  const d = Math.min(600, Math.max(36, dpi))
  return Math.min(d / 72, Math.sqrt(60_000_000 / Math.max(1, widthPt * heightPt)))
}

const BOXES = ['CropBox', 'TrimBox', 'BleedBox', 'ArtBox', 'Rotate', 'Annots', 'Thumb', 'B', 'AA', 'PieceInfo', 'StructParents', 'Group', 'Metadata']

export async function rasterisePages(bytes: Uint8Array, o: RasteriseOptions, d: RasteriseDeps): Promise<RasteriseResult> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false })
  const targets = [...new Set(o.pages)].filter((p) => p >= 0 && p < doc.getPageCount()).sort((a, b) => a - b)
  let flattened = 0
  const widgets = new Set<PDFRef>()
  const N = PDFName.of
  for (const [i, p] of targets.entries()) {
    d.progress?.(i, targets.length)
    const size = d.pages[p]
    const scale = rasteriseScale(o.dpi, size.width, size.height)
    const rendered = await d.render(p, scale)
    let { width: w, height: h, data } = rendered
    const realScale = w / size.width
    if (d.enhance) {
      const e = await d.enhance(data, w, h, Math.round(realScale * 72))
      data = e.data
      w = e.width
      h = e.height
    }
    const imageRef = await embedPicture(doc, data, w, h, o, d)
    const page = doc.getPage(p)
    const pw = w / realScale
    const ph = h / realScale
    const annots = page.node.lookupMaybe(N('Annots'), PDFArray)
    for (let k = 0; k < (annots?.size() ?? 0); k++) {
      flattened++
      const ref = annots!.get(k)
      if (ref instanceof PDFRef) widgets.add(ref)
    }
    for (const k of BOXES) page.node.delete(N(k))
    page.node.delete(N('Resources'))
    page.node.set(N('MediaBox'), doc.context.obj([0, 0, pw, ph]))
    const key = page.node.newXObject('RasterPage', imageRef)
    setPageContent(doc, page, `q ${pw.toFixed(3)} 0 0 ${ph.toFixed(3)} 0 0 cm /${key.decodeText()} Do Q`)
  }
  d.progress?.(targets.length, targets.length)
  dropFields(doc, widgets)
  pruneUnreachable(doc)
  return { bytes: await doc.save(), pages: targets.length, annotationsFlattened: flattened }
}

/** Takes the form fields whose widgets were on rasterised pages out of the form, so no field is left pointing at nothing. */
export function dropFields(doc: PDFDocument, gone: Set<PDFRef>): void {
  const form = doc.catalog.lookupMaybe(PDFName.of('AcroForm'), PDFDict)
  const fields = form?.lookupMaybe(PDFName.of('Fields'), PDFArray)
  if (!form || !fields) return
  const prune = (arr: PDFArray): void => {
    for (let i = arr.size() - 1; i >= 0; i--) {
      const ref = arr.get(i)
      const dict = arr.lookupMaybe(i, PDFDict)
      if (!dict) continue
      const kids = dict.lookupMaybe(PDFName.of('Kids'), PDFArray)
      if (kids) {
        prune(kids)
        if (kids.size() === 0) arr.remove(i)
      } else if (ref instanceof PDFRef && gone.has(ref)) arr.remove(i)
    }
  }
  prune(fields)
  if (fields.size() === 0) doc.catalog.delete(PDFName.of('AcroForm'))
}

/** Puts the page picture in the file in the chosen format and returns its reference. */
async function embedPicture(doc: PDFDocument, rgba: Uint8Array, w: number, h: number, o: RasteriseOptions, d: RasteriseDeps): Promise<PDFRef> {
  const ctx = doc.context
  const dict = { Type: 'XObject', Subtype: 'Image', Width: w, Height: h }
  if (o.format === 'jpeg') {
    if (!d.encodeJpeg) throw new Error('No JPEG encoder was given.')
    return (await doc.embedJpg(await d.encodeJpeg(rgba, w, h, o.quality))).ref
  }
  if (o.format === 'g4') {
    const grey = new Uint8Array(w * h)
    for (let i = 0, p = 0; i < grey.length; i++, p += 4) grey[i] = (77 * rgba[p] + 151 * rgba[p + 1] + 28 * rgba[p + 2]) >> 8
    const { data } = encodeG4(grey, w, h)
    return ctx.register(ctx.stream(data, { ...dict, ColorSpace: 'DeviceGray', BitsPerComponent: 1, Filter: 'CCITTFaxDecode', DecodeParms: { K: -1, Columns: w, Rows: h } }))
  }
  const rgb = new Uint8Array(w * h * 3)
  for (let i = 0, p = 0, q = 0; i < w * h; i++, p += 4, q += 3) {
    rgb[q] = rgba[p]
    rgb[q + 1] = rgba[p + 1]
    rgb[q + 2] = rgba[p + 2]
  }
  return ctx.register(ctx.flateStream(rgb, { ...dict, ColorSpace: 'DeviceRGB', BitsPerComponent: 8 }))
}
