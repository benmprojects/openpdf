import { useState } from 'react'
import { Modal } from './AppDialogs'
import { t } from './i18n'
import { parsePageRanges } from './pageOps'
import { overlayPageCount, overlayPages, type OverlayAlign, type OverlayFit, type OverlaySpec } from './overlay'

interface Props {
  pageCount: number
  currentPage: number
  selected: number[]
  /** Runs the change on the document (one undo step) and says what was done. */
  onApply: (fn: (base: Uint8Array) => Promise<Uint8Array>, done: string) => void
  onClose: () => void
}

const MM = 72 / 25.4

/** Lays pages of another PDF over or under pages of this one. */
export function OverlayDialog({ pageCount, currentPage, selected, onApply, onClose }: Props) {
  const ALIGN: [OverlayAlign, string][] = [
    ['tl', t('Top left')],
    ['tc', t('Top centre')],
    ['tr', t('Top right')],
    ['ml', t('Middle left')],
    ['mc', t('Centre')],
    ['mr', t('Middle right')],
    ['bl', t('Bottom left')],
    ['bc', t('Bottom centre')],
    ['br', t('Bottom right')]
  ]
  const [other, setOther] = useState<{ name: string; data: Uint8Array; pages: number } | null>(null)
  const [sourceText, setSourceText] = useState('1')
  const [pairing, setPairing] = useState<OverlaySpec['pairing']>('sequence')
  const [range, setRange] = useState<'all' | 'current' | 'selected' | 'custom'>(selected.length > 1 ? 'selected' : 'all')
  const [custom, setCustom] = useState(`1-${pageCount}`)
  const [behind, setBehind] = useState(false)
  const [fit, setFit] = useState<OverlayFit>('fit')
  const [align, setAlign] = useState<OverlayAlign>('mc')
  const [dx, setDx] = useState(0)
  const [dy, setDy] = useState(0)
  const [opacity, setOpacity] = useState(1)
  const [tinted, setTinted] = useState(false)
  const [tint, setTint] = useState('#d02020')
  const [error, setError] = useState('')

  const choose = async () => {
    setError('')
    const f = await window.openpdf.pickFile({ name: 'PDF', ext: ['pdf'] })
    if (!f) return
    try {
      const pages = await overlayPageCount(f.data)
      setOther({ name: f.name, data: f.data, pages })
      setSourceText(pages > 1 ? `1-${pages}` : '1')
    } catch (e) {
      setError(/encrypt/i.test(String(e)) ? t('That PDF is protected. Open it, remove the password, and save a copy first.') : t('That file could not be read as a PDF.'))
    }
  }

  const submit = () => {
    try {
      setError('')
      if (!other) throw new Error(t('Choose the PDF to overlay.'))
      const sourcePages = parsePageRanges(sourceText, other.pages)
      if (!sourcePages.length) throw new Error(t('Choose which pages of the other PDF to use.'))
      const pages =
        range === 'all' ? Array.from({ length: pageCount }, (_, i) => i) : range === 'current' ? [currentPage] : range === 'selected' ? (selected.length ? selected : [currentPage]) : parsePageRanges(custom, pageCount)
      if (!pages.length) throw new Error(t('Choose the pages to overlay.'))
      const spec: OverlaySpec = { pages, sourcePages, pairing, behind, fit, align, offsetX: dx * MM, offsetY: dy * MM, opacity, tint: tinted ? tint : null }
      onApply((base) => overlayPages(base, other.data, spec), t('Overlaid {n} pages from {name}', { n: pages.length, name: other.name }))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <Modal title={t('Overlay pages')} onClose={onClose}>
      <form
        className="marks-form"
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        <div className="form-grid">
          <span className="muted">{t('Other PDF')}</span>
          <span className="marks-row">
            <button type="button" className="btn" onClick={() => void choose()}>
              {t('Choose…')}
            </button>
            {other && (
              <span className="muted small" data-testid="overlay-source">
                {other.name} ({other.pages})
              </span>
            )}
          </span>
          <label htmlFor="ov-src">{t('Its pages')}</label>
          <input id="ov-src" value={sourceText} onChange={(e) => setSourceText(e.target.value)} disabled={!other} />
          <label htmlFor="ov-pair">{t('Pairing')}</label>
          <select id="ov-pair" value={pairing} onChange={(e) => setPairing(e.target.value as OverlaySpec['pairing'])}>
            <option value="sequence">{t('One after another (starting again when they run out)')}</option>
            <option value="first">{t('The first of them on every page')}</option>
          </select>
          <label htmlFor="ov-range">{t('Over pages')}</label>
          <span className="marks-row">
            <select id="ov-range" value={range} onChange={(e) => setRange(e.target.value as typeof range)}>
              <option value="all">{t('All pages')}</option>
              <option value="current">{t('Current page ({n})', { n: currentPage + 1 })}</option>
              {selected.length > 0 && <option value="selected">{t('Selected pages ({n})', { n: selected.length })}</option>}
              <option value="custom">{t('Pages')}</option>
            </select>
            {range === 'custom' && <input aria-label={t('Page range')} value={custom} onChange={(e) => setCustom(e.target.value)} />}
          </span>
          <label htmlFor="ov-place">{t('Place')}</label>
          <select id="ov-place" value={behind ? 'under' : 'over'} onChange={(e) => setBehind(e.target.value === 'under')}>
            <option value="over">{t('Over the page')}</option>
            <option value="under">{t('Under the page content')}</option>
          </select>
          <label htmlFor="ov-fit">{t('Size')}</label>
          <select id="ov-fit" value={fit} onChange={(e) => setFit(e.target.value as OverlayFit)}>
            <option value="fit">{t('Fit the page')}</option>
            <option value="fill">{t('Fill the page')}</option>
            <option value="actual">{t('Actual size')}</option>
          </select>
          <label htmlFor="ov-align">{t('Alignment')}</label>
          <select id="ov-align" value={align} onChange={(e) => setAlign(e.target.value as OverlayAlign)}>
            {ALIGN.map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
          <span className="muted">{t('Offset')}</span>
          <span className="marks-row">
            <input type="number" aria-label={t('Offset right (mm)')} value={dx} onChange={(e) => setDx(Number(e.target.value) || 0)} /> →
            <input type="number" aria-label={t('Offset down (mm)')} value={dy} onChange={(e) => setDy(Number(e.target.value) || 0)} /> ↓
            <span className="muted">mm</span>
          </span>
          <label htmlFor="ov-opacity">{t('Opacity')}</label>
          <span className="props-range">
            <input id="ov-opacity" type="range" min={5} max={100} step={5} value={Math.round(opacity * 100)} onChange={(e) => setOpacity(Number(e.target.value) / 100)} />
            <span>{Math.round(opacity * 100)}%</span>
          </span>
          <span className="muted">{t('Colour')}</span>
          <span className="marks-row">
            <label className="inline">
              <input type="checkbox" checked={tinted} onChange={(e) => setTinted(e.target.checked)} /> {t('Draw the overlay in one colour')}
            </label>
            {tinted && <input type="color" aria-label={t('Overlay colour')} value={tint} onChange={(e) => setTint(e.target.value)} />}
          </span>
        </div>
        <p className="muted small">{t('A tinted overlay shows only its dark lines, so two revisions of a drawing can be compared: tint one, and what changed stands out.')}</p>
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
            {t('Apply')}
          </button>
        </div>
      </form>
    </Modal>
  )
}
