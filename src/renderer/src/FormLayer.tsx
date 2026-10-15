import { useMemo, useRef, useState } from 'react'
import { Lock, Settings2, Trash2 } from 'lucide-react'
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
}

export interface DesignProps {
  selected: { name: string; widget: number } | null
  onSelect: (s: { name: string; widget: number } | null) => void
  onPlace: (name: string, widget: number, rect: Rect) => void
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
        <Control key={key} field={field} widget={widget} zoom={zoom} value={forms.values.get(field.name) ?? field.value} onChange={(v) => forms.onChange(field.name, v)} onButton={() => forms.onButton?.(field)} />
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
  const [drag, setDrag] = useState<{ key: string; kind: 'move' | 'resize'; dx: number; dy: number } | null>(null)
  const root = useRef<HTMLDivElement>(null)
  const isSel = (it: Item) => design.selected?.name === it.field.name && design.selected.widget === it.index

  const begin = (e: React.MouseEvent, it: Item, kind: 'move' | 'resize') => {
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    design.onSelect({ name: it.field.name, widget: it.index })
    root.current?.focus({ preventScroll: true })
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
      setDrag({ key: it.key, kind, ...delta(ev) })
    }
    const up = (ev: MouseEvent) => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      setDrag(null)
      if (!moved) return
      const { dx, dy } = delta(ev)
      const r = it.widget.rect
      design.onPlace(it.field.name, it.index, kind === 'move' ? { ...r, x: r.x + dx, y: r.y + dy } : { ...r, w: Math.max(6, r.w + dx), h: Math.max(6, r.h + dy) })
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  const shown = (it: Item): Rect => {
    const r = it.widget.rect
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
        if (e.target === e.currentTarget) design.onSelect(null)
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
            aria-pressed={isSel(it)}
            className={`form-design-box${isSel(it) ? ' selected' : ''}`}
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

function Control({ field, widget, zoom, value, onChange, onButton }: { field: FormField; widget: Widget; zoom: number; value: FormValue; onChange: (v: FormValue) => void; onButton: () => void }) {
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
  const cls = `form-widget ${field.type}${field.readOnly ? ' readonly' : ''}${field.required ? ' required' : ''}`
  const label = field.name

  if (field.type === 'text') {
    const text = typeof value === 'string' ? value : ''
    return field.multiline ? (
      <textarea className={cls} style={style} aria-label={label} value={text} readOnly={field.readOnly} maxLength={field.maxLength} spellCheck onChange={(e) => onChange(e.target.value)} />
    ) : (
      <input className={cls} style={style} aria-label={label} type={field.password ? 'password' : 'text'} value={text} readOnly={field.readOnly} maxLength={field.maxLength} spellCheck onChange={(e) => onChange(e.target.value)} />
    )
  }
  if (field.type === 'checkbox') {
    return <input className={cls} style={style} aria-label={label} type="checkbox" checked={value === true} disabled={field.readOnly} onChange={(e) => onChange(e.target.checked)} />
  }
  if (field.type === 'radio') {
    const on = widget.onValue ?? ''
    return <input className={cls} style={style} aria-label={`${label}: ${on}`} type="radio" name={`${field.name}-${widget.page}`} checked={value === on} disabled={field.readOnly} onChange={() => onChange(on)} />
  }
  if (field.type === 'dropdown') {
    const current = typeof value === 'string' ? value : ''
    const opts = field.options ?? []
    return (
      <select className={cls} style={style} aria-label={label} value={current} disabled={field.readOnly} onChange={(e) => onChange(e.target.value)}>
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
        disabled={field.readOnly}
        onChange={(e) => onChange(field.multiSelect ? Array.from(e.target.selectedOptions, (o) => o.value) : [e.target.value])}
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
  return (
    <button type="button" className={cls} style={style} aria-label={label} title={field.tooltip || label} onClick={onButton}>
      {widget.caption ?? label}
    </button>
  )
}
