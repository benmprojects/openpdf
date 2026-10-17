import { PDFDocument } from 'pdf-lib'
import { useEffect, useRef, useState } from 'react'
import type { CombineFile } from '../../preload'
import { combineFiles, pagesFor, type CombineIo } from './combine'
import { formatDay, formatSize, kindOf, moveItem, sortItems, type CombineItem, type SortBy } from './combineLogic'
import { t } from './i18n'
import { Frame } from './PageOpsDialogs'
import { PdfClient } from './pdfClient'

interface Row extends CombineItem {
  /** Pages in the file; null until known (Office files are only counted once converted). */
  pages: number | null
  error: string | null
}

let nextId = 1

const io: CombineIo = {
  read: (p) => window.openpdf.combineRead(p),
  office: (p) => window.openpdf.combineOffice(p),
  outline: async (pdf) => {
    const c = new PdfClient()
    try {
      await c.load(pdf)
      return await c.outline()
    } finally {
      c.dispose()
    }
  }
}

async function describe(f: CombineFile): Promise<Row | null> {
  const kind = kindOf(f.name)
  if (!kind) return null
  const row: Row = { id: `c${nextId++}`, name: f.name, path: f.path, kind, size: f.size, mtime: f.mtime, range: '', pages: kind === 'picture' ? 1 : null, error: null }
  if (kind === 'pdf') {
    try {
      row.pages = (await PDFDocument.load(await io.read(f.path), { updateMetadata: false })).getPageCount()
    } catch (e) {
      row.error = e instanceof Error && /encrypt/i.test(e.message) ? t('password protected: open it and remove the password first') : t('could not be read')
    }
  }
  return row
}

/** The Combine files dialog: PDFs, pictures and Office files in one list, in order, into one new PDF. */
export function CombineDialog({ onClose, onNewDoc, notify }: { onClose: () => void; onNewDoc: (name: string, data: Uint8Array) => void; notify: (n: { kind: 'error' | 'info'; text: string }) => void }) {
  const [rows, setRows] = useState<Row[]>([])
  const [perFile, setPerFile] = useState(true)
  const [keepOwn, setKeepOwn] = useState(false)
  const [pictureSize, setPictureSize] = useState<'a4' | 'image'>('a4')
  const [output, setOutput] = useState<'tab' | 'save'>('tab')
  const [by, setBy] = useState<{ by: SortBy | null; desc: boolean }>({ by: null, desc: false })
  const [office, setOffice] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const dragFrom = useRef<number | null>(null)

  useEffect(() => {
    void window.openpdf.officeAvailable().then(setOffice, () => setOffice(false))
  }, [])

  const add = async (files: CombineFile[]) => {
    const made = (await Promise.all(files.map(describe))).filter((r): r is Row => !!r)
    setRows((cur) => [...cur, ...made])
    setFailure(null)
  }
  const sort = (next: SortBy) => {
    const desc = by.by === next ? !by.desc : false
    setBy({ by: next, desc })
    setRows((cur) => sortItems(cur, next, desc))
  }

  let error: string | null = !rows.length ? t('Add at least one file to combine.') : null
  let pdfPages = 0
  for (const r of rows) {
    if (r.error) error ??= `${r.name}: ${r.error}.`
    else if (r.kind === 'office' && office === false) error ??= t('{name} needs LibreOffice to convert it, and that is not installed. Remove it or convert it to PDF first.', { name: r.name })
    else if (r.pages !== null) {
      const p = r.kind === 'picture' ? { pages: [0], error: null } : pagesFor(r.range, r.pages)
      if (p.error) error ??= `${r.name}: ${p.error}`
      pdfPages += p.pages.length
    }
  }
  const summary = t('{files} files, {pages} pages (Office files are counted once converted).', { files: rows.length, pages: pdfPages })

  const run = async () => {
    setBusy(true)
    setFailure(null)
    try {
      const out = await combineFiles(rows, { bookmarkPerFile: perFile, keepBookmarks: keepOwn, pictureSize }, io)
      if (output === 'save') {
        const saved = await window.openpdf.saveFileAs('Combined.pdf', out.bytes)
        if (!saved) return
        notify({ kind: 'info', text: t('Combined {n} pages into {name}.', { n: out.count, name: saved.name }) })
      } else {
        onNewDoc('Combined.pdf', out.bytes)
        notify({ kind: 'info', text: t('Combined {n} pages into a new document. Save it to keep it.', { n: out.count }) })
      }
      onClose()
    } catch (e) {
      setFailure(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const kindLabel = (k: Row['kind']) => (k === 'pdf' ? t('PDF') : k === 'picture' ? t('Picture') : t('Office'))

  return (
    <Frame title={t('Combine files')} ok={t('Combine')} error={busy ? t('Combining the files…') : (failure ?? error)} summary={summary} onClose={onClose} onOk={() => void run()} wide>
      <p className="pod-hint">{t('PDFs, pictures (PNG, JPEG, TIFF, GIF, BMP, WebP) and Office files go into one PDF in the order listed. Drag to reorder, or use the arrows.')}</p>
      <div className="pod-filelist">
        <div className="combine-bar">
          <button type="button" onClick={() => void window.openpdf.combinePick().then(add)}>
            {t('Add files…')}
          </button>
          <button type="button" onClick={() => void window.openpdf.combineFolder().then(add)}>
            {t('Add folder…')}
          </button>
          <button type="button" onClick={() => sort('name')} disabled={rows.length < 2}>
            {t('Sort by name')}
            {by.by === 'name' ? (by.desc ? ' ↓' : ' ↑') : ''}
          </button>
          <button type="button" onClick={() => sort('date')} disabled={rows.length < 2}>
            {t('Sort by date')}
            {by.by === 'date' ? (by.desc ? ' ↓' : ' ↑') : ''}
          </button>
          <button type="button" onClick={() => setRows([])} disabled={!rows.length}>
            {t('Clear list')}
          </button>
        </div>
        {rows.length > 0 && (
          <ul className="pod-files combine-files" aria-label={t('Files to combine')}>
            {rows.map((r, i) => (
              <li
                key={r.id}
                draggable
                aria-label={r.name}
                onDragStart={() => (dragFrom.current = i)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault()
                  const from = dragFrom.current
                  dragFrom.current = null
                  if (from !== null) setRows((cur) => moveItem(cur, from, i))
                }}
              >
                <span className="combine-grip" aria-hidden>
                  ⋮⋮
                </span>
                <span className="pod-file-name" title={`${r.name} (${formatSize(r.size)}, ${formatDay(r.mtime)})`}>
                  {r.name}
                </span>
                <span className="pod-hint">{kindLabel(r.kind)}</span>
                <span className="pod-hint">{r.error ? t('unreadable') : r.pages === null ? '…' : r.pages === 1 ? t('1 page') : t('{n} pages', { n: r.pages })}</span>
                <input
                  aria-label={t('Pages to take from {name}', { name: r.name })}
                  placeholder={r.kind === 'picture' ? '—' : t('All pages')}
                  value={r.range}
                  disabled={!!r.error || r.kind === 'picture'}
                  onChange={(e) => setRows((cur) => cur.map((x) => (x.id === r.id ? { ...x, range: e.target.value } : x)))}
                />
                <button type="button" aria-label={t('Move {name} up', { name: r.name })} disabled={i === 0} onClick={() => setRows((cur) => moveItem(cur, i, i - 1))}>
                  ↑
                </button>
                <button type="button" aria-label={t('Move {name} down', { name: r.name })} disabled={i === rows.length - 1} onClick={() => setRows((cur) => moveItem(cur, i, i + 1))}>
                  ↓
                </button>
                <button type="button" aria-label={t('Remove {name}', { name: r.name })} onClick={() => setRows((cur) => cur.filter((x) => x.id !== r.id))}>
                  {t('Remove')}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <label className="pod-check">
        <input type="checkbox" checked={perFile} onChange={(e) => setPerFile(e.target.checked)} /> {t('Add a bookmark for each file, named after it')}
      </label>
      <label className="pod-check">
        <input type="checkbox" checked={keepOwn} onChange={(e) => setKeepOwn(e.target.checked)} /> {t('Keep the bookmarks already in the PDFs')}
      </label>
      <label className="pod-field">
        <span>{t('Page size for pictures')}</span>
        <select aria-label={t('Page size for pictures')} value={pictureSize} onChange={(e) => setPictureSize(e.target.value as 'a4' | 'image')}>
          <option value="a4">{t('Fit to A4')}</option>
          <option value="image">{t('Original size')}</option>
        </select>
      </label>
      <label className="pod-field">
        <span>{t('Result')}</span>
        <select aria-label={t('Result')} value={output} onChange={(e) => setOutput(e.target.value as 'tab' | 'save')}>
          <option value="tab">{t('Open as a new document (not yet saved)')}</option>
          <option value="save">{t('Save to a file I choose')}</option>
        </select>
      </label>
      {office === false && rows.some((r) => r.kind === 'office') && <p className="pod-warn">{t('LibreOffice is not installed, so Office files cannot be converted.')}</p>}
    </Frame>
  )
}
