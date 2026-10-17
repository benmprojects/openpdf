import { useEffect, useMemo, useState } from 'react'
import { Modal } from './AppDialogs'
import { t } from './i18n'
import { batesLogCsv, countPages, numberFile, planNumbering, totalPages, type BatesFormat, type LogRow } from './batesMulti'
import type { HeaderFooterSpec } from './pageMarks'

interface Entry {
  path: string
  name: string
  pages: number | null
  error?: string
}

interface Props {
  /** Bates numbers or page numbers: what the preview shows. */
  mode: 'bates' | 'pagenumbers'
  /** Position, font, colour and the text of the mark, as set in the dialog this opened from. */
  template: Omit<HeaderFooterSpec, 'pages' | 'startNumber' | 'bates' | 'totalPages'>
  format: BatesFormat
  /** First page number (page numbering mode). */
  pageStart: number
  onClose: () => void
}

const baseName = (p: string) => p.split(/[\\/]/).pop() ?? p

/** Numbers several files as one run: the number carries on from file to file. */
export function BatesFilesDialog({ mode, template, format, pageStart, onClose }: Props) {
  const [files, setFiles] = useState<Entry[]>([])
  const [outDir, setOutDir] = useState('')
  const [suffix, setSuffix] = useState(mode === 'bates' ? '_bates' : '_numbered')
  const [running, setRunning] = useState(false)
  const [problem, setProblem] = useState('')
  const [log, setLog] = useState<LogRow[] | null>(null)
  const [status, setStatus] = useState('')

  const add = async (folders: boolean) => {
    const picked = await window.openpdf.batchPick(folders)
    if (!picked.length) return
    const found = folders ? await window.openpdf.batchExpand(picked, true) : picked
    setFiles((list) => {
      const have = new Set(list.map((f) => f.path))
      return [...list, ...found.filter((p) => !have.has(p)).map((path) => ({ path, name: baseName(path), pages: null }))]
    })
  }
  // Page counts for the preview, read once per file.
  useEffect(() => {
    let live = true
    void (async () => {
      for (const f of files) {
        if (f.pages !== null || f.error) continue
        let next: Partial<Entry>
        try {
          next = { pages: await countPages((await window.openpdf.batchRead(f.path)).data) }
        } catch (e) {
          next = { error: e instanceof Error ? e.message : String(e) }
        }
        if (!live) return
        setFiles((list) => list.map((x) => (x.path === f.path ? { ...x, ...next } : x)))
      }
    })()
    return () => {
      live = false
    }
  }, [files])

  const move = (i: number, d: -1 | 1) =>
    setFiles((list) => {
      const j = i + d
      if (j < 0 || j >= list.length) return list
      const next = [...list]
      ;[next[i], next[j]] = [next[j], next[i]]
      return next
    })

  const usable = files.filter((f) => f.pages !== null)
  const plan = useMemo(() => planNumbering(usable.map((f) => ({ name: f.name, pages: f.pages ?? 0 })), format, pageStart), [usable, format, pageStart]) // eslint-disable-line react-hooks/exhaustive-deps
  const planFor = (f: Entry) => (f.pages === null ? undefined : plan[usable.indexOf(f)])

  const run = async () => {
    setProblem('')
    if (!usable.length) return setProblem(t('Add the files to number.'))
    if (!outDir.trim()) return setProblem(t('Choose the folder for the results.'))
    setRunning(true)
    const rows: LogRow[] = []
    try {
      const grand = totalPages(usable.map((f) => ({ pages: f.pages ?? 0 })))
      let offset = 0
      for (const [i, f] of files.entries()) {
        if (f.pages === null) {
          rows.push({ source: f.name, output: '', pages: 0, first: '', last: '', error: f.error ?? t('Could not be read') })
          continue
        }
        setStatus(t('Numbering {n} of {total}: {name}', { n: i + 1, total: files.length, name: f.name }))
        try {
          const { data } = await window.openpdf.batchRead(f.path)
          const r = await numberFile(data, f.name, template, format, offset, pageStart, grand)
          const out = await window.openpdf.batchWrite(f.path, outDir.trim(), suffix, r.bytes)
          const p = planNumbering([{ name: f.name, pages: r.pages }], { ...format, start: format.start + offset }, pageStart + offset)[0]
          rows.push({ source: f.name, output: baseName(out), pages: r.pages, first: mode === 'bates' ? p.first : String(p.firstPage), last: mode === 'bates' ? p.last : String(p.lastPage) })
          offset += r.pages
        } catch (e) {
          // A file that fails leaves its numbers unused only in the log: the rest carry on from where the numbering stood.
          rows.push({ source: f.name, output: '', pages: 0, first: '', last: '', error: e instanceof Error ? e.message : String(e) })
        }
      }
      setLog(rows)
    } catch (e) {
      setProblem(e instanceof Error ? e.message : String(e))
    } finally {
      setRunning(false)
      setStatus('')
    }
  }

  const saveLog = async () => {
    if (log) await window.openpdf.saveData('numbering-log.csv', new TextEncoder().encode(batesLogCsv(log)), { name: 'CSV', ext: 'csv' })
  }

  return (
    <Modal title={t('Number several files')} onClose={running ? () => undefined : onClose} wide>
      <div className="marks-form batch">
        <section aria-label={t('Files to number')}>
          <h3>{t('1. Files, in numbering order')}</h3>
          <div className="batch-actionbar">
            <button type="button" onClick={() => void add(false)}>
              {t('Add files…')}
            </button>
            <button type="button" onClick={() => void add(true)}>
              {t('Add folder…')}
            </button>
          </div>
          <table className="bates-files" aria-label={t('Numbering preview')}>
            <thead>
              <tr>
                <th>{t('File')}</th>
                <th>{t('Pages')}</th>
                <th>{t('First')}</th>
                <th>{t('Last')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {files.map((f, i) => {
                const p = planFor(f)
                return (
                  <tr key={f.path}>
                    <td>{f.name}</td>
                    <td>{f.error ? <span className="error-text">{f.error}</span> : f.pages ?? '…'}</td>
                    <td data-testid="first">{p ? (mode === 'bates' ? p.first : p.firstPage) : ''}</td>
                    <td data-testid="last">{p ? (mode === 'bates' ? p.last : p.lastPage) : ''}</td>
                    <td>
                      <button type="button" aria-label={t('Move {name} up', { name: f.name })} disabled={i === 0} onClick={() => move(i, -1)}>
                        ↑
                      </button>
                      <button type="button" aria-label={t('Move {name} down', { name: f.name })} disabled={i === files.length - 1} onClick={() => move(i, 1)}>
                        ↓
                      </button>
                      <button type="button" aria-label={t('Remove {name}', { name: f.name })} onClick={() => setFiles((l) => l.filter((x) => x.path !== f.path))}>
                        ✕
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {!files.length && <p className="muted">{t('Add the files in the order the numbers should run.')}</p>}
        </section>
        <section aria-label={t('Where the results go')}>
          <h3>{t('2. Where the results go')}</h3>
          <div className="batch-actionbar">
            <input aria-label={t('Results folder')} value={outDir} onChange={(e) => setOutDir(e.target.value)} placeholder={t('Folder for the results')} />
            <button
              type="button"
              onClick={() =>
                void window.openpdf.pickFolder().then((d) => {
                  if (d) setOutDir(d)
                })
              }
            >
              {t('Browse…')}
            </button>
          </div>
          <label className="batch-field">
            <span>{t('Add to the name')}</span>
            <input aria-label={t('Name suffix')} value={suffix} onChange={(e) => setSuffix(e.target.value)} />
          </label>
          <p className="muted">{t('Originals are never changed, and an existing file is never overwritten (a number is added to the name instead).')}</p>
        </section>
        {problem && (
          <div role="alert" className="error-text">
            {problem}
          </div>
        )}
        {status && (
          <p role="status" className="muted">
            {status}
          </p>
        )}
        {log && (
          <section aria-label={t('Outcome')}>
            <h3>{t('Done: {n} of {total} files numbered', { n: log.filter((r) => !r.error).length, total: log.length })}</h3>
            <ul className="batch-results">
              {log.map((r, i) => (
                <li key={i} className={r.error ? 'std-fail' : 'std-pass'}>
                  {r.source}
                  <span className="muted"> {r.error ? r.error : `→ ${r.output} (${r.first} to ${r.last})`}</span>
                </li>
              ))}
            </ul>
            <button type="button" onClick={() => void saveLog()}>
              {t('Save the log (CSV)…')}
            </button>
          </section>
        )}
        <div className="marks-actions">
          <span style={{ flex: 1 }} />
          <button type="button" onClick={onClose} disabled={running}>
            {t('Close')}
          </button>
          <button className="primary" type="button" disabled={running} onClick={() => void run()}>
            {t('Number the files')}
          </button>
        </div>
      </div>
    </Modal>
  )
}
