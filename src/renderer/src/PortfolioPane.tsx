import { useEffect, useState } from 'react'
import { Download, ExternalLink, File as FileIcon, Folder, FolderPlus, LayoutGrid, List, Pencil, Trash2, X } from 'lucide-react'
import type { AttachmentInfo } from './pdfClient'
import { addFolder, checkFolderName, moveToFolder, readPortfolio, removeFolder, renameFolder, type PortfolioInfo } from './portfolio'
import { thumbnailUrl } from './portfolioThumbs'
import { t } from './i18n'

interface Props {
  list: AttachmentInfo[]
  /** The document as it is now; the folders are read again whenever it changes. */
  bytes: Uint8Array
  readOnly: boolean
  /** The bytes of an attached file, for its thumbnail. */
  getData: (a: AttachmentInfo) => Promise<Uint8Array>
  onSave: (a: AttachmentInfo) => void
  onAdd?: () => void
  onRemove?: (a: AttachmentInfo) => void
  onSaveAll?: () => void
  openWith?: { can: (name: string) => boolean; run: (a: AttachmentInfo) => void }
  run: (fn: (base: Uint8Array) => Promise<Uint8Array | null>, done?: string) => Promise<void>
}

const size = (n: number) => (n < 0 ? t('size unknown') : n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`)

/** A picture of the first page of an embedded PDF (drawn when it is first shown); other files get an icon. */
function Thumb({ a, getData, big }: { a: AttachmentInfo; getData: () => Promise<Uint8Array>; big: boolean }) {
  const [url, setUrl] = useState<string | null>(null)
  const isPdf = /\.pdf$/i.test(a.name)
  useEffect(() => {
    if (!isPdf || a.size < 0) return
    let live = true
    thumbnailUrl(`${a.name}:${a.size}`, a.name, getData, big ? 160 : 64).then((u) => live && setUrl(u))
    return () => {
      live = false
    }
  }, [a.name, a.size, big]) // eslint-disable-line react-hooks/exhaustive-deps
  if (url) return <img className={big ? 'pf-thumb big' : 'pf-thumb'} src={url} alt={t('First page of {name}', { name: a.name })} />
  return <FileIcon className="side-list-icon" size={big ? 40 : 18} strokeWidth={1.6} aria-hidden />
}

/** The Attachments pane of a portfolio: the files in their folders, as a list or as thumbnails. */
export function PortfolioPane({ list, bytes, readOnly, getData, onSave, onAdd, onRemove, onSaveAll, openWith, run }: Props) {
  const [info, setInfo] = useState<PortfolioInfo | null>(null)
  const [view, setView] = useState<'list' | 'thumbs'>('list')
  const [draft, setDraft] = useState('')
  const [renaming, setRenaming] = useState<{ path: string; text: string } | null>(null)
  const [problem, setProblem] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    readPortfolio(bytes).then(
      (i) => live && setInfo(i),
      () => live && setInfo(null)
    )
    return () => {
      live = false
    }
  }, [bytes])

  const edit = async (job: (b: Uint8Array) => Promise<Uint8Array>, done: string) => {
    setProblem(null)
    try {
      await run(job, done)
    } catch (e) {
      setProblem(e instanceof Error ? e.message : String(e))
    }
  }

  const folders = info?.folders ?? []
  const inFolder = (path: string) => list.filter((a) => a.page === undefined && (info?.assign[a.name] ?? '') === path)
  const commentFiles = list.filter((a) => a.page !== undefined)
  const sections: { path: string; files: AttachmentInfo[] }[] = [{ path: '', files: inFolder('') }, ...folders.map((p) => ({ path: p, files: inFolder(p) }))]

  const fileRow = (a: AttachmentInfo) => {
    const big = view === 'thumbs'
    return (
      <li key={`${a.page ?? 'doc'}-${a.index}`} className={big ? 'pf-tile' : undefined}>
        <Thumb a={a} getData={() => getData(a)} big={big} />
        <span className="side-list-text">
          <span className="side-list-name" title={a.name}>
            {a.name}
          </span>
          <span className="muted small">
            {size(a.size)}
            {a.page !== undefined ? ` · ${t('on page {n}', { n: a.page + 1 })}` : ''}
          </span>
          {a.page === undefined && !readOnly && (
            <select className="pf-folder-select" aria-label={t('Folder for {name}', { name: a.name })} value={info?.assign[a.name] ?? ''} onChange={(e) => void edit((b) => moveToFolder(b, a.name, e.target.value), t('File moved'))}>
              <option value="">{t('Top level')}</option>
              {folders.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
          )}
        </span>
        {openWith?.can(a.name) && (
          <button className="icon-btn" onClick={() => openWith.run(a)} aria-label={t('Open {name} with its program', { name: a.name })} title={t('Open with the program set in Settings')}>
            <ExternalLink size={16} strokeWidth={1.8} aria-hidden />
          </button>
        )}
        <button className="icon-btn" onClick={() => onSave(a)} aria-label={`Save ${a.name}`} title="Save a copy of this file…">
          <Download size={16} strokeWidth={1.8} aria-hidden />
        </button>
        {onRemove && a.page === undefined && (
          <button className="icon-btn" onClick={() => onRemove(a)} aria-label={`Remove ${a.name}`} title="Remove this file from the document">
            <X size={16} strokeWidth={1.8} aria-hidden />
          </button>
        )}
      </li>
    )
  }

  return (
    <div className="portfolio-pane">
      <div className="side-toolbar">
        {onAdd && (
          <button type="button" onClick={onAdd}>
            Add files…
          </button>
        )}
        {onSaveAll && (
          <button type="button" onClick={onSaveAll} disabled={!list.length}>
            Save all…
          </button>
        )}
        <span style={{ flex: 1 }} />
        <button type="button" className="icon-btn" aria-pressed={view === 'list'} aria-label={t('List view')} title={t('List view')} onClick={() => setView('list')}>
          <List size={16} aria-hidden />
        </button>
        <button type="button" className="icon-btn" aria-pressed={view === 'thumbs'} aria-label={t('Thumbnail view')} title={t('Thumbnail view')} onClick={() => setView('thumbs')}>
          <LayoutGrid size={16} aria-hidden />
        </button>
      </div>
      {!readOnly && (
        <form
          className="side-toolbar pf-new-folder"
          onSubmit={(e) => {
            e.preventDefault()
            const bad = checkFolderName(draft)
            if (bad) return setProblem(t(bad))
            void edit((b) => addFolder(b, draft.trim()), t('Folder added')).then(() => setDraft(''))
          }}
        >
          <input aria-label={t('Name of the new folder')} placeholder={t('New folder name')} value={draft} maxLength={100} onChange={(e) => setDraft(e.target.value)} />
          <button type="submit" disabled={!draft.trim()} title={t('Add a folder to the portfolio')}>
            <FolderPlus size={14} aria-hidden /> {t('Add folder')}
          </button>
        </form>
      )}
      {problem && (
        <p role="alert" className="error-text small" style={{ margin: '4px 10px' }}>
          {problem}
        </p>
      )}
      {!list.length ? (
        <div className="side-empty">This document has no attached files.</div>
      ) : (
        <>
          <ul className={view === 'thumbs' ? 'side-list pf-grid' : 'side-list'} aria-label="Attached files">
            {sections[0].files.map(fileRow)}
            {commentFiles.map(fileRow)}
          </ul>
          {sections.slice(1).map(({ path, files }) => {
            const depth = path.split('/').length - 1
            const name = path.slice(path.lastIndexOf('/') + 1)
            return (
              <section key={path} className="pf-folder" aria-label={t('Folder {name}', { name: path })} style={{ marginLeft: depth * 12 }}>
                <div className="pf-folder-head">
                  <Folder size={16} aria-hidden />
                  {renaming?.path === path ? (
                    <form
                      className="pf-rename"
                      onSubmit={(e) => {
                        e.preventDefault()
                        const bad = checkFolderName(renaming.text)
                        if (bad) return setProblem(t(bad))
                        void edit((b) => renameFolder(b, path, renaming.text), t('Folder renamed')).then(() => setRenaming(null))
                      }}
                    >
                      <input aria-label={t('New name of folder {name}', { name: path })} value={renaming.text} maxLength={100} onChange={(e) => setRenaming({ path, text: e.target.value })} />
                      <button type="submit">{t('Rename')}</button>
                      <button type="button" onClick={() => setRenaming(null)}>
                        {t('Cancel')}
                      </button>
                    </form>
                  ) : (
                    <>
                      <strong className="pf-folder-name" title={path}>
                        {name}
                      </strong>
                      {!readOnly && (
                        <>
                          <button type="button" className="icon-btn" aria-label={t('Rename folder {name}', { name: path })} title={t('Rename the folder')} onClick={() => setRenaming({ path, text: name })}>
                            <Pencil size={14} aria-hidden />
                          </button>
                          <button type="button" className="icon-btn" aria-label={t('Remove folder {name}', { name: path })} title={t('Remove the folder: its files move up one level')} onClick={() => void edit((b) => removeFolder(b, path), t('Folder removed'))}>
                            <Trash2 size={14} aria-hidden />
                          </button>
                        </>
                      )}
                    </>
                  )}
                </div>
                {files.length ? (
                  <ul className={view === 'thumbs' ? 'side-list pf-grid' : 'side-list'} aria-label={t('Files in {name}', { name: path })}>
                    {files.map(fileRow)}
                  </ul>
                ) : (
                  <p className="muted small">{t('This folder is empty.')}</p>
                )}
              </section>
            )
          })}
        </>
      )}
    </div>
  )
}
