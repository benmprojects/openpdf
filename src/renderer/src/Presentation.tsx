import { useEffect, useRef, useState } from 'react'
import { PdfClient } from './pdfClient'

interface Props {
  /** The document to show, with pending annotation edits already written in. */
  bytes: Uint8Array
  password?: string
  start: number
  onExit: (page: number) => void
}

/**
 * Full-screen presentation: one page at a time, fitted to the screen on black. Arrow keys, Page Up/Down, space,
 * Home/End, a click (next) or right-click (previous) move between pages; Esc leaves.
 */
export function Presentation({ bytes, password, start, onExit }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const [client, setClient] = useState<PdfClient | null>(null)
  const [count, setCount] = useState(0)
  const [page, setPage] = useState(start)
  const [idle, setIdle] = useState(false)
  const pageRef = useRef(page)
  pageRef.current = page
  const sizes = useRef<{ width: number; height: number }[]>([])
  const [view, setView] = useState({ w: window.innerWidth, h: window.innerHeight })

  useEffect(() => {
    void window.openpdf.setFullScreen(true)
    const c = new PdfClient()
    c.load(bytes, password)
      .then((p) => {
        sizes.current = p
        setCount(p.length)
        setClient(c)
      })
      .catch(() => onExit(start))
    const onResize = () => setView({ w: window.innerWidth, h: window.innerHeight })
    window.addEventListener('resize', onResize)
    return () => {
      window.removeEventListener('resize', onResize)
      void window.openpdf.setFullScreen(false)
      c.dispose()
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Draw the current page as large as the screen allows.
  useEffect(() => {
    if (!client || !count) return
    const size = sizes.current[page]
    const dpr = window.devicePixelRatio || 1
    const fit = Math.min(view.w / size.width, view.h / size.height)
    const ctrl = new AbortController()
    client
      .render(page, fit * dpr, { signal: ctrl.signal })
      .then((out) => {
        const cv = canvas.current
        if (!cv || ctrl.signal.aborted) return
        cv.width = out.width
        cv.height = out.height
        cv.style.width = `${out.width / dpr}px`
        cv.style.height = `${out.height / dpr}px`
        cv.getContext('2d')?.putImageData(new ImageData(new Uint8ClampedArray(out.data), out.width, out.height), 0, 0)
      })
      .catch(() => {})
    return () => ctrl.abort()
  }, [client, count, page, view])

  useEffect(() => {
    const go = (p: number) => setPage(Math.max(0, Math.min(count - 1, p)))
    const onKey = (e: KeyboardEvent) => {
      e.stopImmediatePropagation()
      const k = e.key
      if (k === 'Escape' || k === 'F5') {
        e.preventDefault()
        onExit(pageRef.current)
      } else if (k === 'ArrowRight' || k === 'ArrowDown' || k === 'PageDown' || k === ' ' || k === 'Enter' || k === 'n') {
        e.preventDefault()
        go(pageRef.current + 1)
      } else if (k === 'ArrowLeft' || k === 'ArrowUp' || k === 'PageUp' || k === 'Backspace' || k === 'p') {
        e.preventDefault()
        go(pageRef.current - 1)
      } else if (k === 'Home') go(0)
      else if (k === 'End') go(count - 1)
    }
    // Capture phase, so the document's own shortcuts underneath do not fire.
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [count, onExit])

  // Hide the pointer after a moment without movement.
  useEffect(() => {
    let t = setTimeout(() => setIdle(true), 2000)
    const onMove = () => {
      setIdle(false)
      clearTimeout(t)
      t = setTimeout(() => setIdle(true), 2000)
    }
    window.addEventListener('mousemove', onMove)
    return () => {
      clearTimeout(t)
      window.removeEventListener('mousemove', onMove)
    }
  }, [])

  return (
    <div
      className={idle ? 'presentation idle' : 'presentation'}
      role="dialog"
      aria-label="Presentation"
      onClick={() => setPage((p) => Math.min(count - 1, p + 1))}
      onContextMenu={(e) => {
        e.preventDefault()
        setPage((p) => Math.max(0, p - 1))
      }}
      onWheel={(e) => setPage((p) => Math.max(0, Math.min(count - 1, p + (e.deltaY > 0 ? 1 : -1))))}
    >
      <canvas ref={canvas} />
      <div className="presentation-counter" aria-live="polite">
        {count ? `${page + 1} / ${count}` : ''}
      </div>
    </div>
  )
}
