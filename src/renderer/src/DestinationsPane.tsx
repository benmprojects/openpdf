import { useEffect, useState } from 'react'
import { LocateFixed, Pencil, Trash2 } from 'lucide-react'
import { readDestinations, type Destination } from './destinations'
import { t } from './i18n'

interface Props {
  /** The document as it is now; the list is read again whenever it changes. */
  bytes: Uint8Array
  /** Page labels, to show "iv" where the page is numbered that way. */
  labels: string[] | null
  /** The document cannot be changed (owner restrictions) or is busy. */
  readOnly: boolean
  onGoTo: (d: Destination) => void
  /** Each returns an error message to show, or null when it worked. */
  onAdd: (name: string) => Promise<string | null>
  onRename: (from: string, to: string) => Promise<string | null>
  onDelete: (name: string) => Promise<string | null>
  onSetHere: (name: string) => Promise<string | null>
}

/** The Destinations pane: the document's named destinations, to go to, add (at the current view), rename and delete. */
export function DestinationsPane({ bytes, labels, readOnly, onGoTo, onAdd, onRename, onDelete, onSetHere }: Props) {
  const [list, setList] = useState<Destination[] | null>(null)
  const [draft, setDraft] = useState('')
  const [editing, setEditing] = useState<{ name: string; text: string } | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    readDestinations(bytes).then(
      (l) => !cancelled && setList(l),
      () => !cancelled && setList([])
    )
    return () => {
      cancelled = true
    }
  }, [bytes])

  const run = async (job: Promise<string | null>) => {
    setMessage(await job)
  }
  const pageName = (d: Destination) => (d.page < 0 ? t('no page') : t('page {n}', { n: labels?.[d.page] || String(d.page + 1) }))

  return (
    <div className="dest-pane">
      <form
        className="side-toolbar dest-add"
        onSubmit={(e) => {
          e.preventDefault()
          if (!draft.trim()) return
          void run(onAdd(draft.trim()).then((err) => (err ? err : (setDraft(''), null))))
        }}
      >
        <input aria-label={t('Name of the new destination')} placeholder={t('New destination name')} value={draft} maxLength={120} onChange={(e) => setDraft(e.target.value)} disabled={readOnly} />
        <button type="submit" disabled={readOnly || !draft.trim()} title={t('Add a destination at the top-left of what is on screen')}>
          {t('Add')}
        </button>
      </form>
      {message && (
        <p role="alert" className="error-text small" style={{ margin: '4px 8px' }}>
          {message}
        </p>
      )}
      {list === null ? (
        <p className="muted small" style={{ margin: 8 }}>
          {t('Looking for destinations…')}
        </p>
      ) : !list.length ? (
        <p className="muted small" style={{ margin: 8 }}>
          {t('This document has no named destinations. Type a name and press Add to name the place you are looking at.')}
        </p>
      ) : (
        <ul className="dest-list" aria-label={t('Named destinations')}>
          {list.map((d) => (
            <li key={d.name}>
              {editing?.name === d.name ? (
                <input
                  className="dest-rename"
                  aria-label={t('New name for {name}', { name: d.name })}
                  autoFocus
                  value={editing.text}
                  maxLength={120}
                  onChange={(e) => setEditing({ name: d.name, text: e.target.value })}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') setEditing(null)
                    else if (e.key === 'Enter') {
                      const to = editing.text.trim()
                      setEditing(null)
                      if (to && to !== d.name) void run(onRename(d.name, to))
                    }
                  }}
                  onBlur={() => setEditing(null)}
                />
              ) : (
                <button
                  type="button"
                  className="dest-go"
                  onClick={() => onGoTo(d)}
                  onKeyDown={(e) => {
                    if (e.key === 'F2' && !readOnly) setEditing({ name: d.name, text: d.name })
                    else if (e.key === 'Delete' && !readOnly) void run(onDelete(d.name))
                  }}
                  aria-label={t('Go to {name}', { name: d.name })}
                  title={t('Go to {name}', { name: d.name })}
                >
                  <span className="dest-name">{d.name}</span>
                  <span className="muted small">{pageName(d)}</span>
                </button>
              )}
              {!readOnly && editing?.name !== d.name && (
                <span className="dest-actions">
                  <button type="button" className="icon-btn" aria-label={t('Rename {name}', { name: d.name })} title={t('Rename (F2)')} onClick={() => setEditing({ name: d.name, text: d.name })}>
                    <Pencil size={14} strokeWidth={1.8} aria-hidden />
                  </button>
                  <button type="button" className="icon-btn" aria-label={t('Move {name} to the current view', { name: d.name })} title={t('Move this destination to the top-left of what is on screen')} onClick={() => void run(onSetHere(d.name))}>
                    <LocateFixed size={14} strokeWidth={1.8} aria-hidden />
                  </button>
                  <button type="button" className="icon-btn" aria-label={t('Delete {name}', { name: d.name })} title={t('Delete (Delete)')} onClick={() => void run(onDelete(d.name))}>
                    <Trash2 size={14} strokeWidth={1.8} aria-hidden />
                  </button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
