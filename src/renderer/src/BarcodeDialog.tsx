import { useMemo, useState } from 'react'
import { Modal } from './AppDialogs'
import { BARCODE_KINDS, TEMPLATE_TOKENS, barcodeShape, quietZone, type BarcodeKind, type QrEcc } from './barcode'
import { planBarcodes, textFor, type BarcodeSpot } from './barcodePlan'
import type { BarcodePlacement } from './barcodeWrite'
import { t } from './i18n'
import { parsePageRanges } from './pageOps'

/** The symbol drawn from its own shapes, for a preview. */
export function BarcodePreview({ kind, text, ecc, showText }: { kind: BarcodeKind; text: string; ecc: QrEcc; showText: boolean }) {
  const shape = useMemo(() => {
    try {
      return { ok: barcodeShape(kind, text, ecc), error: '' }
    } catch (e) {
      return { ok: null, error: e instanceof Error ? e.message : String(e) }
    }
  }, [kind, text, ecc])
  if (!shape.ok) {
    return (
      <p className="error-text" role="alert">
        {shape.error}
      </p>
    )
  }
  const s = shape.ok
  const q = quietZone(kind)
  const w = s.width + 2 * q
  // A bar code is drawn as tall as the symbol is wide divided by four, so the picture has a bar code's proportions.
  const barH = s.is2d ? s.height : Math.max(8, Math.round(s.width / 4))
  const h = s.is2d ? w : barH + (showText && s.label ? 6 : 0)
  return (
    <svg className="barcode-preview" role="img" aria-label={t('Barcode preview')} viewBox={`0 0 ${w} ${h}`} width={s.is2d ? 140 : 280} height={s.is2d ? 140 : (280 * h) / w} shapeRendering="crispEdges">
      <rect width={w} height={h} fill="#fff" />
      {s.rects.map((r, i) => (s.is2d ? <rect key={i} x={q + r.x} y={q + r.y} width={r.w} height={r.h} fill="#000" /> : <rect key={i} x={q + r.x} y={0} width={r.w} height={barH} fill="#000" />))}
      {!s.is2d && showText && s.label && (
        <text x={w / 2} y={h - 1} textAnchor="middle" fontSize={5} fontFamily="Helvetica, Arial, sans-serif">
          {s.label}
        </text>
      )}
    </svg>
  )
}

const SPOTS: [BarcodeSpot, string][] = [
  ['top-left', 'Top left'],
  ['top-right', 'Top right'],
  ['bottom-left', 'Bottom left'],
  ['bottom-right', 'Bottom right'],
  ['centre', 'Centre']
]

/**
 * Place a QR code or bar code on pages: typed text or a template with fields, a corner and size, and whether it is page
 * content or an annotation that can be selected later.
 */
export function BarcodeDialog({
  sizes,
  currentPage,
  fileName,
  onPlace,
  onClose
}: {
  /** The size of every page as shown, in points. */
  sizes: { width: number; height: number }[]
  /** Zero-based. */
  currentPage: number
  fileName: string
  onPlace: (items: BarcodePlacement[]) => void
  onClose: () => void
}) {
  const [kind, setKind] = useState<BarcodeKind>('qr')
  const [template, setTemplate] = useState('{filename} page {page} of {pages}')
  const [ecc, setEcc] = useState<QrEcc>('M')
  const [showText, setShowText] = useState(true)
  const [width, setWidth] = useState('25')
  const [height, setHeight] = useState('12')
  const [margin, setMargin] = useState('10')
  const [spot, setSpot] = useState<BarcodeSpot>('bottom-right')
  const [placeAs, setPlaceAs] = useState<'content' | 'annotation'>('content')
  const [asLink, setAsLink] = useState(false)
  const [which, setWhich] = useState<'current' | 'all' | 'range'>('current')
  const [range, setRange] = useState('')
  const [error, setError] = useState('')

  const now = useMemo(() => new Date(), [])
  const pagesOf = (): number[] => (which === 'current' ? [currentPage] : which === 'all' ? sizes.map((_, i) => i) : parsePageRanges(range, sizes.length))
  const opts = () => ({ kind, template, ecc, showText, widthMm: Number(width), heightMm: Number(height), marginMm: Number(margin), spot, as: placeAs, pages: pagesOf(), sizes, fileName, date: now })
  const preview = textFor({ template, fileName, date: now, sizes }, currentPage)

  const submit = () => {
    try {
      onPlace(planBarcodes(opts()).map((p) => ({ ...p, link: asLink })))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <Modal title={t('Add a QR code or barcode')} onClose={onClose}>
      <form
        className="marks-form props-form"
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        <label className="props-row">
          <span>{t('Type')}</span>
          <select aria-label={t('Barcode type')} value={kind} onChange={(e) => setKind(e.target.value as BarcodeKind)}>
            {BARCODE_KINDS.map((k) => (
              <option key={k.kind} value={k.kind}>
                {t(k.label)}
              </option>
            ))}
          </select>
        </label>
        <label className="props-row">
          <span>{t('Text')}</span>
          <input aria-label={t('Barcode text')} value={template} onChange={(e) => setTemplate(e.target.value)} autoFocus />
        </label>
        <div className="marks-row" role="group" aria-label={t('Insert a field')}>
          {TEMPLATE_TOKENS.map((tok) => (
            <button key={tok} type="button" onClick={() => setTemplate(template + tok)} title={t('Add {field} to the text', { field: tok })}>
              {tok}
            </button>
          ))}
        </div>
        <p className="muted small">{t('The file name is shown without .pdf and the date as DD/MM/YYYY. Each page gets its own text.')}</p>
        <p className="muted small">{t('This page would say: {text}', { text: preview })}</p>
        {kind === 'qr' && (
          <label className="props-row">
            <span>{t('Error correction')}</span>
            <select aria-label={t('Error correction')} value={ecc} onChange={(e) => setEcc(e.target.value as QrEcc)}>
              <option value="L">{t('Low (7%)')}</option>
              <option value="M">{t('Medium (15%)')}</option>
              <option value="Q">{t('Quartile (25%)')}</option>
              <option value="H">{t('High (30%)')}</option>
            </select>
          </label>
        )}
        {kind !== 'qr' && (
          <label className="inline">
            <input type="checkbox" checked={showText} onChange={(e) => setShowText(e.target.checked)} /> {t('Print the text under the bars')}
          </label>
        )}
        <BarcodePreview kind={kind} text={preview} ecc={ecc} showText={showText} />
        <div className="marks-row">
          <label className="inline">
            {kind === 'qr' ? t('Size (mm)') : t('Width (mm)')}
            <input type="number" aria-label={t('Width in millimetres')} min={3} step={1} value={width} onChange={(e) => setWidth(e.target.value)} />
          </label>
          {kind !== 'qr' && (
            <label className="inline">
              {t('Height (mm)')}
              <input type="number" aria-label={t('Height in millimetres')} min={3} step={1} value={height} onChange={(e) => setHeight(e.target.value)} />
            </label>
          )}
        </div>
        <div className="marks-row">
          <label className="inline">
            {t('Place')}
            <select aria-label={t('Position')} value={spot} onChange={(e) => setSpot(e.target.value as BarcodeSpot)}>
              {SPOTS.map(([k, label]) => (
                <option key={k} value={k}>
                  {t(label)}
                </option>
              ))}
            </select>
          </label>
          <label className="inline">
            {t('Margin (mm)')}
            <input type="number" aria-label={t('Margin in millimetres')} min={0} step={1} value={margin} onChange={(e) => setMargin(e.target.value)} />
          </label>
        </div>
        <div className="marks-row">
          <label className="inline">
            {t('Pages')}
            <select aria-label={t('Pages')} value={which} onChange={(e) => setWhich(e.target.value as typeof which)}>
              <option value="current">{t('This page')}</option>
              <option value="all">{t('Every page')}</option>
              <option value="range">{t('Pages…')}</option>
            </select>
          </label>
          {which === 'range' && <input aria-label={t('Page range')} placeholder="1-3, 5" value={range} onChange={(e) => setRange(e.target.value)} />}
        </div>
        <label className="props-row">
          <span>{t('Added as')}</span>
          <select aria-label={t('Added as')} value={placeAs} onChange={(e) => setPlaceAs(e.target.value as typeof placeAs)}>
            <option value="content">{t('Page content (part of the page)')}</option>
            <option value="annotation">{t('Stamp annotation (can be selected and removed)')}</option>
          </select>
        </label>
        <label className="inline">
          <input type="checkbox" checked={asLink} onChange={(e) => setAsLink(e.target.checked)} /> {t('Make the barcode a link when its text is a web address')}
        </label>
        {error && (
          <p className="error-text" role="alert">
            {error}
          </p>
        )}
        <div className="marks-actions">
          <button type="button" onClick={onClose}>
            {t('Cancel')}
          </button>
          <button className="primary" type="submit">
            {t('Add barcode')}
          </button>
        </div>
      </form>
    </Modal>
  )
}
