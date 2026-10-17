import { useEffect, useMemo, useRef, useState } from 'react'
import { CalendarDays, Lock, Settings2, Trash2, X } from 'lucide-react'
import { dateFormatOf, formatDate, fromInputValue, parseDate, toInputValue } from './dateField'
import { isImageField } from './formImage'
import type { FormField, FormValue, Widget } from './forms'
import { deltaToPage, type Rotation } from './viewRotation'
import type { Rect } from './textLogic'

export interface FormsView {
  fields: FormField[]
  /** Edited values by field name (a field not in here still has its value from the file). */
  values: ReadonlyMap<string, FormValue>
  onChange: (name: string, value: FormValue) => void
  /** Tint fields so they can be found. */
  highlight: boolean
  /** Set while designing: fields are boxes to select, move, resize and delete rather than controls to fill in. */
  design?: DesignProps
  /** A push button was pressed. */
  onButton?: (field: FormField) => void
  /** A value was committed: a text field lost focus, or another kind of control changed. */
  onCommit?: (field: FormField, value: FormValue) => void
  /** What fields with a format script show when they are not being edited. */
  display?: ReadonlyMap<string, string>
  /** The picture in an image field was cleared. */
  onClearImage?: (field: FormField) => void
}

export interface DesignProps {
  selected: { name: string; widget: number } | null
  onSelect: (s: { name: string; widget: number } | null) => void
  /** Further widgets selected with Shift or Ctrl (keys `name#widget`), for aligning, spreading and matching size. */
  extra?: ReadonlySet<string>
  /** Shift or Ctrl and click: add the widget to the selection, or take it out. */
  onToggle?: (s: { name: string; widget: number }) => void
  onPlace: (name: string, widget: number, rect: Rect) => void
  /** Several selected widgets were dragged together by this offset (display space, points) on a page. */
  onPlaceMany?: (page: number, dx: number, dy: number) => void
  /** A box was dragged on the page background: these widgets are now the selection. */
  onSelectMany?: (refs: { name: string; widget: number }[]) => void
  onEdit: (name: string) => void
  onDelete: (name: string) => void
}

/** The fields of one page, in tab order, as real controls over the page image. */
export function FormLayer({ page, zoom, rotation, forms, interactive }: { page: number; zoom: number; rotation: Rotation; forms: FormsView; interactive: boolean }) {
  const items = useMemo(() => {
    const all = forms.fields.flatMap((field) => field.widgets.map((widget, i) => ({ field, widget, index: i, key: `${field.name}#${i}` })).filter((x) => x.widget.page === page))
    const tabs = all[0]?.widget.tabs ?? ''
    // Tab follows the page's /Tabs setting: rows (top to bottom, then left to right), columns, or the order in the file.
    const row = (r: Rect) => Math.round(r.y / 6)
    if (tabs === 'R') return all.sort((a, b) => row(a.widget.rect) - row(b.widget.rect) || a.widget.rect.x - b.widget.rect.x)
    if (tabs === 'C') return all.sort((a, b) => Math.round(a.widget.rect.x / 6) - Math.round(b.widget.rect.x / 6) || a.widget.rect.y - b.widget.rect.y)
    return all.sort((a, b) => a.widget.order - b.widget.order)
  }, [forms.fields, page])
  if (!items.length) return null
  if (forms.design) return <DesignLayer items={items} zoom={zoom} rotation={rotation} design={forms.design} />
  return (
    <div className={`form-layer${forms.highlight ? ' highlight' : ''}${interactive ? '' : ' inert'}`}>
      {items.map(({ field, widget, key }) => (
        <Control
          key={key}
          field={field}
          widget={widget}
          zoom={zoom}
          value={forms.values.get(field.name) ?? field.value}
          shown={forms.display?.get(field.name)}
          onChange={(v) => forms.onChange(field.name, v)}
          onCommit={(v) => forms.onCommit?.(field, v)}
          onButton={() => forms.onButton?.(field)}
          onClearImage={() => forms.onClearImage?.(field)}
        />
      ))}
    </div>
  )
}

interface Item {
  field: FormField
  widget: Widget
  index: number
  key: string
}

/** Design mode: each widget is a box with its name. Drag to move, drag the corner to resize, Delete removes it. */
function DesignLayer({ items, zoom, rotation, design }: { items: Item[]; zoom: number; rotation: Rotation; design: DesignProps }) {
  const [drag, setDrag] = useState<{ key: string; kind: 'move' | 'resize'; dx: number; dy: number; group?: ReadonlySet<string> } | null>(null)
  /** The box being dragged on the page background to select several widgets (layer pixels). */
  const [marquee, setMarquee] = useState<{ x: number; y: number; w: number; h: number } | null>(null)
  const root = useRef<HTMLDivElement>(null)
  const isSel = (it: Item) => design.selected?.name === it.field.name && design.selected.widget === it.index
  const isExtra = (it: Item) => !!design.extra?.has(`${it.field.name}#${it.index}`)

  const begin = (e: React.MouseEvent, it: Item, kind: 'move' | 'resize') => {
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    root.current?.focus({ preventScroll: true })
    if (kind === 'move' && (e.shiftKey || e.ctrlKey || e.metaKey) && design.onToggle) {
      design.onToggle({ name: it.field.name, widget: it.index })
      return
    }
    // Dragging one of several selected widgets moves them all; anything else selects just this one.
    const selectedKeys = new Set<string>([...(design.selected ? [`${design.selected.name}#${design.selected.widget}`] : []), ...(design.extra ?? [])])
    const group = kind === 'move' && selectedKeys.size > 1 && selectedKeys.has(it.key) && design.onPlaceMany ? new Set(items.filter((x) => selectedKeys.has(x.key)).map((x) => x.key)) : undefined
    if (!group) design.onSelect({ name: it.field.name, widget: it.index })
    const sx = e.clientX
    const sy = e.clientY
    let moved = false
    const delta = (ev: MouseEvent) => {
      const d = deltaToPage(rotation, ev.clientX - sx, ev.clientY - sy)
      return { dx: d.dx / zoom, dy: d.dy / zoom }
    }
    const move = (ev: MouseEvent) => {
      if (!moved && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 3) return
      moved = true
      setDrag({ key: it.key, kind, ...delta(ev), group })
    }
    const up = (ev: MouseEvent) => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      setDrag(null)
      if (!moved) {
        // A click (no drag) on one of several selected widgets narrows the selection to it.
        if (group) design.onSelect({ name: it.field.name, widget: it.index })
        return
      }
      const { dx, dy } = delta(ev)
      if (group) return design.onPlaceMany?.(it.widget.page, dx, dy)
      const r = it.widget.rect
      design.onPlace(it.field.name, it.index, kind === 'move' ? { ...r, x: r.x + dx, y: r.y + dy } : { ...r, w: Math.max(6, r.w + dx), h: Math.max(6, r.h + dy) })
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  const shown = (it: Item): Rect => {
    const r = it.widget.rect
    if (drag?.group?.has(it.key)) return { ...r, x: r.x + drag.dx, y: r.y + drag.dy }
    if (!drag || drag.key !== it.key) return r
    return drag.kind === 'move' ? { ...r, x: r.x + drag.dx, y: r.y + drag.dy } : { ...r, w: Math.max(6, r.w + drag.dx), h: Math.max(6, r.h + drag.dy) }
  }
  const sel = items.find(isSel)

  return (
    <div
      ref={root}
      className="form-layer design"
      tabIndex={-1}
      onMouseDown={(e) => {
        e.stopPropagation()
        if (e.target !== e.currentTarget) return
        design.onSelect(null)
        if (e.button !== 0 || !design.onSelectMany || !items.length) return
        // Drag a box over the page to select every widget it touches.
        const sx = e.clientX
        const sy = e.clientY
        const ox = e.nativeEvent.offsetX
        const oy = e.nativeEvent.offsetY
        let moved = false
        let last = { x: ox, y: oy }
        const toLayer = (ev: MouseEvent) => {
          const d = deltaToPage(rotation, ev.clientX - sx, ev.clientY - sy)
          return { x: ox + d.dx, y: oy + d.dy }
        }
        const box = (a: { x: number; y: number }, b: { x: number; y: number }) => ({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) })
        const move = (ev: MouseEvent) => {
          if (!moved && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 4) return
          moved = true
          last = toLayer(ev)
          setMarquee(box({ x: ox, y: oy }, last))
        }
        const up = () => {
          window.removeEventListener('mousemove', move)
          window.removeEventListener('mouseup', up)
          setMarquee(null)
          if (!moved) return
          const b = box({ x: ox, y: oy }, last)
          const area = { x: b.x / zoom, y: b.y / zoom, w: b.w / zoom, h: b.h / zoom }
          const hit = items.filter((it) => it.widget.rect.x < area.x + area.w && it.widget.rect.x + it.widget.rect.w > area.x && it.widget.rect.y < area.y + area.h && it.widget.rect.y + it.widget.rect.h > area.y)
          design.onSelectMany?.(hit.map((it) => ({ name: it.field.name, widget: it.index })))
        }
        window.addEventListener('mousemove', move)
        window.addEventListener('mouseup', up)
      }}
      onKeyDown={(e) => {
        if (!sel) return
        if (e.key === 'Delete' || e.key === 'Backspace') {
          e.preventDefault()
          design.onDelete(sel.field.name)
        } else if (e.key === 'Escape') design.onSelect(null)
        else if (e.key === 'Enter') design.onEdit(sel.field.name)
      }}
    >
      {items.map((it) => {
        const r = shown(it)
        return (
          <div
            key={it.key}
            role="button"
            tabIndex={0}
            aria-label={`Field ${it.field.name}${it.field.widgets.length > 1 ? ` (${it.index + 1})` : ''}`}
            aria-pressed={isSel(it) || isExtra(it)}
            className={`form-design-box${isSel(it) ? ' selected' : isExtra(it) ? ' selected multi' : ''}`}
            style={{ left: r.x * zoom, top: r.y * zoom, width: r.w * zoom, height: r.h * zoom }}
            onMouseDown={(e) => begin(e, it, 'move')}
            onDoubleClick={() => design.onEdit(it.field.name)}
            onKeyDown={(e) => e.key === 'Enter' && design.onSelect({ name: it.field.name, widget: it.index })}
          >
            <span className="form-design-name">{it.field.name}</span>
            {isSel(it) && <div className="resize-handle" aria-label="Resize field" onMouseDown={(e) => begin(e, it, 'resize')} />}
          </div>
        )
      })}
      {marquee && <div className="form-marquee" aria-hidden style={{ left: marquee.x, top: marquee.y, width: marquee.w, height: marquee.h }} />}
      {sel && !drag && (
        <div className="imageedit-bar" style={{ left: sel.widget.rect.x * zoom, top: Math.max(0, sel.widget.rect.y * zoom - 34) }} onMouseDown={(e) => e.stopPropagation()}>
          <button type="button" onClick={() => design.onEdit(sel.field.name)} title="Name, options and other properties (Enter)">
            <Settings2 size={14} aria-hidden /> Properties
          </button>
          <button type="button" onClick={() => design.onDelete(sel.field.name)} title="Delete this field (Delete)">
            <Trash2 size={14} aria-hidden /> Delete
          </button>
        </div>
      )}
    </div>
  )
}

function Control({
  field,
  widget,
  zoom,
  value,
  shown,
  onChange,
  onCommit,
  onButton,
  onClearImage
}: {
  field: FormField
  widget: Widget
  zoom: number
  value: FormValue
  shown?: string
  onChange: (v: FormValue) => void
  onCommit: (v: FormValue) => void
  onButton: () => void
  onClearImage?: () => void
}) {
  const [editing, setEditing] = useState(false)
  const box = useRef<HTMLInputElement & HTMLTextAreaElement>(null)
  // A field that shows a formatted value switches to what was entered when it gains focus: select that, as Acrobat does.
  const swaps = shown !== undefined && typeof value === 'string' && shown !== value
  useEffect(() => {
    if (editing && swaps) box.current?.select()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing])
  // A calculated field is worked out, not typed into.
  const locked = field.readOnly || !!field.scripts?.calculate
  const r = widget.rect
  const size = field.fontSize > 0 ? field.fontSize : Math.max(6, Math.min(12, r.h * 0.7))
  const style: React.CSSProperties = {
    left: r.x * zoom,
    top: r.y * zoom,
    width: r.w * zoom,
    height: r.h * zoom,
    fontSize: size * zoom,
    color: field.color,
    textAlign: field.align === 1 ? 'center' : field.align === 2 ? 'right' : 'left',
    ...(widget.background ? { background: widget.background } : {}),
    ...(widget.border ? { borderColor: widget.border } : {})
  }
  const cls = `form-widget ${field.type}${locked ? ' readonly' : ''}${field.required ? ' required' : ''}`
  const label = field.name

  if (field.type === 'text') {
    const text = typeof value === 'string' ? value : ''
    const dateForm = dateFormatOf(field)
    // While not being edited a field with a format script shows its formatted value; editing shows what was entered.
    // (A field that cannot be typed into is never being edited, even when it has focus.)
    const display = (!editing || locked) && shown !== undefined ? shown : text
    const focus = { onFocus: () => setEditing(true), onBlur: () => {
      setEditing(false)
      onCommit(text)
    } }
    if (field.multiline)
      return <textarea ref={box} className={cls} style={style} aria-label={label} value={display} readOnly={locked} maxLength={field.maxLength} spellCheck {...focus} onChange={(e) => onChange(e.target.value)} />
    const input = (
      <input ref={box} className={cls} style={style} aria-label={label} type={field.password ? 'password' : 'text'} value={display} readOnly={locked} maxLength={field.maxLength} spellCheck {...focus} onChange={(e) => onChange(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && onCommit(text)} />
    )
    if (!dateForm || locked) return input
    return (
      <>
        {input}
        <DatePicker
          name={label}
          style={style}
          current={parseDate(text, dateForm)}
          onPick={(d) => {
            const picked = formatDate(d, dateForm)
            onChange(picked)
            onCommit(picked)
          }}
        />
      </>
    )
  }
  if (field.type === 'checkbox') {
    return (
      <input
        className={cls}
        style={style}
        aria-label={label}
        type="checkbox"
        checked={value === true}
        disabled={locked}
        onChange={(e) => {
          onChange(e.target.checked)
          onCommit(e.target.checked)
        }}
      />
    )
  }
  if (field.type === 'radio') {
    const on = widget.onValue ?? ''
    return (
      <input
        className={cls}
        style={style}
        aria-label={`${label}: ${on}`}
        type="radio"
        name={`${field.name}-${widget.page}`}
        checked={value === on}
        disabled={locked}
        onChange={() => {
          onChange(on)
          onCommit(on)
        }}
      />
    )
  }
  if (field.type === 'dropdown') {
    const current = typeof value === 'string' ? value : ''
    const opts = field.options ?? []
    return (
      <select
        className={cls}
        style={style}
        aria-label={label}
        value={current}
        disabled={locked}
        onChange={(e) => {
          onChange(e.target.value)
          onCommit(e.target.value)
        }}
      >
        {!opts.includes(current) && <option value={current}>{current}</option>}
        {opts.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    )
  }
  if (field.type === 'list') {
    const current = Array.isArray(value) ? value : value ? [String(value)] : []
    return (
      <select
        className={cls}
        style={style}
        aria-label={label}
        multiple={field.multiSelect}
        size={Math.max(2, Math.floor(r.h / (size * 1.25)))}
        value={field.multiSelect ? current : (current[0] ?? '')}
        disabled={locked}
        onChange={(e) => {
          const v = field.multiSelect ? Array.from(e.target.selectedOptions, (o) => o.value) : [e.target.value]
          onChange(v)
          onCommit(v)
        }}
      >
        {(field.options ?? []).map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    )
  }
  if (field.type === 'signature') {
    return (
      <button type="button" className={cls} style={style} aria-label={`${label} (signature)`} title="Signature field" disabled>
        <Lock size={Math.max(8, size * zoom)} aria-hidden /> Signature
      </button>
    )
  }
  const picture = isImageField(field) && typeof value === 'string' && value.startsWith('data:image/') ? value : null
  const hasPicture = isImageField(field) && typeof value === 'string' && value !== ''
  const button = (
    <button
      type="button"
      className={`${cls}${isImageField(field) ? ' image-field' : ''}`}
      style={picture ? { ...style, backgroundImage: `url(${picture})`, backgroundSize: 'contain', backgroundRepeat: 'no-repeat', backgroundPosition: 'center' } : style}
      aria-label={label}
      title={field.tooltip || (isImageField(field) ? 'Click to choose a picture' : label)}
      onClick={onButton}
    >
      {picture ? '' : (widget.caption ?? label)}
    </button>
  )
  if (!hasPicture || locked || !onClearImage) return button
  const s = Math.max(14, Math.min(20, r.h * zoom * 0.5))
  return (
    <>
      {button}
      <button
        type="button"
        className="form-clear-btn"
        aria-label={`Clear the picture in ${label}`}
        title="Clear the picture"
        style={{ left: r.x * zoom + r.w * zoom - s - 1, top: r.y * zoom + 1, width: s, height: s }}
        onClick={onClearImage}
      >
        <X size={Math.max(8, s - 6)} aria-hidden />
      </button>
    </>
  )
}

/** A small calendar button at the right end of a date field; it opens the system date picker. */
function DatePicker({ name, style, current, onPick }: { name: string; style: React.CSSProperties; current: Date | null; onPick: (d: Date) => void }) {
  const input = useRef<HTMLInputElement>(null)
  const size = Math.min(Number(style.height) || 16, 22)
  return (
    <>
      <button
        type="button"
        className="form-date-btn"
        aria-label={`Pick a date for ${name}`}
        title="Pick a date"
        style={{ left: Number(style.left) + Number(style.width) - size - 1, top: Number(style.top) + (Number(style.height) - size) / 2, width: size, height: size }}
        onClick={() => {
          const el = input.current
          if (!el) return
          el.value = current ? toInputValue(current) : ''
          try {
            el.showPicker()
          } catch {
            el.focus()
          }
        }}
      >
        <CalendarDays size={Math.max(8, size - 6)} aria-hidden />
      </button>
      <input
        ref={input}
        type="date"
        className="form-date-input"
        aria-label={`Date for ${name}`}
        tabIndex={-1}
        style={{ left: Number(style.left), top: Number(style.top), width: Number(style.width), height: Number(style.height) }}
        onChange={(e) => {
          const d = fromInputValue(e.target.value)
          if (d) onPick(d)
        }}
      />
    </>
  )
}
