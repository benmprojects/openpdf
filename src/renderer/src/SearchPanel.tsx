import { ChevronDown, ChevronRight, FileText, FolderOpen, Search, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { searchFiles, type FileHit, type FileResult, type SearchSource } from './multiSearch'

export interface SearchJump {
  /** Changes on every request, so the same target can be jumped to twice. */
  key: number
  query: string
  matchCase: boolean
  wholeWord: boolean
  page: number
  from: number
}

interface Props {
  /** The documents open in tabs. */
  openDocs: SearchSource[]
  onOpenHit: (source: SearchSource, jump: Omit<SearchJump, 'key'>) => void
  onClose: () => void
}

/** Find text across many PDFs: the open documents, or every PDF in a folder. */
export function SearchPanel({ openDocs, onOpenHit, onClose }: Props) {
  const [query, setQuery] = useState('')
  const [matchCase, setMatchCase] = useState(false)
  const [wholeWord, setWholeWord] = useState(false)
  const [scope, setScope] = useState<'open' | 'folder'>(openDocs.length ? 'open' : 'folder')
  const [folder, setFolder] = useState<string | null>(null)
  const [subfolders, setSubfolders] = useState(true)
  const [results, setResults] = useState<FileResult[]>([])
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [collapsed, setCollapsed] = useState<ReadonlySet<number>>(new Set())
  const ctrl = useRef<AbortController | null>(null)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    input.current?.focus()
    return () => ctrl.current?.abort()
  }, [])

  const run = async () => {
    ctrl.current?.abort()
    const c = (ctrl.current = new AbortController())
    setResults([])
    setCollapsed(new Set())
    let sources: SearchSource[]
    if (scope === 'open') sources = openDocs
    else {
      if (!folder) return
      sources = (await window.openpdf.listPdfs(folder, subfolders)).map((p) => ({ name: p.slice(Math.max(p.lastIndexOf('\\'), p.lastIndexOf('/')) + 1), path: p }))
    }
    setProgress({ done: 0, total: sources.length })
    const opts = { matchCase, wholeWord }
    await searchFiles(
      sources,
      query,
      opts,
      (r, done) => {
        if (c.signal.aborted) return
        setProgress({ done, total: sources.length })
        if (r.hits.length || r.error) setResults((list) => [...list, r])
      },
      c.signal
    )
    if (!c.signal.aborted) setProgress((p) => (p ? { ...p, done: p.total } : p))
  }

  const pickFolder = async () => {
    const f = await window.openpdf.pickFolder()
    if (f) {
      setFolder(f)
      setScope('folder')
    }
  }

  const total = results.reduce((n, r) => n + r.hits.length, 0)
  const busy = progress !== null && progress.done < progress.total
  const canRun = !!query && (scope === 'open' ? openDocs.length > 0 : !!folder)

  return (
    <aside className="search-panel" aria-label="Search in files">
      <div className="search-panel-head">
        <Search size={16} strokeWidth={1.8} aria-hidden />
        <h2>Search in files</h2>
        <button className="icon-btn" onClick={onClose} aria-label="Close search in files" title="Close">
          <X size={16} strokeWidth={1.8} aria-hidden />
        </button>
      </div>
      <form
        className="search-panel-form"
        onSubmit={(e) => {
          e.preventDefault()
          if (canRun) void run()
        }}
      >
        <input ref={input} type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Text to find" aria-label="Text to find in files" />
        <div className="search-panel-row">
          <label>
            <input type="radio" name="scope" checked={scope === 'open'} disabled={!openDocs.length} onChange={() => setScope('open')} /> Open documents ({openDocs.length})
          </label>
        </div>
        <div className="search-panel-row">
          <label>
            <input type="radio" name="scope" checked={scope === 'folder'} onChange={() => setScope('folder')} /> Folder
          </label>
          <button type="button" className="btn" onClick={() => void pickFolder()}>
            <FolderOpen size={15} strokeWidth={1.8} aria-hidden />
            Choose…
          </button>
        </div>
        {folder && (
          <div className="search-panel-folder muted small" title={folder}>
            {folder}
          </div>
        )}
        <div className="search-panel-row">
          <label>
            <input type="checkbox" checked={subfolders} onChange={(e) => setSubfolders(e.target.checked)} disabled={scope !== 'folder'} /> Include subfolders
          </label>
        </div>
        <div className="search-panel-row">
          <label>
            <input type="checkbox" checked={matchCase} onChange={(e) => setMatchCase(e.target.checked)} /> Match case
          </label>
          <label>
            <input type="checkbox" checked={wholeWord} onChange={(e) => setWholeWord(e.target.checked)} /> Whole word
          </label>
        </div>
        <div className="search-panel-row">
          <button className="primary" type="submit" disabled={!canRun}>
            Search
          </button>
          {busy && (
            <button type="button" className="btn" onClick={() => ctrl.current?.abort()}>
              Stop
            </button>
          )}
        </div>
      </form>
      <div className="search-panel-status muted small" aria-live="polite">
        {progress &&
          (busy
            ? `Searching ${progress.done} of ${progress.total} files… ${total} matches so far`
            : `${total} match${total === 1 ? '' : 'es'} in ${results.filter((r) => r.hits.length).length} of ${progress.total} files`)}
      </div>
      <ul className="search-results" aria-label="Search results">
        {results.map((r, i) => {
          const closed = collapsed.has(i)
          return (
            <li key={i}>
              <button
                className="search-file"
                onClick={() => setCollapsed((c) => (c.has(i) ? new Set([...c].filter((x) => x !== i)) : new Set(c).add(i)))}
                aria-expanded={!closed}
                title={r.source.path ?? r.source.name}
              >
                {closed ? <ChevronRight size={14} aria-hidden /> : <ChevronDown size={14} aria-hidden />}
                <FileText size={15} strokeWidth={1.7} className="recent-icon" aria-hidden />
                <span className="search-file-name">{r.source.name}</span>
                <span className="muted small">{r.error ? '' : `${r.hits.length}${r.truncated ? '+' : ''}`}</span>
              </button>
              {r.error && <div className="search-error small">{r.error}</div>}
              {!closed && (
                <ul>
                  {r.hits.map((h: FileHit, k) => (
                    <li key={k}>
                      <button
                        className="search-hit"
                        onClick={() => onOpenHit(r.source, { query, matchCase, wholeWord, page: h.page, from: h.from })}
                        title={`Page ${h.page + 1}`}
                      >
                        <span className="search-hit-page">p. {h.page + 1}</span>
                        <span className="search-hit-text">
                          {h.before}
                          <mark>{h.match}</mark>
                          {h.after}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          )
        })}
      </ul>
    </aside>
  )
}
