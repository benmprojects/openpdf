import { useEffect, useRef, useState, type RefObject } from 'react'
import { X } from 'lucide-react'
import type { PageSize, PdfClient } from './pdfClient'
import type { ViewerHandle } from './Viewer'
import { displayDims, stackTransform, type Rotation } from './viewRotation'
import { IconButton } from './Ribbon'
import { overviewScale, overviewToPage, viewportRect, zoomForWidth } from './viewTools'
import { t } from './i18n'

const BOX_W = 200
const BOX_H = 220

type Vp = { page: number; u: number; v: number; w: number; h: number }

/**
 * A small overview of the page in view with a rectangle for what the main view shows. Drag the rectangle (or click the
 * overview) to move the view; drag the corner handle to zoom.
 */
export function PanZoom({
  client,
  pages,
  rotation,
  zoom,
  viewer,
  onZoomTo,
  onClose
}: {
  client: PdfClient
  pages: PageSize[]
  rotation: Rotation
  zoom: number
  viewer: RefObject<ViewerHandle | null>
  onZoomTo: (zoom: number) => void
  onClose: () => void
}) {
  const [vp, setVp] = useState<Vp | null>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const zoomRef = useRef(zoom)
  zoomRef.current = zoom

  // Follow the main view: it scrolls without telling anyone, so look at it a few times a second.
  useEffect(() => {
    const read = () => {
      const v = viewer.current?.viewport() ?? null
      setVp((old) => (v && old && old.page === v.page && Math.abs(old.u - v.u) < 0.05 && Math.abs(old.v - v.v) < 0.05 && Math.abs(old.w - v.w) < 0.05 && Math.abs(old.h - v.h) < 0.05 ? old : v))
    }
    read()
    const timer = window.setInterval(read, 120)
    return () => window.clearInterval(timer)
  }, [viewer])

  const page = vp?.page ?? 0
  const size = pages[page]
  const dims = size ? displayDims(size, rotation) : { width: 1, height: 1 }
  const scale = overviewScale(dims.width, dims.height, BOX_W, BOX_H)
  const w = Math.round(dims.width * scale)
  const h = Math.round(dims.height * scale)

  // The overview picture: the page drawn small (view rotation applied with the same transform the page view uses).
  useEffect(() => {
    if (!size) return
    const ctrl = new AbortController()
    const dpr = window.devicePixelRatio || 1
    const cssScale = overviewScale(size.width, size.height, rotation === 90 || rotation === 270 ? BOX_H : BOX_W, rotation === 90 || rotation === 270 ? BOX_W : BOX_H)
    client
      .render(page, cssScale * dpr, { signal: ctrl.signal, priority: 2 })
      .then((out) => {
        const cv = canvas.current
        if (!cv || ctrl.signal.aborted) return
        cv.width = out.width
        cv.height = out.height
        cv.getContext('2d')?.putImageData(new ImageData(new Uint8ClampedArray(out.data), out.width, out.height), 0, 0)
      })
      .catch(() => {})
    return () => ctrl.abort()
  }, [client, page, size, rotation])

  const drag = (e: React.PointerEvent, mode: 'move' | 'zoom') => {
    if (!vp || !viewer.current) return
    e.preventDefault()
    e.stopPropagation()
    const frame = (e.currentTarget as HTMLElement).closest('.panzoom-page') as HTMLElement
    const base = frame.getBoundingClientRect()
    const start = { x: e.clientX, y: e.clientY, vp }
    const move = (ev: PointerEvent) => {
      if (mode === 'move') {
        // Keep the grabbed spot of the rectangle under the pointer; the view is centred on the rectangle's centre.
        const dx = (ev.clientX - start.x) / scale
        const dy = (ev.clientY - start.y) / scale
        const c = overviewToPage((start.vp.u + start.vp.w / 2 + dx) * scale, (start.vp.v + start.vp.h / 2 + dy) * scale, scale, dims.width, dims.height)
        viewer.current?.panTo(start.vp.page, c.u, c.v)
      } else {
        // Corner handle: the new width of the rectangle is the distance from its left edge to the pointer.
        const px = (ev.clientX - base.left) / scale
        const newW = Math.max(10, px - start.vp.u)
        onZoomTo(zoomForWidth(zoomRef.current, start.vp.w, newW))
      }
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const r = vp ? viewportRect(vp, scale) : null
  const rotated = rotation === 90 || rotation === 270
  const cw = rotated ? h : w
  const ch = rotated ? w : h
  return (
    <aside className="panzoom" role="region" aria-label={t('Pan and zoom')}>
      <div className="panzoom-head">
        <span>{t('Pan and zoom')}</span>
        <IconButton icon={X} label={t('Close pan and zoom')} onClick={onClose} />
      </div>
      <div
        className="panzoom-page"
        style={{ width: w, height: h }}
        onPointerDown={(e) => {
          // A click on the overview centres the main view there.
          if (!vp || !viewer.current) return
          const b = e.currentTarget.getBoundingClientRect()
          const c = overviewToPage(e.clientX - b.left, e.clientY - b.top, scale, dims.width, dims.height)
          viewer.current.panTo(vp.page, c.u, c.v)
        }}
      >
        <div style={{ width: cw, height: ch, transform: stackTransform(rotation, cw, ch), transformOrigin: '0 0' }}>
          <canvas ref={canvas} style={{ width: cw, height: ch, display: 'block' }} />
        </div>
        {r && (
          <div className="panzoom-view" data-testid="panzoom-view" style={{ left: r.x, top: r.y, width: Math.max(4, r.w), height: Math.max(4, r.h) }} onPointerDown={(e) => drag(e, 'move')}>
            <div className="panzoom-handle" aria-label={t('Drag to zoom')} title={t('Drag to zoom')} onPointerDown={(e) => drag(e, 'zoom')} />
          </div>
        )}
      </div>
    </aside>
  )
}
