/**
 * Measurement: distances, perimeters and areas on a page, in real-world units.
 *
 * A scale converts page points to real units. It comes from, in order: a scale the user calibrated for the
 * document, a viewport measure dictionary in the page (/VP with /Measure, ISO 32000-2 12.9, as written by CAD
 * exports), or plain paper size in millimetres.
 */
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, PDFString, PDFHexString } from 'pdf-lib'
import type { Pt } from './annotations'
import { formatAreaQuantity, formatQuantity, type Precision } from './measureScale'

export interface Scale {
  /** Real units per page point. */
  factor: number
  unit: string
  /** Where the scale came from, for display. */
  source: 'paper' | 'document' | 'calibrated' | 'set'
  /** The document's own ratio text, for example "1:100", when it has one. */
  label?: string
  /** Decimal places or fractions for results; sensible automatic precision when unset. */
  precision?: Precision
}

export const PAPER_MM: Scale = { factor: 25.4 / 72, unit: 'mm', source: 'paper' }

export function distance(a: Pt, b: Pt): number {
  return Math.hypot(b.x - a.x, b.y - a.y)
}

export function pathLength(points: Pt[], closed = false): number {
  let n = 0
  for (let i = 1; i < points.length; i++) n += distance(points[i - 1], points[i])
  if (closed && points.length > 2) n += distance(points[points.length - 1], points[0])
  return n
}

/** Area of a simple polygon (shoelace formula), always positive. */
export function polygonArea(points: Pt[]): number {
  let s = 0
  for (let i = 0; i < points.length; i++) {
    const a = points[i]
    const b = points[(i + 1) % points.length]
    s += a.x * b.y - b.x * a.y
  }
  return Math.abs(s) / 2
}

/** A number with sensible precision for its size: 1234 → "1,234", 12.345 → "12.35", 0.01234 → "0.0123". */
export function formatNumber(n: number): string {
  const abs = Math.abs(n)
  const digits = abs >= 1000 ? 0 : abs >= 100 ? 1 : abs >= 1 ? 2 : 3
  return n.toLocaleString('en-AU', { maximumFractionDigits: digits, minimumFractionDigits: 0 })
}

export function formatLength(pt: number, s: Scale): string {
  return formatQuantity(pt * s.factor, s.unit, s.precision)
}

export function formatArea(pt2: number, s: Scale): string {
  return formatAreaQuantity(pt2 * s.factor * s.factor, s.unit, s.precision)
}

/** The result of a measurement as text, for example "12.5 m" or "34 m²". */
export function resultLabel(kind: 'distance' | 'perimeter' | 'area', points: Pt[], s: Scale): string {
  return kind === 'area' ? formatArea(polygonArea(points), s) : formatLength(pathLength(points), s)
}

/** Real units per point that make a measured length (in points) equal `real` units. */
export function calibrate(measuredPt: number, real: number, unit: string): Scale {
  if (!(measuredPt > 0) || !(real > 0)) throw new Error('Measure a line and enter its real length, both above zero.')
  return { factor: real / measuredPt, unit, source: 'calibrated', label: `${formatNumber(real)} ${unit} over ${formatNumber(measuredPt * (25.4 / 72))} mm` }
}

export interface Viewport {
  /** In page points, top-left origin like the rest of the app: x0, y0 (top), x1, y1 (bottom). */
  bbox: [number, number, number, number]
  scale: Scale
}

const text = (o: unknown) => (o instanceof PDFString || o instanceof PDFHexString ? o.decodeText() : undefined)

/**
 * Viewport scales per page, from /VP arrays with rectilinear (/RL) /Measure dictionaries. The first /X number
 * format's /C converts points to its unit /U. Pages without any give an empty list.
 */
export async function readViewports(bytes: Uint8Array): Promise<Viewport[][]> {
  let doc: PDFDocument
  try {
    doc = await PDFDocument.load(bytes, { updateMetadata: false })
  } catch {
    return []
  }
  return doc.getPages().map((page) => {
    const vp = page.node.lookupMaybe(PDFName.of('VP'), PDFArray)
    // Viewports are given in unrotated PDF space; pages turned with /Rotate are left at paper scale for now.
    if (!vp || page.getRotation().angle % 360 !== 0) return []
    const crop = page.getCropBox()
    const out: Viewport[] = []
    for (let i = 0; i < vp.size(); i++) {
      const v = vp.lookupMaybe(i, PDFDict)
      const m = v?.lookupMaybe(PDFName.of('Measure'), PDFDict)
      if (!v || !m || m.lookupMaybe(PDFName.of('Subtype'), PDFName)?.asString() !== '/RL') continue
      const x = m.lookupMaybe(PDFName.of('X'), PDFArray)?.lookupMaybe(0, PDFDict)
      const c = x?.lookupMaybe(PDFName.of('C'), PDFNumber)?.asNumber()
      const unit = text(x?.lookup(PDFName.of('U'))) ?? ''
      if (!c || !(c > 0)) continue
      const bb = v.lookupMaybe(PDFName.of('BBox'), PDFArray)
      const nums = bb ? [0, 1, 2, 3].map((k) => bb.lookupMaybe(k, PDFNumber)?.asNumber() ?? 0) : [crop.x, crop.y, crop.x + crop.width, crop.y + crop.height]
      // PDF space has y up from the page bottom; the app uses y down from the top of the crop box.
      const top = crop.y + crop.height
      const bbox: [number, number, number, number] = [
        Math.min(nums[0], nums[2]) - crop.x,
        top - Math.max(nums[1], nums[3]),
        Math.max(nums[0], nums[2]) - crop.x,
        top - Math.min(nums[1], nums[3])
      ]
      out.push({ bbox, scale: { factor: c, unit: unit || 'units', source: 'document', label: text(m.lookup(PDFName.of('R'))) } })
    }
    return out
  })
}

/** The scale that applies at a point: a calibrated scale wins, then the smallest viewport holding the point, then paper. */
export function scaleAt(p: Pt, viewports: Viewport[] | undefined, calibrated: Scale | null): Scale {
  if (calibrated) return calibrated
  let best: Viewport | null = null
  for (const v of viewports ?? []) {
    const [x0, y0, x1, y1] = v.bbox
    if (p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1) {
      if (!best || (x1 - x0) * (y1 - y0) < (best.bbox[2] - best.bbox[0]) * (best.bbox[3] - best.bbox[1])) best = v
    }
  }
  return best?.scale ?? PAPER_MM
}
