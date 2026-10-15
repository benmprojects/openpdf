import { useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type Ref } from 'react'
import { AnnotLayer } from './AnnotLayer'
import { isMarkup, pointInRect, simplifyPath, withBounds, NOTE_SIZE, type Annot, type Pt } from './annotations'
import type { PageSize, PdfClient } from './pdfClient'
import type { PageText } from './pdfiumRaw'
import {
  comparePos,
  hitTest,
  normaliseNewlines,
  rangeRects,
  sliceText,
  type CharPos,
  type Match,
  type Rect
} from './textLogic'
import { layoutRows, rowOfPage, type PageMode } from './pageLayout'
import { displayDims, stackTransform, toDisplay, toPage, type Rotation } from './viewRotation'

/** Space around the page stack and between pages, in CSS pixels. */
/** Above this many bitmap pixels a page renders as a low-resolution base plus a sharp tile of the part in view. */
const TILE_THRESHOLD = 16_000_000
const BASE_PIXELS = 3_000_000
/** Extra rendered area around the view, in CSS pixels, so small scrolls need no new tile. */
const TILE_MARGIN = 300

/** Puts an RGBA render on a canvas. Returns false if the render was aborted or the canvas is gone. */
function paint(cv: HTMLCanvasElement | null, out: { width: number; height: number; data: Uint8Array }, signal: AbortSignal): boolean {
  if (signal.aborted || !cv) return false
  cv.width = out.width
  cv.height = out.height
  cv.getContext('2d')?.putImageData(new ImageData(new Uint8ClampedArray(out.data), out.width, out.height), 0, 0)
  return true
}

export const PAD = 16
export const GAP = 12

export interface ViewerHandle {
  scrollToPage(index: number): void
  scrollToMatch(match: Match): void
  copySelection(): Promise<boolean>
  hasSelection(): boolean
  clearSelection(): void
  /** One entry per page touched by the current text selection, with a rectangle per line. */
  selectionRects(): Promise<{ page: number; rects: Rect[] }[]>
}

export type Tool =
  | 'select'
  | 'hand'
  | 'note'
  | 'textbox'
  | 'line'
  | 'arrow'
  | 'rectangle'
  | 'ellipse'
  | 'ink'
  | 'stamp'
  | 'zoom'
  | 'snapshot'

export interface DrawStyle {
  color: string
  lineWidth: number
}

function isShapeTool(t: Tool): t is 'line' | 'arrow' | 'rectangle' | 'ellipse' | 'ink' {
  return t === 'line' || t === 'arrow' || t === 'rectangle' || t === 'ellipse' || t === 'ink'
}

/** Snap a drag to 45 degree steps (lines) or to a square (rectangles and ellipses). */
function constrain(kind: string, a: Pt, b: Pt): Pt {
  const dx = b.x - a.x
  const dy = b.y - a.y
  if (kind === 'rectangle' || kind === 'ellipse') {
    const s = Math.max(Math.abs(dx), Math.abs(dy))
    return { x: a.x + Math.sign(dx || 1) * s, y: a.y + Math.sign(dy || 1) * s }
  }
  const step = Math.PI / 4
  const ang = Math.round(Math.atan2(dy, dx) / step) * step
  const len = Math.hypot(dx, dy)
  return { x: a.x + len * Math.cos(ang), y: a.y + len * Math.sin(ang) }
}

interface Props {
  client: PdfClient
  pages: PageSize[]
  zoom: number
  /** View-only rotation of every page; the file is not changed. */
  rotation: Rotation
  /** Single page or continuous, one or two pages per row. */
  mode: PageMode
  /** The marquee zoom tool asks for a new zoom level. */
  onZoomTo: (zoom: number) => void
  /** The snapshot tool: a box dragged on one page, in page points (unrotated frame). */
  onSnapshot: (page: number, rect: Rect) => void
  tool: Tool
  annots: Annot[]
  selectedAnnot: number | null
  editingAnnot: number | null
  touchedAnnots: ReadonlySet<number>
  onTouchAnnot: (id: number) => void
  /** Bumped when PDFium's drawing of the document changed and visible pages must be redrawn. */
  epoch: number
  onSelectAnnot: (id: number | null) => void
  onMoveAnnot: (id: number, dx: number, dy: number) => void
  onResizeAnnot: (id: number, w: number, h: number) => void
  onEditAnnot: (id: number | null) => void
  onAnnotText: (id: number, text: string) => void
  onPlace: (kind: 'note' | 'textbox' | 'stamp', page: number, x: number, y: number) => void
  drawStyle: DrawStyle
  onCreateShape: (a: Omit<Annot, 'id'>) => void
  onReshapeAnnot: (id: number, index: number, dx: number, dy: number) => void
  onSelectionChange: (has: boolean) => void
  matches: Match[]
  currentMatch: number
  onPageChange: (index: number) => void
  onSize: (width: number, height: number) => void
  ref?: Ref<ViewerHandle>
}

interface Selection {
  anchor: CharPos
  focus: CharPos
}

export function Viewer({
  client,
  pages,
  zoom,
  rotation,
  mode,
  onZoomTo,
  onSnapshot,
  tool,
  annots,
  selectedAnnot,
  editingAnnot,
  touchedAnnots,
  onTouchAnnot,
  epoch,
  onSelectAnnot,
  onMoveAnnot,
  onResizeAnnot,
  onEditAnnot,
  onAnnotText,
  onPlace,
  drawStyle,
  onCreateShape,
  onReshapeAnnot,
  onSelectionChange,
  matches,
  currentMatch,
  onPageChange,
  onSize,
  ref
}: Props) {
  const scroller = useRef<HTMLDivElement>(null)
  const pageEls = useRef<(HTMLDivElement | null)[]>([])
  const [sel, setSel] = useState<Selection | null>(null)
  const [draft, setDraft] = useState<Annot | null>(null)
  /** The marquee zoom rectangle, in screen pixels. */
  const [band, setBand] = useState<{ x: number; y: number; w: number; h: number } | null>(null)
  const drawStyleRef = useRef(drawStyle)
  drawStyleRef.current = drawStyle
  const selRef = useRef<Selection | null>(null)
  selRef.current = sel

  useEffect(() => onSelectionChange(sel !== null), [sel, onSelectionChange])

  const annotsByPage = useMemo(() => {
    const map = new Map<number, Annot[]>()
    for (const a of annots) {
      const list = map.get(a.page)
      if (list) list.push(a)
      else map.set(a.page, [a])
    }
    return map
  }, [annots])

  const rows = useMemo(() => layoutRows(pages.length, mode), [pages.length, mode])
  const rowOf = useMemo(() => rowOfPage(rows), [rows])
  // Outside continuous mode only one row is on screen; scrolling past its ends turns to the next or previous one.
  const [shownRow, setShownRow] = useState(0)
  const shownRowSafe = Math.min(shownRow, Math.max(0, rows.length - 1))
  const visibleRows = useMemo(
    () => (mode.continuous ? rows.map((_, i) => i) : rows.length ? [shownRowSafe] : []),
    [mode.continuous, rows, shownRowSafe]
  )
  const pendingEdge = useRef<'top' | 'bottom' | null>(null)

  /** Top of each visible row in document pixels, and of each page (its row's top; hidden pages get the first row's). */
  const { rowTops, offsets } = useMemo(() => {
    const tops = new Map<number, number>()
    let y = PAD
    for (const ri of visibleRows) {
      tops.set(ri, y)
      y += Math.max(...rows[ri].map((p) => Math.round(displayDims(pages[p], rotation).height * zoom))) + GAP
    }
    return { rowTops: tops, offsets: pages.map((_, i) => tops.get(rowOf[i]) ?? PAD) }
  }, [visibleRows, rows, rowOf, pages, zoom, rotation])

  /** A screen point to page points on the given page element, undoing the view rotation. */
  const pointOnPage = useCallback(
    (el: HTMLElement, page: number, cx: number, cy: number) => {
      const r = el.getBoundingClientRect()
      return toPage(rotation, (cx - r.left) / zoom, (cy - r.top) / zoom, pages[page])
    },
    [rotation, zoom, pages]
  )

  /** The row at a document y, as an index into `rows`. */
  const rowAtDocY = useCallback(
    (y: number) => {
      let best = visibleRows[0] ?? 0
      for (const ri of visibleRows) if ((rowTops.get(ri) ?? 0) <= y) best = ri
      return best
    },
    [visibleRows, rowTops]
  )
  /** First page of the row at a document y. */
  const pageAtDocY = useCallback((y: number) => rows[rowAtDocY(y)]?.[0] ?? 0, [rows, rowAtDocY])
  /** The page under a screen point: the row by height, then the page in that row nearest the point across. */
  const pageAtPoint = useCallback(
    (cx: number, cy: number) => {
      const sc = scroller.current
      if (!sc) return 0
      const row = rows[rowAtDocY(cy - sc.getBoundingClientRect().top + sc.scrollTop)] ?? [0]
      let best = row[0]
      let bestDist = Infinity
      for (const p of row) {
        const r = pageEls.current[p]?.getBoundingClientRect()
        if (!r) continue
        const d = cx < r.left ? r.left - cx : cx > r.right ? cx - r.right : 0
        if (d < bestDist) {
          bestDist = d
          best = p
        }
      }
      return best
    },
    [rows, rowAtDocY]
  )

  // Keep the view anchored on the same spot of the document when the zoom or the window size changes.
  const anchor = useRef<{ x: number; y: number } | null>(null)
  const lastPage = useRef(-1)

  const reportPage = useCallback(() => {
    const el = scroller.current
    if (!el || !offsets.length) return
    const idx = mode.continuous ? pageAtDocY(el.scrollTop + el.clientHeight * 0.4) : (rows[shownRowSafe]?.[0] ?? 0)
    if (idx !== lastPage.current) {
      lastPage.current = idx
      onPageChange(idx)
    }
  }, [offsets, pageAtDocY, onPageChange, mode.continuous, rows, shownRowSafe])

  /** Set by the marquee zoom tool: the page point to centre once the new zoom is laid out. */
  const zoomTarget = useRef<{ page: number; x: number; y: number } | null>(null)

  useLayoutEffect(() => {
    const el = scroller.current
    const a = anchor.current
    const t = zoomTarget.current
    zoomTarget.current = null
    const pageEl = t ? pageEls.current[t.page] : null
    if (el && t && pageEl) {
      const d = toDisplay(rotation, t.x, t.y, pages[t.page])
      el.scrollLeft = pageEl.offsetLeft + d.u * zoom - el.clientWidth / 2
      el.scrollTop = pageEl.offsetTop + d.v * zoom - el.clientHeight / 2
    } else if (el && a) {
      el.scrollTop = a.y * el.scrollHeight - el.clientHeight / 2
      el.scrollLeft = a.x * el.scrollWidth - el.clientWidth / 2
    }
    reportPage()
  }, [zoom, rotation, mode, reportPage]) // eslint-disable-line react-hooks/exhaustive-deps

  useLayoutEffect(() => {
    const el = scroller.current
    if (!el || !pendingEdge.current) return
    el.scrollTop = pendingEdge.current === 'top' ? 0 : el.scrollHeight
    pendingEdge.current = null
    reportPage()
  }, [shownRowSafe, reportPage])

  // One row at a time: the wheel turns to the next or previous row at the ends of the current one.
  const onWheel = useCallback(
    (e: React.WheelEvent) => {
      const el = scroller.current
      if (mode.continuous || !el || e.ctrlKey) return
      if (e.deltaY > 0 && el.scrollTop + el.clientHeight >= el.scrollHeight - 1 && shownRowSafe < rows.length - 1) {
        pendingEdge.current = 'top'
        setShownRow(shownRowSafe + 1)
      } else if (e.deltaY < 0 && el.scrollTop <= 0 && shownRowSafe > 0) {
        pendingEdge.current = 'bottom'
        setShownRow(shownRowSafe - 1)
      }
    },
    [mode.continuous, shownRowSafe, rows.length]
  )

  useEffect(() => {
    const el = scroller.current
    if (!el) return
    let raf = 0
    const onScroll = () => {
      anchor.current = {
        x: (el.scrollLeft + el.clientWidth / 2) / Math.max(1, el.scrollWidth),
        y: (el.scrollTop + el.clientHeight / 2) / Math.max(1, el.scrollHeight)
      }
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(reportPage)
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    const ro = new ResizeObserver(() => {
      if (el.clientWidth > 0 && el.clientHeight > 0) onSize(el.clientWidth, el.clientHeight)
    })
    ro.observe(el)
    return () => {
      cancelAnimationFrame(raf)
      el.removeEventListener('scroll', onScroll)
      ro.disconnect()
    }
  }, [reportPage, onSize])

  // ---- Text selection -------------------------------------------------------------------------------
  const seq = useRef(0)

  const posAt = useCallback(
    async (cx: number, cy: number): Promise<CharPos | null> => {
      const i = pageAtPoint(cx, cy)
      const el = pageEls.current[i]
      if (!el) return null
      const p = pointOnPage(el, i, cx, cy)
      const pt = await client.pageText(i)
      const char = hitTest(pt.boxes, p.x, p.y)
      return char < 0 ? null : { page: i, char }
    },
    [client, pointOnPage, pageAtPoint]
  )

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0) return
      if (tool === 'snapshot') {
        const pageEl = (e.target as HTMLElement).closest<HTMLElement>('[data-page]')
        if (!pageEl) return
        e.preventDefault()
        const page = Number(pageEl.dataset.page)
        const sx = e.clientX
        const sy = e.clientY
        const move = (ev: MouseEvent) => setBand({ x: Math.min(sx, ev.clientX), y: Math.min(sy, ev.clientY), w: Math.abs(ev.clientX - sx), h: Math.abs(ev.clientY - sy) })
        const up = (ev: MouseEvent) => {
          window.removeEventListener('mousemove', move)
          window.removeEventListener('mouseup', up)
          setBand(null)
          if (Math.abs(ev.clientX - sx) < 4 || Math.abs(ev.clientY - sy) < 4) return
          const size = pages[page]
          const a = pointOnPage(pageEl, page, sx, sy)
          const b = pointOnPage(pageEl, page, ev.clientX, ev.clientY)
          const x0 = Math.max(0, Math.min(a.x, b.x))
          const y0 = Math.max(0, Math.min(a.y, b.y))
          const x1 = Math.min(size.width, Math.max(a.x, b.x))
          const y1 = Math.min(size.height, Math.max(a.y, b.y))
          if (x1 - x0 > 1 && y1 - y0 > 1) onSnapshot(page, { x: x0, y: y0, w: x1 - x0, h: y1 - y0 })
        }
        window.addEventListener('mousemove', move)
        window.addEventListener('mouseup', up)
        return
      }
      if (tool === 'zoom') {
        const sc = scroller.current
        if (!sc) return
        e.preventDefault()
        const sx = e.clientX
        const sy = e.clientY
        const out = e.shiftKey || e.altKey
        const move = (ev: MouseEvent) => setBand({ x: Math.min(sx, ev.clientX), y: Math.min(sy, ev.clientY), w: Math.abs(ev.clientX - sx), h: Math.abs(ev.clientY - sy) })
        const up = (ev: MouseEvent) => {
          window.removeEventListener('mousemove', move)
          window.removeEventListener('mouseup', up)
          setBand(null)
          const w = Math.abs(ev.clientX - sx)
          const h = Math.abs(ev.clientY - sy)
          const cx = (sx + ev.clientX) / 2
          const cy = (sy + ev.clientY) / 2
          const page = pageAtPoint(cx, cy)
          const el = pageEls.current[page]
          if (!el) return
          // A click zooms in (Shift or Alt: out) one step around the point; a drag fits the dragged box.
          const next =
            w < 6 && h < 6
              ? out
                ? zoom / 1.5
                : zoom * 1.5
              : Math.min((sc.clientWidth - 2 * PAD) / (w / zoom), (sc.clientHeight - 2 * PAD) / (h / zoom))
          const target = pointOnPage(el, page, cx, cy)
          zoomTarget.current = { page, x: target.x, y: target.y }
          onZoomTo(next)
        }
        window.addEventListener('mousemove', move)
        window.addEventListener('mouseup', up)
        return
      }
      if (tool === 'hand') {
        const sc = scroller.current
        if (!sc) return
        e.preventDefault()
        const start = { x: e.clientX, y: e.clientY, left: sc.scrollLeft, top: sc.scrollTop }
        const pan = (ev: MouseEvent) => {
          sc.scrollLeft = start.left - (ev.clientX - start.x)
          sc.scrollTop = start.top - (ev.clientY - start.y)
        }
        const stop = () => {
          window.removeEventListener('mousemove', pan)
          window.removeEventListener('mouseup', stop)
          sc.classList.remove('panning')
        }
        sc.classList.add('panning')
        window.addEventListener('mousemove', pan)
        window.addEventListener('mouseup', stop)
        return
      }
      const pageEl = (e.target as HTMLElement).closest<HTMLElement>('[data-page]')
      if (!pageEl) {
        onSelectAnnot(null)
        return
      }
      if (isShapeTool(tool)) {
        e.preventDefault()
        const pageIdx = Number(pageEl.dataset.page)
        const size = pages[pageIdx]
        const kind = tool
        const style = drawStyleRef.current
        const toPt = (cx: number, cy: number): Pt => {
          const p = pointOnPage(pageEl, pageIdx, cx, cy)
          return { x: Math.min(size.width, Math.max(0, p.x)), y: Math.min(size.height, Math.max(0, p.y)) }
        }
        const start = toPt(e.clientX, e.clientY)
        const trail: Pt[] = [start]
        let end = start
        const make = (to: Pt, path: Pt[]): Omit<Annot, 'id'> => {
          const base = { page: pageIdx, kind, color: style.color, text: '', fontSize: 12, lineWidth: style.lineWidth }
          if (kind === 'rectangle' || kind === 'ellipse') {
            return {
              ...base,
              rects: [{ x: Math.min(start.x, to.x), y: Math.min(start.y, to.y), w: Math.abs(to.x - start.x), h: Math.abs(to.y - start.y) }]
            }
          }
          return withBounds({ ...base, id: -1, rects: [], points: [kind === 'ink' ? path : [start, to]] })
        }
        const move = (ev: MouseEvent) => {
          const cur = toPt(ev.clientX, ev.clientY)
          if (kind === 'ink') {
            const last = trail[trail.length - 1]
            if (Math.hypot(cur.x - last.x, cur.y - last.y) >= 1) trail.push(cur)
            end = cur
          } else {
            end = ev.shiftKey ? constrain(kind, start, cur) : cur
          }
          setDraft({ ...make(end, trail), id: -1 })
        }
        const up = () => {
          window.removeEventListener('mousemove', move)
          window.removeEventListener('mouseup', up)
          setDraft(null)
          const path = kind === 'ink' ? simplifyPath(trail, 0.6) : trail
          const made = make(end, path)
          const box = made.rects[0]
          const big = kind === 'ink' ? path.length >= 2 && box.w + box.h > 4 : kind === 'line' || kind === 'arrow' ? Math.hypot(end.x - start.x, end.y - start.y) >= 4 : box.w >= 4 && box.h >= 4
          if (big) onCreateShape(made)
        }
        window.addEventListener('mousemove', move)
        window.addEventListener('mouseup', up)
        return
      }
      if (tool === 'note' || tool === 'textbox' || tool === 'stamp') {
        e.preventDefault()
        const { x, y } = pointOnPage(pageEl, Number(pageEl.dataset.page), e.clientX, e.clientY)
        onPlace(tool, Number(pageEl.dataset.page), tool === 'note' ? x - NOTE_SIZE / 2 : x, tool === 'note' ? y - NOTE_SIZE / 2 : y)
        return
      }
      e.preventDefault()
      const startX = e.clientX
      const startY = e.clientY
      const mySeq = ++seq.current
      const anchorPos = posAt(startX, startY)
      let moved = false
      setSel(null)

      const onMove = async (ev: MouseEvent) => {
        if (!moved && Math.hypot(ev.clientX - startX, ev.clientY - startY) < 4) return
        moved = true
        const sc = scroller.current
        if (sc) {
          const r = sc.getBoundingClientRect()
          if (ev.clientY < r.top + 24) sc.scrollTop -= 24
          else if (ev.clientY > r.bottom - 24) sc.scrollTop += 24
        }
        const myMove = ++seq.current
        const [a, f] = await Promise.all([anchorPos, posAt(ev.clientX, ev.clientY)])
        if (myMove !== seq.current || mySeq > seq.current || !a || !f) return
        setSel({ anchor: a, focus: f })
      }
      const onUp = (ev: MouseEvent) => {
        window.removeEventListener('mousemove', onMove)
        window.removeEventListener('mouseup', onUp)
        if (moved) return
        // A plain click: pick the text markup under the pointer, or clear the annotation selection.
        const i = pageAtPoint(ev.clientX, ev.clientY)
        const el = pageEls.current[i]
        if (!el) return
        const { x, y } = pointOnPage(el, i, ev.clientX, ev.clientY)
        const hit = [...annots].reverse().find((a) => a.page === i && isMarkup(a.kind) && a.rects.some((q) => pointInRect(q, x, y, 2)))
        onSelectAnnot(hit ? hit.id : null)
      }
      window.addEventListener('mousemove', onMove)
      window.addEventListener('mouseup', onUp)
    },
    [posAt, tool, annots, pages, pageAtPoint, pointOnPage, onSelectAnnot, onPlace, onCreateShape, zoom, onZoomTo, onSnapshot]
  )

  const ordered = useMemo(() => {
    if (!sel) return null
    return comparePos(sel.anchor, sel.focus) <= 0 ? { s: sel.anchor, e: sel.focus } : { s: sel.focus, e: sel.anchor }
  }, [sel])

  const selForPage = (page: number) =>
    ordered && page >= ordered.s.page && page <= ordered.e.page
      ? {
          from: page === ordered.s.page ? ordered.s.char : 0,
          to: page === ordered.e.page ? ordered.e.char : Infinity
        }
      : null

  const matchesByPage = useMemo(() => {
    const map = new Map<number, { m: Match; idx: number }[]>()
    matches.forEach((m, idx) => {
      const list = map.get(m.page)
      if (list) list.push({ m, idx })
      else map.set(m.page, [{ m, idx }])
    })
    return map
  }, [matches])

  useImperativeHandle(
    ref,
    () => ({
      scrollToPage(index) {
        const el = scroller.current
        if (!el || offsets[index] === undefined) return
        if (!mode.continuous) {
          if (rowOf[index] !== shownRowSafe) {
            pendingEdge.current = 'top'
            setShownRow(rowOf[index])
          } else el.scrollTop = 0
          return
        }
        el.scrollTop = offsets[index] - PAD / 2
      },
      async scrollToMatch(match) {
        const el = scroller.current
        if (!el) return
        if (!mode.continuous && rowOf[match.page] !== shownRowSafe) {
          setShownRow(rowOf[match.page])
          await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
        }
        const pageEl = pageEls.current[match.page]
        if (!pageEl) return
        const pt = await client.pageText(match.page)
        const r = rangeRects(pt.boxes, match.from, match.to)[0]
        if (!r) return
        // The corner of the match nearest the displayed top left, whatever the view rotation.
        const corners = [toDisplay(rotation, r.x, r.y, pages[match.page]), toDisplay(rotation, r.x + r.w, r.y + r.h, pages[match.page])]
        const u = Math.min(corners[0].u, corners[1].u)
        const v = Math.min(corners[0].v, corners[1].v)
        const top = pageEl.offsetTop + v * zoom
        if (top < el.scrollTop + 40 || top > el.scrollTop + el.clientHeight - 80) el.scrollTop = top - el.clientHeight / 3
        const left = pageEl.offsetLeft + u * zoom
        if (left < el.scrollLeft + 20 || left > el.scrollLeft + el.clientWidth - 60) el.scrollLeft = left - el.clientWidth / 3
      },
      async copySelection() {
        const o = ordered
        if (!o) return false
        const parts: string[] = []
        for (let p = o.s.page; p <= o.e.page; p++) {
          const pt = await client.pageText(p)
          parts.push(sliceText(pt, p === o.s.page ? o.s.char : 0, p === o.e.page ? o.e.char : Infinity))
        }
        await navigator.clipboard.writeText(normaliseNewlines(parts.join('\n')))
        return true
      },
      async selectionRects() {
        const o = ordered
        if (!o) return []
        const out: { page: number; rects: Rect[] }[] = []
        for (let p = o.s.page; p <= o.e.page; p++) {
          const pt = await client.pageText(p)
          const rects = rangeRects(pt.boxes, p === o.s.page ? o.s.char : 0, p === o.e.page ? o.e.char : Infinity)
          if (rects.length) out.push({ page: p, rects })
        }
        return out
      },
      hasSelection: () => selRef.current !== null,
      clearSelection: () => setSel(null)
    }),
    [client, offsets, zoom, rotation, pages, ordered, mode.continuous, rowOf, shownRowSafe]
  )

  return (
    <div
      ref={scroller}
      className={tool === 'hand' ? 'scroller hand' : tool === 'zoom' ? 'scroller zoom' : tool === 'select' ? 'scroller' : 'scroller place'}
      onMouseDown={onMouseDown}
      onWheel={onWheel}
    >
      <div className="viewer" style={{ padding: PAD }}>
        {visibleRows.map((ri) => (
          <div key={ri} className="page-row" style={{ gap: GAP, marginBottom: GAP }}>
            {rows[ri].map((i) => (
              <PageView
                key={i}
                client={client}
                index={i}
                size={pages[i]}
                zoom={zoom}
                rotation={rotation}
                annots={annotsByPage.get(i)}
                draft={draft && draft.page === i ? draft : undefined}
                epoch={epoch}
                scroller={scroller}
                annotProps={{ tool, selectedAnnot, editingAnnot, touchedAnnots, onTouchAnnot, onSelectAnnot, onMoveAnnot, onResizeAnnot, onReshapeAnnot, onEditAnnot, onAnnotText }}
                selection={selForPage(i)}
                matches={matchesByPage.get(i)}
                currentMatch={currentMatch}
                elRef={(el) => {
                  pageEls.current[i] = el
                }}
              />
            ))}
          </div>
        ))}
      </div>
      {band && <div className="zoom-band" style={{ left: band.x, top: band.y, width: band.w, height: band.h }} />}
    </div>
  )
}

interface PageViewProps {
  client: PdfClient
  index: number
  size: PageSize
  zoom: number
  rotation: Rotation
  /** The scrolling container, so very large pages can render only the part in view. */
  scroller: React.RefObject<HTMLDivElement | null>
  annots?: Annot[]
  draft?: Annot
  epoch: number
  annotProps: {
    tool: Tool
    selectedAnnot: number | null
    editingAnnot: number | null
    touchedAnnots: ReadonlySet<number>
    onTouchAnnot: (id: number) => void
    onSelectAnnot: (id: number | null) => void
    onMoveAnnot: (id: number, dx: number, dy: number) => void
    onResizeAnnot: (id: number, w: number, h: number) => void
    onReshapeAnnot: (id: number, index: number, dx: number, dy: number) => void
    onEditAnnot: (id: number | null) => void
    onAnnotText: (id: number, text: string) => void
  }
  selection: { from: number; to: number } | null
  matches?: { m: Match; idx: number }[]
  currentMatch: number
  elRef: (el: HTMLDivElement | null) => void
}

function PageView({ client, index, size, zoom, rotation, scroller, epoch, annots, draft, annotProps, selection, matches, currentMatch, elRef }: PageViewProps) {
  const holder = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const [visible, setVisible] = useState(false)
  const [text, setText] = useState<PageText | null>(null)

  const cssW = Math.round(size.width * zoom)
  const cssH = Math.round(size.height * zoom)
  const rotated = rotation === 90 || rotation === 270

  useEffect(() => {
    const el = holder.current
    if (!el) return
    const io = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { rootMargin: '600px 0px' })
    io.observe(el)
    return () => io.disconnect()
  }, [])

  // Whole-page rendering, or for very large bitmaps (high zoom) a low-resolution whole page plus a sharp tile
  // covering just the part in view, re-rendered as the view scrolls.
  const tileCanvas = useRef<HTMLCanvasElement>(null)
  const [tile, setTile] = useState<{ x: number; y: number; w: number; h: number; scale: number } | null>(null)
  const dpr = window.devicePixelRatio || 1
  const fullScale = zoom * dpr
  const tiled = Math.floor(size.width) * fullScale * Math.floor(size.height) * fullScale > TILE_THRESHOLD

  useEffect(() => {
    if (!visible) {
      // Release the bitmaps of pages that are far off screen.
      if (canvas.current) canvas.current.width = 0
      if (tileCanvas.current) tileCanvas.current.width = 0
      setTile(null)
      return
    }
    const ctrl = new AbortController()
    const scale = tiled ? Math.sqrt(BASE_PIXELS / (size.width * size.height)) : fullScale
    // Debounce so rapid zoom changes do not queue a render per step.
    const timer = setTimeout(() => {
      client
        .render(index, scale, { signal: ctrl.signal })
        .then((out) => paint(canvas.current, out, ctrl.signal))
        .catch(() => {})
    }, 60)
    return () => {
      clearTimeout(timer)
      ctrl.abort()
    }
  }, [client, index, zoom, visible, epoch, tiled, fullScale, size.width, size.height])

  useEffect(() => {
    setTile(null)
    if (!visible || !tiled) return
    const sc = scroller.current
    const holderEl = holder.current
    if (!sc || !holderEl) return
    const fw = Math.floor(Math.floor(size.width) * fullScale)
    const fh = Math.floor(Math.floor(size.height) * fullScale)
    let ctrl: AbortController | null = null
    let shown: { x: number; y: number; w: number; h: number } | null = null
    // The part of the page in view, in whole-page pixels at full scale (unrotated page frame).
    const wanted = (margin: number) => {
      const v = sc.getBoundingClientRect()
      const p = holderEl.getBoundingClientRect()
      const u0 = Math.max(v.left, p.left) - p.left - margin
      const v0 = Math.max(v.top, p.top) - p.top - margin
      const u1 = Math.min(v.right, p.right) - p.left + margin
      const v1 = Math.min(v.bottom, p.bottom) - p.top + margin
      if (u1 <= u0 || v1 <= v0) return null
      const a = toPage(rotation, u0 / zoom, v0 / zoom, size)
      const b = toPage(rotation, u1 / zoom, v1 / zoom, size)
      const x0 = Math.max(0, Math.floor(Math.min(a.x, b.x) * fullScale))
      const y0 = Math.max(0, Math.floor(Math.min(a.y, b.y) * fullScale))
      const x1 = Math.min(fw, Math.ceil(Math.max(a.x, b.x) * fullScale))
      const y1 = Math.min(fh, Math.ceil(Math.max(a.y, b.y) * fullScale))
      return x1 > x0 && y1 > y0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null
    }
    const inside = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) =>
      a.x >= b.x && a.y >= b.y && a.x + a.w <= b.x + b.w && a.y + a.h <= b.y + b.h
    const update = () => {
      const need = wanted(0)
      if (!need || (shown && inside(need, shown))) return
      const region = wanted(TILE_MARGIN)
      if (!region) return
      ctrl?.abort()
      const c = (ctrl = new AbortController())
      client
        .render(index, fullScale, { signal: c.signal, region })
        .then((out) => {
          if (paint(tileCanvas.current, out, c.signal)) {
            shown = region
            setTile({ ...region, scale: fullScale })
          }
        })
        .catch(() => {})
    }
    let timer = setTimeout(update, 80)
    const onScroll = () => {
      clearTimeout(timer)
      timer = setTimeout(update, 100)
    }
    sc.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      clearTimeout(timer)
      ctrl?.abort()
      sc.removeEventListener('scroll', onScroll)
    }
  }, [client, index, visible, tiled, fullScale, zoom, rotation, size, scroller, epoch])

  const needsText = selection !== null || (matches?.length ?? 0) > 0
  useEffect(() => {
    if (!needsText) return
    let cancelled = false
    client
      .pageText(index)
      .then((t) => !cancelled && setText(t))
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [client, index, needsText])

  const selRects = useMemo<Rect[]>(
    () => (text && selection ? rangeRects(text.boxes, selection.from, selection.to) : []),
    [text, selection?.from, selection?.to] // eslint-disable-line react-hooks/exhaustive-deps
  )
  const matchRects = useMemo(
    () => (text && matches ? matches.map(({ m, idx }) => ({ idx, rects: rangeRects(text.boxes, m.from, m.to) })) : []),
    [text, matches]
  )

  const box = (r: Rect, cls: string, key: string) => (
    <div key={key} className={cls} style={{ left: r.x * zoom, top: r.y * zoom, width: r.w * zoom, height: r.h * zoom }} />
  )

  return (
    <div
      ref={(el) => {
        holder.current = el
        elRef(el)
      }}
      data-page={index}
      className="page"
      style={{ width: rotated ? cssH : cssW, height: rotated ? cssW : cssH }}
    >
      {/* Everything below stays in the unrotated page frame; the view rotation turns the whole stack. */}
      <div className="page-stack" style={{ width: cssW, height: cssH, transform: stackTransform(rotation, cssW, cssH) }}>
      <canvas ref={canvas} style={{ width: cssW, height: cssH }} />
      {tiled && (
        <canvas
          ref={tileCanvas}
          className="page-tile"
          style={
            tile && tile.scale === fullScale
              ? { left: tile.x / dpr, top: tile.y / dpr, width: tile.w / dpr, height: tile.h / dpr }
              : { display: 'none' }
          }
        />
      )}
      {(annots || draft) && (
        <AnnotLayer
          annots={draft ? [...(annots ?? []), draft] : annots!}
          pageSize={size}
          rotation={rotation}
          onReshape={annotProps.onReshapeAnnot}
          zoom={zoom}
          interactive={annotProps.tool === 'select'}
          selectedId={annotProps.selectedAnnot}
          editingId={annotProps.editingAnnot}
          touched={annotProps.touchedAnnots}
          onTouch={annotProps.onTouchAnnot}
          onSelect={annotProps.onSelectAnnot}
          onMove={annotProps.onMoveAnnot}
          onResize={annotProps.onResizeAnnot}
          onEdit={annotProps.onEditAnnot}
          onText={annotProps.onAnnotText}
        />
      )}
      <div className="hl-layer">
        {matchRects.flatMap(({ idx, rects }) =>
          rects.map((r, k) => box(r, idx === currentMatch ? 'hl match current' : 'hl match', `m${idx}-${k}`))
        )}
        {selRects.map((r, k) => box(r, 'hl sel', `s${k}`))}
      </div>
      </div>
    </div>
  )
}
