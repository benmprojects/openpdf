import { useState } from 'react'
import { Modal } from './AppDialogs'
import type { HiddenInfo, SanitiseOptions } from './sanitise'
import { t } from './i18n'

const ROWS: { key: keyof SanitiseOptions; label: string; plural: (n: number) => string }[] = [
  { key: 'metadata', label: 'Document properties and metadata', plural: () => 'author, title, dates, XMP' },
  { key: 'attachments', label: 'Attached files', plural: (n) => `${n} file${n === 1 ? '' : 's'}` },
  { key: 'javascript', label: 'JavaScript and actions', plural: (n) => `${n} script${n === 1 ? '' : 's'}` },
  { key: 'comments', label: 'Comments and markup', plural: (n) => `${n} annotation${n === 1 ? '' : 's'}` },
  { key: 'bookmarks', label: 'Bookmarks', plural: () => 'outline' },
  { key: 'thumbnails', label: 'Page thumbnails', plural: (n) => `${n} thumbnail${n === 1 ? '' : 's'}` }
]

/** Lists what the document carries that is not on its pages, and removes what is ticked. */
export function SanitiseDialog({ found, onApply, onClose }: { found: HiddenInfo; onApply: (o: SanitiseOptions) => void; onClose: () => void }) {
  const [pick, setPick] = useState<SanitiseOptions>({ metadata: true, attachments: true, javascript: true, comments: false, bookmarks: false, thumbnails: true })
  const present = ROWS.filter((r) => found[r.key] > 0)
  return (
    <Modal title={t('Remove hidden information')} onClose={onClose}>
      <form
        className="marks-form"
        onSubmit={(e) => {
          e.preventDefault()
          onApply(pick)
        }}
      >
        {present.length === 0 ? (
          <p>No hidden information was found in this document.</p>
        ) : (
          <>
            <p className="muted">This document carries the following that is not visible on its pages. Ticked items are removed for good once the file is saved.</p>
            <div className="marks-remove" role="group" aria-label="Hidden information">
              {present.map((r) => (
                <label key={r.key} className="inline">
                  <input type="checkbox" checked={pick[r.key]} onChange={(e) => setPick({ ...pick, [r.key]: e.target.checked })} /> {r.label} <span className="muted">({r.plural(found[r.key])})</span>
                </label>
              ))}
            </div>
          </>
        )}
        <div className="marks-actions">
          <span style={{ flex: 1 }} />
          <button type="button" onClick={onClose}>
            {present.length ? 'Cancel' : 'Close'}
          </button>
          {present.length > 0 && (
            <button className="primary" type="submit" disabled={!present.some((r) => pick[r.key])}>
              Remove
            </button>
          )}
        </div>
      </form>
    </Modal>
  )
}
