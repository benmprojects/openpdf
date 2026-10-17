/** Working out where barcodes go on the chosen pages, and what each one says. Pure, so it can be tested. */
import { barcodeShape, fillTemplate, type BarcodeKind, type QrEcc } from './barcode'
import type { BarcodePlacement } from './barcodeWrite'

export type BarcodeSpot = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'centre'

export const MM = 72 / 25.4

export interface BarcodePlanOptions {
  kind: BarcodeKind
  /** Text, or a template with {filename}, {page}, {pages} and {date}. */
  template: string
  ecc: QrEcc
  showText: boolean
  /** Size and margin in millimetres. A QR code uses the width for both. */
  widthMm: number
  heightMm: number
  marginMm: number
  spot: BarcodeSpot
  as: 'content' | 'annotation'
  /** Zero-based pages, and the size of every page as shown (points). */
  pages: number[]
  sizes: { width: number; height: number }[]
  fileName: string
  date: Date
}

/** The text for one page. */
export const textFor = (o: Pick<BarcodePlanOptions, 'template' | 'fileName' | 'date' | 'sizes'>, page: number): string =>
  fillTemplate(o.template, { filename: o.fileName, page: page + 1, pages: o.sizes.length, date: o.date })

/** One placement per page. Throws a readable error when the text does not suit the symbology or the box does not fit. */
export function planBarcodes(o: BarcodePlanOptions): BarcodePlacement[] {
  if (!o.pages.length) throw new Error('Choose at least one page.')
  const w = o.widthMm * MM
  const h = (o.kind === 'qr' ? o.widthMm : o.heightMm) * MM
  const m = Math.max(0, o.marginMm) * MM
  if (!(w >= 8) || !(h >= 8)) throw new Error('The barcode is too small to read. Make it at least 3 mm.')
  return o.pages.map((page) => {
    const size = o.sizes[page]
    if (!size) throw new Error(`Page ${page + 1} was not found.`)
    if (w + 2 * m > size.width || h + 2 * m > size.height) throw new Error(`The barcode does not fit on page ${page + 1}.`)
    const left = o.spot.endsWith('left') ? m : o.spot.endsWith('right') ? size.width - m - w : (size.width - w) / 2
    const top = o.spot.startsWith('top') ? m : o.spot.startsWith('bottom') ? size.height - m - h : (size.height - h) / 2
    const text = textFor(o, page)
    barcodeShape(o.kind, text, o.ecc)
    return { page, rect: { x: left, y: top, w, h }, style: { kind: o.kind, text, ecc: o.ecc, showText: o.showText }, as: o.as }
  })
}
