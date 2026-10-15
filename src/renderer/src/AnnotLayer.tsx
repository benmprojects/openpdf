import { useRef, useState } from 'react'
import { ShapeLayer, type Gesture } from './ShapeLayer'
import {
  isShapeKind,
  STRIKEOUT_AT,
  TEXTBOX_LINE_HEIGHT,
  TEXTBOX_PADDING,
  UNDERLINE_AT,
  LINE_WIDTH,
  annotLabel,
  arrowHeadPoints,
  FONT_CSS,
  calloutAttach,
  caretRectAfter,
  isMarkup,
  squigglePoints,
  type Annot
} from './annotations'
import { deltaToPage, type Rotation } from './viewRotation'

interface Props {
  annots: Annot[]
  zoom: number
  /** Only the select tool can pick, move and edit annotations; other tools let clicks through to the page. */
  interactive: boolean
  selectedId: number | null
  editingId: number | null
  /** Imported annotations still drawn by PDFium; ours stay invisible until touched. */
  touched: ReadonlySet<number>
  /** Called before an imported annotation changes, so PDFium stops drawing the original. */
  onTouch: (id: number) => void
  onSelect: (id: number | null) => void
  onMove: (id: number, dx: number, dy: number) => void
  onResize: (id: number, w: number, h: number) => void
  onReshape: (id: number, index: number, dx: number, dy: number) => void
  pageSize: { width: number; height: number }
  /** View rotation, so that drags on screen move things the right way in the page frame. */
  rotation: Rotation
  onEdit: (id: number | null) => void
  onText: (id: number, text: string) => void
}

export function AnnotLayer({
  annots,
  zoom,
  interactive,
  selectedId,
  editingId,
  touched,
  onTouch,
  onSelect,
  onMove,
  onResize,
  onReshape,
  pageSize,
  rotation,
  onEdit,
  onText
}: Props) {
  const [gesture, setGesture] = useState<Gesture | null>(null)

  const begin = (e: React.MouseEvent, a: Annot, kind: Gesture['kind'], index?: number) => {
    if (e.button !== 0 || !interactive) return
    e.stopPropagation()
    e.preventDefault()
    onSelect(a.id)
    if (editingId === a.id && kind === 'move') return
    const sx = e.clientX
    const sy = e.clientY
    let moved = false
    const move = (ev: MouseEvent) => {
      const { dx, dy } = deltaToPage(rotation, ev.clientX - sx, ev.clientY - sy)
      if (!moved && Math.hypot(dx, dy) < 3) return
      if (!moved) onTouch(a.id)
      moved = true
      setGesture({ id: a.id, kind, dx, dy, index })
    }
    const up = (ev: MouseEvent) => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      setGesture(null)
      if (!moved) return
      const d = deltaToPage(rotation, ev.clientX - sx, ev.clientY - sy)
      const dx = d.dx / zoom
      const dy = d.dy / zoom
      if (kind === 'move') onMove(a.id, dx, dy)
      else if (kind === 'reshape') onReshape(a.id, index ?? 0, dx, dy)
      else onResize(a.id, a.rects[0].w + dx, a.rects[0].h + dy)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  return (
    <div className="annot-layer">
      {annots.map((a) => {
        if (isShapeKind(a.kind) || a.kind === 'stamp') return null
        const selected = a.id === selectedId
        const ghost = a.origin !== undefined && !touched.has(a.id)
        if (isMarkup(a.kind)) {
          return a.rects.map((r, i) => {
            const base = { left: r.x * zoom, width: r.w * zoom }
            return (
              <div key={`${a.id}-${i}`} style={{ opacity: a.opacity }}>
                {a.kind === 'highlight' && !ghost && (
                  <div className="annot-highlight" style={{ ...base, top: r.y * zoom, height: r.h * zoom, background: a.color }} />
                )}
                {a.kind === 'squiggly' && !ghost && (
                  <svg className="annot-wave" style={{ left: r.x * zoom, top: r.y * zoom, width: r.w * zoom, height: r.h * zoom * 1.1 }} viewBox={`${r.x} ${r.y} ${r.w} ${r.h * 1.1}`} preserveAspectRatio="none">
                    <polyline points={squigglePoints(r).map((p) => `${p.x},${p.y}`).join(' ')} fill="none" stroke={a.color} strokeWidth={LINE_WIDTH} vectorEffect="non-scaling-stroke" />
                  </svg>
                )}
                {(a.kind === 'underline' || a.kind === 'strikeout') && !ghost && (
                  <div
                    className="annot-line"
                    style={{
                      ...base,
                      top: (r.y + r.h * (a.kind === 'underline' ? UNDERLINE_AT : STRIKEOUT_AT)) * zoom - (LINE_WIDTH * zoom) / 2,
                      height: Math.max(1, LINE_WIDTH * zoom),
                      background: a.color
                    }}
                  />
                )}
                {selected && <div className="annot-selected" style={{ ...base, top: r.y * zoom, height: r.h * zoom }} />}
                {a.replace && i === a.rects.length - 1 && !ghost && <CaretMark rect={caretRectAfter(r)} color={a.color} zoom={zoom} title={a.text} />}
                {a.replace && i === a.rects.length - 1 && editingId === a.id && (
                  <NoteEditor annot={a} label="Replacement text" style={{ left: r.x * zoom, top: (r.y + r.h) * zoom + 4 }} onText={onText} />
                )}
              </div>
            )
          })
        }

        if (a.kind === 'caret') {
          const r = a.rects[0]
          return (
            <div key={a.id}>
              <div
                className={`annot-caret${selected ? ' selected' : ''}${interactive ? ' interactive' : ''}`}
                role="button"
                aria-label={`Insert text: ${a.text || 'empty'}`}
                title={a.text || undefined}
                style={{ left: r.x * zoom, top: r.y * zoom, width: r.w * zoom, height: r.h * zoom }}
                onMouseDown={(e) => begin(e, a, 'move')}
                onDoubleClick={() => interactive && onEdit(a.id)}
              >
                {!ghost && <CaretMark rect={{ x: 0, y: 0, w: r.w, h: r.h }} color={a.color} zoom={zoom} />}
              </div>
              {editingId === a.id && <NoteEditor annot={a} label="Text to insert" style={{ left: r.x * zoom, top: (r.y + r.h) * zoom + 4 }} onText={onText} />}
            </div>
          )
        }

        const r = a.rects[0]
        const g = gesture?.id === a.id ? gesture : null
        const x = r.x + (g?.kind === 'move' ? g.dx / zoom : 0)
        const y = r.y + (g?.kind === 'move' ? g.dy / zoom : 0)
        // A typewriter box fits its text exactly, so it keeps its own size.
        const minW = a.kind === 'typewriter' ? 0 : 40
        const minH = a.kind === 'typewriter' ? 0 : 20
        const w = Math.max(minW, r.w + (g?.kind === 'resize' ? g.dx / zoom : 0))
        const h = Math.max(minH, r.h + (g?.kind === 'resize' ? g.dy / zoom : 0))
        const editing = editingId === a.id
        const cls = `annot-box ${a.kind}${selected ? ' selected' : ''}${interactive ? ' interactive' : ''}${ghost ? ' ghost' : ''}`

        if (a.kind === 'callout') {
          const box = { x, y, w, h }
          const dxm = g?.kind === 'move' ? g.dx / zoom : 0
          const dym = g?.kind === 'move' ? g.dy / zoom : 0
          const rawTip = a.points?.[0]?.[0] ?? { x: r.x - 40, y: r.y + r.h / 2 }
          const tip =
            g?.kind === 'reshape' ? { x: rawTip.x + g.dx / zoom, y: rawTip.y + g.dy / zoom } : { x: rawTip.x + dxm, y: rawTip.y + dym }
          const knee = calloutAttach(box, tip)
          const [hl, ht, hr] = arrowHeadPoints(knee, tip, 1)
          return (
            <div key={a.id}>
              {!ghost && (
                <svg className="annot-callout-line" width={pageSize.width * zoom} height={pageSize.height * zoom} viewBox={`0 0 ${pageSize.width} ${pageSize.height}`}>
                  <polyline points={`${knee.x},${knee.y} ${tip.x},${tip.y}`} fill="none" stroke={a.color} strokeWidth={1} />
                  <polyline points={`${hl.x},${hl.y} ${ht.x},${ht.y} ${hr.x},${hr.y}`} fill="none" stroke={a.color} strokeWidth={1} />
                </svg>
              )}
              <div
                className={`${cls} callout`}
                style={{
                  left: x * zoom,
                  top: y * zoom,
                  width: w * zoom,
                  height: h * zoom,
                  color: a.color,
                  opacity: a.opacity,
                  fontFamily: FONT_CSS[a.fontFamily ?? 'Helvetica'],
                  borderColor: ghost ? 'transparent' : a.color,
                  background: ghost ? 'transparent' : '#fff',
                  fontSize: a.fontSize * zoom,
                  lineHeight: TEXTBOX_LINE_HEIGHT,
                  padding: (TEXTBOX_PADDING + 1) * zoom
                }}
                onMouseDown={(e) => begin(e, a, 'move')}
                onDoubleClick={() => interactive && onEdit(a.id)}
              >
                {editing ? <TextEditor annot={a} onText={onText} /> : ghost ? null : a.text}
                {selected && interactive && !editing && (
                  <div className="resize-handle" onMouseDown={(e) => begin(e, a, 'resize')} aria-label="Resize callout" />
                )}
              </div>
              {selected && interactive && (
                <div
                  className="point-handle"
                  style={{ left: tip.x * zoom - 5, top: tip.y * zoom - 5 }}
                  onMouseDown={(e) => begin(e, a, 'reshape', 0)}
                  aria-label="Move callout arrow"
                />
              )}
            </div>
          )
        }

        if (a.kind === 'link') {
          return (
            <div
              key={a.id}
              className={`annot-link${selected ? ' selected' : ''}${interactive ? ' interactive' : ''}`}
              role="button"
              aria-label={`Link to ${a.linkUri ?? `page ${(a.linkPage ?? 0) + 1}`}`}
              title={a.linkUri ?? `Page ${(a.linkPage ?? 0) + 1}`}
              style={{ left: x * zoom, top: y * zoom, width: w * zoom, height: h * zoom }}
              onMouseDown={(e) => begin(e, a, 'move')}
            >
              {selected && interactive && <div className="resize-handle" onMouseDown={(e) => begin(e, a, 'resize')} aria-label="Resize link" />}
            </div>
          )
        }

        if (a.kind === 'foreign') {
          return (
            <div
              key={a.id}
              className={`annot-foreign${selected ? ' selected' : ''}${interactive ? ' interactive' : ''}`}
              role="button"
              aria-label={`Annotation${a.text ? `: ${a.text}` : ''}`}
              title={a.text || undefined}
              style={{ left: x * zoom, top: y * zoom, width: Math.max(4, r.w + (g?.kind === 'resize' ? g.dx / zoom : 0)) * zoom, height: Math.max(4, r.h + (g?.kind === 'resize' ? g.dy / zoom : 0)) * zoom }}
              onMouseDown={(e) => begin(e, a, 'move')}
            >
              {selected && interactive && <div className="resize-handle" onMouseDown={(e) => begin(e, a, 'resize')} aria-label="Resize annotation" />}
            </div>
          )
        }

        if (a.kind === 'note') {
          return (
            <div key={a.id}>
              <div
                className={cls}
                role="button"
                aria-label={`${annotLabel(a.kind)}: ${a.text || 'empty'}`}
                title={a.text || undefined}
                style={{ left: x * zoom, top: y * zoom, width: r.w * zoom, height: r.h * zoom, background: a.color, opacity: a.opacity }}
                onMouseDown={(e) => begin(e, a, 'move')}
                onDoubleClick={() => interactive && onEdit(a.id)}
              >
                {!ghost && <span />}
              </div>
              {editing && (
                <NoteEditor
                  annot={a}
                  style={{ left: x * zoom, top: (y + r.h) * zoom + 4 }}
                  onText={onText}
                />
              )}
            </div>
          )
        }

        return (
          <div
            key={a.id}
            className={cls}
            style={{
              left: x * zoom,
              top: y * zoom,
              width: w * zoom,
              height: h * zoom,
              color: a.color,
              opacity: a.opacity,
              fontFamily: FONT_CSS[a.fontFamily ?? 'Helvetica'],
              fontSize: a.fontSize * zoom,
              lineHeight: TEXTBOX_LINE_HEIGHT,
              padding: TEXTBOX_PADDING * zoom
            }}
            onMouseDown={(e) => begin(e, a, 'move')}
            onDoubleClick={() => interactive && onEdit(a.id)}
          >
            {editing ? <TextEditor annot={a} onText={onText} /> : a.text}
            {selected && interactive && !editing && a.kind === 'textbox' && (
              <div className="resize-handle" onMouseDown={(e) => begin(e, a, 'resize')} aria-label="Resize text box" />
            )}
          </div>
        )
      })}
      <ShapeLayer
        annots={annots.filter((a) => isShapeKind(a.kind) || a.kind === 'stamp')}
        zoom={zoom}
        pageSize={pageSize}
        interactive={interactive}
        selectedId={selectedId}
        touched={touched}
        gesture={gesture}
        begin={begin}
      />
    </div>
  )
}

/** Textarea that commits on blur or Ctrl+Enter and reverts on Escape. */
function useEditorHandlers(annot: Annot, onText: (id: number, text: string) => void) {
  const cancelled = useRef(false)
  return {
    autoFocus: true,
    defaultValue: annot.text,
    onFocus: (e: React.FocusEvent<HTMLTextAreaElement>) => e.currentTarget.setSelectionRange(e.currentTarget.value.length, e.currentTarget.value.length),
    onMouseDown: (e: React.MouseEvent) => e.stopPropagation(),
    onBlur: (e: React.FocusEvent<HTMLTextAreaElement>) => onText(annot.id, cancelled.current ? annot.text : e.currentTarget.value),
    onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        cancelled.current = true
        e.currentTarget.blur()
      } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.currentTarget.blur()
      }
    }
  }
}

function TextEditor({ annot, onText }: { annot: Annot; onText: (id: number, text: string) => void }) {
  const h = useEditorHandlers(annot, onText)
  return <textarea className="annot-editor" aria-label="Text box contents" {...h} />
}

function NoteEditor({
  annot,
  style,
  onText,
  label = 'Note text'
}: {
  annot: Annot
  style: React.CSSProperties
  onText: (id: number, text: string) => void
  label?: string
}) {
  const h = useEditorHandlers(annot, onText)
  return (
    <div className="note-popup" style={style}>
      <textarea aria-label={label} placeholder={`${label}. Ctrl+Enter to finish.`} {...h} />
    </div>
  )
}

/** The wedge drawn for insert and replace marks, in the box `rect` (page points, or local when nested). */
function CaretMark({ rect: r, color, zoom, title }: { rect: { x: number; y: number; w: number; h: number }; color: string; zoom: number; title?: string }) {
  return (
    <svg className="annot-caret-mark" style={{ left: r.x * zoom, top: r.y * zoom, width: r.w * zoom, height: r.h * zoom }} viewBox={`0 0 ${r.w} ${r.h}`}>
      {title && <title>{title}</title>}
      <path d={`M0 ${r.h} L${r.w / 2} 0 L${r.w} ${r.h} L${r.w / 2} ${r.h * 0.7} Z`} fill={color} />
    </svg>
  )
}
