/** The measurements list: one row per measurement or count marker, totals, and CSV. Pure. */
import type { Annot } from './annotations'
import { angleAt, pathLength, polygonArea } from './measure'
import { pdfUnit } from './measureScale'

export type MeasureType = 'distance' | 'perimeter' | 'area' | 'count' | 'angle'

export const MEASURE_TYPE_NAMES: Record<MeasureType, string> = { distance: 'Distance', perimeter: 'Perimeter', area: 'Area', count: 'Count', angle: 'Angle' }

export interface MeasureRow {
  id: number
  /** Zero-based. */
  page: number
  /** The page as the document labels it (for example "iv" or "3"). */
  pageLabel: string
  type: MeasureType
  /** Length, area (in unit squared) or 1 for a count marker. */
  value: number
  /** Unit of `value`: m, m², ft, or "count". */
  unit: string
  /** The result as shown on the page, or for a count its group and number. */
  result: string
  /** Count group, or the person's label (name or comment) for the others. */
  label: string
}

/** Rows for every measurement in `annots`, in page order then the order they were made. */
export function measureRows(annots: Annot[], labels: string[] | null): MeasureRow[] {
  const rows: MeasureRow[] = []
  for (const a of annots) {
    const m = a.measure
    if (!m) continue
    const pageLabel = labels?.[a.page] || String(a.page + 1)
    if (m.kind === 'count') {
      rows.push({ id: a.id, page: a.page, pageLabel, type: 'count', value: 1, unit: 'count', result: `${m.label} #${m.n ?? 1}`, label: m.label })
      continue
    }
    const pts = a.points?.[0] ?? []
    if (m.kind === 'angle') {
      rows.push({ id: a.id, page: a.page, pageLabel, type: 'angle', value: pts.length >= 3 ? angleAt(pts[0], pts[1], pts[2]) : 0, unit: '°', result: m.label, label: m.name ?? '' })
      continue
    }
    const value = m.kind === 'area' ? polygonArea(pts) * m.factor * m.factor : pathLength(pts) * m.factor
    const unit = pdfUnit(m.unit)
    rows.push({ id: a.id, page: a.page, pageLabel, type: m.kind, value, unit: m.kind === 'area' ? `${unit}²` : unit, result: m.label, label: m.name ?? '' })
  }
  return rows.sort((p, q) => p.page - q.page || p.id - q.id)
}

export interface MeasureTotal {
  type: MeasureType
  /** Count group, or '' for lengths and areas. */
  label: string
  unit: string
  value: number
  items: number
}

/** Running totals: one per count label, and one per type and unit for the rest. */
export function measureTotals(rows: MeasureRow[]): MeasureTotal[] {
  const out = new Map<string, MeasureTotal>()
  for (const r of rows) {
    // Angles do not add up.
    if (r.type === 'angle') continue
    const key = r.type === 'count' ? `count\u0000${r.label}` : `${r.type}\u0000${r.unit}`
    const t = out.get(key) ?? { type: r.type, label: r.type === 'count' ? r.label : '', unit: r.unit, value: 0, items: 0 }
    t.value += r.value
    t.items++
    out.set(key, t)
  }
  return [...out.values()]
}

/** The number a new marker in group `label` gets: one more than the highest already there. */
export function nextCount(annots: Annot[], label: string): number {
  let max = 0
  for (const a of annots) if (a.measure?.kind === 'count' && a.measure.label === label) max = Math.max(max, a.measure.n ?? 0)
  return max + 1
}

const q = (s: string) => `"${s.replace(/"/g, '""')}"`

/** Round to 6 places so 0.1 + 0.2 does not show as 0.30000000000000004. */
const num = (v: number) => String(Number(v.toFixed(6)))

/** Measurements as CSV (comma separated, every field quoted, CRLF line ends) with a totals block under the rows. */
export function measureCsv(rows: MeasureRow[]): string {
  const lines = [['Page', 'Type', 'Label', 'Value', 'Units', 'Result'].map(q).join(',')]
  for (const r of rows) lines.push([r.pageLabel, MEASURE_TYPE_NAMES[r.type], r.label, num(r.value), r.unit, r.result].map(q).join(','))
  const totals = measureTotals(rows)
  if (totals.length) {
    lines.push('')
    lines.push(['Totals', 'Type', 'Label', 'Value', 'Units', 'Items'].map(q).join(','))
    for (const t of totals) lines.push(['', MEASURE_TYPE_NAMES[t.type], t.label, num(t.value), t.unit, String(t.items)].map(q).join(','))
  }
  return lines.join('\r\n') + '\r\n'
}
