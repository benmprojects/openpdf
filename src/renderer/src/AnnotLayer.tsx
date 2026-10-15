import { useRef, useState } from 'react'
import {
  STRIKEOUT_AT,
  TEXTBOX_LINE_HEIGHT,
  TEXTBOX_PADDING,
  UNDERLINE_AT,
  LINE_WIDTH,
  annotLabel,
  isMarkup,
  type Annot
} from './annotations'

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
  onEdit: (id: number | null) => void
  onText: (id: number, text: string) => void
}

type Gesture = { id: number; kind: 'move' | 'resize'; dx: number; dy: number }

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
  onEdit,
  onText
}: Props) {
  const [gesture, setGesture] = useState<Gesture | null>(null)

  const begin = (e: React.MouseEvent, a: Annot, kind: 'move' | 'resize') => {
    if (e.button !== 0 || !interactive) return
    e.stopPropagation()
    e.preventDefault()
    onSelect(a.id)
    if (editingId === a.id && kind === 'move') return
    const sx = e.clientX
    const sy = e.clientY
    let moved = false
    const move = (ev: MouseEvent) => {
      const dx = ev.clientX - sx
      const dy = ev.clientY - sy
      if (!moved && Math.hypot(dx, dy) < 3) return
      if (!moved) onTouch(a.id)
      moved = true
      setGesture({ id: a.id, kind, dx, dy })
    }
    const up = (ev: MouseEvent) => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      setGesture(null)
      if (!moved) return
      const dx = (ev.clientX - sx) / zoom
      const dy = (ev.clientY - sy) / zoom
      if (kind === 'move') onMove(a.id, dx, dy)
      else onResize(a.id, a.rects[0].w + dx, a.rects[0].h + dy)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  return (
    <div className="annot-layer">
      {annots.map((a) => {
        const selected = a.id === selectedId
        const ghost = a.origin !== undefined && !touched.has(a.id)
        if (isMarkup(a.kind)) {
          return a.rects.map((r, i) => {
            const base = { left: r.x * zoom, width: r.w * zoom }
            return (
              <div key={`${a.id}-${i}`}>
                {a.kind === 'highlight' && !ghost && (
                  <div className="annot-highlight" style={{ ...base, top: r.y * zoom, height: r.h * zoom, background: a.color }} />
                )}
                {a.kind !== 'highlight' && !ghost && (
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
              </div>
            )
          })
        }

        const r = a.rects[0]
        const g = gesture?.id === a.id ? gesture : null
        const x = r.x + (g?.kind === 'move' ? g.dx / zoom : 0)
        const y = r.y + (g?.kind === 'move' ? g.dy / zoom : 0)
        const w = Math.max(40, r.w + (g?.kind === 'resize' ? g.dx / zoom : 0))
        const h = Math.max(20, r.h + (g?.kind === 'resize' ? g.dy / zoom : 0))
        const editing = editingId === a.id
        const cls = `annot-box ${a.kind}${selected ? ' selected' : ''}${interactive ? ' interactive' : ''}${ghost ? ' ghost' : ''}`

        if (a.kind === 'note') {
          return (
            <div key={a.id}>
              <div
                className={cls}
                role="button"
                aria-label={`${annotLabel(a.kind)}: ${a.text || 'empty'}`}
                title={a.text || undefined}
                style={{ left: x * zoom, top: y * zoom, width: r.w * zoom, height: r.h * zoom, background: a.color }}
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
              fontSize: a.fontSize * zoom,
              lineHeight: TEXTBOX_LINE_HEIGHT,
              padding: TEXTBOX_PADDING * zoom
            }}
            onMouseDown={(e) => begin(e, a, 'move')}
            onDoubleClick={() => interactive && onEdit(a.id)}
          >
            {editing ? <TextEditor annot={a} onText={onText} /> : a.text}
            {selected && interactive && !editing && (
              <div className="resize-handle" onMouseDown={(e) => begin(e, a, 'resize')} aria-label="Resize text box" />
            )}
          </div>
        )
      })}
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

function NoteEditor({ annot, style, onText }: { annot: Annot; style: React.CSSProperties; onText: (id: number, text: string) => void }) {
  const h = useEditorHandlers(annot, onText)
  return (
    <div className="note-popup" style={style}>
      <textarea aria-label="Note text" placeholder="Type a note. Ctrl+Enter to finish." {...h} />
    </div>
  )
}
