import { blendCss, blendOf, cloudCurves, cloudLevel, cloudOutline, dashArray, isVertexKind, lineEndsOf, translated, withBounds, type Annot, type Pt } from './annotations'
import { pathEnds } from './lineEnds'
import { measureCaption, measureLabelAt } from './measure'

/** SVG path data for a scalloped border along `pts`. */
function cloudPath(pts: Pt[], lw: number, level: number): string {
  const { start, curves } = cloudCurves(pts, lw, level)
  return `M${start.x} ${start.y} ` + curves.map(([c1, c2, p]) => `C${c1.x} ${c1.y} ${c2.x} ${c2.y} ${p.x} ${p.y}`).join(' ') + ' Z'
}

/** The end markers (arrows, circles and so on) of a path, as SVG paths. */
function endMarkers(a: Annot, pts: Pt[], col: string, lw: number, key: string) {
  const ends = lineEndsOf(a)
  return pathEnds(pts, ends.start, ends.end, lw).map((m, i) => (
    <path
      key={`${key}-end${i}`}
      d={m.pts.map((p, k) => `${k ? 'L' : 'M'}${p.x} ${p.y}`).join(' ') + (m.closed ? ' Z' : '')}
      fill={m.fill ? col : 'none'}
      stroke={col}
      strokeWidth={lw}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ))
}

export type Gesture = { id: number; kind: 'move' | 'resize' | 'reshape'; dx: number; dy: number; index?: number }

interface Props {
  annots: Annot[]
  zoom: number
  pageSize: { width: number; height: number }
  interactive: boolean
  selectedId: number | null
  touched: ReadonlySet<number>
  gesture: Gesture | null
  begin: (e: React.MouseEvent, a: Annot, kind: Gesture['kind'], index?: number) => void
}

/** The annotation as it looks mid-gesture, before the change is committed. */
function displayed(a: Annot, g: Gesture | null, zoom: number): Annot {
  if (!g || g.id !== a.id) return a
  const dx = g.dx / zoom
  const dy = g.dy / zoom
  if (g.kind === 'move') return translated(a, dx, dy)
  if (g.kind === 'resize') {
    const r = a.rects[0]
    return { ...a, rects: [{ ...r, w: Math.max(40, r.w + dx), h: Math.max(20, r.h + dy) }] }
  }
  const first = a.points![0].map((p, i) => (i === g.index ? { x: p.x + dx, y: p.y + dy } : p))
  return withBounds({ ...a, points: [first, ...a.points!.slice(1)] })
}

let measurer: CanvasRenderingContext2D | null | undefined

/** Width of a bold Helvetica/Arial string at font size 1, matching the metrics used when the stamp is saved. */
function unitWidth(label: string): number {
  measurer ??= document.createElement('canvas').getContext('2d')
  if (!measurer) return label.length * 0.7
  measurer.font = 'bold 100px Arial'
  return measurer.measureText(label).width / 100
}

export function stampFontSize(w: number, h: number, label: string): number {
  return Math.max(4, Math.min(h * 0.52, (w - 14) / (unitWidth(label) || 1)))
}

/** Lines, arrows, rectangles, ellipses, ink and stamps, drawn as SVG in page points. */
export function ShapeLayer({ annots, zoom, pageSize, interactive, selectedId, touched, gesture, begin }: Props) {
  const hit = interactive ? 'stroke' : 'none'
  const fat = (lw: number) => Math.max(lw, 12 / zoom)
  const handles: React.ReactNode[] = []

  const svgShapes = annots.map((orig) => {
    const a = displayed(orig, gesture, zoom)
    const ghost = orig.origin !== undefined && !touched.has(orig.id)
    const col = ghost ? 'transparent' : a.color
    const fillCol = ghost || !a.fill ? 'none' : a.fill
    const lw = a.lineWidth
    const dash = dashArray(a.dash, lw)?.join(' ')
    const r = a.rects[0]
    const selected = orig.id === selectedId
    const down = (e: React.MouseEvent) => begin(e, orig, 'move')
    const cursor = { cursor: 'move' }
    let body: React.ReactNode = null

    if (a.kind === 'line' || a.kind === 'arrow') {
      const [p0, p1] = a.points![0]
      body = (
        <>
          <line x1={p0.x} y1={p0.y} x2={p1.x} y2={p1.y} stroke={col} strokeWidth={lw} strokeLinecap="round" strokeDasharray={dash} />
          {endMarkers(a, [p0, p1], col, lw, String(orig.id))}
          <line x1={p0.x} y1={p0.y} x2={p1.x} y2={p1.y} stroke="transparent" strokeWidth={fat(lw)} pointerEvents={hit} style={cursor} onMouseDown={down} />
        </>
      )
      if (selected && interactive) {
        ;[p0, p1].forEach((p, index) =>
          handles.push(
            <div
              key={`${orig.id}-h${index}`}
              className="point-handle"
              style={{ left: p.x * zoom - 5, top: p.y * zoom - 5 }}
              onMouseDown={(e) => begin(e, orig, 'reshape', index)}
              aria-label={index === 0 ? 'Move line start' : 'Move line end'}
            />
          )
        )
      }
    } else if (isVertexKind(a.kind)) {
      const pts = a.points![0]
      let d: string
      const level = cloudLevel(a)
      if (level) d = cloudPath(pts, lw, level)
      else d = pts.map((p, k) => `${k ? 'L' : 'M'}${p.x} ${p.y}`).join(' ') + (a.kind !== 'polyline' ? ' Z' : '')
      const closed = a.kind !== 'polyline'
      body = (
        <>
          <path d={d} fill={closed ? fillCol : 'none'} stroke={col} strokeWidth={lw} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={dash} />
          {!closed && endMarkers(a, pts, col, lw, String(orig.id))}
          <path d={d} fill={closed ? 'transparent' : 'none'} stroke="transparent" strokeWidth={fat(lw)} pointerEvents={interactive ? (closed ? 'all' : 'stroke') : 'none'} style={cursor} onMouseDown={down} />
        </>
      )
      if (selected && interactive) {
        pts.forEach((p, index) =>
          handles.push(
            <div
              key={`${orig.id}-v${index}`}
              className="point-handle"
              style={{ left: p.x * zoom - 5, top: p.y * zoom - 5 }}
              onMouseDown={(e) => begin(e, orig, 'reshape', index)}
              aria-label={`Move corner ${index + 1}`}
            />
          )
        )
      }
    } else if (a.kind === 'ink') {
      body = (
        <>
          {a.points!.map((path, i) => {
            const d = path.map((p, k) => `${k ? 'L' : 'M'}${p.x} ${p.y}`).join(' ')
            return (
              <g key={i}>
                <path d={d} fill="none" stroke={col} strokeWidth={lw} strokeLinecap="round" strokeLinejoin="round" />
                <path d={d} fill="none" stroke="transparent" strokeWidth={fat(lw)} pointerEvents={hit} style={cursor} onMouseDown={down} />
              </g>
            )
          })}
        </>
      )
    } else if (a.kind === 'rectangle' || a.kind === 'ellipse') {
      const inset = lw / 2
      const w = Math.max(1, r.w - lw)
      const h = Math.max(1, r.h - lw)
      const outline = a.kind === 'rectangle' ? cloudOutline(a) : null
      const shape = (props: React.SVGProps<SVGElement>) =>
        outline ? (
          <path d={cloudPath(outline, lw, cloudLevel(a))} {...(props as object)} />
        ) : a.kind === 'rectangle' ? (
          <rect x={r.x + inset} y={r.y + inset} width={w} height={h} {...(props as object)} />
        ) : (
          <ellipse cx={r.x + r.w / 2} cy={r.y + r.h / 2} rx={w / 2} ry={h / 2} {...(props as object)} />
        )
      body = (
        <>
          {shape({ stroke: col, strokeWidth: lw, fill: fillCol, strokeDasharray: dash, strokeLinecap: 'round' } as never)}
          {shape({ stroke: 'transparent', fill: a.fill ? 'transparent' : 'none', strokeWidth: fat(lw), pointerEvents: interactive ? (a.fill ? 'all' : 'stroke') : 'none', style: cursor, onMouseDown: down } as never)}
        </>
      )
    } else if (a.kind === 'stamp' && a.image) {
      body = (
        <>
          {!ghost && <image href={a.image} x={r.x} y={r.y} width={r.w} height={r.h} preserveAspectRatio="none" />}
          <rect x={r.x} y={r.y} width={r.w} height={r.h} fill="transparent" pointerEvents={interactive ? 'all' : 'none'} style={cursor} onMouseDown={down} />
        </>
      )
    } else if (a.kind === 'stamp') {
      const label = a.text.toUpperCase()
      const info = a.stampInfo ?? ''
      const labelH = info ? r.h * 0.62 : r.h
      const size = Math.min(stampFontSize(r.w, labelH, label) * (info ? 0.6 / 0.52 : 1), stampFontSize(r.w, r.h * 4, label))
      const isz = Math.max(3, Math.min(r.h * 0.2, (r.w - 10) / (info.length * 0.5 || 1)))
      body = (
        <>
          <rect x={r.x + lw / 2} y={r.y + lw / 2} width={Math.max(1, r.w - lw)} height={Math.max(1, r.h - lw)} fill="none" stroke={col} strokeWidth={lw} />
          {info && (
            <text x={r.x + r.w / 2} y={r.y + r.h * 0.86} textAnchor="middle" fontFamily="Helvetica, Arial, sans-serif" fontSize={isz} fill={col}>
              {info}
            </text>
          )}
          <text
            x={r.x + r.w / 2}
            y={r.y + labelH / 2 + size * 0.35 + (info ? r.h * 0.04 : 0)}
            textAnchor="middle"
            fontFamily="Helvetica, Arial, sans-serif"
            fontWeight="bold"
            fontSize={size}
            fill={col}
          >
            {label}
          </text>
          <rect x={r.x} y={r.y} width={r.w} height={r.h} fill="transparent" pointerEvents={interactive ? 'all' : 'none'} style={cursor} onMouseDown={down} />
        </>
      )
    }

    // A turned stamp is drawn turned about the centre of its box; its resize handle goes to the turned corner.
    let corner = { x: r.x + r.w, y: r.y + r.h }
    if (a.kind === 'stamp' && a.angle) {
      const cx = r.x + r.w / 2
      const cy = r.y + r.h / 2
      body = <g transform={`rotate(${a.angle} ${cx} ${cy})`}>{body}</g>
      const rad = (a.angle * Math.PI) / 180
      corner = { x: cx + (r.w / 2) * Math.cos(rad) - (r.h / 2) * Math.sin(rad), y: cy + (r.w / 2) * Math.sin(rad) + (r.h / 2) * Math.cos(rad) }
    }
    if ((a.kind === 'rectangle' || a.kind === 'ellipse' || a.kind === 'stamp') && selected && interactive) {
      handles.push(
        <div
          key={`${orig.id}-resize`}
          className="resize-handle"
          style={{ left: corner.x * zoom - 5, top: corner.y * zoom - 5, right: 'auto', bottom: 'auto' }}
          onMouseDown={(e) => begin(e, orig, 'resize')}
          aria-label="Resize"
        />
      )
    }

    let label: React.ReactNode = null
    if (a.measure?.kind === 'count' && !ghost) {
      // A count marker: its number in white on the filled circle.
      label = (
        <text className="count-marker-number" x={r.x + r.w / 2} y={r.y + r.h / 2} textAnchor="middle" dominantBaseline="central" fontSize={Math.max(5, Math.min(r.h * 0.6, 10))} fill="#fff" fontWeight={700} pointerEvents="none">
          {a.measure.n ?? 1}
        </text>
      )
    } else if (a.measure && a.points?.[0]?.length && !ghost) {
      const pts = a.points[0]
      const at = measureLabelAt(a.measure.kind, pts)
      label = (
        <text className="measure-annot-label" x={at.x} y={at.y - 4} textAnchor="middle" fontSize={9} fill={a.color} paintOrder="stroke" stroke="#fff" strokeWidth={3}>
          {measureCaption(a.measure)}
        </text>
      )
    }
    return (
      <g key={orig.id} opacity={a.opacity} style={blendOf(a) !== 'Normal' ? { mixBlendMode: blendCss(blendOf(a)) as React.CSSProperties['mixBlendMode'] } : undefined}>
        {body}
        {label}
        {selected && (
          <rect
            x={r.x - 2}
            y={r.y - 2}
            width={r.w + 4}
            height={r.h + 4}
            fill="none"
            strokeDasharray="4 3"
            strokeWidth={1.5 / zoom}
            style={{ stroke: 'var(--accent)' }}
            pointerEvents="none"
          />
        )}
      </g>
    )
  })

  return (
    <>
      <svg className="annot-svg" width={pageSize.width * zoom} height={pageSize.height * zoom} viewBox={`0 0 ${pageSize.width} ${pageSize.height}`}>
        {svgShapes}
      </svg>
      {handles}
    </>
  )
}
