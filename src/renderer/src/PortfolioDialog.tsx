import { useEffect, useState } from 'react'
import { Modal } from './AppDialogs'
import { checkFolderName, cleanFolderPath, type FileThumb } from './portfolio'
import { thumbToDataUrl, thumbnailOf } from './portfolioThumbs'
import { t } from './i18n'

export interface PortfolioChoices {
  /** How a portfolio viewer first lists the files. */
  view: 'D' | 'T'
  /** File name to folder path (only the files that are in a folder). */
  folders: Record<string, string>
  /** Pictures of the first page of each PDF. */
  thumbs: Record<string, FileThumb>
}

/** Title, cover text, folders and first view for a portfolio made from the chosen files. */
export function PortfolioDialog({ files, onCreate, onClose }: { files: { name: string; data: Uint8Array }[]; onCreate: (title: string, cover: string, choices: PortfolioChoices) => void; onClose: () => void }) {
  const [title, setTitle] = useState('Portfolio')
  const [cover, setCover] = useState('')
  const [view, setView] = useState<'D' | 'T'>('D')
  const [folders, setFolders] = useState<Record<string, string>>({})
  const [thumbs, setThumbs] = useState<Record<string, FileThumb>>({})
  const [urls, setUrls] = useState<Record<string, string>>({})

  // Pictures of the PDFs, drawn one after another (each file has its own PDFium worker while it is drawn).
  useEffect(() => {
    let live = true
    void (async () => {
      for (const f of files.slice(0, 40)) {
        if (!live) return
        const th = await thumbnailOf(f.name, f.data).catch(() => null)
        if (th && live) {
          setThumbs((old) => ({ ...old, [f.name]: th }))
          setUrls((old) => ({ ...old, [f.name]: thumbToDataUrl(th) }))
        }
      }
    })()
    return () => {
      live = false
    }
  }, [files])

  const problems = Object.values(folders)
    .flatMap((p) => cleanFolderPath(p).split('/').filter(Boolean))
    .map(checkFolderName)
    .filter(Boolean)
  const valid = problems.length === 0

  return (
    <Modal title={t('Create a portfolio')} onClose={onClose}>
      <form
        className="marks-form props-form"
        onSubmit={(e) => {
          e.preventDefault()
          if (!valid) return
          const clean: Record<string, string> = {}
          for (const [k, v] of Object.entries(folders)) {
            const p = cleanFolderPath(v)
            if (p) clean[k] = p
          }
          onCreate(title.trim() || 'Portfolio', cover, { view, folders: clean, thumbs })
        }}
      >
        <p className="muted">
          {files.length} file{files.length === 1 ? '' : 's'} will be packaged in one PDF. Viewers that support portfolios show the files first; others show the cover page.
        </p>
        <label className="props-row">
          <span>Title</span>
          <input aria-label="Portfolio title" value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label className="props-row">
          <span>Cover text</span>
          <textarea aria-label="Cover text" rows={3} value={cover} onChange={(e) => setCover(e.target.value)} placeholder="Shown on the first page (optional)" />
        </label>
        <label className="props-row">
          <span>{t('Viewers open it as')}</span>
          <select aria-label={t('First view')} value={view} onChange={(e) => setView(e.target.value as 'D' | 'T')}>
            <option value="D">{t('A list of files (details)')}</option>
            <option value="T">{t('Tiles with pictures')}</option>
          </select>
        </label>
        <fieldset className="pf-files">
          <legend>{t('Files and folders')}</legend>
          <ul className="pf-dialog-list" aria-label={t('Files in the portfolio')}>
            {files.map((f) => (
              <li key={f.name}>
                {urls[f.name] ? <img className="pf-thumb" src={urls[f.name]} alt={t('First page of {name}', { name: f.name })} /> : <span className="pf-thumb blank" aria-hidden />}
                <span className="pf-dialog-name" title={f.name}>
                  {f.name}
                </span>
                <input aria-label={t('Folder for {name}', { name: f.name })} placeholder={t('Folder (optional), e.g. Drawings/Civil')} value={folders[f.name] ?? ''} onChange={(e) => setFolders({ ...folders, [f.name]: e.target.value })} />
              </li>
            ))}
          </ul>
        </fieldset>
        {!valid && (
          <p role="alert" className="error-text small">
            {problems[0]}
          </p>
        )}
        <div className="marks-actions">
          <span style={{ flex: 1 }} />
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="primary" type="submit" disabled={!valid}>
            Create
          </button>
        </div>
      </form>
    </Modal>
  )
}
