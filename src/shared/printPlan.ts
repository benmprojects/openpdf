import { sheetGrid, sheetSlots, type PrintLayout } from './printLayout'

/** Pure print planning shared by the Print dialog (renderer) and the print job (main): no DOM, no Electron. */

export type PageRangeKind = 'all' | 'current' | 'view' | 'selected' | 'custom'
export type Subset = 'all' | 'odd' | 'even'

export interface PageSelection {
  /** Pages in the document. */
  count: number
  range: PageRangeKind
  /** 0-based current page. */
  current: number
  /** First and last (0-based) pages showing in the view, or null when unknown. */
  view: [number, number] | null
  /** 0-based thumbnail selection. */
  selected: number[]
  /** 0-based pages from the custom text, already parsed. */
  custom: number[]
  subset: Subset
  reverse: boolean
}

/**
 * The pages to print as 0-based indices in print order. Odd and even refer to page numbers (1, 3, 5 are odd),
 * whatever the range. Reversing happens last.
 */
export function selectPages(s: PageSelection): number[] {
  const clean = (list: number[]) => [...new Set(list.filter((n) => Number.isInteger(n) && n >= 0 && n < s.count))].sort((a, b) => a - b)
  let list: number[]
  switch (s.range) {
    case 'all':
      list = Array.from({ length: s.count }, (_, i) => i)
      break
    case 'current':
      list = [s.current]
      break
    case 'view':
      list = s.view ? Array.from({ length: Math.max(0, s.view[1] - s.view[0] + 1) }, (_, i) => s.view![0] + i) : [s.current]
      break
    case 'selected':
      list = s.selected
      break
    default:
      list = s.custom
  }
  list = clean(list)
  if (s.subset === 'odd') list = list.filter((i) => i % 2 === 0)
  else if (s.subset === 'even') list = list.filter((i) => i % 2 === 1)
  return s.reverse ? list.reverse() : list
}

// ---- Paper ------------------------------------------------------------------------------------------

export const PAPER_SIZES = {
  A3: { label: 'A3', w: 841.89, h: 1190.55 },
  A4: { label: 'A4', w: 595.28, h: 841.89 },
  A5: { label: 'A5', w: 419.53, h: 595.28 },
  Letter: { label: 'Letter', w: 612, h: 792 },
  Legal: { label: 'Legal', w: 612, h: 1008 },
  Tabloid: { label: 'Tabloid', w: 792, h: 1224 }
} as const
export type PaperId = keyof typeof PAPER_SIZES
export const isPaperId = (v: unknown): v is PaperId => typeof v === 'string' && Object.prototype.hasOwnProperty.call(PAPER_SIZES, v)

const MM_PER_PT = 25.4 / 72

/** Paper size in points as it lies on the printer (landscape swaps width and height). */
export function paperPoints(paper: PaperId, landscape: boolean): { w: number; h: number } {
  const p = PAPER_SIZES[paper]
  return landscape ? { w: p.h, h: p.w } : { w: p.w, h: p.h }
}

/** "A4 · 210 x 297 mm" style text for a sheet (millimetres, rounded). */
export function paperLabel(paper: PaperId, landscape: boolean): string {
  const { w, h } = paperPoints(paper, landscape)
  return `${PAPER_SIZES[paper].label} · ${Math.round(w * MM_PER_PT)} x ${Math.round(h * MM_PER_PT)} mm`
}

export type Orientation = 'auto' | 'portrait' | 'landscape'

/**
 * Whether the sheets are landscape. Booklets are always landscape (two pages side by side). Otherwise an explicit
 * choice wins; Auto follows the layout (two-up is landscape), and for one page per sheet follows the first page
 * unless pages are being auto-rotated to fill portrait paper.
 */
export function resolveLandscape(orientation: Orientation, layout: PrintLayout, firstPageLandscape: boolean, autoRotate: boolean): boolean {
  if (layout.kind === 'booklet') return true
  if (orientation === 'portrait') return false
  if (orientation === 'landscape') return true
  if (layout.kind === 'nup') return sheetGrid(layout).landscape
  return autoRotate ? false : firstPageLandscape
}

/** Whether landscape pages are turned a quarter turn to fill portrait paper (one page per sheet only). */
export function shouldRotate(autoRotate: boolean, layout: PrintLayout, landscapeSheet: boolean): boolean {
  return autoRotate && layout.kind === 'single' && !landscapeSheet
}

// ---- Scaling and placement ---------------------------------------------------------------------------

export type Scaling = { kind: 'fit' } | { kind: 'actual' } | { kind: 'shrink' } | { kind: 'custom'; percent: number }

/** Several pages on a sheet are always fitted to their cells; the scaling choice applies to one page per sheet. */
export function effectiveScaling(layout: PrintLayout, scaling: Scaling): Scaling {
  return layout.kind === 'single' ? scaling : { kind: 'fit' }
}

export const clampPercent = (n: number): number => (Number.isFinite(n) ? Math.min(400, Math.max(10, Math.round(n))) : 100)

/** Where a page (points) lands inside a cell (points) for a scaling choice; centred unless `centre` is false. */
export function placePage(
  cell: { w: number; h: number },
  page: { w: number; h: number },
  scaling: Scaling,
  centre: boolean
): { x: number; y: number; w: number; h: number } {
  const fit = Math.min(cell.w / page.w, cell.h / page.h)
  const s = scaling.kind === 'fit' ? fit : scaling.kind === 'shrink' ? Math.min(1, fit) : scaling.kind === 'actual' ? 1 : clampPercent(scaling.percent) / 100
  const w = page.w * s
  const h = page.h * s
  // Fitting always fills the cell on one axis, so only the other axis is centred; same rule as the printed layout.
  const centred = centre || scaling.kind === 'fit'
  return { x: centred ? (cell.w - w) / 2 : 0, y: centred ? (cell.h - h) / 2 : 0, w, h }
}

// ---- Sheets -------------------------------------------------------------------------------------------

export type Duplex = 'off' | 'long' | 'short'

/** The two-sided setting actually used: booklets printed on both sides of the paper flip on the short edge. */
export function effectiveDuplex(duplex: Duplex, layout: PrintLayout): Duplex {
  if (layout.kind === 'booklet') return (layout.sides ?? 'both') === 'both' ? 'short' : 'off'
  return duplex
}

/** Number of printed faces ("sheets" in the preview) for `pageCount` pages. */
export function faceCount(pageCount: number, layout: PrintLayout): number {
  return pageCount === 0 ? 0 : sheetSlots(pageCount, layout).length
}

/** Pieces of paper used by that many faces. */
export function paperCount(faces: number, duplex: Duplex): number {
  return duplex === 'off' ? faces : Math.ceil(faces / 2)
}

/** What the main process needs to lay out and print a job, besides the page images. */
export interface PrintRunOptions {
  copies: number
  /** Number of page images sent. */
  count: number
  layout: PrintLayout
  scaling: Scaling
  centre: boolean
  /** Resolved by the renderer with resolveLandscape. */
  landscape: boolean
  paper: PaperId
  colour: boolean
  duplex: Duplex
  collate: boolean
  /** Printer to print to without the system dialog; empty to show the system dialog. */
  deviceName?: string
  /** Write a PDF (asking where) instead of printing. */
  toFile?: boolean
}
