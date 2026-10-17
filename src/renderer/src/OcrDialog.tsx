import { useEffect, useState } from 'react'
import { Modal } from './AppDialogs'
import { t } from './i18n'

export interface OcrRequest {
  languages: string[]
  scope: 'blank' | 'all' | 'current'
  dpi: 200 | 300 | 400
  /** Invisible text over the scan (searchable), or visible text with the scan taken out (replace). */
  output: 'searchable' | 'replace'
}

/** Text recognition: languages, which pages, and resolution. */
export function OcrDialog({ pageCount, currentPage, onRun, onClose }: { pageCount: number; currentPage: number; onRun: (r: OcrRequest) => void; onClose: () => void }) {
  const [all, setAll] = useState<[string, string][]>([['eng', 'English']])
  const [installed, setInstalled] = useState<string[]>(['eng'])
  const [first, setFirst] = useState('eng')
  const [second, setSecond] = useState('')
  const [scope, setScope] = useState<OcrRequest['scope']>('blank')
  const [dpi, setDpi] = useState<OcrRequest['dpi']>(300)
  const [output, setOutput] = useState<OcrRequest['output']>('searchable')

  useEffect(() => {
    let live = true
    void window.openpdf.ocrLanguages().then((l) => {
      if (!live) return
      setAll(l.all)
      setInstalled(l.installed)
    })
    return () => {
      live = false
    }
  }, [])

  const chosen = [first, second].filter(Boolean).filter((l, i, a) => a.indexOf(l) === i)
  const needDownload = chosen.filter((l) => !installed.includes(l))
  const options = (skip?: string) =>
    all
      .filter(([c]) => c !== skip)
      .map(([c, n]) => (
        <option key={c} value={c}>
          {n}
          {installed.includes(c) ? '' : ' (downloads on first use)'}
        </option>
      ))

  return (
    <Modal title={t('Recognise text (OCR)')} onClose={onClose}>
      <form
        className="marks-form props-form"
        onSubmit={(e) => {
          e.preventDefault()
          onRun({ languages: chosen, scope, dpi, output })
        }}
      >
        <p className="muted">Finds the words in scanned pages and adds them as invisible text, so the pages can be searched and copied. The pages look the same afterwards.</p>
        <label className="props-row">
          <span>Language</span>
          <select aria-label="Language" value={first} onChange={(e) => setFirst(e.target.value)}>
            {options()}
          </select>
        </label>
        <label className="props-row">
          <span>Second language</span>
          <select aria-label="Second language" value={second} onChange={(e) => setSecond(e.target.value)}>
            <option value="">None</option>
            {options(first)}
          </select>
        </label>
        <label className="props-row">
          <span>Pages</span>
          <select aria-label="Pages" value={scope} onChange={(e) => setScope(e.target.value as OcrRequest['scope'])}>
            <option value="blank">Pages that have no text yet</option>
            <option value="all">All {pageCount} page{pageCount === 1 ? '' : 's'}</option>
            <option value="current">Page {currentPage + 1} only</option>
          </select>
        </label>
        <label className="props-row">
          <span>Quality</span>
          <select aria-label="Quality" value={dpi} onChange={(e) => setDpi(Number(e.target.value) as OcrRequest['dpi'])}>
            <option value={200}>Faster (200 dpi)</option>
            <option value={300}>Standard (300 dpi)</option>
            <option value={400}>Small print (400 dpi)</option>
          </select>
        </label>
        <label className="props-row">
          <span>{t('Output')}</span>
          <select aria-label={t('Output')} value={output} onChange={(e) => setOutput(e.target.value as OcrRequest['output'])}>
            <option value="searchable">{t('Searchable image: keep the scan, add invisible text')}</option>
            <option value="replace">{t('Replace the scan with the recognised text')}</option>
          </select>
        </label>
        {output === 'replace' && <p className="muted">{t('The page picture is taken out and the recognised words are drawn as visible text in a standard font. The page is then only as good as the recognition: check it. You can undo this until you save.')}</p>}
        {needDownload.length > 0 && <p className="muted">The language data for {needDownload.map((l) => all.find(([c]) => c === l)?.[1] ?? l).join(' and ')} is downloaded once from the internet (a few megabytes) and kept on this computer.</p>}
        <div className="marks-actions">
          <span style={{ flex: 1 }} />
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="primary" type="submit">
            Recognise
          </button>
        </div>
      </form>
    </Modal>
  )
}
