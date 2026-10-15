import { arrowHeadPoints, cloudCurves, dashArray, isVertexKind, translated, withBounds, type Annot } from './annotations'

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
      const [l, tip, rr] = arrowHeadPoints(p0, p1, lw)
      body = (
        <>
          <line x1={p0.x} y1={p0.y} x2={p1.x} y2={p1.y} stroke={col} strokeWidth={lw} strokeLinecap="round" strokeDasharray={dash} />
          {a.kind === 'arrow' && (
            <polyline
              points={`${l.x},${l.y} ${tip.x},${tip.y} ${rr.x},${rr.y}`}
              fill="none"
              stroke={col}
              strokeWidth={lw}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}
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
      if (a.kind === 'cloud') {
        const { start, curves } = cloudCurves(pts, lw)
        d = `M${start.x} ${start.y} ` + curves.map(([c1, c2, p]) => `C${c1.x} ${c1.y} ${c2.x} ${c2.y} ${p.x} ${p.y}`).join(' ') + ' Z'
      } else d = pts.map((p, k) => `${k ? 'L' : 'M'}${p.x} ${p.y}`).join(' ') + (a.kind === 'polygon' ? ' Z' : '')
      const closed = a.kind !== 'polyline'
      body = (
        <>
          <path d={d} fill={closed ? fillCol : 'none'} stroke={col} strokeWidth={lw} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={dash} />
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
      const shape = (props: React.SVGProps<SVGElement>) =>
        a.kind === 'rectangle' ? (
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
    } else if (a.kind === 'stamp') {
      const label = a.text.toUpperCase()
      const size = stampFontSize(r.w, r.h, label)
      body = (
        <>
          <rect x={r.x + lw / 2} y={r.y + lw / 2} width={Math.max(1, r.w - lw)} height={Math.max(1, r.h - lw)} fill="none" stroke={col} strokeWidth={lw} />
          <text
            x={r.x + r.w / 2}
            y={r.y + r.h / 2 + size * 0.35}
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

    if ((a.kind === 'rectangle' || a.kind === 'ellipse' || a.kind === 'stamp') && selected && interactive) {
      handles.push(
        <div
          key={`${orig.id}-resize`}
          className="resize-handle"
          style={{ left: (r.x + r.w) * zoom - 5, top: (r.y + r.h) * zoom - 5, right: 'auto', bottom: 'auto' }}
          onMouseDown={(e) => begin(e, orig, 'resize')}
          aria-label="Resize"
        />
      )
    }

    let label: React.ReactNode = null
    if (a.measure && a.points?.[0]?.length && !ghost) {
      const pts = a.points[0]
      const at =
        a.measure.kind === 'area'
          ? { x: pts.reduce((s, p) => s + p.x, 0) / pts.length, y: pts.reduce((s, p) => s + p.y, 0) / pts.length }
          : { x: (pts[Math.floor((pts.length - 1) / 2)].x + pts[Math.ceil((pts.length - 1) / 2) || 1].x) / 2, y: (pts[Math.floor((pts.length - 1) / 2)].y + pts[Math.ceil((pts.length - 1) / 2) || 1].y) / 2 }
      label = (
        <text className="measure-annot-label" x={at.x} y={at.y - 4} textAnchor="middle" fontSize={9} fill={a.color} paintOrder="stroke" stroke="#fff" strokeWidth={3}>
          {a.measure.label}
        </text>
      )
    }
    return (
      <g key={orig.id}>
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
