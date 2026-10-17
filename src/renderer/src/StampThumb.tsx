import { stampSize } from './annotations'
import { stampFontSize } from './ShapeLayer'
import type { StampDef } from './stampLogic'

interface Props {
  def: Pick<StampDef, 'kind' | 'color' | 'image'>
  /** The text as it will appear, with fields already filled in. */
  title: string
  detail: string
  /** Largest size of the picture in CSS pixels. */
  maxW?: number
  maxH?: number
}

/** A stamp drawn as it appears on the page: the same border, bold title and small detail line as the saved annotation. */
export function StampThumb({ def, title, detail, maxW = 150, maxH = 46 }: Props) {
  if (def.kind === 'image' && def.image) {
    return <img className="stamp-thumb" src={def.image.dataUrl} alt="" style={{ maxWidth: maxW, maxHeight: maxH }} />
  }
  const label = title.toUpperCase()
  const { w, h } = stampSize(label, detail || undefined)
  const lw = 2
  const labelH = detail ? h * 0.62 : h
  const size = Math.min(stampFontSize(w, labelH, label) * (detail ? 0.6 / 0.52 : 1), stampFontSize(w, h * 4, label))
  const isz = Math.max(3, Math.min(h * 0.2, (w - 10) / (detail.length * 0.5 || 1)))
  const scale = Math.min(maxW / w, maxH / h)
  return (
    <svg className="stamp-thumb" viewBox={`0 0 ${w} ${h}`} width={Math.round(w * scale)} height={Math.round(h * scale)} aria-hidden>
      <rect x={lw / 2} y={lw / 2} width={w - lw} height={h - lw} fill="none" stroke={def.color} strokeWidth={lw} />
      {detail && (
        <text x={w / 2} y={h * 0.86} textAnchor="middle" fontFamily="Helvetica, Arial, sans-serif" fontSize={isz} fill={def.color}>
          {detail}
        </text>
      )}
      <text x={w / 2} y={labelH / 2 + size * 0.35 + (detail ? h * 0.04 : 0)} textAnchor="middle" fontFamily="Helvetica, Arial, sans-serif" fontWeight="bold" fontSize={size} fill={def.color}>
        {label}
      </text>
    </svg>
  )
}
