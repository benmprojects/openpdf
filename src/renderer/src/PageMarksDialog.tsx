import { useState } from 'react'
import { Modal } from './AppDialogs'
import { FONT_FAMILIES, type FontFamily } from './annotations'
import { parsePageRanges } from './pageOps'
import type { BackgroundSpec, HeaderFooterSpec, MarkKind, Slot, WatermarkSpec } from './pageMarks'

export type MarksMode = 'headerfooter' | 'pagenumbers' | 'bates' | 'watermark' | 'background' | 'crop' | 'resize' | 'remove'

export type MarksRequest =
  | { mode: 'headerfooter' | 'pagenumbers' | 'bates'; spec: HeaderFooterSpec }
  | { mode: 'watermark'; spec: WatermarkSpec }
  | { mode: 'background'; spec: BackgroundSpec }
  | { mode: 'crop'; pages: number[]; margins: { top: number; right: number; bottom: number; left: number } }
  | { mode: 'uncrop'; pages: number[] }
  | { mode: 'resize'; pages: number[]; width: number; height: number; fit: boolean }
  | { mode: 'remove'; kinds: MarkKind[] }

interface Props {
  mode: MarksMode
  pageCount: number
  currentPage: number
  selected: number[]
  present: Set<MarkKind>
  onPickImage: () => Promise<Uint8Array | null>
  onApply: (r: MarksRequest) => void
  onClose: () => void
}

const MM = 72 / 25.4
const SLOTS: [Slot, string][] = [
  ['tl', 'Top left'],
  ['tc', 'Top centre'],
  ['tr', 'Top right'],
  ['bl', 'Bottom left'],
  ['bc', 'Bottom centre'],
  ['br', 'Bottom right']
]
const PAPER: Record<string, [number, number]> = {
  A5: [148, 210],
  A4: [210, 297],
  A3: [297, 420],
  A2: [420, 594],
  A1: [594, 841],
  Letter: [215.9, 279.4],
  Legal: [215.9, 355.6],
  Tabloid: [279.4, 431.8]
}
const TITLE: Record<MarksMode, string> = {
  headerfooter: 'Header and footer',
  pagenumbers: 'Page numbers',
  bates: 'Bates numbering',
  watermark: 'Watermark',
  background: 'Background',
  crop: 'Crop pages',
  resize: 'Resize pages',
  remove: 'Remove marks'
}

/** One dialog for every kind of page mark and page box change. */
export function PageMarksDialog({ mode, pageCount, currentPage, selected, present, onPickImage, onApply, onClose }: Props) {
  const [range, setRange] = useState<'all' | 'current' | 'selected' | 'custom'>(selected.length > 1 ? 'selected' : 'all')
  const [custom, setCustom] = useState(`1-${pageCount}`)
  const [error, setError] = useState<string | null>(null)
  // Text marks
  const [slots, setSlots] = useState<Partial<Record<Slot, string>>>(mode === 'headerfooter' ? { tc: '<<file>>', br: 'Page <<page>> of <<pages>>' } : {})
  const [font, setFont] = useState<FontFamily>('Helvetica')
  const [fontSize, setFontSize] = useState(mode === 'watermark' ? 64 : 9)
  const [color, setColor] = useState(mode === 'watermark' ? '#c8323c' : '#333333')
  const [marginMm, setMarginMm] = useState(10)
  const [start, setStart] = useState(1)
  const [slot, setSlot] = useState<Slot>(mode === 'bates' ? 'br' : 'bc')
  const [format, setFormat] = useState('Page <<page>> of <<pages>>')
  const [bates, setBates] = useState({ prefix: 'DOC', suffix: '', start: 1, digits: 6 })
  // Watermark and background
  const [wmKind, setWmKind] = useState<'text' | 'image'>('text')
  const [wmText, setWmText] = useState('DRAFT')
  const [image, setImage] = useState<Uint8Array | null>(null)
  const [opacity, setOpacity] = useState(mode === 'background' ? 1 : 0.25)
  const [angle, setAngle] = useState(45)
  const [scale, setScale] = useState(0.5)
  const [behind, setBehind] = useState(false)
  const [bgColour, setBgColour] = useState('#fffbe6')
  // Boxes
  const [margins, setMargins] = useState({ top: 10, right: 10, bottom: 10, left: 10 })
  const [paper, setPaper] = useState('A4')
  const [customSize, setCustomSize] = useState({ w: 210, h: 297 })
  const [fit, setFit] = useState(true)
  // Removal
  const [kinds, setKinds] = useState<Set<MarkKind>>(new Set(present))

  const pages = (): number[] => {
    if (range === 'all') return Array.from({ length: pageCount }, (_, i) => i)
    if (range === 'current') return [currentPage]
    if (range === 'selected') return selected.length ? selected : [currentPage]
    return parsePageRanges(custom, pageCount)
  }

  const submit = () => {
    try {
      setError(null)
      if (mode === 'remove') {
        if (!kinds.size) throw new Error('Choose what to remove.')
        return onApply({ mode, kinds: [...kinds] })
      }
      const p = pages()
      if (mode === 'headerfooter' || mode === 'pagenumbers' || mode === 'bates') {
        const s: Partial<Record<Slot, string>> =
          mode === 'headerfooter' ? slots : mode === 'pagenumbers' ? { [slot]: format } : { [slot]: '<<bates>>' }
        if (!Object.values(s).some((t) => t?.trim())) throw new Error('Enter some text for at least one position.')
        return onApply({
          mode,
          spec: { slots: s, fontSize, font, color, margin: marginMm * MM, pages: p, startNumber: start, ...(mode === 'bates' ? { bates } : {}) }
        })
      }
      if (mode === 'watermark') {
        if (wmKind === 'image' && !image) throw new Error('Choose a picture for the watermark.')
        if (wmKind === 'text' && !wmText.trim()) throw new Error('Enter the watermark text.')
        return onApply({ mode, spec: { kind: wmKind, text: wmText, image: image ?? undefined, font, fontSize, color, opacity, angle, scale, behind, pages: p } })
      }
      if (mode === 'background') return onApply({ mode, spec: { color: bgColour, image: image ?? undefined, opacity, pages: p } })
      if (mode === 'crop') return onApply({ mode, pages: p, margins: { top: margins.top * MM, right: margins.right * MM, bottom: margins.bottom * MM, left: margins.left * MM } })
      if (mode === 'resize') {
        const [w, h] = paper === 'custom' ? [customSize.w, customSize.h] : PAPER[paper]
        return onApply({ mode, pages: p, width: w * MM, height: h * MM, fit })
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const pickImage = async () => {
    const img = await onPickImage()
    if (img) setImage(img)
  }

  const num = (v: number, set: (n: number) => void, label: string, step = 1, min = 0) => (
    <input type="number" aria-label={label} value={v} step={step} min={min} onChange={(e) => set(Number(e.target.value))} />
  )

  return (
    <Modal title={TITLE[mode]} onClose={onClose}>
      <form
        className="marks-form"
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        {mode === 'headerfooter' && (
          <>
            <div className="marks-slots">
              {SLOTS.map(([k, label]) => (
                <label key={k}>
                  {label}
                  <input aria-label={label} value={slots[k] ?? ''} onChange={(e) => setSlots({ ...slots, [k]: e.target.value })} />
                </label>
              ))}
            </div>
            <p className="muted small">
              Codes: &lt;&lt;page&gt;&gt; &lt;&lt;pages&gt;&gt; &lt;&lt;label&gt;&gt; &lt;&lt;date&gt;&gt; &lt;&lt;file&gt;&gt; &lt;&lt;bates&gt;&gt;
            </p>
          </>
        )}
        {(mode === 'pagenumbers' || mode === 'bates') && (
          <div className="form-grid">
            <label htmlFor="mk-slot">Position</label>
            <select id="mk-slot" value={slot} onChange={(e) => setSlot(e.target.value as Slot)}>
              {SLOTS.map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </select>
            {mode === 'pagenumbers' && (
              <>
                <label htmlFor="mk-format">Format</label>
                <select id="mk-format" value={format} onChange={(e) => setFormat(e.target.value)}>
                  <option value="<<page>>">1</option>
                  <option value="Page <<page>>">Page 1</option>
                  <option value="Page <<page>> of <<pages>>">Page 1 of 9</option>
                  <option value="<<page>> / <<pages>>">1 / 9</option>
                  <option value="<<label>>">Page label (i, ii, 1 …)</option>
                </select>
              </>
            )}
            {mode === 'bates' && (
              <>
                <label htmlFor="mk-prefix">Prefix</label>
                <input id="mk-prefix" value={bates.prefix} onChange={(e) => setBates({ ...bates, prefix: e.target.value })} />
                <label htmlFor="mk-suffix">Suffix</label>
                <input id="mk-suffix" value={bates.suffix} onChange={(e) => setBates({ ...bates, suffix: e.target.value })} />
                <label htmlFor="mk-bstart">First number</label>
                <input id="mk-bstart" type="number" min={0} value={bates.start} onChange={(e) => setBates({ ...bates, start: Number(e.target.value) })} />
                <label htmlFor="mk-digits">Digits</label>
                <input id="mk-digits" type="number" min={1} max={12} value={bates.digits} onChange={(e) => setBates({ ...bates, digits: Number(e.target.value) })} />
                <span className="muted">Example</span>
                <span>{`${bates.prefix}${String(bates.start).padStart(bates.digits, '0')}${bates.suffix}`}</span>
              </>
            )}
          </div>
        )}
        {mode === 'watermark' && (
          <div className="form-grid">
            <span className="muted">Type</span>
            <span className="marks-row">
              <label className="inline">
                <input type="radio" checked={wmKind === 'text'} onChange={() => setWmKind('text')} /> Text
              </label>
              <label className="inline">
                <input type="radio" checked={wmKind === 'image'} onChange={() => setWmKind('image')} /> Picture
              </label>
            </span>
            {wmKind === 'text' ? (
              <>
                <label htmlFor="mk-wmtext">Text</label>
                <input id="mk-wmtext" value={wmText} onChange={(e) => setWmText(e.target.value)} />
              </>
            ) : (
              <>
                <span className="muted">Picture</span>
                <span className="marks-row">
                  <button type="button" className="btn" onClick={() => void pickImage()}>
                    Choose…
                  </button>
                  {image && <span className="muted small">{Math.round(image.length / 1024)} KB</span>}
                </span>
                <label htmlFor="mk-scale">Width</label>
                <select id="mk-scale" value={scale} onChange={(e) => setScale(Number(e.target.value))}>
                  {[0.25, 0.5, 0.75, 1].map((s) => (
                    <option key={s} value={s}>
                      {s * 100}% of the page
                    </option>
                  ))}
                </select>
              </>
            )}
            <label htmlFor="mk-angle">Angle</label>
            <select id="mk-angle" value={angle} onChange={(e) => setAngle(Number(e.target.value))}>
              {[0, 30, 45, 60, 90, -45].map((a) => (
                <option key={a} value={a}>
                  {a}°
                </option>
              ))}
            </select>
            <label htmlFor="mk-place">Place</label>
            <select id="mk-place" value={behind ? 'behind' : 'over'} onChange={(e) => setBehind(e.target.value === 'behind')}>
              <option value="over">Over the page</option>
              <option value="behind">Behind the page content</option>
            </select>
          </div>
        )}
        {mode === 'background' && (
          <div className="form-grid">
            <label htmlFor="mk-bg">Colour</label>
            <input id="mk-bg" type="color" value={bgColour} onChange={(e) => setBgColour(e.target.value)} />
            <span className="muted">Picture</span>
            <span className="marks-row">
              <button type="button" className="btn" onClick={() => void pickImage()}>
                Choose…
              </button>
              {image && (
                <button type="button" className="btn" onClick={() => setImage(null)}>
                  Remove picture
                </button>
              )}
            </span>
          </div>
        )}
        {(mode === 'headerfooter' || mode === 'pagenumbers' || mode === 'bates' || (mode === 'watermark' && wmKind === 'text')) && (
          <div className="form-grid">
            <label htmlFor="mk-font">Font</label>
            <span className="marks-row">
              <select id="mk-font" value={font} onChange={(e) => setFont(e.target.value as FontFamily)}>
                {FONT_FAMILIES.map((f) => (
                  <option key={f}>{f}</option>
                ))}
              </select>
              {num(fontSize, setFontSize, 'Font size', 1, 4)}
              <span className="muted">pt</span>
              <input type="color" aria-label="Text colour" value={color} onChange={(e) => setColor(e.target.value)} />
            </span>
            {mode !== 'watermark' && (
              <>
                <label htmlFor="mk-margin">Margin</label>
                <span className="marks-row">
                  <input id="mk-margin" type="number" min={0} value={marginMm} onChange={(e) => setMarginMm(Number(e.target.value))} />
                  <span className="muted">mm from the edge</span>
                </span>
                {mode !== 'bates' && (
                  <>
                    <label htmlFor="mk-start">Start numbering at</label>
                    <input id="mk-start" type="number" min={0} value={start} onChange={(e) => setStart(Number(e.target.value))} />
                  </>
                )}
              </>
            )}
          </div>
        )}
        {(mode === 'watermark' || mode === 'background') && (
          <div className="form-grid">
            <label htmlFor="mk-opacity">Opacity</label>
            <span className="props-range">
              <input id="mk-opacity" type="range" min={5} max={100} step={5} value={Math.round(opacity * 100)} onChange={(e) => setOpacity(Number(e.target.value) / 100)} />
              <span>{Math.round(opacity * 100)}%</span>
            </span>
          </div>
        )}
        {mode === 'crop' && (
          <div className="form-grid">
            {(['top', 'bottom', 'left', 'right'] as const).map((k) => (
              <span key={k} className="contents">
                <label htmlFor={`mk-crop-${k}`}>{k[0].toUpperCase() + k.slice(1)}</label>
                <span className="marks-row">
                  <input id={`mk-crop-${k}`} type="number" min={0} value={margins[k]} onChange={(e) => setMargins({ ...margins, [k]: Number(e.target.value) })} />
                  <span className="muted">mm</span>
                </span>
              </span>
            ))}
          </div>
        )}
        {mode === 'resize' && (
          <div className="form-grid">
            <label htmlFor="mk-paper">Paper</label>
            <select id="mk-paper" value={paper} onChange={(e) => setPaper(e.target.value)}>
              {Object.keys(PAPER).map((k) => (
                <option key={k} value={k}>
                  {k} ({PAPER[k][0]} × {PAPER[k][1]} mm)
                </option>
              ))}
              <option value="custom">Custom size</option>
            </select>
            {paper === 'custom' && (
              <>
                <span className="muted">Size</span>
                <span className="marks-row">
                  {num(customSize.w, (w) => setCustomSize({ ...customSize, w }), 'Width in mm', 1, 10)} ×{' '}
                  {num(customSize.h, (h) => setCustomSize({ ...customSize, h }), 'Height in mm', 1, 10)} mm
                </span>
              </>
            )}
            <span className="muted">Content</span>
            <label className="inline">
              <input type="checkbox" checked={fit} onChange={(e) => setFit(e.target.checked)} /> Scale to fit the new size
            </label>
          </div>
        )}
        {mode === 'remove' && (
          <div className="marks-remove">
            {(['HeaderFooter', 'Watermark', 'Background'] as MarkKind[]).map((k) => (
              <label key={k} className="inline">
                <input
                  type="checkbox"
                  disabled={!present.has(k)}
                  checked={kinds.has(k)}
                  onChange={(e) => setKinds((s) => (e.target.checked ? new Set(s).add(k) : new Set([...s].filter((x) => x !== k))))}
                />{' '}
                {k === 'HeaderFooter' ? 'Headers, footers, page and Bates numbers' : k === 'Watermark' ? 'Watermarks' : 'Backgrounds'}
                {!present.has(k) && <span className="muted small"> (none)</span>}
              </label>
            ))}
            <p className="muted small">Only marks added with OpenPDF can be removed this way.</p>
          </div>
        )}
        {mode !== 'remove' && (
          <div className="form-grid">
            <label htmlFor="mk-range">Pages</label>
            <span className="marks-row">
              <select id="mk-range" value={range} onChange={(e) => setRange(e.target.value as typeof range)}>
                <option value="all">All pages</option>
                <option value="current">Current page ({currentPage + 1})</option>
                {selected.length > 0 && <option value="selected">Selected thumbnails ({selected.length})</option>}
                <option value="custom">Pages…</option>
              </select>
              {range === 'custom' && <input aria-label="Page range" value={custom} onChange={(e) => setCustom(e.target.value)} />}
            </span>
          </div>
        )}
        {error && <div className="error small">{error}</div>}
        <div className="marks-actions">
          {mode === 'crop' && (
            <button
              type="button"
              className="btn"
              onClick={() => {
                try {
                  onApply({ mode: 'uncrop', pages: pages() })
                } catch (e) {
                  setError(e instanceof Error ? e.message : String(e))
                }
              }}
            >
              Remove cropping
            </button>
          )}
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="primary" type="submit">
            {mode === 'remove' ? 'Remove' : 'Apply'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
