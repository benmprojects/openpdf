import { useEffect, useMemo, useRef, useState } from 'react'
import { X, ZoomIn, ZoomOut } from 'lucide-react'
import type { PageSize, PdfClient } from './pdfClient'
import { displayDims, stackTransform, type Rotation } from './viewRotation'
import { PANE_STEPS, paneZoom, stepPaneZoom, type PaneZoom } from './workspace'
import { IconButton } from './Ribbon'
import { t } from './i18n'

const PAD = 16

/** One page of the second view: a canvas drawn by PDFium while it is near the visible area. */
function SplitPage({ client, index, size, zoom, rotation, epoch }: { client: PdfClient; index: number; size: PageSize; zoom: number; rotation: Rotation; epoch: number }) {
  const holder = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const [visible, setVisible] = useState(false)
  const cssW = Math.round(size.width * zoom)
  const cssH = Math.round(size.height * zoom)
  const rotated = rotation === 90 || rotation === 270

  useEffect(() => {
    const el = holder.current
    if (!el) return
    const io = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { rootMargin: '400px 0px' })
    io.observe(el)
    return () => io.disconnect()
  }, [])

  useEffect(() => {
    const cv = canvas.current
    if (!visible) {
      if (cv) cv.width = 0
      return
    }
    const ctrl = new AbortController()
    const dpr = window.devicePixelRatio || 1
    // Very large bitmaps are drawn a little softer rather than exhausting memory.
    const scale = Math.min(zoom * dpr, Math.sqrt(16_000_000 / (size.width * size.height)))
    const timer = setTimeout(() => {
      client
        .render(index, scale, { signal: ctrl.signal, priority: 1 })
        .then((out) => {
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
  }, [client, index, zoom, visible, epoch, size.width, size.height])

  return (
    <div ref={holder} data-split-page={index} data-zoom={zoom} data-rotation={rotation} className="page" style={{ width: rotated ? cssH : cssW, height: rotated ? cssW : cssH }}>
      <div className="page-stack" style={{ width: cssW, height: cssH, transform: stackTransform(rotation, cssW, cssH) }}>
        <canvas ref={canvas} style={{ width: cssW, height: cssH }} />
      </div>
    </div>
  )
}

/**
 * The second view of a split window: the same document with its own scrolling and zoom. It shows the pages as PDFium
 * draws them (a single column) and is read-only; editing happens in the first view.
 */
export function SplitPane({
  client,
  pages,
  rotation,
  epoch,
  vertical,
  onClose
}: {
  client: PdfClient
  pages: PageSize[]
  rotation: Rotation
  epoch: number
  /** Side by side (true) or one above the other (false). */
  vertical: boolean
  onClose: () => void
}) {
  const scroller = useRef<HTMLDivElement>(null)
  const [mode, setMode] = useState<PaneZoom>('fit-width')
  const [view, setView] = useState({ w: 0, h: 0 })
  const dims = useMemo(() => pages.map((p) => displayDims(p, rotation)), [pages, rotation])
  const zoom = useMemo(() => paneZoom(mode, view, dims, PAD), [mode, view, dims])

  useEffect(() => {
    const el = scroller.current
    if (!el) return
    // The scroll bar takes some width; fitting to the inner width avoids a sideways scroll bar.
    const measure = () => setView((v) => (v.w === el.clientWidth && v.h === el.clientHeight ? v : { w: el.clientWidth, h: el.clientHeight }))
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const zoomValue = typeof mode === 'number' ? (PANE_STEPS.includes(mode) ? String(mode) : 'custom') : mode
  return (
    <section className={vertical ? 'split-pane vertical' : 'split-pane'} role="region" aria-label={t('Second view')}>
      <div className="split-bar toolbar" role="toolbar" aria-label={t('Second view controls')}>
        <span className="muted small">{t('Second view')}</span>
        <span className="status-fill" />
        <IconButton icon={ZoomOut} label={t('Zoom out second view')} onClick={() => setMode(stepPaneZoom(zoom, -1))} />
        <select
          aria-label={t('Second view zoom')}
          value={zoomValue}
          onChange={(e) => {
            const v = e.target.value
            if (v === 'fit-width' || v === 'fit-page') setMode(v)
            else if (v !== 'custom') setMode(Number(v))
          }}
        >
          <option value="fit-width">{t('Fit width')}</option>
          <option value="fit-page">{t('Fit page')}</option>
          {zoomValue === 'custom' && <option value="custom">{Math.round(zoom * 100)}%</option>}
          {PANE_STEPS.map((s) => (
            <option key={s} value={s}>
              {Math.round(s * 100)}%
            </option>
          ))}
        </select>
        <IconButton icon={ZoomIn} label={t('Zoom in second view')} onClick={() => setMode(stepPaneZoom(zoom, 1))} />
        <IconButton icon={X} label={t('Close second view')} onClick={onClose} />
      </div>
      <div ref={scroller} className="split-scroller" role="group" aria-label={t('Second view pages')}>
        <div className="split-pages" data-split-zoom={zoom}>
          {pages.map((p, i) => (
            <SplitPage key={i} client={client} index={i} size={p} zoom={zoom} rotation={rotation} epoch={epoch} />
          ))}
        </div>
      </div>
    </section>
  )
}
