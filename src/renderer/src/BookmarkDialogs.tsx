import { useRef, useState } from 'react'
import { Modal } from './AppDialogs'
import { t } from './i18n'
import type { BookmarkNode } from './outlineEdit'
import { DEFAULT_HEADING_OPTIONS, detectHeadings, linesFromObjects, nestHeadings, pageBookmarks, type TextLine } from './outlineTools'
import type { PdfClient } from './pdfClient'

interface Props {
  client: PdfClient
  pageCount: number
  /** Page labels, when the document has them. */
  labels: string[] | null
  hasBookmarks: boolean
  /** `replace` is false to add the new bookmarks after the existing ones. */
  onGenerate: (tree: BookmarkNode[], replace: boolean) => void
  onClose: () => void
}

/** Make bookmarks from the headings in the text (by font size and weight), or one for each page. */
export function GenerateBookmarksDialog({ client, pageCount, labels, hasBookmarks, onGenerate, onClose }: Props) {
  const [source, setSource] = useState<'headings' | 'pages'>('headings')
  const [levels, setLevels] = useState(String(DEFAULT_HEADING_OPTIONS.maxLevels))
  const [bold, setBold] = useState(DEFAULT_HEADING_OPTIONS.includeBold)
  const [ratio, setRatio] = useState('15')
  const [useLabels, setUseLabels] = useState(!!labels)
  const [replace, setReplace] = useState(hasBookmarks)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const run = useRef(0)

  const generate = async () => {
    const id = ++run.current
    setBusy(true)
    setMessage('')
    try {
      let tree: BookmarkNode[]
      if (source === 'pages') tree = pageBookmarks(pageCount, useLabels ? labels : null, t('Page'))
      else {
        const lines: TextLine[] = []
        for (let p = 0; p < pageCount; p++) {
          if (id !== run.current) return
          try {
            lines.push(...linesFromObjects(p, (await client.textObjects(p)).objects))
          } catch {
            // A page that cannot be read adds no headings.
          }
        }
        tree = nestHeadings(
          detectHeadings(lines, pageCount, {
            maxLevels: Math.min(6, Math.max(1, Math.round(Number(levels)) || 3)),
            includeBold: bold,
            minRatio: 1 + Math.min(100, Math.max(1, Number(ratio) || 15)) / 100
          })
        )
      }
      if (id !== run.current) return
      if (!tree.length) {
        setMessage(t('No headings were found. Try a smaller size difference, or include bold lines.'))
        return
      }
      onGenerate(tree, replace)
      onClose()
    } finally {
      if (id === run.current) setBusy(false)
    }
  }

  return (
    <Modal title={t('Generate bookmarks')} onClose={onClose}>
      <div className="marks-form">
        <label className="inline">
          <input type="radio" name="bm-source" checked={source === 'headings'} onChange={() => setSource('headings')} /> {t('From headings in the text (font size and weight)')}
        </label>
        <div className="marks-row">
          <label className="inline">
            {t('Levels')} <input type="number" min={1} max={6} value={levels} disabled={source !== 'headings'} onChange={(e) => setLevels(e.target.value)} aria-label={t('Levels')} />
          </label>
          <label className="inline">
            {t('Heading at least this much larger than body text (%)')}
            <input type="number" min={1} max={100} value={ratio} disabled={source !== 'headings'} onChange={(e) => setRatio(e.target.value)} aria-label={t('Size difference percent')} />
          </label>
          <label className="inline">
            <input type="checkbox" checked={bold} disabled={source !== 'headings'} onChange={(e) => setBold(e.target.checked)} /> {t('Include short bold lines')}
          </label>
        </div>
        <label className="inline">
          <input type="radio" name="bm-source" checked={source === 'pages'} onChange={() => setSource('pages')} /> {t('One for each page')}
        </label>
        <label className="inline">
          <input type="checkbox" checked={useLabels && !!labels} disabled={source !== 'pages' || !labels} onChange={(e) => setUseLabels(e.target.checked)} /> {t('Name them from the page labels')}
        </label>
        {hasBookmarks && (
          <div className="marks-row">
            <label className="inline">
              <input type="radio" name="bm-replace" checked={replace} onChange={() => setReplace(true)} /> {t('Replace the existing bookmarks')}
            </label>
            <label className="inline">
              <input type="radio" name="bm-replace" checked={!replace} onChange={() => setReplace(false)} /> {t('Add after the existing bookmarks')}
            </label>
          </div>
        )}
        {message && (
          <p className="search-error small" role="alert">
            {message}
          </p>
        )}
        <div className="marks-actions">
          <button type="button" onClick={onClose}>
            {t('Cancel')}
          </button>
          <button className="primary" type="button" disabled={busy} onClick={() => void generate()}>
            {busy ? t('Reading…') : t('Generate')}
          </button>
        </div>
      </div>
    </Modal>
  )
}
