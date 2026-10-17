import { useCallback, useEffect, useRef, useState } from 'react'
import { PdfClient } from './pdfClient'
import { TRANSITIONS, defaultPresentation, type PresentationPrefs, type TransitionChoice } from '../../shared/prefs'
import { advanceDelay, keyframesFor, readPageTransitions, stepPage, transitionFor, type PageTransition } from './transitions'
import { t } from './i18n'

interface Props {
  /** The document to show, with pending annotation edits already written in. */
  bytes: Uint8Array
  password?: string
  start: number
  /** Transition, automatic advance and looping, as last chosen. */
  prefs?: PresentationPrefs
  /** The choices were changed on the control bar: remember them. */
  onPrefs?: (p: PresentationPrefs) => void
  onExit: (page: number) => void
}

const TRANSITION_NAMES: Record<TransitionChoice, () => string> = {
  none: () => t('No transition'),
  fade: () => t('Fade'),
  push: () => t('Push'),
  wipe: () => t('Wipe'),
  zoom: () => t('Zoom'),
  document: () => t('As set in the document')
}
const INTERVALS = [0, 2, 3, 5, 10, 15, 30, 60]

/**
 * Full-screen presentation: one page at a time, fitted to the screen on black. Arrow keys, Page Up/Down, space,
 * Home/End, a click (next) or right-click (previous) move between pages; Esc leaves. Pages can change with a transition
 * and move on by themselves after a set time (A pauses and resumes that).
 */
export function Presentation({ bytes, password, start, prefs = defaultPresentation(), onPrefs, onExit }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const [client, setClient] = useState<PdfClient | null>(null)
  const [count, setCount] = useState(0)
  const [page, setPage] = useState(start)
  const [idle, setIdle] = useState(false)
  const [opts, setOpts] = useState<PresentationPrefs>(prefs)
  const [paused, setPaused] = useState(false)
  const [fromFile, setFromFile] = useState<Map<number, PageTransition> | null>(null)
  const pageRef = useRef(page)
  pageRef.current = page
  const sizes = useRef<{ width: number; height: number }[]>([])
  const [view, setView] = useState({ w: window.innerWidth, h: window.innerHeight })
  /** The page last shown and the way the last move went, so the next bitmap can be animated in. */
  const shown = useRef<{ page: number; dir: 1 | -1 }>({ page: start, dir: 1 })
  const animatedFor = useRef(-1)

  const change = (patch: Partial<PresentationPrefs>) => {
    const next = { ...opts, ...patch }
    setOpts(next)
    onPrefs?.(next)
  }

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
    readPageTransitions(bytes).then(setFromFile, () => setFromFile(null))
    const onResize = () => setView({ w: window.innerWidth, h: window.innerHeight })
    window.addEventListener('resize', onResize)
    return () => {
      window.removeEventListener('resize', onResize)
      void window.openpdf.setFullScreen(false)
      c.dispose()
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const go = useCallback(
    (p: number) => {
      const to = Math.max(0, Math.min(count - 1, p))
      if (to === pageRef.current) return
      shown.current = { page: pageRef.current, dir: to > pageRef.current ? 1 : -1 }
      setPage(to)
    },
    [count]
  )

  // Draw the current page as large as the screen allows, then bring it in with the chosen transition.
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
        // Only a change of page is animated (not a resize), and only once per page.
        if (animatedFor.current !== page && shown.current.page !== page) {
          const { effect, seconds } = transitionFor(opts.transition, page, fromFile)
          const frames = keyframesFor(effect, shown.current.dir)
          if (frames.length && typeof cv.animate === 'function') cv.animate(frames, { duration: seconds * 1000, easing: 'ease-in-out' })
        }
        animatedFor.current = page
        shown.current = { page, dir: shown.current.dir }
      })
      .catch(() => {})
    return () => ctrl.abort()
  }, [client, count, page, view]) // eslint-disable-line react-hooks/exhaustive-deps

  // Moving on by itself: after the interval (or the page's own display time), unless paused.
  useEffect(() => {
    if (!count || paused) return
    const delay = advanceDelay(opts.transition, opts.seconds, page, fromFile)
    if (delay === null) return
    const timer = window.setTimeout(() => {
      const next = stepPage(pageRef.current, count, 1, opts.loop)
      if (next === null) setPaused(true)
      else go(next)
    }, delay * 1000)
    return () => window.clearTimeout(timer)
  }, [count, page, paused, opts.transition, opts.seconds, opts.loop, fromFile, go])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Keys inside the control bar (its selects) keep their own meaning.
      if ((e.target as HTMLElement | null)?.closest?.('.presentation-bar') && e.key !== 'Escape') return
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
      } else if (k === 'a') {
        // A: pause or resume the automatic advance.
        e.preventDefault()
        setPaused((v) => !v)
      } else if (k === 'Home') go(0)
      else if (k === 'End') go(count - 1)
    }
    // Capture phase, so the document's own shortcuts underneath do not fire.
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [count, onExit, go])

  // Hide the pointer and the control bar after a moment without movement.
  useEffect(() => {
    let timer = setTimeout(() => setIdle(true), 2000)
    const onMove = () => {
      setIdle(false)
      clearTimeout(timer)
      timer = setTimeout(() => setIdle(true), 2000)
    }
    window.addEventListener('mousemove', onMove)
    return () => {
      clearTimeout(timer)
      window.removeEventListener('mousemove', onMove)
    }
  }, [])

  const auto = opts.seconds > 0 || opts.transition === 'document'
  return (
    <div
      className={idle ? 'presentation idle' : 'presentation'}
      role="dialog"
      aria-label="Presentation"
      onClick={() => go(pageRef.current + 1)}
      onContextMenu={(e) => {
        e.preventDefault()
        go(pageRef.current - 1)
      }}
      onWheel={(e) => go(pageRef.current + (e.deltaY > 0 ? 1 : -1))}
    >
      <canvas ref={canvas} />
      <div className="presentation-counter" aria-live="polite">
        {count ? `${page + 1} / ${count}` : ''}
      </div>
      <div className="presentation-bar" role="toolbar" aria-label={t('Presentation options')} onClick={(e) => e.stopPropagation()} onContextMenu={(e) => e.stopPropagation()} onWheel={(e) => e.stopPropagation()}>
        <label>
          <span>{t('Transition')}</span>
          <select aria-label={t('Transition')} value={opts.transition} onChange={(e) => change({ transition: e.target.value as TransitionChoice })}>
            {TRANSITIONS.map((tr) => (
              <option key={tr} value={tr}>
                {TRANSITION_NAMES[tr]()}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>{t('Advance')}</span>
          <select aria-label={t('Advance automatically')} value={opts.seconds} onChange={(e) => change({ seconds: Number(e.target.value) })}>
            {INTERVALS.map((s) => (
              <option key={s} value={s}>
                {s === 0 ? t('Off') : t('Every {n} s', { n: s })}
              </option>
            ))}
          </select>
        </label>
        <label className="inline">
          <input type="checkbox" checked={opts.loop} onChange={(e) => change({ loop: e.target.checked })} /> {t('Loop')}
        </label>
        {auto && (
          <button type="button" onClick={() => setPaused((v) => !v)} aria-pressed={paused}>
            {paused ? t('Resume') : t('Pause')}
          </button>
        )}
      </div>
    </div>
  )
}
