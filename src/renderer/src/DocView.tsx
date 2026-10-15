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
import { DEFAULT_MODE, layoutRows, rowExtent, type PageMode } from './pageLayout'
import { GAP, PAD, Viewer, type Tool, type ViewerHandle } from './Viewer'
import { printDocument } from './print'
import {
  ArrowLeftRight,
  BookOpen,
  Columns2,
  FileText,
  GalleryVertical,
  ScanSearch,
  Bookmark,
  ChevronDown,
  ChevronUp,
  Circle,
  Copy,
  Expand,
  FileOutput,
  FilePlus2,
  Files,
  FolderOpen,
  Hand,
  Highlighter,
  LayoutGrid,
  MousePointer2,
  MoveUpRight,
  PanelLeft,
  PanelRight,
  Pencil,
  Printer,
  Redo2,
  RotateCcw,
  RotateCcwSquare,
  RotateCw,
  RotateCwSquare,
  Save,
  SaveAll,
  Scan,
  Scissors,
  Search,
  Slash,
  Square,
  Stamp as StampIcon,
  StickyNote,
  Strikethrough,
  Trash2,
  Type,
  Underline,
  Undo2,
  X,
  ZoomIn,
  ZoomOut
} from 'lucide-react'
import { IconButton, RB, RGroup, RStack } from './Ribbon'
import { displayDims, turn, type Rotation } from './viewRotation'

type ZoomMode = 'fit-width' | 'fit-page' | number

interface PrintChoice {
  range: 'all' | 'current' | 'custom'
  custom: string
  copies: number
  fit: boolean
  autoRotate: boolean
}

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
  /** Restored from a crash-recovery snapshot: starts out unsaved. */
  recovered?: boolean
  /** Minutes between crash-recovery snapshots; 0 turns them off. */
  autosaveMinutes: number
  sidebarWidth: number
  paneSide: 'left' | 'right'
  onPaneSide: (side: 'left' | 'right') => void
  /** Called when the user finishes dragging the side pane's edge. */
  onSidebarWidth: (w: number) => void
  onOpen: () => void
  onCloseDoc: () => void
}

type RibbonTab = 'file' | 'home' | 'comment' | 'organise' | 'view'
const RIBBON_TABS: [RibbonTab, string][] = [
  ['file', 'File'],
  ['home', 'Home'],
  ['comment', 'Comment'],
  ['organise', 'Organise'],
  ['view', 'View']
]

/** Tells this window's recovery snapshots apart from those left by an earlier run. */
const SESSION = Math.random().toString(36).slice(2, 10)

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

export function DocView({ id: docId, data, name, path, active, onMeta: reportMeta, recovered, autosaveMinutes, sidebarWidth, onSidebarWidth, paneSide, onPaneSide, onOpen, onCloseDoc }: Props) {
  const [ribbon, setRibbon] = useState<RibbonTab>('home')
  // Pages selected in the thumbnail pane; the Organise tab acts on them, or on the current page if none are.
  const [pageSel, setPageSel] = useState<number[]>([])
  const [paneWidth, setPaneWidth] = useState(sidebarWidth)
  useEffect(() => setPaneWidth(sidebarWidth), [sidebarWidth])
  const onMeta = useCallback((meta: DocMeta) => reportMeta(docId, meta), [docId, reportMeta])
  // The bytes currently shown. They change after a save, which reloads the document with the annotations baked in.
  const [bytes, setBytes] = useState(data)
  // Page edits (rotate, delete, move, insert) rewrite the whole file. Each is applied at once and the previous bytes
  // are kept so it can be undone. Pending annotation edits are written into the file first, so undoing a page edit
  // brings back the annotations as ordinary saved ones, not as editable overlay changes.
  const [savedBytes, setSavedBytes] = useState(() => (recovered ? new Uint8Array(0) : data))
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
  // View-only rotation for this tab. It never touches the bytes, so it cannot mark the document unsaved.
  const [rotation, setRotation] = useState<Rotation>(0)
  const rotateView = useCallback((dir: 1 | -1) => setRotation((r) => turn(r, dir)), [])
  const [pageMode, setPageMode] = useState<PageMode>(DEFAULT_MODE)
  const zoomTo = useCallback((z: number) => setMode(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z))), [])
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
    const shown = pages.map((p) => displayDims(p, rotation))
    const { maxWidth, maxHeight } = rowExtent(layoutRows(pages.length, pageMode), shown, 0)
    const gaps = pageMode.twoUp ? GAP : 0 // pixels between the two pages of a row
    const byWidth = (size.w - 2 * PAD - gaps) / maxWidth
    const z = mode === 'fit-width' ? byWidth : Math.min(byWidth, (size.h - 2 * PAD) / maxHeight)
    return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z))
  }, [mode, pages, size, rotation, pageMode])

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

  // ---- Crash recovery -------------------------------------------------------------------------------
  // While there are unsaved changes, write a snapshot (annotations included) every few minutes. A save or a
  // close removes it; after a crash the app offers it back on the next start.
  const recoveryKey = `${SESSION}-${docId}`
  const snapshot = useRef<() => Promise<Uint8Array>>(async () => bytes)
  snapshot.current = async () => (annotsDirty && !password ? writeAnnotations(bytes, annots.filter(changed), deleted) : bytes)
  const metaRef = useRef({ name, path })
  metaRef.current = { name, path }
  useEffect(() => {
    if (!dirty) {
      void window.openpdf.recoveryClear(recoveryKey).catch(() => {})
      return
    }
    if (!autosaveMinutes) return
    const t = setInterval(() => {
      snapshot
        .current()
        .then((out) => window.openpdf.recoverySave(recoveryKey, metaRef.current, out))
        .catch(() => {})
    }, autosaveMinutes * 60_000)
    return () => clearInterval(t)
  }, [dirty, autosaveMinutes, recoveryKey])
  useEffect(() => () => void window.openpdf.recoveryClear(recoveryKey).catch(() => {}), [recoveryKey])

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
    tool === 'select' || tool === 'hand' || tool === 'zoom' ? null : tool // every other tool is named after the kind it creates
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

  // ---- Print ----------------------------------------------------------------------------------------
  const [printDialog, setPrintDialog] = useState<PrintChoice | null>(null)
  const [printing, setPrinting] = useState<{ done: number; total: number; ctrl: AbortController } | null>(null)
  const openPrint = useCallback(() => {
    if (!pages.length || printing) return
    setPrintDialog((d) => d ?? { range: 'all', custom: `1-${pages.length}`, copies: 1, fit: true, autoRotate: true })
  }, [pages.length, printing])

  const runPrint = async (c: PrintChoice) => {
    let list: number[]
    try {
      list =
        c.range === 'all' ? pages.map((_, i) => i) : c.range === 'current' ? [currentPage] : parsePageRanges(c.custom, pages.length)
    } catch (e) {
      setNotice({ kind: 'error', text: e instanceof Error ? e.message : String(e) })
      return
    }
    setPrintDialog(null)
    const ctrl = new AbortController()
    setPrinting({ done: 0, total: list.length, ctrl })
    try {
      // Pending annotation edits are written into a copy first, so the printout matches what Save would write.
      // PDFium then draws everything, including annotations, at print resolution.
      let src = bytes
      if (annotsDirty && password) setNotice({ kind: 'info', text: 'Unsaved annotation changes are not printed for password-protected PDFs.' })
      else if (annotsDirty) src = await writeAnnotations(bytes, annots.filter(changed), deleted)
      const res = await printDocument(
        src,
        password,
        { pages: list, copies: c.copies, fit: c.fit, autoRotate: c.autoRotate },
        (done, total) => setPrinting((p) => (p ? { ...p, done, total } : p)),
        ctrl.signal
      )
      if (res.error) setNotice({ kind: 'error', text: `Could not print: ${res.error}` })
      else if (res.pdfPath) setNotice({ kind: 'info', text: `Print output written to ${res.pdfPath}` })
      else if (res.ok) setNotice({ kind: 'info', text: `Sent ${list.length} page${list.length === 1 ? '' : 's'} to the printer` })
    } catch (e) {
      setNotice({ kind: 'error', text: `Could not print: ${e instanceof Error ? e.message : String(e)}` })
    } finally {
      setPrinting(null)
    }
  }

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
        if (printDialog) setPrintDialog(null)
        else if (searchOpen) setSearchOpen(false)
        else if (tool !== 'select') setTool('select')
        else if (selectedAnnot !== null) setSelectedAnnot(null)
        else viewer.current?.clearSelection()
      } else if (ctrl && e.key.toLowerCase() === 'c' && !inField && viewer.current?.hasSelection()) {
        e.preventDefault()
        void viewer.current.copySelection()
      } else if (ctrl && e.shiftKey && (e.key === '+' || e.key === '=' || e.code === 'Equal' || e.code === 'NumpadAdd')) {
        e.preventDefault()
        rotateView(1)
      } else if (ctrl && e.shiftKey && (e.key === '-' || e.key === '_' || e.code === 'Minus' || e.code === 'NumpadSubtract')) {
        e.preventDefault()
        rotateView(-1)
      } else if (ctrl && k === 'p') {
        e.preventDefault()
        openPrint()
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
  }, [active, searchOpen, tool, selectedAnnot, openSearch, rotateView, openPrint, printDialog, stepMatch, stepZoom, save, removeAnnot, history.undo, history.redo, history.canUndo, history.canRedo, pageUndo.length, pageRedo.length, undoPageEdit, redoPageEdit])

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
  const opPages = pageSel.length ? pageSel : [Math.min(currentPage, Math.max(0, pages.length - 1))]
  const undoButtons = (
    <>
      <RB
        icon={Undo2}
        label="Undo"
        onClick={history.canUndo || !pageUndo.length ? history.undo : undoPageEdit}
        disabled={!history.canUndo && !pageUndo.length}
        title="Undo (Ctrl+Z)"
      />
      <RB
        icon={Redo2}
        label="Redo"
        onClick={history.canRedo || !pageRedo.length ? history.redo : redoPageEdit}
        disabled={!history.canRedo && !pageRedo.length}
        title="Redo (Ctrl+Y)"
      />
    </>
  )

  return (
    <div className="docview" style={{ display: active ? 'flex' : 'none' }}>
      <div className="ribbon">
        <div className="ribbon-tabs" role="tablist" aria-label="Ribbon">
          {RIBBON_TABS.map(([k, label]) => (
            <button key={k} role="tab" aria-selected={ribbon === k} className={ribbon === k ? 'rtab on' : 'rtab'} onClick={() => setRibbon(k)}>
              {label}
            </button>
          ))}
        </div>
        <div className="ribbon-body" role="tabpanel" aria-label={RIBBON_TABS.find(([k]) => k === ribbon)?.[1]}>
          {ribbon === 'file' && (
            <>
              <RGroup label="Document">
                <RB big icon={FolderOpen} label="Open" onClick={onOpen} title="Open a PDF (Ctrl+O)" />
                <RB big icon={Save} label="Save" badge={dirty} onClick={() => void save(false)} disabled={saving || !pages.length} title={dirty ? 'Save (Ctrl+S). There are unsaved changes' : 'Save (Ctrl+S)'} />
                <RB big icon={SaveAll} label="Save as" onClick={() => void save(true)} disabled={saving || !pages.length} title="Save a copy (Ctrl+Shift+S)" />
                <RB big icon={X} label="Close" onClick={onCloseDoc} title="Close this document (Ctrl+W)" />
              </RGroup>
              <RGroup label="Output">
                <RB big icon={Printer} label="Print" onClick={openPrint} disabled={!pages.length || !!printing} title="Print (Ctrl+P)" />
              </RGroup>
            </>
          )}
          {ribbon === 'home' && (
            <>
              <RGroup label="Tools">
                <RB big icon={MousePointer2} label="Select" onClick={() => setTool('select')} disabled={!pages.length} pressed={tool === 'select'} title="Select text and annotations" />
                <RB big icon={Hand} label="Hand" onClick={() => setTool('hand')} disabled={!pages.length} pressed={tool === 'hand'} title="Hand tool: drag to pan" />
                <RB big icon={ScanSearch} label="Zoom" onClick={() => setTool(tool === 'zoom' ? 'select' : 'zoom')} disabled={!pages.length} pressed={tool === 'zoom'} title="Zoom tool: drag a box to fit it, click to zoom in, Shift+click to zoom out" />
              </RGroup>
              <RGroup label="Edit">
                <RStack>
                  <RB icon={Copy} label="Copy" onClick={() => void viewer.current?.copySelection()} disabled={!hasTextSelection} title="Copy the selected text (Ctrl+C)" />
                  {undoButtons}
                </RStack>
              </RGroup>
              <RGroup label="Comment">
                <RB big icon={Highlighter} label="Highlight" onClick={() => void markSelection('highlight')} disabled={!hasTextSelection} title="Highlight the selected text" />
                <RB big icon={StickyNote} label="Note" onClick={() => setTool(tool === 'note' ? 'select' : 'note')} disabled={!pages.length} pressed={tool === 'note'} title="Add a sticky note: click on the page" />
              </RGroup>
              <RGroup label="Find">
                <RB big icon={Search} label="Find" onClick={openSearch} disabled={!pages.length} pressed={searchOpen} title="Find (Ctrl+F)" />
              </RGroup>
              <RGroup label="Document">
                <RB big icon={Save} label="Save" badge={dirty} onClick={() => void save(false)} disabled={saving || !pages.length} title={dirty ? 'Save (Ctrl+S). There are unsaved changes' : 'Save (Ctrl+S)'} />
                <RB big icon={Printer} label="Print" onClick={openPrint} disabled={!pages.length || !!printing} title="Print (Ctrl+P)" />
              </RGroup>
            </>
          )}
          {ribbon === 'comment' && (
            <>
              <RGroup label="Text markup">
                <RB big icon={Highlighter} label="Highlight" onClick={() => void markSelection('highlight')} disabled={!hasTextSelection} title="Highlight the selected text" />
                <RStack>
                  <RB icon={Underline} label="Underline" onClick={() => void markSelection('underline')} disabled={!hasTextSelection} title="Underline the selected text" />
                  <RB icon={Strikethrough} label="Strikeout" onClick={() => void markSelection('strikeout')} disabled={!hasTextSelection} title="Strike out the selected text" />
                </RStack>
              </RGroup>
              <RGroup label="Notes">
                <RB big icon={StickyNote} label="Note" onClick={() => setTool(tool === 'note' ? 'select' : 'note')} disabled={!pages.length} pressed={tool === 'note'} title="Add a sticky note: click on the page" />
                <RB big icon={Type} label="Text box" onClick={() => setTool(tool === 'textbox' ? 'select' : 'textbox')} disabled={!pages.length} pressed={tool === 'textbox'} title="Add a text box: click on the page" />
              </RGroup>
              <RGroup label="Drawing">
                <RStack>
                  <RB icon={Slash} label="Line" onClick={() => setTool(tool === 'line' ? 'select' : 'line')} disabled={!pages.length} pressed={tool === 'line'} title="Draw a line: drag. Hold Shift for 45 degree steps" />
                  <RB icon={MoveUpRight} label="Arrow" onClick={() => setTool(tool === 'arrow' ? 'select' : 'arrow')} disabled={!pages.length} pressed={tool === 'arrow'} title="Draw an arrow: drag. Hold Shift for 45 degree steps" />
                </RStack>
                <RStack>
                  <RB icon={Square} label="Rectangle" onClick={() => setTool(tool === 'rectangle' ? 'select' : 'rectangle')} disabled={!pages.length} pressed={tool === 'rectangle'} title="Draw a rectangle: drag. Hold Shift for a square" />
                  <RB icon={Circle} label="Ellipse" onClick={() => setTool(tool === 'ellipse' ? 'select' : 'ellipse')} disabled={!pages.length} pressed={tool === 'ellipse'} title="Draw an ellipse: drag. Hold Shift for a circle" />
                </RStack>
                <RB big icon={Pencil} label="Pencil" onClick={() => setTool(tool === 'ink' ? 'select' : 'ink')} disabled={!pages.length} pressed={tool === 'ink'} title="Draw freehand: drag" />
              </RGroup>
              <RGroup label="Stamp">
                <RB big icon={StampIcon} label="Stamp" onClick={() => setTool(tool === 'stamp' ? 'select' : 'stamp')} disabled={!pages.length} pressed={tool === 'stamp'} title="Place a stamp: click on the page" />
                <select className="rselect" value={selected?.kind === 'stamp' ? selected.text : stampLabel} onChange={(e) => pickStamp(e.target.value)} aria-label="Stamp text">
                  {STAMP_LABELS.map((l) => (
                    <option key={l} value={l}>
                      {l}
                    </option>
                  ))}
                </select>
              </RGroup>
              <RGroup label={`${annotLabel(swatchKind)} style`}>
                <div className="rstyle">
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
                  {showWidth && (
                    <select className="rselect" value={activeWidth} onChange={(e) => pickWidth(Number(e.target.value))} aria-label="Line width" title="Line width">
                      {(LINE_WIDTHS.includes(activeWidth) ? LINE_WIDTHS : [...LINE_WIDTHS, activeWidth].sort((a, b) => a - b)).map((w) => (
                        <option key={w} value={w}>
                          {w} pt
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              </RGroup>
              <RGroup label="Edit">
                <RB big icon={Trash2} label="Delete" onClick={() => selected && removeAnnot(selected.id)} disabled={!selected} title="Delete the selected annotation (Delete)" />
                <RStack>{undoButtons}</RStack>
              </RGroup>
            </>
          )}
          {ribbon === 'organise' && (
            <>
              <RGroup label={pageSel.length > 1 ? `Pages (${pageSel.length} selected)` : `Page ${opPages[0] + 1}`}>
                <RStack>
                  <RB icon={RotateCcwSquare} label="Rotate left" onClick={() => void runPageOp({ kind: 'rotate', delta: -90 }, opPages)} disabled={!pages.length || busy} title="Rotate the selected pages anticlockwise (changes the file)" />
                  <RB icon={RotateCwSquare} label="Rotate right" onClick={() => void runPageOp({ kind: 'rotate', delta: 90 }, opPages)} disabled={!pages.length || busy} title="Rotate the selected pages clockwise (changes the file)" />
                </RStack>
                <RB big icon={Trash2} label="Delete" onClick={() => void runPageOp({ kind: 'delete' }, opPages)} disabled={!pages.length || busy || opPages.length >= pages.length} title="Delete the selected pages" />
              </RGroup>
              <RGroup label="Insert and extract">
                <RB big icon={FilePlus2} label="Insert" onClick={() => void runPageOp({ kind: 'insert', at: Math.max(...opPages) + 1 }, opPages)} disabled={!pages.length || busy} title="Insert pages from another PDF after the selected pages" />
                <RB big icon={FileOutput} label="Extract" onClick={() => void runPageOp({ kind: 'extract' }, opPages)} disabled={!pages.length || busy} title="Save the selected pages as a new PDF" />
              </RGroup>
              <RGroup label="Documents">
                <RB big icon={Files} label="Merge" onClick={mergeFiles} disabled={!pages.length || busy} title="Merge: add the pages of other PDFs to the end" />
                <RB big icon={Scissors} label="Split" onClick={() => void runPageOp({ kind: 'split' }, opPages)} disabled={!pages.length || busy} title="Split into files of a set number of pages" />
              </RGroup>
              <RGroup label="Edit">
                <RStack>{undoButtons}</RStack>
              </RGroup>
            </>
          )}
          {ribbon === 'view' && (
            <>
              <RGroup label="Panes">
                <RB big icon={LayoutGrid} label="Pages" onClick={() => setSidebar(sidebar === 'pages' ? null : 'pages')} pressed={sidebar === 'pages'} title="Show or hide page thumbnails" />
                <RB big icon={Bookmark} label="Bookmarks" onClick={() => setSidebar(sidebar === 'bookmarks' ? null : 'bookmarks')} pressed={sidebar === 'bookmarks'} title="Show or hide bookmarks" />
                <RStack>
                  <RB icon={PanelLeft} label="Dock left" onClick={() => onPaneSide('left')} pressed={paneSide === 'left'} title="Dock the side pane on the left" />
                  <RB icon={PanelRight} label="Dock right" onClick={() => onPaneSide('right')} pressed={paneSide === 'right'} title="Dock the side pane on the right" />
                </RStack>
              </RGroup>
              <RGroup label="Page display">
                <RB big icon={FileText} label="Single" onClick={() => setPageMode({ ...pageMode, twoUp: false })} pressed={!pageMode.twoUp} disabled={!pages.length} title="One page per row" />
                <RB big icon={Columns2} label="Two pages" onClick={() => setPageMode({ ...pageMode, twoUp: true })} pressed={pageMode.twoUp} disabled={!pages.length} title="Two pages side by side" />
                <RStack>
                  <RB icon={GalleryVertical} label="Continuous" onClick={() => setPageMode({ ...pageMode, continuous: !pageMode.continuous })} pressed={pageMode.continuous} disabled={!pages.length} title="Scroll through all pages, or show one page (or pair) at a time" />
                  <RB icon={BookOpen} label="Cover page" onClick={() => setPageMode({ ...pageMode, cover: !pageMode.cover })} pressed={pageMode.cover} disabled={!pages.length || !pageMode.twoUp} title="With two pages: show the first page on its own, like a book cover" />
                </RStack>
              </RGroup>
              <RGroup label="Zoom">
                <RB big icon={ScanSearch} label="Zoom tool" onClick={() => setTool(tool === 'zoom' ? 'select' : 'zoom')} disabled={!pages.length} pressed={tool === 'zoom'} title="Zoom tool: drag a box to fit it, click to zoom in, Shift+click to zoom out" />
                <RStack>
                  <RB icon={ArrowLeftRight} label="Fit width" onClick={() => setMode('fit-width')} disabled={!pages.length} pressed={mode === 'fit-width'} title="Fit width (Ctrl+0)" />
                  <RB icon={Expand} label="Fit page" onClick={() => setMode('fit-page')} disabled={!pages.length} pressed={mode === 'fit-page'} title="Fit page" />
                </RStack>
                <RStack>
                  <RB icon={Scan} label="Actual size" onClick={() => setMode(1)} disabled={!pages.length} pressed={mode === 1} title="Actual size (Ctrl+1)" />
                  <RB icon={ZoomIn} label="Zoom in" onClick={() => stepZoom(1)} disabled={!pages.length} title="Zoom in (Ctrl++)" />
                </RStack>
              </RGroup>
              <RGroup label="Rotate view">
                <RB big icon={RotateCcw} label="Left" ariaLabel="Rotate view anticlockwise" onClick={() => rotateView(-1)} disabled={!pages.length} title="Rotate view anticlockwise (Ctrl+Shift+−). The file is not changed" />
                <RB big icon={RotateCw} label="Right" ariaLabel="Rotate view clockwise" onClick={() => rotateView(1)} disabled={!pages.length} title="Rotate view clockwise (Ctrl+Shift++). The file is not changed" />
              </RGroup>
            </>
          )}
        </div>
      </div>

      {notice && (
        <div className={notice.kind === 'error' ? 'error banner' : 'info banner'} role={notice.kind === 'error' ? 'alert' : 'status'}>
          {notice.text}
          {notice.kind === 'error' && (
            <IconButton icon={X} label="Dismiss" onClick={() => setNotice(null)} />
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
          <IconButton icon={ChevronUp} label="Previous match" title="Previous match (Shift+Enter)" onClick={() => stepMatch(-1)} disabled={!matches.length} />
          <IconButton icon={ChevronDown} label="Next match" title="Next match (Enter)" onClick={() => stepMatch(1)} disabled={!matches.length} />
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
          <IconButton icon={X} className="close" label="Close find" title="Close (Esc)" onClick={() => setSearchOpen(false)} />
        </div>
      )}

      {printDialog && (
        <form
          className="page-dialog print-dialog"
          aria-label="Print"
          onSubmit={(e) => {
            e.preventDefault()
            void runPrint(printDialog)
          }}
        >
          <span className="muted">Print</span>
          <select
            aria-label="Pages to print"
            value={printDialog.range}
            onChange={(e) => setPrintDialog({ ...printDialog, range: e.target.value as PrintChoice['range'] })}
          >
            <option value="all">All pages</option>
            <option value="current">Current page ({currentPage + 1})</option>
            <option value="custom">Pages…</option>
          </select>
          {printDialog.range === 'custom' && (
            <input
              autoFocus
              aria-label="Page range, for example 1-3, 5"
              title="For example 1-3, 5"
              value={printDialog.custom}
              onChange={(e) => setPrintDialog({ ...printDialog, custom: e.target.value })}
            />
          )}
          <label>
            Copies
            <input
              type="number"
              min={1}
              max={999}
              className="copies"
              value={printDialog.copies}
              onChange={(e) => setPrintDialog({ ...printDialog, copies: Math.max(1, Math.min(999, Number(e.target.value) || 1)) })}
            />
          </label>
          <select
            aria-label="Page scaling"
            value={printDialog.fit ? 'fit' : 'actual'}
            onChange={(e) => setPrintDialog({ ...printDialog, fit: e.target.value === 'fit' })}
          >
            <option value="fit">Fit to paper</option>
            <option value="actual">Actual size</option>
          </select>
          <label title="Turn landscape pages so they fill portrait paper">
            <input type="checkbox" checked={printDialog.autoRotate} onChange={(e) => setPrintDialog({ ...printDialog, autoRotate: e.target.checked })} />
            Auto-rotate
          </label>
          <button className="primary" type="submit">
            Print…
          </button>
          <button type="button" onClick={() => setPrintDialog(null)}>
            Cancel
          </button>
        </form>
      )}

      {printing && (
        <div className="page-dialog print-progress" role="status">
          <span>
            Preparing pages for printing: {printing.done} of {printing.total}
          </span>
          <button type="button" onClick={() => printing.ctrl.abort()}>
            Cancel
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

      <div className={paneSide === 'right' ? 'body pane-right' : 'body'}>
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
                width={paneWidth}
                onSelectionChange={setPageSel}
              />
            )}
            {sidebar && (
              <div
                className="splitter"
                role="separator"
                aria-orientation="vertical"
                aria-label="Resize side pane"
                onMouseDown={(e) => {
                  e.preventDefault()
                  const startX = e.clientX
                  const startW = paneWidth
                  let w = startW
                  const move = (ev: MouseEvent) => {
                    const dx = (ev.clientX - startX) * (paneSide === 'right' ? -1 : 1)
                    w = Math.min(600, Math.max(140, startW + dx))
                    setPaneWidth(w)
                  }
                  const up = () => {
                    window.removeEventListener('mousemove', move)
                    window.removeEventListener('mouseup', up)
                    onSidebarWidth(w)
                  }
                  window.addEventListener('mousemove', move)
                  window.addEventListener('mouseup', up)
                }}
              />
            )}
            <Viewer
              ref={viewer}
              client={client}
              pages={pages}
              zoom={zoom}
              rotation={rotation}
              mode={pageMode}
              onZoomTo={zoomTo}
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
      <div className="statusbar toolbar" role="toolbar" aria-label="Page and zoom">
        <IconButton icon={PanelLeft} label="Side panel" title="Show or hide the side panel" onClick={() => setSidebar(sidebar ? null : 'pages')} pressed={sidebar !== null} />
        <span className="sep" />
        <IconButton icon={ChevronUp} label="Previous page" onClick={() => goTo(currentPage - 1)} disabled={currentPage <= 0} />
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
        <IconButton icon={ChevronDown} label="Next page" onClick={() => goTo(currentPage + 1)} disabled={currentPage >= pages.length - 1} />
        <span className="status-fill" />
        <IconButton icon={ZoomOut} label="Zoom out" title="Zoom out (Ctrl+−)" onClick={() => stepZoom(-1)} disabled={!pages.length} />
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
        <IconButton icon={ZoomIn} label="Zoom in" title="Zoom in (Ctrl++)" onClick={() => stepZoom(1)} disabled={!pages.length} />
      </div>
    </div>
  )
}
