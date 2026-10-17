import { useEffect, useRef, useState } from 'react'
import type { PageSize, PdfClient } from './pdfClient'
import { toPage, type Rotation } from './viewRotation'
import { LOUPE_SIZE, loupePosition, loupeRegion } from './workspace'
import { t } from './i18n'

/**
 * A magnifier window that follows the pointer over any page of the document (the main view or the second view).
 * It draws the part of the page under the pointer from PDFium at a larger scale, so the detail is sharp rather than
 * stretched.
 */
export function Loupe({ client, pages, zoom, rotation, factor }: { client: PdfClient; pages: PageSize[]; zoom: number; rotation: Rotation; factor: number }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const [at, setAt] = useState<{ left: number; top: number } | null>(null)
  const latest = useRef({ client, pages, zoom, rotation, factor })
  latest.current = { client, pages, zoom, rotation, factor }

  useEffect(() => {
    let ctrl: AbortController | null = null
    let timer = 0
    const hide = () => {
      ctrl?.abort()
      setAt(null)
    }
    const onMove = (e: MouseEvent) => {
      const el = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>('[data-page],[data-split-page]')
      const cur = latest.current
      if (!el) return hide()
      const index = Number(el.dataset.page ?? el.dataset.splitPage)
      const size = cur.pages[index]
      if (!size) return hide()
      // The split view's pages carry their own zoom; the main view's use the document's.
      const z = el.dataset.zoom ? Number(el.dataset.zoom) : cur.zoom
      const r = el.getBoundingClientRect()
      const pt = toPage(cur.rotation, (e.clientX - r.left) / z, (e.clientY - r.top) / z, size)
      const dpr = window.devicePixelRatio || 1
      const plan = loupeRegion(pt, size, LOUPE_SIZE, z, cur.factor, dpr)
      if (!plan) return hide()
      setAt(loupePosition({ x: e.clientX, y: e.clientY }, LOUPE_SIZE, { w: window.innerWidth, h: window.innerHeight }))
      clearTimeout(timer)
      timer = window.setTimeout(() => {
        ctrl?.abort()
        const c = (ctrl = new AbortController())
        cur.client
          .render(index, plan.scale, { signal: c.signal, region: plan.region, priority: 0 })
          .then((out) => {
            const cv = canvas.current
            if (c.signal.aborted || !cv) return
            cv.width = out.width
            cv.height = out.height
            cv.getContext('2d')?.putImageData(new ImageData(new Uint8ClampedArray(out.data), out.width, out.height), 0, 0)
          })
          .catch(() => {})
      }, 30)
    }
    window.addEventListener('mousemove', onMove)
    document.addEventListener('mouseleave', hide)
    return () => {
      window.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseleave', hide)
      clearTimeout(timer)
      ctrl?.abort()
    }
  }, [])

  // The canvas is always mounted so it keeps its picture while the window moves; it is only hidden off a page.
  return (
    <div className="loupe" role="img" aria-label={t('Magnifier')} hidden={!at} style={at ? { left: at.left, top: at.top, width: LOUPE_SIZE, height: LOUPE_SIZE } : undefined}>
      <canvas ref={canvas} style={{ width: LOUPE_SIZE, height: LOUPE_SIZE, transform: rotation ? `rotate(${rotation}deg)` : undefined }} />
      <span className="loupe-cross" aria-hidden />
    </div>
  )
}
