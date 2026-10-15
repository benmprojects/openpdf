import { useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type Ref } from 'react'
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

/** Space around the page stack and between pages, in CSS pixels. */
export const PAD = 16
export const GAP = 12

export interface ViewerHandle {
  scrollToPage(index: number): void
  scrollToMatch(match: Match): void
  copySelection(): Promise<boolean>
  hasSelection(): boolean
  clearSelection(): void
}

interface Props {
  client: PdfClient
  pages: PageSize[]
  zoom: number
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

export function Viewer({ client, pages, zoom, matches, currentMatch, onPageChange, onSize, ref }: Props) {
  const scroller = useRef<HTMLDivElement>(null)
  const pageEls = useRef<(HTMLDivElement | null)[]>([])
  const [sel, setSel] = useState<Selection | null>(null)
  const selRef = useRef<Selection | null>(null)
  selRef.current = sel

  const offsets = useMemo(() => {
    const tops: number[] = []
    let y = PAD
    for (const p of pages) {
      tops.push(y)
      y += Math.round(p.height * zoom) + GAP
    }
    return tops
  }, [pages, zoom])

  const pageAtDocY = useCallback(
    (y: number) => {
      let lo = 0
      let hi = offsets.length - 1
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1
        if (offsets[mid] <= y) lo = mid
        else hi = mid - 1
      }
      return lo
    },
    [offsets]
  )

  // Keep the view anchored on the same spot of the document when the zoom or the window size changes.
  const anchor = useRef<{ x: number; y: number } | null>(null)
  const lastPage = useRef(-1)

  const reportPage = useCallback(() => {
    const el = scroller.current
    if (!el || !offsets.length) return
    const idx = pageAtDocY(el.scrollTop + el.clientHeight * 0.4)
    if (idx !== lastPage.current) {
      lastPage.current = idx
      onPageChange(idx)
    }
  }, [offsets, pageAtDocY, onPageChange])

  useLayoutEffect(() => {
    const el = scroller.current
    const a = anchor.current
    if (el && a) {
      el.scrollTop = a.y * el.scrollHeight - el.clientHeight / 2
      el.scrollLeft = a.x * el.scrollWidth - el.clientWidth / 2
    }
    reportPage()
  }, [zoom, reportPage])

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
      const sc = scroller.current
      if (!sc) return null
      const i = pageAtDocY(cy - sc.getBoundingClientRect().top + sc.scrollTop)
      const el = pageEls.current[i]
      if (!el) return null
      const r = el.getBoundingClientRect()
      const pt = await client.pageText(i)
      const char = hitTest(pt.boxes, (cx - r.left) / zoom, (cy - r.top) / zoom)
      return char < 0 ? null : { page: i, char }
    },
    [client, zoom, pageAtDocY]
  )

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0 || !(e.target as HTMLElement).closest('[data-page]')) return
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
      const onUp = () => {
        window.removeEventListener('mousemove', onMove)
        window.removeEventListener('mouseup', onUp)
      }
      window.addEventListener('mousemove', onMove)
      window.addEventListener('mouseup', onUp)
    },
    [posAt]
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
        if (el && offsets[index] !== undefined) el.scrollTop = offsets[index] - PAD / 2
      },
      async scrollToMatch(match) {
        const el = scroller.current
        const pageEl = pageEls.current[match.page]
        if (!el || !pageEl) return
        const pt = await client.pageText(match.page)
        const r = rangeRects(pt.boxes, match.from, match.to)[0]
        if (!r) return
        const top = offsets[match.page] + r.y * zoom
        if (top < el.scrollTop + 40 || top > el.scrollTop + el.clientHeight - 80) el.scrollTop = top - el.clientHeight / 3
        const left = pageEl.offsetLeft + r.x * zoom
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
      hasSelection: () => selRef.current !== null,
      clearSelection: () => setSel(null)
    }),
    [client, offsets, zoom, ordered]
  )

  return (
    <div ref={scroller} className="scroller" onMouseDown={onMouseDown}>
      <div className="viewer" style={{ padding: PAD }}>
        {pages.map((size, i) => (
          <PageView
            key={i}
            client={client}
            index={i}
            size={size}
            zoom={zoom}
            selection={selForPage(i)}
            matches={matchesByPage.get(i)}
            currentMatch={currentMatch}
            elRef={(el) => {
              pageEls.current[i] = el
            }}
          />
        ))}
      </div>
    </div>
  )
}

interface PageViewProps {
  client: PdfClient
  index: number
  size: PageSize
  zoom: number
  selection: { from: number; to: number } | null
  matches?: { m: Match; idx: number }[]
  currentMatch: number
  elRef: (el: HTMLDivElement | null) => void
}

function PageView({ client, index, size, zoom, selection, matches, currentMatch, elRef }: PageViewProps) {
  const holder = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const [visible, setVisible] = useState(false)
  const [text, setText] = useState<PageText | null>(null)

  const cssW = Math.round(size.width * zoom)
  const cssH = Math.round(size.height * zoom)

  useEffect(() => {
    const el = holder.current
    if (!el) return
    const io = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { rootMargin: '600px 0px' })
    io.observe(el)
    return () => io.disconnect()
  }, [])

  useEffect(() => {
    if (!visible) {
      // Release the bitmap of pages that are far off screen.
      if (canvas.current) canvas.current.width = 0
      return
    }
    const ctrl = new AbortController()
    const dpr = window.devicePixelRatio || 1
    // Debounce so rapid zoom changes do not queue a render per step.
    const timer = setTimeout(() => {
      client
        .render(index, zoom * dpr, { signal: ctrl.signal })
        .then((out) => {
          const cv = canvas.current
          if (ctrl.signal.aborted || !cv) return
          cv.width = out.width
          cv.height = out.height
          cv.getContext('2d')?.putImageData(new ImageData(new Uint8ClampedArray(out.data), out.width, out.height), 0, 0)
        })
        .catch(() => {})
    }, 60)
    return () => {
      clearTimeout(timer)
      ctrl.abort()
    }
  }, [client, index, zoom, visible])

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
      style={{ width: cssW, height: cssH, marginBottom: GAP }}
    >
      <canvas ref={canvas} style={{ width: cssW, height: cssH }} />
      <div className="hl-layer">
        {matchRects.flatMap(({ idx, rects }) =>
          rects.map((r, k) => box(r, idx === currentMatch ? 'hl match current' : 'hl match', `m${idx}-${k}`))
        )}
        {selRects.map((r, k) => box(r, 'hl sel', `s${k}`))}
      </div>
    </div>
  )
}
