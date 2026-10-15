import type { Pt } from './annotations'
import type { Rotation } from './viewRotation'

export type MeasureKind = 'distance' | 'perimeter' | 'area'

export interface Measurement {
  id: number
  page: number
  kind: MeasureKind
  /** Page points, unrotated page frame. */
  points: Pt[]
}

interface Props {
  items: Measurement[]
  /** The measurement being drawn: its points so far plus where the pointer is. */
  draft?: { kind: MeasureKind | 'calibrate'; points: Pt[]; cursor: Pt | null }
  zoom: number
  rotation: Rotation
  size: { width: number; height: number }
  label: (kind: MeasureKind, points: Pt[], page: number) => string
  page: number
}

/** Draws measurements over a page, with labels kept upright whatever the view rotation. */
export function MeasureLayer({ items, draft, zoom, rotation, size, label, page }: Props) {
  const stroke = 1.5 / zoom
  const tick = 5 / zoom
  const font = 11 / zoom

  const shape = (kind: MeasureKind | 'calibrate', pts: Pt[], key: string, live: boolean) => {
    if (!pts.length) return null
    const closed = kind === 'area' && pts.length > 2
    const d = pts.map((p, i) => `${i ? 'L' : 'M'}${p.x} ${p.y}`).join(' ') + (closed ? ' Z' : '')
    const first = pts[0]
    const last = pts[pts.length - 1]
    // End ticks perpendicular to the first and last segments, like a dimension line.
    const ticks = (a: Pt, b: Pt) => {
      const len = Math.hypot(b.x - a.x, b.y - a.y) || 1
      const nx = (-(b.y - a.y) / len) * tick
      const ny = ((b.x - a.x) / len) * tick
      return `M${a.x - nx} ${a.y - ny} L${a.x + nx} ${a.y + ny}`
    }
    const text = kind === 'calibrate' ? '' : pts.length > 1 ? label(kind, pts, page) : ''
    const anchor = labelPoint(kind, pts)
    return (
      <g key={key} className={live ? 'measure live' : 'measure'}>
        {closed && <path d={d} className="measure-fill" />}
        <path d={d} fill="none" strokeWidth={stroke} />
        {pts.length > 1 && kind !== 'area' && (
          <path d={`${ticks(first, pts[1])} ${ticks(last, pts[pts.length - 2])}`} strokeWidth={stroke} />
        )}
        {pts.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r={2.2 / zoom} />
        ))}
        {text && (
          <g transform={`translate(${anchor.x} ${anchor.y}) rotate(${-rotation})`}>
            <text className="measure-label" fontSize={font} textAnchor="middle" dy={-6 / zoom} paintOrder="stroke" strokeWidth={3 / zoom}>
              {text}
            </text>
          </g>
        )}
      </g>
    )
  }

  const draftPts = draft ? (draft.cursor ? [...draft.points, draft.cursor] : draft.points) : []
  return (
    <svg className="measure-svg" width={size.width * zoom} height={size.height * zoom} viewBox={`0 0 ${size.width} ${size.height}`} aria-hidden>
      {items.map((m) => shape(m.kind, m.points, `m${m.id}`, false))}
      {draft && shape(draft.kind, draftPts, 'draft', true)}
    </svg>
  )
}

function labelPoint(kind: MeasureKind | 'calibrate', pts: Pt[]): Pt {
  if (kind === 'area' && pts.length > 2) {
    return { x: pts.reduce((s, p) => s + p.x, 0) / pts.length, y: pts.reduce((s, p) => s + p.y, 0) / pts.length }
  }
  // Middle of the middle segment.
  const i = Math.max(0, Math.floor((pts.length - 1) / 2))
  const a = pts[i]
  const b = pts[Math.min(pts.length - 1, i + 1)]
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
}
