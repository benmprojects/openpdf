import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  DEFAULT_FONT_SIZE,
  NOTE_SIZE,
  TEXTBOX_DEFAULT,
  annotLabel,
  colorChoices,
  defaultColor,
  signature,
  type Annot,
  type AnnotKind
} from './annotations'
import { writeAnnotations, type DeletedAnnot } from './annotWrite'
import { PdfClient, type OutlineNode, type PageSize } from './pdfClient'
import { Sidebar, type SidebarTab } from './Sidebar'
import { findInPage, type Match } from './textLogic'
import { useHistory } from './useHistory'
import { PAD, Viewer, type Tool, type ViewerHandle } from './Viewer'

type ZoomMode = 'fit-width' | 'fit-page' | number

const ZOOM_STEPS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4, 8]
const MIN_ZOOM = 0.1
const MAX_ZOOM = 8
const MAX_MATCHES = 5000

export interface DocMeta {
  dirty?: boolean
  name?: string
  path?: string
}

interface Props {
  id: number
  data: Uint8Array
  name: string
  path?: string
  active: boolean
  /** Must be a stable function; it is called from effects. */
  onMeta: (id: number, meta: DocMeta) => void
}

export function DocView({ id: docId, data, name, path, active, onMeta: reportMeta }: Props) {
  const onMeta = useCallback((meta: DocMeta) => reportMeta(docId, meta), [docId, reportMeta])
  // The bytes currently shown. They change after a save, which reloads the document with the annotations baked in.
  const [bytes, setBytes] = useState(data)
  const [client, setClient] = useState<PdfClient | null>(null)
  const [pages, setPages] = useState<PageSize[]>([])
  const [error, setError] = useState<string | null>(null)
  const [outline, setOutline] = useState<OutlineNode[] | null>(null)
  const [password, setPassword] = useState<string | undefined>()
  const [passwordIssue, setPasswordIssue] = useState<'required' | 'wrong' | null>(null)
  const [passwordDraft, setPasswordDraft] = useState('')
  const [tool, setTool] = useState<Tool>('select')

  const [mode, setMode] = useState<ZoomMode>('fit-width')
  const [size, setSize] = useState({ w: 0, h: 0 })
  const [currentPage, setCurrentPage] = useState(0)
  const [sidebar, setSidebar] = useState<SidebarTab | null>('pages')
  const viewer = useRef<ViewerHandle>(null)

  useEffect(() => {
    const c = new PdfClient()
    let cancelled = false
    c.load(bytes, password)
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
  }, [bytes, password])

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

  // ---- Annotations ----------------------------------------------------------------------------------
  const history = useHistory<Annot[]>([])
  const annots = history.present
  const [selectedAnnot, setSelectedAnnot] = useState<number | null>(null)
  const [editingAnnot, setEditingAnnot] = useState<number | null>(null)
  const [hasTextSelection, setHasTextSelection] = useState(false)
  const [colors, setColors] = useState<Record<AnnotKind, string>>(() => ({
    highlight: defaultColor('highlight'),
    underline: defaultColor('underline'),
    strikeout: defaultColor('strikeout'),
    note: defaultColor('note'),
    textbox: defaultColor('textbox')
  }))
  const [lastMarkup, setLastMarkup] = useState<AnnotKind>('highlight')
  const [notice, setNotice] = useState<{ kind: 'error' | 'info'; text: string } | null>(null)
  const [saving, setSaving] = useState(false)
  const nextAnnotId = useRef(1)
  const annotsRef = useRef(annots)
  annotsRef.current = annots

  // Annotations that were already in the file when it was opened. Unchanged ones stay in the file untouched.
  const baseline = useRef(new Map<number, { page: number; origin: NonNullable<Annot['origin']>; sig: string }>())
  const [touched, setTouched] = useState<ReadonlySet<number>>(() => new Set())
  const touchedRef = useRef(touched)
  const [epoch, setEpoch] = useState(0)
  const clientRef = useRef(client)
  clientRef.current = client

  // Load the editable annotations of a freshly opened document. The first call per document also resets the
  // edit state, because saving swaps in new bytes and this runs again.
  useEffect(() => {
    if (!client) return
    let cancelled = false
    client
      .annots()
      .then((pages) => {
        if (cancelled) return
        const imported: Annot[] = []
        baseline.current = new Map()
        for (const { page, annots: list } of pages) {
          for (const r of list) {
            const a: Annot = {
              id: nextAnnotId.current++,
              page,
              kind: r.kind,
              color: r.color ?? defaultColor(r.kind),
              rects: r.rects,
              text: r.text,
              fontSize: r.fontSize,
              origin: { index: r.index, subtype: r.subtype, rect: r.rect }
            }
            imported.push(a)
            baseline.current.set(a.id, { page, origin: a.origin!, sig: signature(a) })
          }
        }
        touchedRef.current = new Set()
        setTouched(touchedRef.current)
        history.reset([...imported, ...annotsRef.current.filter((a) => !a.origin)])
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [client]) // eslint-disable-line react-hooks/exhaustive-deps

  /** Stop PDFium drawing an imported annotation so our overlay can draw its edited version. */
  const touch = useCallback((id: number) => {
    const a = annotsRef.current.find((x) => x.id === id)
    if (!a?.origin || touchedRef.current.has(id)) return
    touchedRef.current = new Set(touchedRef.current).add(id)
    setTouched(touchedRef.current)
    clientRef.current
      ?.hideAnnot(a.page, a.origin.index, a.origin.subtype)
      .then(() => setEpoch((e) => e + 1))
      .catch(() => {})
  }, [])

  const deleted = useMemo<DeletedAnnot[]>(() => {
    const present = new Set(annots.map((a) => a.id))
    return [...baseline.current].filter(([id]) => !present.has(id)).map(([, b]) => ({ page: b.page, origin: b.origin }))
  }, [annots])
  const changed = (a: Annot) => !a.origin || baseline.current.get(a.id)?.sig !== signature(a)
  const dirty = deleted.length > 0 || annots.some(changed)
  useEffect(() => onMeta({ dirty }), [dirty, onMeta])

  useEffect(() => {
    if (!notice || notice.kind === 'error') return
    const t = setTimeout(() => setNotice(null), 3500)
    return () => clearTimeout(t)
  }, [notice])

  const newAnnot = (kind: AnnotKind, page: number, rects: Annot['rects'], text = ''): Annot => ({
    id: nextAnnotId.current++,
    page,
    kind,
    color: colors[kind],
    rects,
    text,
    fontSize: DEFAULT_FONT_SIZE
  })

  const markSelection = useCallback(
    async (kind: AnnotKind) => {
      const parts = (await viewer.current?.selectionRects()) ?? []
      if (!parts.length) return
      const made = parts.map((p) => newAnnot(kind, p.page, p.rects))
      history.commit((list) => [...list, ...made])
      setLastMarkup(kind)
      setSelectedAnnot(made[made.length - 1].id)
      viewer.current?.clearSelection()
    },
    [colors, history.commit] // eslint-disable-line react-hooks/exhaustive-deps
  )

  const place = useCallback(
    (kind: 'note' | 'textbox', page: number, x: number, y: number) => {
      const size = pages[page]
      if (!size) return
      const w = kind === 'note' ? NOTE_SIZE : TEXTBOX_DEFAULT.w
      const h = kind === 'note' ? NOTE_SIZE : TEXTBOX_DEFAULT.h
      const rect = { x: Math.max(0, Math.min(size.width - w, x)), y: Math.max(0, Math.min(size.height - h, y)), w, h }
      const a = newAnnot(kind, page, [rect])
      history.commit((list) => [...list, a])
      setSelectedAnnot(a.id)
      setEditingAnnot(a.id)
      setTool('select')
    },
    [pages, colors, history.commit] // eslint-disable-line react-hooks/exhaustive-deps
  )

  const moveAnnot = useCallback(
    (id: number, dx: number, dy: number) => {
      touch(id)
      history.commit((list) =>
        list.map((a) => {
          if (a.id !== id) return a
          const size = pages[a.page]
          const r = a.rects[0]
          const x = Math.max(0, Math.min(size.width - r.w, r.x + dx))
          const y = Math.max(0, Math.min(size.height - r.h, r.y + dy))
          return { ...a, rects: [{ ...r, x, y }] }
        })
      )
    },
    [pages, history.commit, touch]
  )

  const resizeAnnot = useCallback(
    (id: number, w: number, h: number) => {
      touch(id)
      history.commit((list) =>
        list.map((a) => {
          if (a.id !== id) return a
          const size = pages[a.page]
          const r = a.rects[0]
          return {
            ...a,
            rects: [{ ...r, w: Math.max(40, Math.min(size.width - r.x, w)), h: Math.max(20, Math.min(size.height - r.y, h)) }]
          }
        })
      )
    },
    [pages, history.commit, touch]
  )

  const removeAnnot = useCallback(
    (id: number) => {
      touch(id)
      history.commit((list) => list.filter((a) => a.id !== id))
      setSelectedAnnot((s) => (s === id ? null : s))
      setEditingAnnot((e) => (e === id ? null : e))
    },
    [history.commit, touch]
  )

  const editAnnot = useCallback(
    (id: number | null) => {
      if (id !== null) touch(id)
      setEditingAnnot(id)
    },
    [touch]
  )

  const finishText = useCallback(
    (id: number, text: string) => {
      setEditingAnnot(null)
      const existing = annotsRef.current.find((a) => a.id === id)
      if (!existing) return
      // A note or text box left empty is dropped rather than saved as an invisible object.
      if (!text.trim()) return removeAnnot(id)
      if (text !== existing.text) touch(id)
      if (text !== existing.text) history.commit((list) => list.map((a) => (a.id === id ? { ...a, text } : a)))
    },
    [history.commit, removeAnnot, touch]
  )

  const selected = annots.find((a) => a.id === selectedAnnot) ?? null
  const swatchKind: AnnotKind = selected?.kind ?? (tool === 'note' ? 'note' : tool === 'textbox' ? 'textbox' : lastMarkup)
  const activeColor = selected ? selected.color : colors[swatchKind]

  const pickColor = (c: string) => {
    setColors((m) => ({ ...m, [swatchKind]: c }))
    if (selected) touch(selected.id)
    if (selected) history.commit((list) => list.map((a) => (a.id === selected.id ? { ...a, color: c } : a)))
  }

  const save = useCallback(
    async (asNew: boolean) => {
      if (saving) return
      if (password) {
        setNotice({ kind: 'error', text: 'Saving password-protected PDFs is not supported yet, so nothing was written.' })
        return
      }
      setSaving(true)
      try {
        const out = dirty ? await writeAnnotations(bytes, annots.filter(changed), deleted) : bytes
        const saved =
          !asNew && path
            ? await window.openpdf.saveFile(path, out)
            : await window.openpdf.saveFileAs(name.replace(/(\.pdf)?$/i, '.pdf'), out)
        if (!saved) return // the Save As dialog was cancelled
        onMeta({ name: saved.name, path: saved.path })
        baseline.current = new Map() // the reloaded document is re-imported with fresh positions
        history.reset([])
        setSelectedAnnot(null)
        setEditingAnnot(null)
        setBytes(out)
        setNotice({ kind: 'info', text: `Saved ${saved.name}` })
      } catch (e) {
        setNotice({ kind: 'error', text: `Could not save: ${e instanceof Error ? e.message : String(e)}` })
      } finally {
        setSaving(false)
      }
    },
    [saving, password, annots, deleted, dirty, bytes, path, name, onMeta, history.reset] // eslint-disable-line react-hooks/exhaustive-deps
  )

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
      const inField =
        e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.target instanceof HTMLTextAreaElement
      const ctrl = e.ctrlKey || e.metaKey
      const k = e.key.toLowerCase()
      if (ctrl && k === 's') {
        e.preventDefault()
        void save(e.shiftKey)
      } else if (ctrl && !inField && (k === 'z' || k === 'y')) {
        e.preventDefault()
        if (k === 'y' || e.shiftKey) history.redo()
        else history.undo()
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && !inField && selectedAnnot !== null) {
        e.preventDefault()
        removeAnnot(selectedAnnot)
      } else if (ctrl && e.key.toLowerCase() === 'f') {
        e.preventDefault()
        openSearch()
      } else if (e.key === 'F3' || (ctrl && e.key.toLowerCase() === 'g')) {
        e.preventDefault()
        stepMatch(e.shiftKey ? -1 : 1)
      } else if (e.key === 'Escape') {
        if (searchOpen) setSearchOpen(false)
        else if (tool !== 'select') setTool('select')
        else if (selectedAnnot !== null) setSelectedAnnot(null)
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
  }, [active, searchOpen, tool, selectedAnnot, openSearch, stepMatch, stepZoom, save, removeAnnot, history.undo, history.redo])

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
        <button onClick={openSearch} disabled={!pages.length} aria-pressed={searchOpen} title="Find (Ctrl+F)">
          Find
        </button>
      </div>

      <div className="toolbar annot-bar" role="toolbar" aria-label="Annotations">
        <button onClick={() => setTool('select')} disabled={!pages.length} aria-pressed={tool === 'select'} title="Select text and annotations">
          Select
        </button>
        <button onClick={() => setTool('hand')} disabled={!pages.length} aria-pressed={tool === 'hand'} title="Hand tool: drag to pan">
          Hand
        </button>
        <span className="sep" />
        {(['highlight', 'underline', 'strikeout'] as const).map((k) => (
          <button key={k} onClick={() => void markSelection(k)} disabled={!hasTextSelection} title={`${annotLabel(k)} the selected text`}>
            {annotLabel(k)}
          </button>
        ))}
        <span className="sep" />
        <button
          onClick={() => setTool(tool === 'note' ? 'select' : 'note')}
          disabled={!pages.length}
          aria-pressed={tool === 'note'}
          title="Add a sticky note: click on the page"
        >
          Note
        </button>
        <button
          onClick={() => setTool(tool === 'textbox' ? 'select' : 'textbox')}
          disabled={!pages.length}
          aria-pressed={tool === 'textbox'}
          title="Add a text box: click on the page"
        >
          Text box
        </button>
        <span className="sep" />
        <span className="swatches" role="group" aria-label={`${annotLabel(swatchKind)} colour`}>
          {colorChoices(swatchKind).map((c) => (
            <button
              key={c}
              className={c === activeColor ? 'swatch on' : 'swatch'}
              style={{ background: c }}
              onClick={() => pickColor(c)}
              aria-label={`Colour ${c}`}
              aria-pressed={c === activeColor}
            />
          ))}
        </span>
        <button onClick={() => selected && removeAnnot(selected.id)} disabled={!selected} title="Delete the selected annotation (Delete)">
          Delete
        </button>
        <span className="sep" />
        <button onClick={history.undo} disabled={!history.canUndo} title="Undo (Ctrl+Z)">
          Undo
        </button>
        <button onClick={history.redo} disabled={!history.canRedo} title="Redo (Ctrl+Y)">
          Redo
        </button>
        <span className="sep" />
        <button onClick={() => void save(false)} disabled={saving || !pages.length} title="Save (Ctrl+S)">
          {saving ? 'Saving…' : dirty ? 'Save •' : 'Save'}
        </button>
        <button onClick={() => void save(true)} disabled={saving || !pages.length} title="Save a copy (Ctrl+Shift+S)">
          Save as…
        </button>
      </div>

      {notice && (
        <div className={notice.kind === 'error' ? 'error banner' : 'info banner'} role={notice.kind === 'error' ? 'alert' : 'status'}>
          {notice.text}
          {notice.kind === 'error' && (
            <button onClick={() => setNotice(null)} aria-label="Dismiss">
              ✕
            </button>
          )}
        </div>
      )}

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
              annots={annots}
              selectedAnnot={selectedAnnot}
              editingAnnot={editingAnnot}
              onSelectAnnot={setSelectedAnnot}
              onMoveAnnot={moveAnnot}
              onResizeAnnot={resizeAnnot}
              onEditAnnot={editAnnot}
              touchedAnnots={touched}
              onTouchAnnot={touch}
              epoch={epoch}
              onAnnotText={finishText}
              onPlace={place}
              onSelectionChange={setHasTextSelection}
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
