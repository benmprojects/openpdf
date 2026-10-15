import { useState } from 'react'
import { Modal } from './AppDialogs'
import { t } from './i18n'

/** Title and cover text for a portfolio made from the chosen files. */
export function PortfolioDialog({ files, onCreate, onClose }: { files: string[]; onCreate: (title: string, cover: string) => void; onClose: () => void }) {
  const [title, setTitle] = useState('Portfolio')
  const [cover, setCover] = useState('')
  return (
    <Modal title={t('Create a portfolio')} onClose={onClose}>
      <form
        className="marks-form props-form"
        onSubmit={(e) => {
          e.preventDefault()
          onCreate(title.trim() || 'Portfolio', cover)
        }}
      >
        <p className="muted">
          {files.length} file{files.length === 1 ? '' : 's'} will be packaged in one PDF: {files.slice(0, 5).join(', ')}
          {files.length > 5 ? '…' : ''}. Viewers that support portfolios show the files first; others show the cover page.
        </p>
        <label className="props-row">
          <span>Title</span>
          <input aria-label="Portfolio title" value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label className="props-row">
          <span>Cover text</span>
          <textarea aria-label="Cover text" rows={4} value={cover} onChange={(e) => setCover(e.target.value)} placeholder="Shown on the first page (optional)" />
        </label>
        <div className="marks-actions">
          <span style={{ flex: 1 }} />
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="primary" type="submit">
            Create
          </button>
        </div>
      </form>
    </Modal>
  )
}
