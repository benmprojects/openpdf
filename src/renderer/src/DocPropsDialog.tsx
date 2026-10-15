import { useState } from 'react'
import { Modal } from './AppDialogs'
import { formatSize } from './OptimiseDialog'
import type { DocProps } from './metadata'
import { t } from './i18n'

/** The ISO string as the value of a datetime-local input (local time), and back. */
const toLocal = (iso: string) => {
  const d = new Date(iso)
  if (!iso || Number.isNaN(d.getTime())) return ''
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}
const fromLocal = (v: string) => (v ? new Date(v).toISOString() : '')
/** DD/MM/YYYY, 24-hour. */
const show = (iso: string) => (iso && !Number.isNaN(new Date(iso).getTime()) ? new Date(iso).toLocaleString('en-AU', { hour12: false }) : 'not set')

/** Document properties: the Info entries (and matching XMP), file facts, and removal of all metadata. */
export function DocPropsDialog({
  initial,
  fileName,
  pageCount,
  size,
  onApply,
  onRemove,
  onClose
}: {
  initial: DocProps
  fileName: string
  pageCount: number
  size: number
  onApply: (p: DocProps) => void
  onRemove: () => void
  onClose: () => void
}) {
  const [p, setP] = useState(initial)
  const text = (key: 'title' | 'author' | 'subject' | 'keywords' | 'creator' | 'producer', label: string) => (
    <label className="props-row">
      <span>{label}</span>
      <input aria-label={label} value={p[key]} onChange={(e) => setP({ ...p, [key]: e.target.value })} />
    </label>
  )
  return (
    <Modal title={t('Document properties')} onClose={onClose}>
      <form
        className="marks-form props-form"
        onSubmit={(e) => {
          e.preventDefault()
          onApply({ ...p, modified: new Date().toISOString() })
        }}
      >
        <p className="muted">
          {fileName} · {pageCount} page{pageCount === 1 ? '' : 's'} · {formatSize(size)}
        </p>
        {text('title', 'Title')}
        {text('author', 'Author')}
        {text('subject', 'Subject')}
        {text('keywords', 'Keywords')}
        {text('creator', 'Application')}
        {text('producer', 'PDF producer')}
        <label className="props-row">
          <span>Created</span>
          <input type="datetime-local" aria-label="Created" value={toLocal(p.created)} onChange={(e) => setP({ ...p, created: fromLocal(e.target.value) })} />
        </label>
        <p className="muted">Last modified: {show(initial.modified)}. Saving the properties sets it to now.</p>
        <div className="marks-actions">
          <button type="button" onClick={onRemove} title="Remove the title, author and every other piece of document information, including XMP">
            Remove all metadata
          </button>
          <span style={{ flex: 1 }} />
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="primary" type="submit">
            Apply
          </button>
        </div>
      </form>
    </Modal>
  )
}
