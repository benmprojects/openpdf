import { useEffect, useMemo, useRef, useState } from 'react'
import { DEFAULT_BLANK_OPTIONS, inkPercent, pagesToDelete } from './blankPages'
import { t } from './i18n'
import { Frame, type DialogProps } from './PageOpsDialogs'
import { compactRanges, pagesWord } from './pageDialogLogic'
import type { PdfClient } from './pdfClient'

/** Longest side, in pixels, of the picture of a page used to measure it. */
const LOOK = 300
/** Pages below this share (percent) of ink get a small picture in the list. */
const THUMB_BELOW = 5
const THUMB = 56

function thumbnail(rgba: Uint8Array, w: number, h: number): string {
  const full = document.createElement('canvas')
  full.width = w
  full.height = h
  full.getContext('2d')?.putImageData(new ImageData(new Uint8ClampedArray(rgba), w, h), 0, 0)
  const k = THUMB / Math.max(w, h)
  const small = document.createElement('canvas')
  small.width = Math.max(1, Math.round(w * k))
  small.height = Math.max(1, Math.round(h * k))
  small.getContext('2d')?.drawImage(full, 0, 0, small.width, small.height)
  return small.toDataURL()
}

/** Delete blank pages: a threshold, and a list of the pages that will go, each of which can be kept. */
export function DeleteBlankDialog({ ctx, client, onCancel, onSubmit, pageLabel }: DialogProps & { client: PdfClient; pageLabel: (page: number) => string }) {
  const [threshold, setThreshold] = useState(String(DEFAULT_BLANK_OPTIONS.thresholdPercent))
  const [margin, setMargin] = useState(String(DEFAULT_BLANK_OPTIONS.marginPercent))
  const [ink, setInk] = useState<number[]>([])
  const [thumbs, setThumbs] = useState<Record<number, string>>({})
  const [progress, setProgress] = useState(0)
  const [kept, setKept] = useState<ReadonlySet<number>>(new Set())
  const run = useRef(0)
  const m = Math.min(20, Math.max(0, Number(margin) || 0))

  // Measure every page; measuring again only when the edge to ignore changes.
  useEffect(() => {
    const id = ++run.current
    const timer = setTimeout(async () => {
      const got: number[] = []
      const small: Record<number, string> = {}
      setProgress(0)
      for (let p = 0; p < ctx.count; p++) {
        if (id !== run.current) return
        try {
          const size = ctx.sizes[p]
          const out = await client.render(p, LOOK / Math.max(size.width, size.height, 1), { forms: true })
          const v = inkPercent(out.data, out.width, out.height, m)
          got.push(v)
          if (v < THUMB_BELOW) small[p] = thumbnail(out.data, out.width, out.height)
        } catch {
          // A page that cannot be drawn is not called blank.
          got.push(100)
        }
        if (p % 5 === 4 || p === ctx.count - 1) {
          setProgress(p + 1)
          setInk([...got])
          setThumbs({ ...small })
        }
      }
    }, 150)
    return () => {
      clearTimeout(timer)
      run.current++
    }
  }, [client, ctx.count, ctx.sizes, m])

  const limit = Math.min(100, Math.max(0, Number(threshold) || 0))
  const scanning = progress < ctx.count
  const plan = useMemo(() => pagesToDelete(ink, limit, kept), [ink, limit, kept])
  const candidates = useMemo(() => ink.map((v, i) => ({ v, i })).filter((x) => x.v < limit), [ink, limit])
  const error = scanning ? t('Looking at the pages…') : plan.error
  return (
    <Frame
      title={t('Delete blank pages')}
      ok={t('Delete')}
      error={error}
      summary={t('{pages} will be deleted: {list}. The document will have {total}. You can undo this.', {
        pages: pagesWord(plan.pages.length),
        list: compactRanges(plan.pages),
        total: pagesWord(ctx.count - plan.pages.length)
      })}
      onClose={onCancel}
      onOk={() => onSubmit({ kind: 'delete', pages: plan.pages })}
      wide
    >
      <div className="pod-field">
        <label>
          <span>{t('Blank when less than this share of the page is marked (%)')}</span>
          <input aria-label={t('Blank threshold percent')} inputMode="decimal" value={threshold} onChange={(e) => setThreshold(e.target.value)} />
        </label>
        <label>
          <span>{t('Ignore the edge of the page (% of each side)')}</span>
          <input aria-label={t('Ignored edge percent')} inputMode="decimal" value={margin} onChange={(e) => setMargin(e.target.value)} />
        </label>
      </div>
      <p className="pod-hint">{t('Raise the threshold for scans with specks; ignore the edge for scanner shadows and punched holes.')}</p>
      <div className="blank-list" role="list" aria-label={t('Pages that will be deleted')}>
        {candidates.map(({ v, i }) => (
          <label key={i} className="blank-row" role="listitem">
            <input
              type="checkbox"
              checked={!kept.has(i)}
              onChange={(e) => {
                const next = new Set(kept)
                if (e.target.checked) next.delete(i)
                else next.add(i)
                setKept(next)
              }}
              aria-label={t('Delete page {page}', { page: pageLabel(i) })}
            />
            {thumbs[i] ? <img src={thumbs[i]} alt="" /> : <span className="blank-nothumb" />}
            <span>
              {t('Page')} {pageLabel(i)}
            </span>
            <span className="muted small">{v.toFixed(v < 0.01 ? 0 : 2)}%</span>
          </label>
        ))}
        {!candidates.length && !scanning && <p className="muted small">{t('No pages are blank at this setting.')}</p>}
        {scanning && (
          <p className="muted small">
            {t('Looking at page {done} of {total}…', {
              done: progress,
              total: ctx.count
            })}
          </p>
        )}
      </div>
    </Frame>
  )
}

/** Swap two pages. */
export function SwapDialog({ ctx, onCancel, onSubmit }: DialogProps) {
  const [a, setA] = useState(String(ctx.selected.length >= 2 ? ctx.selected[0] + 1 : ctx.current + 1))
  const [b, setB] = useState(String(ctx.selected.length >= 2 ? ctx.selected[1] + 1 : Math.min(ctx.count, ctx.current + 2)))
  const x = Number(a)
  const y = Number(b)
  const ok = (n: number) => Number.isInteger(n) && n >= 1 && n <= ctx.count
  const error = !ok(x) || !ok(y) ? t('Enter page numbers from 1 to {count}.', { count: ctx.count }) : x === y ? t('Choose two different pages.') : null
  return (
    <Frame
      title={t('Swap pages')}
      ok={t('Swap')}
      error={error}
      summary={t('Page {a} and page {b} will change places.', { a: x, b: y })}
      onClose={onCancel}
      onOk={() => onSubmit({ kind: 'swap', a: x - 1, b: y - 1 })}
    >
      <div className="pod-field">
        <label>
          <span>{t('First page')}</span>
          <input aria-label={t('First page to swap')} inputMode="numeric" value={a} onChange={(e) => setA(e.target.value)} />
        </label>
        <label>
          <span>{t('Second page')}</span>
          <input aria-label={t('Second page to swap')} inputMode="numeric" value={b} onChange={(e) => setB(e.target.value)} />
        </label>
        <span className="pod-hint">{t('of {count}', { count: ctx.count })}</span>
      </div>
    </Frame>
  )
}
