import { useMemo } from 'react'
import { Lock } from 'lucide-react'
import type { FormField, FormValue, Widget } from './forms'

export interface FormsView {
  fields: FormField[]
  /** Edited values by field name (a field not in here still has its value from the file). */
  values: ReadonlyMap<string, FormValue>
  onChange: (name: string, value: FormValue) => void
  /** Tint fields so they can be found. */
  highlight: boolean
}

/** The fields of one page, as real controls over the page image. */
export function FormLayer({ page, zoom, forms, interactive }: { page: number; zoom: number; forms: FormsView; interactive: boolean }) {
  const items = useMemo(() => forms.fields.flatMap((field) => field.widgets.map((widget, i) => ({ field, widget, key: `${field.name}#${i}` })).filter((x) => x.widget.page === page)), [forms.fields, page])
  if (!items.length) return null
  return (
    <div className={`form-layer${forms.highlight ? ' highlight' : ''}${interactive ? '' : ' inert'}`}>
      {items.map(({ field, widget, key }) => (
        <Control key={key} field={field} widget={widget} zoom={zoom} value={forms.values.get(field.name) ?? field.value} onChange={(v) => forms.onChange(field.name, v)} />
      ))}
    </div>
  )
}

function Control({ field, widget, zoom, value, onChange }: { field: FormField; widget: Widget; zoom: number; value: FormValue; onChange: (v: FormValue) => void }) {
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
    <button type="button" className={cls} style={style} aria-label={label} title={label}>
      {widget.caption ?? label}
    </button>
  )
}
