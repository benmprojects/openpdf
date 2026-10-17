import { useMemo, useState } from 'react'
import { Modal } from './AppDialogs'
import { t } from './i18n'
import { parsePageRanges } from './pageOps'
import { planTiles, splitPages, type SplitPlan } from './pageTiles'
import { clampGrid } from '../../shared/tiling'

interface Props {
  /** Displayed size of every page, in points. */
  sizes: { width: number; height: number }[]
  currentPage: number
  selected: number[]
  onApply: (fn: (base: Uint8Array) => Promise<Uint8Array>, done: string) => void
  onClose: () => void
}

const PAPER: Record<string, [number, number]> = {
  A5: [148, 210],
  A4: [210, 297],
  A3: [297, 420],
  A2: [420, 594],
  A1: [594, 841],
  Letter: [215.9, 279.4],
  Tabloid: [279.4, 431.8]
}

/** Cuts pages into a grid of tiles, each tile a page of its own. */
export function SplitPagesDialog({ sizes, currentPage, selected, onApply, onClose }: Props) {
  const [how, setHow] = useState<'grid' | 'paper'>('paper')
  const [rows, setRows] = useState(2)
  const [cols, setCols] = useState(2)
  const [paper, setPaper] = useState('A3')
  const [orientation, setOrientation] = useState<'auto' | 'portrait' | 'landscape'>('auto')
  const [overlap, setOverlap] = useState(5)
  const [range, setRange] = useState<'all' | 'current' | 'selected' | 'custom'>(selected.length > 0 ? 'selected' : 'all')
  const [custom, setCustom] = useState(`1-${sizes.length}`)
  const [error, setError] = useState('')

  const plan: SplitPlan =
    how === 'grid'
      ? { kind: 'grid', rows: clampGrid(rows), cols: clampGrid(cols), overlapMm: Math.max(0, overlap) }
      : { kind: 'paper', paperW: PAPER[paper][0], paperH: PAPER[paper][1], overlapMm: Math.max(0, overlap), orientation }

  const pagesToSplit = (): number[] => {
    if (range === 'all') return sizes.map((_, i) => i)
    if (range === 'current') return [currentPage]
    if (range === 'selected') return selected.length ? selected : [currentPage]
    return parsePageRanges(custom, sizes.length)
  }

  // What the first page chosen would become.
  const preview = useMemo(() => {
    try {
      const first = pagesToSplit()[0]
      const s = sizes[first]
      if (!s) return ''
      const g = planTiles(s.width, s.height, plan)
      return g.tiles.length === 1
        ? t('Page {n} is already small enough and stays as it is.', { n: first + 1 })
        : t('Page {n} becomes {count} pages ({rows} rows by {cols} columns).', { n: first + 1, count: g.tiles.length, rows: g.rows, cols: g.cols })
    } catch {
      return ''
    }
  }, [plan, range, custom, sizes, selected, currentPage]) // eslint-disable-line react-hooks/exhaustive-deps

  const submit = () => {
    try {
      setError('')
      const pages = pagesToSplit()
      if (!pages.length) throw new Error(t('Choose the pages to split.'))
      onApply(async (base) => (await splitPages(base, pages, plan)).bytes, t('Split {n} pages', { n: pages.length }))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <Modal title={t('Split pages')} onClose={onClose}>
      <form
        className="marks-form"
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        <div className="form-grid">
          <label htmlFor="sp-how">{t('Cut')}</label>
          <select id="sp-how" value={how} onChange={(e) => setHow(e.target.value as 'grid' | 'paper')}>
            <option value="paper">{t('Into pieces of a paper size')}</option>
            <option value="grid">{t('Into a grid of rows and columns')}</option>
          </select>
          {how === 'grid' ? (
            <>
              <span className="muted">{t('Grid')}</span>
              <span className="marks-row">
                <input type="number" min={1} max={20} aria-label={t('Rows')} value={rows} onChange={(e) => setRows(Number(e.target.value))} /> {t('rows')} ×
                <input type="number" min={1} max={20} aria-label={t('Columns')} value={cols} onChange={(e) => setCols(Number(e.target.value))} /> {t('columns')}
              </span>
            </>
          ) : (
            <>
              <label htmlFor="sp-paper">{t('Paper')}</label>
              <select id="sp-paper" value={paper} onChange={(e) => setPaper(e.target.value)}>
                {Object.entries(PAPER).map(([k, [w, h]]) => (
                  <option key={k} value={k}>
                    {k} ({w} × {h} mm)
                  </option>
                ))}
              </select>
              <label htmlFor="sp-orient">{t('Orientation')}</label>
              <select id="sp-orient" value={orientation} onChange={(e) => setOrientation(e.target.value as typeof orientation)}>
                <option value="auto">{t('Whichever needs fewer pieces')}</option>
                <option value="portrait">{t('Portrait')}</option>
                <option value="landscape">{t('Landscape')}</option>
              </select>
            </>
          )}
          <label htmlFor="sp-overlap">{t('Overlap')}</label>
          <span className="marks-row">
            <input id="sp-overlap" type="number" min={0} max={100} value={overlap} onChange={(e) => setOverlap(Number(e.target.value) || 0)} />
            <span className="muted">mm</span>
          </span>
          <label htmlFor="sp-range">{t('Pages')}</label>
          <span className="marks-row">
            <select id="sp-range" value={range} onChange={(e) => setRange(e.target.value as typeof range)}>
              <option value="all">{t('All pages')}</option>
              <option value="current">{t('Current page ({n})', { n: currentPage + 1 })}</option>
              {selected.length > 0 && <option value="selected">{t('Selected pages ({n})', { n: selected.length })}</option>}
              <option value="custom">{t('Pages…')}</option>
            </select>
            {range === 'custom' && <input aria-label={t('Page range')} value={custom} onChange={(e) => setCustom(e.target.value)} />}
          </span>
        </div>
        {preview && (
          <p className="muted small" role="status" data-testid="split-preview">
            {preview}
          </p>
        )}
        <p className="muted small">{t('Each piece is a page that shows its part of the original through a crop box, so nothing is redrawn. Remove cropping on a piece to see the whole sheet again.')}</p>
        {error && (
          <div className="error small" role="alert">
            {error}
          </div>
        )}
        <div className="marks-actions">
          <button type="button" className="btn" onClick={onClose}>
            {t('Cancel')}
          </button>
          <button className="primary" type="submit">
            {t('Split')}
          </button>
        </div>
      </form>
    </Modal>
  )
}
