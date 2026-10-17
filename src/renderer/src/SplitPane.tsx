import { useEffect, useMemo, useRef, useState } from 'react'
import { X, ZoomIn, ZoomOut } from 'lucide-react'
import type { PageSize, PdfClient } from './pdfClient'
import { displayDims, stackTransform, type Rotation } from './viewRotation'
import { PANE_STEPS, paneZoom, stepPaneZoom, type PaneZoom } from './workspace'
import { IconButton } from './Ribbon'
import { AnnotLayer } from './AnnotLayer'
import { FormLayer, type FormsView } from './FormLayer'
import type { Annot } from './annotations'
import type { RenderStyle } from './Viewer'
import type { Performance } from '../../shared/prefs'
import { t } from './i18n'

const PAD = 16

/** What a second view shows on top of the page images: the document's comments (measurements included) and fields, read-only. */
export interface PaneOverlays {
  annots: Annot[]
  /** Imported annotations the overlay now draws (PDFium stops drawing the original). */
  touched: ReadonlySet<number>
  forms?: FormsView
}

const NO_IDS: ReadonlySet<number> = new Set()
const noop = () => undefined

/** One page of a second view: a canvas drawn by PDFium while it is near the visible area, with read-only overlays. */
function SplitPage({
  client,
  index,
  size,
  zoom,
  rotation,
  epoch,
  overlays,
  style,
  ahead
}: {
  client: PdfClient
  index: number
  size: PageSize
  zoom: number
  rotation: Rotation
  epoch: number
  overlays?: PaneOverlays
  style?: RenderStyle
  ahead: number
}) {
  const holder = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const [visible, setVisible] = useState(false)
  const cssW = Math.round(size.width * zoom)
  const cssH = Math.round(size.height * zoom)
  const rotated = rotation === 90 || rotation === 270
  const hasForms = !!overlays?.forms && overlays.forms.fields.length > 0
  const thin = !!style?.thin
  const clear = !!style?.transparent

  useEffect(() => {
    const el = holder.current
    if (!el) return
    const io = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { rootMargin: `${Math.min(ahead, 400)}px 0px` })
    io.observe(el)
    return () => io.disconnect()
  }, [ahead])

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
        // Fields are drawn as controls over the page, as in the first view, so edits that are not saved yet show here too.
        .render(index, scale, { signal: ctrl.signal, priority: 1, forms: !hasForms, thin, transparent: clear })
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
  }, [client, index, zoom, visible, epoch, size.width, size.height, hasForms, thin, clear])

  const pageAnnots = useMemo(() => (overlays ? overlays.annots.filter((a) => a.page === index) : []), [overlays, index])

  return (
    <div ref={holder} data-split-page={index} data-zoom={zoom} data-rotation={rotation} className="page" style={{ width: rotated ? cssH : cssW, height: rotated ? cssW : cssH }}>
      <div className="page-stack" style={{ width: cssW, height: cssH, transform: stackTransform(rotation, cssW, cssH) }}>
        <canvas ref={canvas} style={{ width: cssW, height: cssH }} />
        {overlays && pageAnnots.length > 0 && (
          // Read-only: pointer events are off and the layer cannot take focus (inert), so nothing here edits the document.
          <div className="split-overlay" inert>
            <AnnotLayer
              annots={pageAnnots}
              zoom={zoom}
              interactive={false}
              selectedId={null}
              editingId={null}
              touched={overlays.touched ?? NO_IDS}
              onTouch={noop}
              onSelect={noop}
              onMove={noop}
              onResize={noop}
              onReshape={noop}
              pageSize={size}
              rotation={rotation}
              onEdit={noop}
              onText={noop}
            />
          </div>
        )}
        {overlays?.forms && hasForms && (
          <div className="split-overlay" inert>
            <FormLayer page={index} zoom={zoom} rotation={rotation} forms={overlays.forms} interactive={false} />
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * Another view of the open document with its own scrolling and zoom. It shows the pages as PDFium draws them (a single
 * column) with the document's comments, form fields and measurements laid over them, read-only; editing happens in the
 * first view. A four-way split uses three of these beside the first view.
 */
export function SplitPane({
  client,
  pages,
  rotation,
  epoch,
  vertical,
  quad,
  title,
  overlays,
  renderStyle,
  perf,
  onClose
}: {
  client: PdfClient
  pages: PageSize[]
  rotation: Rotation
  epoch: number
  /** Side by side (true) or one above the other (false). */
  vertical: boolean
  /** One of the three extra panes of a four-way split. */
  quad?: boolean
  /** Names the pane: Second view, Third view or Fourth view. */
  title?: string
  overlays?: PaneOverlays
  renderStyle?: RenderStyle
  perf?: Performance
  onClose: () => void
}) {
  const name = title ?? t('Second view')
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
    <section className={`split-pane${vertical ? ' vertical' : ''}${quad ? ' quad' : ''}`} role="region" aria-label={name}>
      <div className="split-bar toolbar" role="toolbar" aria-label={t('{view} controls', { view: name })}>
        <span className="muted small">{name}</span>
        <span className="status-fill" />
        <IconButton icon={ZoomOut} label={t('Zoom out {view}', { view: name.toLowerCase() })} onClick={() => setMode(stepPaneZoom(zoom, -1))} />
        <select
          aria-label={t('{view} zoom', { view: name })}
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
        <IconButton icon={ZoomIn} label={t('Zoom in {view}', { view: name.toLowerCase() })} onClick={() => setMode(stepPaneZoom(zoom, 1))} />
        <IconButton icon={X} label={t('Close {view}', { view: name.toLowerCase() })} onClick={onClose} />
      </div>
      <div ref={scroller} className={`split-scroller${renderStyle?.transparent ? ' tgrid' : ''}`} role="group" aria-label={t('{view} pages', { view: name })}>
        <div className="split-pages" data-split-zoom={zoom}>
          {pages.map((p, i) => (
            <SplitPage key={i} client={client} index={i} size={p} zoom={zoom} rotation={rotation} epoch={epoch} overlays={overlays} style={renderStyle} ahead={perf?.renderAhead ?? 400} />
          ))}
        </div>
      </div>
    </section>
  )
}
