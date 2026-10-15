import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  DEFAULT_FONT_SIZE,
  NOTE_SIZE,
  TEXTBOX_DEFAULT,
  annotLabel,
  colorChoices,
  DEFAULT_LINE_WIDTH,
  LINE_WIDTHS,
  STAMP_LABELS,
  defaultColor,
  isShapeKind,
  signature,
  stampSize,
  translated,
  withBounds,
  type Annot,
  type AnnotKind
} from './annotations'
import { writeAnnotations, type DeletedAnnot } from './annotWrite'
import { deletePages, extractPages, insertPagesFrom, movePages, parsePageRanges, rotatePages, splitEvery } from './pageOps'
import { PdfClient, type OutlineNode, type PageSize } from './pdfClient'
import { Sidebar, type PageOp, type SidebarTab } from './Sidebar'
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

/** [0,1,2,4] -> "1-3, 5" */
function compactRanges(pages: number[]): string {
  const out: string[] = []
  for (let i = 0; i < pages.length; ) {
    let j = i
    while (pages[j + 1] === pages[j] + 1) j++
    out.push(j > i ? `${pages[i] + 1}-${pages[j] + 1}` : String(pages[i] + 1))
    i = j + 1
  }
  return out.join(', ')
}

export function DocView({ id: docId, data, name, path, active, onMeta: reportMeta }: Props) {
  const onMeta = useCallback((meta: DocMeta) => reportMeta(docId, meta), [docId, reportMeta])
  // The bytes currently shown. They change after a save, which reloads the document with the annotations baked in.
  const [bytes, setBytes] = useState(data)
  // Page edits (rotate, delete, move, insert) rewrite the whole file. Each is applied at once and the previous bytes
  // are kept so it can be undone. Pending annotation edits are written into the file first, so undoing a page edit
  // brings back the annotations as ordinary saved ones, not as editable overlay changes.
  const [savedBytes, setSavedBytes] = useState(data)
  const [pageUndo, setPageUndo] = useState<Uint8Array[]>([])
  const [pageRedo, setPageRedo] = useState<Uint8Array[]>([])
  const [pageDialog, setPageDialog] = useState<{ kind: 'extract' | 'split'; pages: number[] } | null>(null)
  const [dialogText, setDialogText] = useState('')
  const [busy, setBusy] = useState(false)
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
  const [colors, setColors] = useState<Record<AnnotKind, string>>(() => {
    const kinds: AnnotKind[] = ['highlight', 'underline', 'strikeout', 'note', 'textbox', 'line', 'arrow', 'rectangle', 'ellipse', 'ink', 'stamp']
    return Object.fromEntries(kinds.map((k) => [k, defaultColor(k)])) as Record<AnnotKind, string>
  })
  const [drawWidth, setDrawWidth] = useState(DEFAULT_LINE_WIDTH)
  const [stampLabel, setStampLabel] = useState(STAMP_LABELS[0])
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
              lineWidth: r.lineWidth,
              points: r.points,
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
  const annotsDirty = deleted.length > 0 || annots.some(changed)
  const dirty = annotsDirty || bytes !== savedBytes
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
    fontSize: DEFAULT_FONT_SIZE,
    lineWidth: 1
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
    (kind: 'note' | 'textbox' | 'stamp', page: number, x: number, y: number) => {
      const size = pages[page]
      if (!size) return
      const stamp = kind === 'stamp' ? stampSize(stampLabel) : null
      const w = stamp ? stamp.w : kind === 'note' ? NOTE_SIZE : TEXTBOX_DEFAULT.w
      const h = stamp ? stamp.h : kind === 'note' ? NOTE_SIZE : TEXTBOX_DEFAULT.h
      const left = stamp ? x - w / 2 : x // a stamp is placed centred on the click
      const top = stamp ? y - h / 2 : y
      const rect = { x: Math.max(0, Math.min(size.width - w, left)), y: Math.max(0, Math.min(size.height - h, top)), w, h }
      const a = newAnnot(kind, page, [rect], stamp ? stampLabel : '')
      if (stamp) a.lineWidth = 2
      history.commit((list) => [...list, a])
      setSelectedAnnot(a.id)
      if (!stamp) setEditingAnnot(a.id)
      setTool('select')
    },
    [pages, colors, stampLabel, history.commit] // eslint-disable-line react-hooks/exhaustive-deps
  )

  const createShape = useCallback(
    (shape: Omit<Annot, 'id'>) => {
      const a: Annot = { ...shape, id: nextAnnotId.current++ }
      history.commit((list) => [...list, a])
      setSelectedAnnot(a.id)
    },
    [history.commit]
  )

  const reshapeAnnot = useCallback(
    (id: number, index: number, dx: number, dy: number) => {
      touch(id)
      history.commit((list) =>
        list.map((a) => {
          if (a.id !== id || !a.points) return a
          const size = pages[a.page]
          const first = a.points[0].map((p, i) =>
            i === index ? { x: Math.max(0, Math.min(size.width, p.x + dx)), y: Math.max(0, Math.min(size.height, p.y + dy)) } : p
          )
          return withBounds({ ...a, points: [first, ...a.points.slice(1)] })
        })
      )
    },
    [pages, history.commit, touch]
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
          return translated(a, x - r.x, y - r.y)
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
  const toolKind: AnnotKind | null =
    tool === 'select' || tool === 'hand' ? null : tool // every remaining tool is named after the kind it creates
  const swatchKind: AnnotKind = selected?.kind ?? toolKind ?? lastMarkup
  const showWidth = isShapeKind(swatchKind) || swatchKind === 'stamp'
  const activeWidth = selected && (isShapeKind(selected.kind) || selected.kind === 'stamp') ? selected.lineWidth : drawWidth
  const activeColor = selected ? selected.color : colors[swatchKind]

  const pickColor = (c: string) => {
    setColors((m) => ({ ...m, [swatchKind]: c }))
    if (selected) touch(selected.id)
    if (selected) history.commit((list) => list.map((a) => (a.id === selected.id ? { ...a, color: c } : a)))
  }

  const pickWidth = (w: number) => {
    setDrawWidth(w)
    if (selected && (isShapeKind(selected.kind) || selected.kind === 'stamp')) {
      touch(selected.id)
      history.commit((list) => list.map((a) => (a.id === selected.id ? withBounds({ ...a, lineWidth: w }) : a)))
    }
  }

  const pickStamp = (label: string) => {
    setStampLabel(label)
    if (selected?.kind === 'stamp') {
      touch(selected.id)
      history.commit((list) =>
        list.map((a) => (a.id === selected.id ? { ...a, text: label, rects: [{ ...a.rects[0], w: stampSize(label).w }] } : a))
      )
    }
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
        const out = annotsDirty ? await writeAnnotations(bytes, annots.filter(changed), deleted) : bytes
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
        setSavedBytes(out)
        setBytes(out)
        setNotice({ kind: 'info', text: `Saved ${saved.name}` })
      } catch (e) {
        setNotice({ kind: 'error', text: `Could not save: ${e instanceof Error ? e.message : String(e)}` })
      } finally {
        setSaving(false)
      }
    },
    [saving, password, annots, deleted, annotsDirty, bytes, path, name, onMeta, history.reset] // eslint-disable-line react-hooks/exhaustive-deps
  )

  // ---- Page organisation ----------------------------------------------------------------------------
  const swapBytes = useCallback((next: Uint8Array) => {
    baseline.current = new Map()
    history.reset([])
    setSelectedAnnot(null)
    setEditingAnnot(null)
    setBytes(next)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  /** Runs a structural edit. `fn` gets bytes with pending annotation edits already written in. */
  const applyPageEdit = useCallback(
    async (fn: (base: Uint8Array) => Promise<Uint8Array | null>, done?: string) => {
      if (busy || saving) return
      if (password) {
        setNotice({ kind: 'error', text: 'Editing pages of password-protected PDFs is not supported yet.' })
        return
      }
      setBusy(true)
      try {
        const base = annotsDirty ? await writeAnnotations(bytes, annots.filter(changed), deleted) : bytes
        const out = await fn(base)
        if (!out) return
        setPageUndo((u) => [...u, base])
        setPageRedo([])
        swapBytes(out)
        if (done) setNotice({ kind: 'info', text: done })
      } catch (e) {
        setNotice({ kind: 'error', text: `Page edit failed: ${e instanceof Error ? e.message : String(e)}` })
      } finally {
        setBusy(false)
      }
    },
    [busy, saving, password, annotsDirty, bytes, annots, deleted, swapBytes] // eslint-disable-line react-hooks/exhaustive-deps
  )

  const undoPageEdit = useCallback(() => {
    const prev = pageUndo[pageUndo.length - 1]
    if (!prev || busy) return
    setPageUndo((u) => u.slice(0, -1))
    setPageRedo((r) => [...r, bytes])
    swapBytes(prev)
  }, [pageUndo, busy, bytes, swapBytes])

  const redoPageEdit = useCallback(() => {
    const next = pageRedo[pageRedo.length - 1]
    if (!next || busy) return
    setPageRedo((r) => r.slice(0, -1))
    setPageUndo((u) => [...u, bytes])
    swapBytes(next)
  }, [pageRedo, busy, bytes, swapBytes])

  const baseName = name.replace(/\.pdf$/i, '')

  const runPageOp = useCallback(
    async (op: PageOp, selection: number[]) => {
      const n = pages.length
      const count = `${selection.length} page${selection.length === 1 ? '' : 's'}`
      switch (op.kind) {
        case 'rotate':
          return applyPageEdit((b) => rotatePages(b, selection, op.delta))
        case 'delete':
          if (selection.length >= n) return setNotice({ kind: 'error', text: 'A document must keep at least one page.' })
          return applyPageEdit((b) => deletePages(b, selection), `Deleted ${count}`)
        case 'move':
          return applyPageEdit((b) => movePages(b, selection, op.before))
        case 'insert': {
          const files = await window.openpdf.openFileDialog()
          if (!files.length) return
          let at = op.at
          let total = 0
          return applyPageEdit(async (b) => {
            let cur = b
            for (const f of files) {
              const r = await insertPagesFrom(cur, f.data, at)
              cur = r.bytes
              at += r.count
              total += r.count
            }
            return cur
          }).then(() => total && setNotice({ kind: 'info', text: `Inserted ${total} page${total === 1 ? '' : 's'}` }))
        }
        case 'extract':
        case 'split':
          setDialogText(op.kind === 'split' ? '1' : compactRanges(selection))
          setPageDialog({ kind: op.kind, pages: selection })
      }
    },
    [pages.length, applyPageEdit]
  )

  const submitPageDialog = async () => {
    const d = pageDialog
    if (!d) return
    try {
      const src = annotsDirty ? await writeAnnotations(bytes, annots.filter(changed), deleted) : bytes
      if (d.kind === 'extract') {
        const idx = parsePageRanges(dialogText, pages.length)
        const out = await extractPages(src, idx)
        const saved = await window.openpdf.saveFileAs(`${baseName} (extract).pdf`, out)
        if (saved) setNotice({ kind: 'info', text: `Extracted ${idx.length} page${idx.length === 1 ? '' : 's'} to ${saved.name}` })
      } else {
        const size = parseInt(dialogText, 10)
        if (!Number.isFinite(size) || size < 1) throw new Error('Enter a whole number of pages per file, 1 or more.')
        const parts = await splitEvery(src, size)
        const res = await window.openpdf.saveMany(
          parts.map((p) => ({ name: `${baseName} (pages ${p.first}-${p.last}).pdf`, data: p.bytes }))
        )
        if (res) setNotice({ kind: 'info', text: `Wrote ${res.written.length} files to ${res.dir}` })
      }
      setPageDialog(null)
    } catch (e) {
      setNotice({ kind: 'error', text: e instanceof Error ? e.message : String(e) })
    }
  }

  /** Merge: append whole files to the end of this document. */
  const mergeFiles = () => void runPageOp({ kind: 'insert', at: pages.length }, [])

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
        const redo = k === 'y' || e.shiftKey
        if (redo) (history.canRedo || !pageRedo.length ? history.redo : redoPageEdit)()
        else (history.canUndo || !pageUndo.length ? history.undo : undoPageEdit)()
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
  }, [active, searchOpen, tool, selectedAnnot, openSearch, stepMatch, stepZoom, save, removeAnnot, history.undo, history.redo, history.canUndo, history.canRedo, pageUndo.length, pageRedo.length, undoPageEdit, redoPageEdit])

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
        {(
          [
            ['line', 'Line', 'Draw a line: drag. Hold Shift for 45 degree steps'],
            ['arrow', 'Arrow', 'Draw an arrow: drag. Hold Shift for 45 degree steps'],
            ['rectangle', 'Rectangle', 'Draw a rectangle: drag. Hold Shift for a square'],
            ['ellipse', 'Ellipse', 'Draw an ellipse: drag. Hold Shift for a circle'],
            ['ink', 'Pencil', 'Draw freehand: drag']
          ] as const
        ).map(([k, label, hint]) => (
          <button key={k} onClick={() => setTool(tool === k ? 'select' : k)} disabled={!pages.length} aria-pressed={tool === k} title={hint}>
            {label}
          </button>
        ))}
        <button onClick={() => setTool(tool === 'stamp' ? 'select' : 'stamp')} disabled={!pages.length} aria-pressed={tool === 'stamp'} title="Place a stamp: click on the page">
          Stamp
        </button>
        {swatchKind === 'stamp' && (
          <select value={selected?.kind === 'stamp' ? selected.text : stampLabel} onChange={(e) => pickStamp(e.target.value)} aria-label="Stamp text">
            {STAMP_LABELS.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
        )}
        {showWidth && (
          <select value={activeWidth} onChange={(e) => pickWidth(Number(e.target.value))} aria-label="Line width" title="Line width">
            {(LINE_WIDTHS.includes(activeWidth) ? LINE_WIDTHS : [...LINE_WIDTHS, activeWidth].sort((a, b) => a - b)).map((w) => (
              <option key={w} value={w}>
                {w} pt
              </option>
            ))}
          </select>
        )}
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
        <button
          onClick={history.canUndo || !pageUndo.length ? history.undo : undoPageEdit}
          disabled={!history.canUndo && !pageUndo.length}
          title="Undo (Ctrl+Z)"
        >
          Undo
        </button>
        <button
          onClick={history.canRedo || !pageRedo.length ? history.redo : redoPageEdit}
          disabled={!history.canRedo && !pageRedo.length}
          title="Redo (Ctrl+Y)"
        >
          Redo
        </button>
        <span className="sep" />
        <button onClick={mergeFiles} disabled={!pages.length || busy} title="Merge: add the pages of other PDFs to the end">
          Merge…
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

      {pageDialog && (
        <form
          className="page-dialog"
          onSubmit={(e) => {
            e.preventDefault()
            void submitPageDialog()
          }}
        >
          <label>
            {pageDialog.kind === 'extract' ? 'Pages to extract (for example 1-3, 5)' : 'Pages per file'}
            <input autoFocus value={dialogText} onChange={(e) => setDialogText(e.target.value)} />
          </label>
          <button className="primary" type="submit">
            {pageDialog.kind === 'extract' ? 'Extract…' : 'Split…'}
          </button>
          <button type="button" onClick={() => setPageDialog(null)}>
            Cancel
          </button>
        </form>
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
                onPageOp={(op, sel) => void runPageOp(op, sel)}
                busy={busy}
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
              drawStyle={{ color: colors[toolKind ?? 'line'], lineWidth: drawWidth }}
              onCreateShape={createShape}
              onReshapeAnnot={reshapeAnnot}
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
