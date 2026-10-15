import { useEffect, useRef } from 'react'

export type RulerUnit = 'mm' | 'cm' | 'in' | 'pt'

/** Points per unit. */
export const UNIT_PT: Record<RulerUnit, number> = { mm: 72 / 25.4, cm: 72 / 2.54, in: 72, pt: 1 }

export const RULER_SIZE = 20

/** Tick spacing in units for a zoom level, so labelled ticks are at least ~50 px apart. */
export function tickStep(unit: RulerUnit, pxPerUnit: number): { major: number; minor: number } {
  const steps = unit === 'in' ? [0.125, 0.25, 0.5, 1, 2, 5, 10] : [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000]
  const major = steps.find((s) => s * pxPerUnit >= 50) ?? steps[steps.length - 1]
  const minor = unit === 'in' ? major / 4 : major / (major >= 10 && String(major).startsWith('2') ? 4 : major >= 5 && String(major).startsWith('5') ? 5 : 10)
  return { major, minor: minor * pxPerUnit >= 4 ? minor : major }
}

interface Props {
  axis: 'x' | 'y'
  /** Screen position (client px) of the ruler origin: the current page's displayed top or left edge. */
  origin: number
  /** CSS px per point. */
  zoom: number
  unit: RulerUnit
  /** Pointer position along the axis in client px, for the marker. */
  pointer: number | null
  /** Start dragging a new guide out of this ruler. */
  onGuideDrag: (e: React.MouseEvent) => void
}

/** One ruler strip, drawn on a canvas. */
export function RulerStrip({ axis, origin, zoom, unit, pointer, onGuideDrag }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const cv = canvas.current
    if (!cv) return
    const draw = () => {
      const r = cv.getBoundingClientRect()
      const dpr = window.devicePixelRatio || 1
      const len = axis === 'x' ? r.width : r.height
      cv.width = Math.round(r.width * dpr)
      cv.height = Math.round(r.height * dpr)
      const ctx = cv.getContext('2d')
      if (!ctx) return
      ctx.scale(dpr, dpr)
      const css = getComputedStyle(cv)
      ctx.fillStyle = css.getPropertyValue('--panel-2') || '#f3f4f7'
      ctx.fillRect(0, 0, r.width, r.height)
      ctx.strokeStyle = css.getPropertyValue('--border-strong') || '#c3c8d1'
      ctx.fillStyle = css.getPropertyValue('--muted') || '#646b78'
      ctx.font = '10px "Segoe UI", system-ui, sans-serif'
      ctx.lineWidth = 1
      const pxPerUnit = UNIT_PT[unit] * zoom
      const { major, minor } = tickStep(unit, pxPerUnit)
      const start = axis === 'x' ? r.left : r.top
      const o = origin - start // origin within the strip
      const first = Math.floor(-o / pxPerUnit / minor) * minor
      const last = (len - o) / pxPerUnit
      ctx.beginPath()
      for (let v = first; v <= last; v += minor) {
        const pos = Math.round(o + v * pxPerUnit) + 0.5
        const isMajor = Math.abs(v / major - Math.round(v / major)) < 1e-6
        const h = isMajor ? RULER_SIZE : RULER_SIZE * 0.35
        if (axis === 'x') {
          ctx.moveTo(pos, RULER_SIZE)
          ctx.lineTo(pos, RULER_SIZE - h)
        } else {
          ctx.moveTo(RULER_SIZE, pos)
          ctx.lineTo(RULER_SIZE - h, pos)
        }
        if (isMajor) {
          const label = String(Math.round(v * 1000) / 1000)
          if (axis === 'x') ctx.fillText(label, pos + 3, 10)
          else {
            ctx.save()
            ctx.translate(10, pos + 3)
            ctx.rotate(-Math.PI / 2)
            ctx.textAlign = 'right'
            ctx.fillText(label, 0, 0)
            ctx.restore()
          }
        }
      }
      ctx.stroke()
      if (pointer !== null) {
        const p = Math.round(pointer - start) + 0.5
        ctx.strokeStyle = css.getPropertyValue('--accent') || '#c8323c'
        ctx.beginPath()
        if (axis === 'x') {
          ctx.moveTo(p, 0)
          ctx.lineTo(p, RULER_SIZE)
        } else {
          ctx.moveTo(0, p)
          ctx.lineTo(RULER_SIZE, p)
        }
        ctx.stroke()
      }
    }
    draw()
    const ro = new ResizeObserver(draw)
    ro.observe(cv)
    return () => ro.disconnect()
  }, [axis, origin, zoom, unit, pointer])

  return (
    <canvas
      ref={canvas}
      className={`ruler ruler-${axis}`}
      title="Drag onto the page to add a guide"
      onMouseDown={onGuideDrag}
      aria-hidden
    />
  )
}
