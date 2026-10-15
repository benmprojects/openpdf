import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { PdfClient, type OutlineNode, type PageSize } from './pdfClient'
import { Sidebar, type SidebarTab } from './Sidebar'
import { PAD, Viewer, type ViewerHandle } from './Viewer'
import { findInPage, type Match } from './textLogic'

type ZoomMode = 'fit-width' | 'fit-page' | number

const ZOOM_STEPS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4, 8]
const MIN_ZOOM = 0.1
const MAX_ZOOM = 8
const MAX_MATCHES = 5000

interface Props {
  data: Uint8Array
  active: boolean
}

export function DocView({ data, active }: Props) {
  const [client, setClient] = useState<PdfClient | null>(null)
  const [pages, setPages] = useState<PageSize[]>([])
  const [error, setError] = useState<string | null>(null)
  const [outline, setOutline] = useState<OutlineNode[] | null>(null)
  const [password, setPassword] = useState<string | undefined>()
  const [passwordIssue, setPasswordIssue] = useState<'required' | 'wrong' | null>(null)
  const [passwordDraft, setPasswordDraft] = useState('')
  const [tool, setTool] = useState<'select' | 'hand'>('select')

  const [mode, setMode] = useState<ZoomMode>('fit-width')
  const [size, setSize] = useState({ w: 0, h: 0 })
  const [currentPage, setCurrentPage] = useState(0)
  const [sidebar, setSidebar] = useState<SidebarTab | null>('pages')
  const viewer = useRef<ViewerHandle>(null)

  useEffect(() => {
    const c = new PdfClient()
    let cancelled = false
    c.load(data, password)
      .then((p) => {
        if (cancelled) return
        setPasswordIssue(null)
        setPages(p)
        setClient(c)
        c.outline()
          .then((o) => !cancelled && setOutline(o))
          .catch(() => !cancelled && setOutline([]))
      })
      .catch((e: Error) => {
        if (cancelled) return
        if (/password/i.test(e.message)) setPasswordIssue(password ? 'wrong' : 'required')
        else setError(`Could not open this PDF: ${e.message}`)
      })
    return () => {
      cancelled = true
      c.dispose()
    }
  }, [data, password])

  const onSize = useCallback((w: number, h: number) => setSize((s) => (s.w === w && s.h === h ? s : { w, h })), [])

  const zoom = useMemo(() => {
    if (typeof mode === 'number') return mode
    if (!pages.length || !size.w) return 1
    const maxW = Math.max(...pages.map((p) => p.width))
    const maxH = Math.max(...pages.map((p) => p.height))
    const byWidth = (size.w - 2 * PAD) / maxW
    const z = mode === 'fit-width' ? byWidth : Math.min(byWidth, (size.h - 2 * PAD) / maxH)
    return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z))
  }, [mode, pages, size])

  const stepZoom = useCallback(
    (dir: 1 | -1) => {
      const next =
        dir > 0
          ? ZOOM_STEPS.find((s) => s > zoom + 0.005) ?? MAX_ZOOM
          : [...ZOOM_STEPS].reverse().find((s) => s < zoom - 0.005) ?? MIN_ZOOM
      setMode(next)
    },
    [zoom]
  )

  const goTo = useCallback((i: number) => viewer.current?.scrollToPage(i), [])

  // ---- Search ---------------------------------------------------------------------------------------
  const [searchOpen, setSearchOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [matchCase, setMatchCase] = useState(false)
  const [wholeWord, setWholeWord] = useState(false)
  const [matches, setMatches] = useState<Match[]>([])
  const [current, setCurrent] = useState(-1)
  const [searching, setSearching] = useState(false)
  const searchInput = useRef<HTMLInputElement>(null)
  const runId = useRef(0)
  const matchesRef = useRef(matches)
  matchesRef.current = matches
  const currentRef = useRef(current)
  currentRef.current = current

  useEffect(() => {
    if (!client || !searchOpen || !query) {
      setMatches([])
      setCurrent(-1)
      setSearching(false)
      return
    }
    const run = ++runId.current
    setSearching(true)
    const timer = setTimeout(async () => {
      const all: Match[] = []
      let jumped = false
      for (let p = 0; p < pages.length; p++) {
        if (run !== runId.current) return
        try {
          all.push(...findInPage(await client.pageText(p), p, query, matchCase, wholeWord))
        } catch {
          continue // a page that fails to parse is skipped rather than ending the search
        }
        if (run !== runId.current) return
        if (all.length >= MAX_MATCHES) break
        if (all.length && !jumped) {
          jumped = true
          setMatches([...all])
          setCurrent(0)
          viewer.current?.scrollToMatch(all[0])
        } else if (p % 25 === 0) {
          setMatches([...all])
        }
      }
      if (run !== runId.current) return
      setMatches(all)
      if (!all.length) setCurrent(-1)
      setSearching(false)
    }, 200)
    return () => {
      clearTimeout(timer)
      runId.current++
    }
  }, [client, searchOpen, query, matchCase, wholeWord, pages.length])

  const stepMatch = useCallback((dir: 1 | -1) => {
    const list = matchesRef.current
    if (!list.length) return
    const next = (currentRef.current + dir + list.length) % list.length
    setCurrent(next)
    viewer.current?.scrollToMatch(list[next])
  }, [])

  const openSearch = useCallback(() => {
    setSearchOpen(true)
    requestAnimationFrame(() => {
      searchInput.current?.focus()
      searchInput.current?.select()
    })
  }, [])

  // ---- Keyboard -------------------------------------------------------------------------------------
  useEffect(() => {
    if (!active) return
    const onKey = (e: KeyboardEvent) => {
      const inField = e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement
      const ctrl = e.ctrlKey || e.metaKey
      if (ctrl && e.key.toLowerCase() === 'f') {
        e.preventDefault()
        openSearch()
      } else if (e.key === 'F3' || (ctrl && e.key.toLowerCase() === 'g')) {
        e.preventDefault()
        stepMatch(e.shiftKey ? -1 : 1)
      } else if (e.key === 'Escape') {
        if (searchOpen) setSearchOpen(false)
        else viewer.current?.clearSelection()
      } else if (ctrl && e.key.toLowerCase() === 'c' && !inField && viewer.current?.hasSelection()) {
        e.preventDefault()
        void viewer.current.copySelection()
      } else if (ctrl && (e.key === '=' || e.key === '+')) {
        e.preventDefault()
        stepZoom(1)
      } else if (ctrl && e.key === '-') {
        e.preventDefault()
        stepZoom(-1)
      } else if (ctrl && e.key === '0') {
        e.preventDefault()
        setMode('fit-width')
      } else if (ctrl && e.key === '1') {
        e.preventDefault()
        setMode(1)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active, searchOpen, openSearch, stepMatch, stepZoom])

  // ---- Page box -------------------------------------------------------------------------------------
  const [pageText, setPageText] = useState('1')
  const [editingPage, setEditingPage] = useState(false)
  useEffect(() => {
    if (!editingPage) setPageText(String(currentPage + 1))
  }, [currentPage, editingPage])

  const commitPage = () => {
    setEditingPage(false)
    const n = parseInt(pageText, 10)
    if (Number.isFinite(n)) goTo(Math.min(pages.length, Math.max(1, n)) - 1)
    else setPageText(String(currentPage + 1))
  }

  const zoomValue = typeof mode === 'number' ? (ZOOM_STEPS.includes(mode) ? String(mode) : 'custom') : mode

  return (
    <div className="docview" style={{ display: active ? 'flex' : 'none' }}>
      <div className="toolbar" role="toolbar" aria-label="Document">
        <button
          onClick={() => setSidebar(sidebar ? null : 'pages')}
          aria-pressed={sidebar !== null}
          title="Show or hide the side panel"
        >
          ☰
        </button>
        <span className="sep" />
        <button onClick={() => goTo(currentPage - 1)} disabled={currentPage <= 0} title="Previous page" aria-label="Previous page">
          ▲
        </button>
        <input
          className="page-input"
          value={pageText}
          aria-label="Page number"
          onFocus={(e) => {
            setEditingPage(true)
            e.currentTarget.select()
          }}
          onChange={(e) => setPageText(e.target.value)}
          onBlur={commitPage}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur()
            if (e.key === 'Escape') {
              setEditingPage(false)
              setPageText(String(currentPage + 1))
              e.currentTarget.blur()
            }
          }}
        />
        <span className="muted">/ {pages.length || '–'}</span>
        <button
          onClick={() => goTo(currentPage + 1)}
          disabled={currentPage >= pages.length - 1}
          title="Next page"
          aria-label="Next page"
        >
          ▼
        </button>
        <span className="sep" />
        <button onClick={() => stepZoom(-1)} disabled={!pages.length} title="Zoom out (Ctrl+−)" aria-label="Zoom out">
          −
        </button>
        <select
          value={zoomValue}
          disabled={!pages.length}
          aria-label="Zoom"
          onChange={(e) => {
            const v = e.target.value
            if (v === 'fit-width' || v === 'fit-page') setMode(v)
            else if (v !== 'custom') setMode(Number(v))
          }}
        >
          <option value="fit-width">Fit width</option>
          <option value="fit-page">Fit page</option>
          {zoomValue === 'custom' && <option value="custom">{Math.round(zoom * 100)}%</option>}
          {ZOOM_STEPS.map((s) => (
            <option key={s} value={s}>
              {Math.round(s * 100)}%
            </option>
          ))}
        </select>
        <span className="muted zoom-now" title="Current zoom">
          {Math.round(zoom * 100)}%
        </span>
        <button onClick={() => stepZoom(1)} disabled={!pages.length} title="Zoom in (Ctrl++)" aria-label="Zoom in">
          +
        </button>
        <span className="sep" />
        <button onClick={() => setTool('select')} disabled={!pages.length} aria-pressed={tool === 'select'} title="Select text">
          Select
        </button>
        <button onClick={() => setTool('hand')} disabled={!pages.length} aria-pressed={tool === 'hand'} title="Hand tool: drag to pan">
          Hand
        </button>
        <span className="sep" />
        <button onClick={openSearch} disabled={!pages.length} aria-pressed={searchOpen} title="Find (Ctrl+F)">
          Find
        </button>
      </div>

      {searchOpen && (
        <div className="searchbar" role="search">
          <input
            ref={searchInput}
            type="search"
            value={query}
            placeholder="Find in document"
            aria-label="Find in document"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') stepMatch(e.shiftKey ? -1 : 1)
            }}
          />
          <button onClick={() => stepMatch(-1)} disabled={!matches.length} title="Previous match (Shift+Enter)" aria-label="Previous match">
            ▲
          </button>
          <button onClick={() => stepMatch(1)} disabled={!matches.length} title="Next match (Enter)" aria-label="Next match">
            ▼
          </button>
          <label>
            <input type="checkbox" checked={matchCase} onChange={(e) => setMatchCase(e.target.checked)} /> Match case
          </label>
          <label>
            <input type="checkbox" checked={wholeWord} onChange={(e) => setWholeWord(e.target.checked)} /> Whole word
          </label>
          <span className="muted search-status" aria-live="polite">
            {!query
              ? ''
              : matches.length
                ? `${current + 1} of ${matches.length}${matches.length >= MAX_MATCHES ? '+' : ''}${searching ? '…' : ''}`
                : searching
                  ? 'Searching…'
                  : 'No results'}
          </span>
          <button className="close" onClick={() => setSearchOpen(false)} title="Close (Esc)" aria-label="Close find">
            ✕
          </button>
        </div>
      )}

      <div className="body">
        {error ? (
          <div className="error">{error}</div>
        ) : passwordIssue ? (
          <form
            className="password-form"
            onSubmit={(e) => {
              e.preventDefault()
              setPassword(passwordDraft)
            }}
          >
            <p>{passwordIssue === 'wrong' ? 'That password is incorrect.' : 'This document is password protected.'}</p>
            <input
              type="password"
              autoFocus
              value={passwordDraft}
              onChange={(e) => setPasswordDraft(e.target.value)}
              aria-label="Document password"
            />
            <button className="primary" type="submit" disabled={!passwordDraft}>
              Open
            </button>
          </form>
        ) : !client ? (
          <div className="empty">Loading…</div>
        ) : (
          <>
            {sidebar && (
              <Sidebar
                client={client}
                pages={pages}
                outline={outline}
                tab={sidebar}
                onTab={setSidebar}
                currentPage={currentPage}
                onGoTo={goTo}
              />
            )}
            <Viewer
              ref={viewer}
              client={client}
              pages={pages}
              zoom={zoom}
              tool={tool}
              matches={matches}
              currentMatch={current}
              onPageChange={setCurrentPage}
              onSize={onSize}
            />
          </>
        )}
      </div>
    </div>
  )
}
