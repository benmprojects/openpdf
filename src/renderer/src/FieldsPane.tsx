import { useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, Pencil, Settings2, Trash2 } from 'lucide-react'
import { isImageField } from './formImage'
import { t } from './i18n'
import type { FormField } from './forms'

/** What a field is called in the list. */
export function fieldKindLabel(f: FormField): string {
  if (f.barcode) return t('Barcode')
  if (isImageField(f)) return t('Image')
  switch (f.type) {
    case 'text':
      return /AFDate_FormatEx/.test(f.scripts?.format ?? '') ? t('Date') : t('Text')
    case 'checkbox':
      return t('Check box')
    case 'radio':
      return t('Radio')
    case 'dropdown':
      return t('Drop-down')
    case 'list':
      return t('List box')
    case 'button':
      return t('Button')
    default:
      return t('Signature')
  }
}

export interface FieldRow {
  field: FormField
  /** Zero-based page of the first widget, or -1. */
  page: number
  order: number
}

/** The fields in the order they sit in the file's pages: by page, then the order of the page's annotations. */
export function fieldRows(fields: FormField[]): FieldRow[] {
  return fields
    .map((field) => ({ field, page: field.widgets[0]?.page ?? -1, order: field.widgets[0]?.order ?? 0 }))
    .sort((a, b) => (a.page < 0 ? 1e9 : a.page) - (b.page < 0 ? 1e9 : b.page) || a.order - b.order)
}

/** The Fields pane: every field with its type and page, to select, rename, delete or reorder for Tab. */
export function FieldsPane({
  fields,
  selected,
  labels,
  canEdit,
  onSelect,
  onRename,
  onDelete,
  onTabMove,
  onProperties
}: {
  fields: FormField[]
  selected: string | null
  /** Page labels (or null); pages are numbered from 1 otherwise. */
  labels: string[] | null
  canEdit: boolean
  onSelect: (name: string) => void
  onRename: (name: string, to: string) => void
  onDelete: (name: string) => void
  onTabMove: (name: string, dir: -1 | 1) => void
  onProperties: (name: string) => void
}) {
  const [filter, setFilter] = useState('')
  const [renaming, setRenaming] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [error, setError] = useState('')
  const rows = useMemo(() => fieldRows(fields).filter((r) => r.field.name.toLowerCase().includes(filter.trim().toLowerCase())), [fields, filter])
  const pageText = (p: number) => (p < 0 ? t('no page') : t('page {n}', { n: labels?.[p] || p + 1 }))
  const startRename = (name: string) => {
    setRenaming(name)
    setDraft(name)
    setError('')
  }

  const finishRename = (from: string) => {
    const to = draft.trim()
    if (to === from) return setRenaming(null)
    if (!to) return setError(t('Give the field a name.'))
    if (to.includes('.')) return setError(t('A field name cannot contain a full stop.'))
    if (fields.some((f) => f.name === to)) return setError(t('There is already a field called "{name}".', { name: to }))
    setRenaming(null)
    setError('')
    onRename(from, to)
  }

  return (
    <div className="fields-pane" aria-label={t('Fields')}>
      <div className="fields-tools">
        <input aria-label={t('Find a field')} placeholder={t('Find a field')} value={filter} onChange={(e) => setFilter(e.target.value)} />
        <span className="muted">{t('{n} fields', { n: fields.length })}</span>
      </div>
      {error && (
        <p className="error-text" role="alert" style={{ padding: '0 6px' }}>
          {error}
        </p>
      )}
      <ul className="fields-list" role="listbox" aria-label={t('Fields in this document')}>
        {rows.map(({ field: f, page }) => (
          <li key={f.name} role="option" aria-selected={selected === f.name} className={`fields-row${selected === f.name ? ' selected' : ''}`} onClick={() => onSelect(f.name)} onDoubleClick={() => canEdit && startRename(f.name)}>
            {renaming === f.name ? (
              <input
                className="fields-rename"
                aria-label={t('New name for {name}', { name: f.name })}
                value={draft}
                autoFocus
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={() => finishRename(f.name)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') finishRename(f.name)
                  else if (e.key === 'Escape') {
                    setRenaming(null)
                    setError('')
                  }
                }}
              />
            ) : (
              <span className="fields-name" title={f.name}>
                {f.name}
              </span>
            )}
            <span className="fields-meta">
              {fieldKindLabel(f)}, {pageText(page)}
              {f.widgets.length > 1 ? ` (${f.widgets.length})` : ''}
            </span>
          </li>
        ))}
        {!rows.length && (
          <li className="muted" style={{ padding: 8 }}>
            {fields.length ? t('No field matches.') : t('This document has no form fields.')}
          </li>
        )}
      </ul>
      <div className="fields-tools">
        <button type="button" disabled={!canEdit || !selected} onClick={() => selected && startRename(selected)} title={t('Rename the selected field')}>
          <Pencil size={14} aria-hidden /> {t('Rename')}
        </button>
        <button type="button" disabled={!canEdit || !selected} onClick={() => selected && onProperties(selected)} title={t('Name, options and other properties')}>
          <Settings2 size={14} aria-hidden /> {t('Properties')}
        </button>
        <button type="button" disabled={!canEdit || !selected} onClick={() => selected && onDelete(selected)} title={t('Delete the selected field')}>
          <Trash2 size={14} aria-hidden /> {t('Delete')}
        </button>
        <button type="button" disabled={!canEdit || !selected} onClick={() => selected && onTabMove(selected, -1)} title={t('Move the selected field earlier in the tab order')}>
          <ArrowUp size={14} aria-hidden /> {t('Earlier')}
        </button>
        <button type="button" disabled={!canEdit || !selected} onClick={() => selected && onTabMove(selected, 1)} title={t('Move the selected field later in the tab order')}>
          <ArrowDown size={14} aria-hidden /> {t('Later')}
        </button>
      </div>
    </div>
  )
}
