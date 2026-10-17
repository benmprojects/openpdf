import { useState } from 'react'
import { Modal } from './AppDialogs'
import { FONT_FAMILIES, type FontFamily } from './annotations'
import { parsePageRanges } from './pageOps'
import { BatesFilesDialog } from './BatesFilesDialog'
import { msg, t } from './i18n'
import { DATE_FORMATS, formatDate } from './stampLogic'
import { oddEvenPlan, trimPlan, type CropItem } from './cropTools'
import type { Frac } from './contentBox'
import type { PageSize } from './pdfClient'
import type { BackgroundSpec, HeaderFooterSpec, MarkKind, Slot, WatermarkAlign, WatermarkSpec } from './pageMarks'
import { presetFlag, presetMap, presetNumber, presetText, savePreset, type MarkPreset, type MarkPresetKind, type PresetValue } from '../../shared/markPresets'

export type MarksMode = 'headerfooter' | 'pagenumbers' | 'bates' | 'watermark' | 'background' | 'crop' | 'resize' | 'remove'

export type MarksRequest =
  | { mode: 'headerfooter' | 'pagenumbers' | 'bates'; spec: HeaderFooterSpec }
  | { mode: 'watermark'; spec: WatermarkSpec }
  | { mode: 'background'; spec: BackgroundSpec }
  | { mode: 'crop'; pages: number[]; margins: { top: number; right: number; bottom: number; left: number }; plan?: CropItem[]; removeContent?: boolean }
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
  /** Sizes of the pages as shown, for trimming margins automatically. */
  sizes?: PageSize[]
  /** The part of each page that is not white, as shares of its size (null for a blank page). */
  measure?: (pages: number[]) => Promise<(Frac | null)[]>
  /** Saved settings, kept with the program's settings. */
  presets?: MarkPreset[]
  onPresetsChange?: (list: MarkPreset[]) => void
}

const MM = 72 / 25.4
const SLOTS: [Slot, string][] = [
  ['tl', msg('Top left')],
  ['tc', msg('Top centre')],
  ['tr', msg('Top right')],
  ['bl', msg('Bottom left')],
  ['bc', msg('Bottom centre')],
  ['br', msg('Bottom right')]
]
const ALIGNS: [WatermarkAlign, string][] = [
  ['tl', msg('Top left')],
  ['tc', msg('Top centre')],
  ['tr', msg('Top right')],
  ['ml', msg('Middle left')],
  ['mc', msg('Centre')],
  ['mr', msg('Middle right')],
  ['bl', msg('Bottom left')],
  ['bc', msg('Bottom centre')],
  ['br', msg('Bottom right')]
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
  headerfooter: msg('Header and footer'),
  pagenumbers: msg('Page numbers'),
  bates: msg('Bates numbering'),
  watermark: msg('Watermark'),
  background: msg('Background'),
  crop: msg('Crop pages'),
  resize: msg('Resize pages'),
  remove: msg('Remove marks')
}
const SIDES = ['top', 'bottom', 'left', 'right'] as const
type Sides = Record<(typeof SIDES)[number], number>
const SIDE_LABEL: Record<(typeof SIDES)[number], string> = { top: msg('Top'), bottom: msg('Bottom'), left: msg('Left'), right: msg('Right') }

const newPresetId = (kind: string) => `${kind}-${Date.now().toString(36)}`

/** One dialog for every kind of page mark and page box change. */
export function PageMarksDialog({ mode, pageCount, currentPage, selected, present, onPickImage, onApply, onClose, sizes, measure, presets, onPresetsChange }: Props) {
  const [range, setRange] = useState<'all' | 'current' | 'selected' | 'odd' | 'even' | 'custom'>(selected.length > 1 ? 'selected' : 'all')
  const [custom, setCustom] = useState(`1-${pageCount}`)
  const [error, setError] = useState<string | null>(null)
  // Text marks
  const [slots, setSlots] = useState<Partial<Record<Slot, string>>>(mode === 'headerfooter' ? { tc: '<<file>>', br: 'Page <<page>> of <<pages>>' } : {})
  const [font, setFont] = useState<FontFamily>('Helvetica')
  const [fontSize, setFontSize] = useState(mode === 'watermark' ? 64 : 9)
  const [color, setColor] = useState(mode === 'watermark' ? '#c8323c' : '#333333')
  const [marginMm, setMarginMm] = useState(10)
  const [sideMargins, setSideMargins] = useState(false)
  const [sides, setSides] = useState<Sides>({ top: 10, bottom: 10, left: 10, right: 10 })
  const [offX, setOffX] = useState(0)
  const [offY, setOffY] = useState(0)
  const [shrink, setShrink] = useState(false)
  const [dateFormat, setDateFormat] = useState<string>(DATE_FORMATS[0])
  const [firstDifferent, setFirstDifferent] = useState(false)
  const [firstSlots, setFirstSlots] = useState<Partial<Record<Slot, string>>>({})
  const [skipFirst, setSkipFirst] = useState(false)
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
  const [align, setAlign] = useState<WatermarkAlign>('mc')
  const [wmMarginMm, setWmMarginMm] = useState(10)
  const [tile, setTile] = useState(false)
  const [gap, setGap] = useState({ x: 30, y: 30 })
  const [bgColour, setBgColour] = useState('#fffbe6')
  // Boxes
  const [margins, setMargins] = useState<Sides>({ top: 10, right: 10, bottom: 10, left: 10 })
  const [evenMargins, setEvenMargins] = useState<Sides>({ top: 10, right: 10, bottom: 10, left: 10 })
  const [oddEven, setOddEven] = useState(false)
  const [removeContent, setRemoveContent] = useState(false)
  const [trimPad, setTrimPad] = useState(3)
  const [trimSame, setTrimSame] = useState(false)
  const [measuring, setMeasuring] = useState(false)
  const [paper, setPaper] = useState('A4')
  const [customSize, setCustomSize] = useState({ w: 210, h: 297 })
  const [fit, setFit] = useState(true)
  // Removal
  const [kinds, setKinds] = useState<Set<MarkKind>>(new Set(present))
  const [several, setSeveral] = useState(false)
  // Saved settings
  const [presetId, setPresetId] = useState('')
  const [presetName, setPresetName] = useState('')

  const pages = (): number[] => {
    if (range === 'all') return Array.from({ length: pageCount }, (_, i) => i)
    if (range === 'current') return [currentPage]
    if (range === 'selected') return selected.length ? selected : [currentPage]
    if (range === 'odd' || range === 'even') return Array.from({ length: pageCount }, (_, i) => i).filter((i) => i % 2 === (range === 'odd' ? 0 : 1))
    return parsePageRanges(custom, pageCount)
  }

  const toPoints = (m: Sides): { top: number; right: number; bottom: number; left: number } => ({ top: m.top * MM, right: m.right * MM, bottom: m.bottom * MM, left: m.left * MM })

  const submit = () => {
    try {
      setError(null)
      if (mode === 'remove') {
        if (!kinds.size) throw new Error(t('Choose what to remove.'))
        return onApply({ mode, kinds: [...kinds] })
      }
      const p = pages()
      if (mode === 'headerfooter' || mode === 'pagenumbers' || mode === 'bates') {
        const s: Partial<Record<Slot, string>> =
          mode === 'headerfooter' ? slots : mode === 'pagenumbers' ? { [slot]: format } : { [slot]: '<<bates>>' }
        if (!Object.values(s).some((x) => x?.trim())) throw new Error(t('Enter some text for at least one position.'))
        return onApply({
          mode,
          spec: {
            slots: s,
            fontSize,
            font,
            color,
            margin: marginMm * MM,
            pages: p,
            startNumber: start,
            ...(mode === 'bates' ? { bates } : {}),
            ...(sideMargins ? { margins: toPoints(sides) } : {}),
            ...(offX || offY ? { offset: { x: offX * MM, y: offY * MM } } : {}),
            ...(shrink ? { shrink: true } : {}),
            ...(dateFormat !== DATE_FORMATS[0] ? { dateFormat } : {}),
            ...(mode === 'headerfooter' && firstDifferent ? { firstSlots } : {}),
            ...(mode === 'pagenumbers' && skipFirst ? { firstSlots: {} } : {})
          }
        })
      }
      if (mode === 'watermark') {
        if (wmKind === 'image' && !image) throw new Error(t('Choose a picture for the watermark.'))
        if (wmKind === 'text' && !wmText.trim()) throw new Error(t('Enter the watermark text.'))
        return onApply({
          mode,
          spec: {
            kind: wmKind,
            text: wmText,
            image: image ?? undefined,
            font,
            fontSize,
            color,
            opacity,
            angle,
            scale,
            behind,
            pages: p,
            ...(align !== 'mc' ? { align } : {}),
            margin: wmMarginMm * MM,
            ...(offX || offY ? { offset: { x: offX * MM, y: offY * MM } } : {}),
            ...(tile ? { tile: { gapX: gap.x * MM, gapY: gap.y * MM } } : {}),
            ...(shrink ? { shrink: true } : {}),
            ...(dateFormat !== DATE_FORMATS[0] ? { dateFormat } : {})
          }
        })
      }
      if (mode === 'background') return onApply({ mode, spec: { color: bgColour, image: image ?? undefined, opacity, pages: p } })
      if (mode === 'crop') {
        const odd = toPoints(margins)
        return onApply({ mode, pages: p, margins: odd, ...(oddEven ? { plan: oddEvenPlan(p, odd, toPoints(evenMargins)) } : {}), ...(removeContent ? { removeContent: true } : {}) })
      }
      if (mode === 'resize') {
        const [w, h] = paper === 'custom' ? [customSize.w, customSize.h] : PAPER[paper]
        return onApply({ mode, pages: p, width: w * MM, height: h * MM, fit })
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  /** Crops each page to its own content (or all to the common content) after looking at the pages. */
  const trimNow = async () => {
    if (!measure || !sizes) return
    try {
      setError(null)
      const p = pages()
      setMeasuring(true)
      const boxes = await measure(p)
      const plan = trimPlan(p, boxes, sizes, trimPad * MM, trimSame)
      if (!plan.length) throw new Error(t('There is nothing on the chosen pages to trim to: they look blank.'))
      onApply({ mode: 'crop', pages: plan.map((x) => x.page), margins: plan[0].margins, plan, ...(removeContent ? { removeContent: true } : {}) })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setMeasuring(false)
    }
  }

  const pickImage = async () => {
    const img = await onPickImage()
    if (img) setImage(img)
  }

  // ---- Saved settings ----
  const kind = mode as MarkPresetKind
  const canSave = !!onPresetsChange && (mode === 'headerfooter' || mode === 'pagenumbers' || mode === 'bates' || mode === 'watermark' || mode === 'crop')
  const mine = (presets ?? []).filter((p) => p.kind === kind)
  const snapshot = (): Record<string, PresetValue> => ({
    slots: Object.fromEntries(Object.entries(slots).filter(([, v]) => typeof v === 'string')) as Record<string, string>,
    firstDifferent,
    firstSlots: Object.fromEntries(Object.entries(firstSlots).filter(([, v]) => typeof v === 'string')) as Record<string, string>,
    skipFirst,
    font,
    fontSize,
    color,
    marginMm,
    sideMargins,
    sides: { ...sides },
    offX,
    offY,
    shrink,
    dateFormat,
    start,
    slot,
    format,
    prefix: bates.prefix,
    suffix: bates.suffix,
    batesStart: bates.start,
    digits: bates.digits,
    wmText,
    opacity,
    angle,
    behind,
    align,
    wmMarginMm,
    tile,
    gapX: gap.x,
    gapY: gap.y,
    margins: { ...margins },
    evenMargins: { ...evenMargins },
    oddEven,
    removeContent
  })
  const restore = (v: Record<string, PresetValue>) => {
    const sidesFrom = (x: PresetValue | undefined, d: Sides): Sides => {
      const m = typeof x === 'object' ? x : {}
      return { top: presetNumber(m.top, d.top), bottom: presetNumber(m.bottom, d.bottom), left: presetNumber(m.left, d.left), right: presetNumber(m.right, d.right) }
    }
    const fnt = presetText(v.font, font)
    if ((FONT_FAMILIES as readonly string[]).includes(fnt)) setFont(fnt as FontFamily)
    setSlots(presetMap(v.slots) as Partial<Record<Slot, string>>)
    setFirstDifferent(presetFlag(v.firstDifferent, false))
    setFirstSlots(presetMap(v.firstSlots) as Partial<Record<Slot, string>>)
    setSkipFirst(presetFlag(v.skipFirst, false))
    setFontSize(presetNumber(v.fontSize, fontSize))
    setColor(/^#[0-9a-f]{6}$/i.test(presetText(v.color, '')) ? presetText(v.color, color) : color)
    setMarginMm(presetNumber(v.marginMm, marginMm))
    setSideMargins(presetFlag(v.sideMargins, false))
    setSides(sidesFrom(v.sides, sides))
    setOffX(presetNumber(v.offX, 0))
    setOffY(presetNumber(v.offY, 0))
    setShrink(presetFlag(v.shrink, false))
    const df = presetText(v.dateFormat, DATE_FORMATS[0])
    setDateFormat((DATE_FORMATS as readonly string[]).includes(df) ? df : DATE_FORMATS[0])
    setStart(presetNumber(v.start, 1))
    const sl = presetText(v.slot, slot)
    if (SLOTS.some(([k]) => k === sl)) setSlot(sl as Slot)
    setFormat(presetText(v.format, format))
    setBates({ prefix: presetText(v.prefix, bates.prefix), suffix: presetText(v.suffix, bates.suffix), start: presetNumber(v.batesStart, bates.start), digits: presetNumber(v.digits, bates.digits) })
    setWmText(presetText(v.wmText, wmText))
    setOpacity(Math.min(1, Math.max(0.05, presetNumber(v.opacity, opacity))))
    setAngle(presetNumber(v.angle, angle))
    setBehind(presetFlag(v.behind, false))
    const al = presetText(v.align, 'mc')
    setAlign(ALIGNS.some(([k]) => k === al) ? (al as WatermarkAlign) : 'mc')
    setWmMarginMm(presetNumber(v.wmMarginMm, wmMarginMm))
    setTile(presetFlag(v.tile, false))
    setGap({ x: presetNumber(v.gapX, gap.x), y: presetNumber(v.gapY, gap.y) })
    setMargins(sidesFrom(v.margins, margins))
    setEvenMargins(sidesFrom(v.evenMargins, evenMargins))
    setOddEven(presetFlag(v.oddEven, false))
    setRemoveContent(presetFlag(v.removeContent, false))
  }
  const choosePreset = (id: string) => {
    setPresetId(id)
    const p = mine.find((x) => x.id === id)
    if (p) {
      restore(p.values)
      setPresetName(p.name)
    }
  }
  const saveNow = () => {
    const name = presetName.trim()
    if (!name || !onPresetsChange) return
    const existing = mine.find((p) => p.name.toLowerCase() === name.toLowerCase())
    const preset: MarkPreset = { id: existing?.id ?? newPresetId(kind), name, kind, values: snapshot() }
    onPresetsChange(savePreset(presets ?? [], preset))
    setPresetId(preset.id)
  }
  const deleteNow = () => {
    if (!onPresetsChange || !presetId) return
    onPresetsChange((presets ?? []).filter((p) => p.id !== presetId))
    setPresetId('')
  }

  const num = (v: number, set: (n: number) => void, label: string, step = 1, min = 0) => (
    <input type="number" aria-label={label} value={v} step={step} min={min} onChange={(e) => set(Number(e.target.value))} />
  )

  // The several-files dialog takes the place of this one; going back returns here with the settings kept.
  if (several && (mode === 'bates' || mode === 'pagenumbers'))
    return (
      <BatesFilesDialog
        mode={mode}
        template={{ slots: mode === 'bates' ? { [slot]: '<<bates>>' } : { [slot]: format }, fontSize, font, color, margin: marginMm * MM }}
        format={bates}
        pageStart={mode === 'bates' ? 1 : start}
        onClose={() => setSeveral(false)}
      />
    )

  const hasDate = (mode === 'headerfooter' || mode === 'watermark') && (mode === 'headerfooter' || wmKind === 'text')
  const now = new Date()

  return (
    <Modal title={t(TITLE[mode])} onClose={onClose}>
      <form
        className="marks-form"
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        {canSave && (
          <div className="form-grid">
            <label htmlFor="mk-preset">{t('Saved settings')}</label>
            <span className="marks-row">
              <select id="mk-preset" value={presetId} onChange={(e) => choosePreset(e.target.value)}>
                <option value="">{t('(none)')}</option>
                {mine.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <input aria-label={t('Name for these settings')} placeholder={t('Name')} value={presetName} onChange={(e) => setPresetName(e.target.value)} />
              <button type="button" className="btn" disabled={!presetName.trim()} onClick={saveNow} title={t('Keep these settings under this name')}>
                {t('Save settings')}
              </button>
              <button type="button" className="btn" disabled={!presetId} onClick={deleteNow}>
                {t('Delete settings')}
              </button>
            </span>
          </div>
        )}
        {mode === 'headerfooter' && (
          <>
            <div className="marks-slots">
              {SLOTS.map(([k, label]) => (
                <label key={k}>
                  {t(label)}
                  <input aria-label={t(label)} value={slots[k] ?? ''} onChange={(e) => setSlots({ ...slots, [k]: e.target.value })} />
                </label>
              ))}
            </div>
            <p className="muted small">
              {t('Codes')}: &lt;&lt;page&gt;&gt; &lt;&lt;pages&gt;&gt; &lt;&lt;label&gt;&gt; &lt;&lt;date&gt;&gt; &lt;&lt;file&gt;&gt; &lt;&lt;bates&gt;&gt;
            </p>
            <label className="inline">
              <input type="checkbox" checked={firstDifferent} onChange={(e) => setFirstDifferent(e.target.checked)} /> {t('Different text on the first page')}
            </label>
            {firstDifferent && (
              <div className="marks-slots">
                {SLOTS.map(([k, label]) => (
                  <label key={k}>
                    {t('First page: {position}', { position: t(label).toLowerCase() })}
                    <input aria-label={t('First page: {position}', { position: t(label).toLowerCase() })} value={firstSlots[k] ?? ''} onChange={(e) => setFirstSlots({ ...firstSlots, [k]: e.target.value })} />
                  </label>
                ))}
              </div>
            )}
          </>
        )}
        {(mode === 'pagenumbers' || mode === 'bates') && (
          <div className="form-grid">
            <label htmlFor="mk-slot">{t('Position')}</label>
            <select id="mk-slot" value={slot} onChange={(e) => setSlot(e.target.value as Slot)}>
              {SLOTS.map(([k, label]) => (
                <option key={k} value={k}>
                  {t(label)}
                </option>
              ))}
            </select>
            {mode === 'pagenumbers' && (
              <>
                <label htmlFor="mk-format">{t('Format')}</label>
                <select id="mk-format" value={format} onChange={(e) => setFormat(e.target.value)}>
                  <option value="<<page>>">1</option>
                  <option value="Page <<page>>">{t('Page 1')}</option>
                  <option value="Page <<page>> of <<pages>>">{t('Page 1 of 9')}</option>
                  <option value="<<page>> / <<pages>>">1 / 9</option>
                  <option value="<<label>>">{t('Page label (i, ii, 1 …)')}</option>
                </select>
                <span className="muted">{t('First page')}</span>
                <label className="inline">
                  <input type="checkbox" checked={skipFirst} onChange={(e) => setSkipFirst(e.target.checked)} /> {t('Do not number the first page')}
                </label>
              </>
            )}
            {mode === 'bates' && (
              <>
                <label htmlFor="mk-prefix">{t('Prefix')}</label>
                <input id="mk-prefix" value={bates.prefix} onChange={(e) => setBates({ ...bates, prefix: e.target.value })} />
                <label htmlFor="mk-suffix">{t('Suffix')}</label>
                <input id="mk-suffix" value={bates.suffix} onChange={(e) => setBates({ ...bates, suffix: e.target.value })} />
                <label htmlFor="mk-bstart">{t('First number')}</label>
                <input id="mk-bstart" type="number" min={0} value={bates.start} onChange={(e) => setBates({ ...bates, start: Number(e.target.value) })} />
                <label htmlFor="mk-digits">{t('Digits')}</label>
                <input id="mk-digits" type="number" min={1} max={12} value={bates.digits} onChange={(e) => setBates({ ...bates, digits: Number(e.target.value) })} />
                <span className="muted">{t('Example')}</span>
                <span>{`${bates.prefix}${String(bates.start).padStart(bates.digits, '0')}${bates.suffix}`}</span>
              </>
            )}
          </div>
        )}
        {mode === 'watermark' && (
          <div className="form-grid">
            <span className="muted">{t('Type')}</span>
            <span className="marks-row">
              <label className="inline">
                <input type="radio" checked={wmKind === 'text'} onChange={() => setWmKind('text')} /> {t('Text')}
              </label>
              <label className="inline">
                <input type="radio" checked={wmKind === 'image'} onChange={() => setWmKind('image')} /> {t('Picture')}
              </label>
            </span>
            {wmKind === 'text' ? (
              <>
                <label htmlFor="mk-wmtext">{t('Text')}</label>
                <input id="mk-wmtext" value={wmText} onChange={(e) => setWmText(e.target.value)} />
              </>
            ) : (
              <>
                <span className="muted">{t('Picture')}</span>
                <span className="marks-row">
                  <button type="button" className="btn" onClick={() => void pickImage()}>
                    {t('Choose…')}
                  </button>
                  {image && <span className="muted small">{Math.round(image.length / 1024)} KB</span>}
                </span>
                <label htmlFor="mk-scale">{t('Width')}</label>
                <select id="mk-scale" value={scale} onChange={(e) => setScale(Number(e.target.value))}>
                  {[0.25, 0.5, 0.75, 1].map((s) => (
                    <option key={s} value={s}>
                      {t('{pct}% of the page', { pct: s * 100 })}
                    </option>
                  ))}
                </select>
              </>
            )}
            <label htmlFor="mk-angle">{t('Angle')}</label>
            <select id="mk-angle" value={angle} onChange={(e) => setAngle(Number(e.target.value))}>
              {[0, 30, 45, 60, 90, -45].map((a) => (
                <option key={a} value={a}>
                  {a}°
                </option>
              ))}
            </select>
            <label htmlFor="mk-place">{t('Place')}</label>
            <select id="mk-place" value={behind ? 'behind' : 'over'} onChange={(e) => setBehind(e.target.value === 'behind')}>
              <option value="over">{t('Over the page')}</option>
              <option value="behind">{t('Behind the page content')}</option>
            </select>
            <label htmlFor="mk-align">{t('Position')}</label>
            <select id="mk-align" value={align} onChange={(e) => setAlign(e.target.value as WatermarkAlign)}>
              {ALIGNS.map(([k, label]) => (
                <option key={k} value={k}>
                  {t(label)}
                </option>
              ))}
            </select>
            {align !== 'mc' && (
              <>
                <label htmlFor="mk-wmmargin">{t('Distance from the edge')}</label>
                <span className="marks-row">
                  <input id="mk-wmmargin" type="number" min={0} value={wmMarginMm} onChange={(e) => setWmMarginMm(Number(e.target.value))} />
                  <span className="muted">mm</span>
                </span>
              </>
            )}
            <span className="muted">{t('Repeat')}</span>
            <span className="marks-row">
              <label className="inline">
                <input type="checkbox" checked={tile} onChange={(e) => setTile(e.target.checked)} /> {t('Tile across the page')}
              </label>
              {tile && (
                <>
                  {num(gap.x, (x) => setGap({ ...gap, x }), t('Gap across (mm)'), 1, 0)}
                  {num(gap.y, (y) => setGap({ ...gap, y }), t('Gap down (mm)'), 1, 0)}
                  <span className="muted">mm</span>
                </>
              )}
            </span>
          </div>
        )}
        {mode === 'background' && (
          <div className="form-grid">
            <label htmlFor="mk-bg">{t('Colour')}</label>
            <input id="mk-bg" type="color" value={bgColour} onChange={(e) => setBgColour(e.target.value)} />
            <span className="muted">{t('Picture')}</span>
            <span className="marks-row">
              <button type="button" className="btn" onClick={() => void pickImage()}>
                {t('Choose…')}
              </button>
              {image && (
                <button type="button" className="btn" onClick={() => setImage(null)}>
                  {t('Remove picture')}
                </button>
              )}
            </span>
          </div>
        )}
        {(mode === 'headerfooter' || mode === 'pagenumbers' || mode === 'bates' || (mode === 'watermark' && wmKind === 'text')) && (
          <div className="form-grid">
            <label htmlFor="mk-font">{t('Font')}</label>
            <span className="marks-row">
              <select id="mk-font" value={font} onChange={(e) => setFont(e.target.value as FontFamily)}>
                {FONT_FAMILIES.map((f) => (
                  <option key={f}>{f}</option>
                ))}
              </select>
              {num(fontSize, setFontSize, t('Font size'), 1, 4)}
              <span className="muted">pt</span>
              <input type="color" aria-label={t('Text colour')} value={color} onChange={(e) => setColor(e.target.value)} />
            </span>
            {mode !== 'watermark' && (
              <>
                <label htmlFor="mk-margin">{t('Margin')}</label>
                <span className="marks-row">
                  <input id="mk-margin" type="number" min={0} value={marginMm} disabled={sideMargins} onChange={(e) => setMarginMm(Number(e.target.value))} />
                  <span className="muted">{t('mm from the edge')}</span>
                  <label className="inline">
                    <input type="checkbox" checked={sideMargins} onChange={(e) => setSideMargins(e.target.checked)} /> {t('Set each side')}
                  </label>
                </span>
                {sideMargins && (
                  <>
                    <span className="muted">{t('Margins (mm)')}</span>
                    <span className="marks-row">
                      {SIDES.map((k) => (
                        <label key={k} className="inline">
                          {t(SIDE_LABEL[k])}
                          <input type="number" min={0} aria-label={t('{side} margin (mm)', { side: t(SIDE_LABEL[k]) })} value={sides[k]} onChange={(e) => setSides({ ...sides, [k]: Number(e.target.value) })} />
                        </label>
                      ))}
                    </span>
                  </>
                )}
                {mode !== 'bates' && (
                  <>
                    <label htmlFor="mk-start">{t('Start numbering at')}</label>
                    <input id="mk-start" type="number" min={0} value={start} onChange={(e) => setStart(Number(e.target.value))} />
                  </>
                )}
              </>
            )}
          </div>
        )}
        {(mode === 'headerfooter' || mode === 'pagenumbers' || mode === 'bates' || mode === 'watermark') && (
          <div className="form-grid">
            <span className="muted">{t('Offset')}</span>
            <span className="marks-row">
              <input type="number" aria-label={t('Move right (mm)')} value={offX} onChange={(e) => setOffX(Number(e.target.value))} />
              <input type="number" aria-label={t('Move down (mm)')} value={offY} onChange={(e) => setOffY(Number(e.target.value))} />
              <span className="muted">{t('mm right and down')}</span>
            </span>
            {mode !== 'bates' && (
              <>
                <span className="muted">{t('Size')}</span>
                <label className="inline">
                  <input type="checkbox" checked={shrink} onChange={(e) => setShrink(e.target.checked)} />{' '}
                  {mode === 'watermark' ? t('Shrink to fit the page') : t('Shrink text that is too long to fit')}
                </label>
              </>
            )}
            {hasDate && (
              <>
                <label htmlFor="mk-datefmt">{t('Date format')}</label>
                <select id="mk-datefmt" value={dateFormat} onChange={(e) => setDateFormat(e.target.value)}>
                  {DATE_FORMATS.map((f) => (
                    <option key={f} value={f}>
                      {f} ({formatDate(f, now)})
                    </option>
                  ))}
                </select>
              </>
            )}
          </div>
        )}
        {(mode === 'watermark' || mode === 'background') && (
          <div className="form-grid">
            <label htmlFor="mk-opacity">{t('Opacity')}</label>
            <span className="props-range">
              <input id="mk-opacity" type="range" min={5} max={100} step={5} value={Math.round(opacity * 100)} onChange={(e) => setOpacity(Number(e.target.value) / 100)} />
              <span>{Math.round(opacity * 100)}%</span>
            </span>
          </div>
        )}
        {mode === 'crop' && (
          <>
            <div className="form-grid">
              {SIDES.map((k) => (
                <span key={k} className="contents">
                  <label htmlFor={`mk-crop-${k}`}>{t(SIDE_LABEL[k])}</label>
                  <span className="marks-row">
                    <input id={`mk-crop-${k}`} type="number" min={0} value={margins[k]} onChange={(e) => setMargins({ ...margins, [k]: Number(e.target.value) })} />
                    <span className="muted">mm</span>
                  </span>
                </span>
              ))}
            </div>
            <label className="inline">
              <input type="checkbox" checked={oddEven} onChange={(e) => setOddEven(e.target.checked)} /> {t('Different margins for even pages')}
            </label>
            {oddEven && (
              <div className="form-grid">
                {SIDES.map((k) => (
                  <span key={k} className="contents">
                    <label htmlFor={`mk-crop-even-${k}`}>{t('Even pages: {side}', { side: t(SIDE_LABEL[k]).toLowerCase() })}</label>
                    <span className="marks-row">
                      <input id={`mk-crop-even-${k}`} type="number" min={0} value={evenMargins[k]} onChange={(e) => setEvenMargins({ ...evenMargins, [k]: Number(e.target.value) })} />
                      <span className="muted">mm</span>
                    </span>
                  </span>
                ))}
                <span className="muted small">{t('The margins above are for odd pages (1, 3, 5 …).')}</span>
              </div>
            )}
            <label className="inline">
              <input type="checkbox" checked={removeContent} onChange={(e) => setRemoveContent(e.target.checked)} /> {t('Remove the cropped area for good')}
            </label>
            {removeContent && <p className="muted small">{t('The page itself becomes the cropped size, so the edges cannot be brought back, and comments outside it are deleted. Text or pictures that were outside stay in the file unseen: use redaction for anything sensitive.')}</p>}
            {measure && sizes && (
              <div className="form-grid">
                <span className="muted">{t('Trim white margins')}</span>
                <span className="marks-row">
                  <input type="number" min={0} step={0.5} aria-label={t('Space to leave round the content (mm)')} value={trimPad} onChange={(e) => setTrimPad(Number(e.target.value))} />
                  <span className="muted">{t('mm round the content')}</span>
                  <label className="inline">
                    <input type="checkbox" checked={trimSame} onChange={(e) => setTrimSame(e.target.checked)} /> {t('Same crop on every page')}
                  </label>
                  <button type="button" className="btn" disabled={measuring} onClick={() => void trimNow()}>
                    {measuring ? t('Looking at the pages…') : t('Trim white margins')}
                  </button>
                </span>
              </div>
            )}
          </>
        )}
        {mode === 'resize' && (
          <div className="form-grid">
            <label htmlFor="mk-paper">{t('Paper')}</label>
            <select id="mk-paper" value={paper} onChange={(e) => setPaper(e.target.value)}>
              {Object.keys(PAPER).map((k) => (
                <option key={k} value={k}>
                  {k} ({PAPER[k][0]} × {PAPER[k][1]} mm)
                </option>
              ))}
              <option value="custom">{t('Custom size')}</option>
            </select>
            {paper === 'custom' && (
              <>
                <span className="muted">{t('Size')}</span>
                <span className="marks-row">
                  {num(customSize.w, (w) => setCustomSize({ ...customSize, w }), t('Width in mm'), 1, 10)} ×{' '}
                  {num(customSize.h, (h) => setCustomSize({ ...customSize, h }), t('Height in mm'), 1, 10)} mm
                </span>
              </>
            )}
            <span className="muted">{t('Content')}</span>
            <label className="inline">
              <input type="checkbox" checked={fit} onChange={(e) => setFit(e.target.checked)} /> {t('Scale to fit the new size')}
            </label>
          </div>
        )}
        {mode === 'remove' && (
          <div className="marks-remove">
            {(['HeaderFooter', 'Watermark', 'Background', 'Overlay'] as MarkKind[]).map((k) => (
              <label key={k} className="inline">
                <input
                  type="checkbox"
                  disabled={!present.has(k)}
                  checked={kinds.has(k)}
                  onChange={(e) => setKinds((s) => (e.target.checked ? new Set(s).add(k) : new Set([...s].filter((x) => x !== k))))}
                />{' '}
                {k === 'HeaderFooter' ? t('Headers, footers, page and Bates numbers') : k === 'Watermark' ? t('Watermarks') : k === 'Overlay' ? t('Overlaid pages') : t('Backgrounds')}
                {!present.has(k) && <span className="muted small"> {t('(none)')}</span>}
              </label>
            ))}
            <p className="muted small">{t('Only marks added with OpenPDF can be removed this way.')}</p>
          </div>
        )}
        {mode !== 'remove' && (
          <div className="form-grid">
            <label htmlFor="mk-range">{t('Pages')}</label>
            <span className="marks-row">
              <select id="mk-range" value={range} onChange={(e) => setRange(e.target.value as typeof range)}>
                <option value="all">{t('All pages')}</option>
                <option value="current">{t('Current page ({n})', { n: currentPage + 1 })}</option>
                {selected.length > 0 && <option value="selected">{t('Selected thumbnails ({n})', { n: selected.length })}</option>}
                <option value="odd">{t('Odd pages')}</option>
                <option value="even" disabled={pageCount < 2}>
                  {t('Even pages')}
                </option>
                <option value="custom">{t('Pages…')}</option>
              </select>
              {range === 'custom' && <input aria-label={t('Page range')} value={custom} onChange={(e) => setCustom(e.target.value)} />}
            </span>
          </div>
        )}
        {error && <div className="error small">{error}</div>}
        <div className="marks-actions">
          {(mode === 'bates' || mode === 'pagenumbers') && (
            <button type="button" className="btn" onClick={() => setSeveral(true)} title={t('Number a list of files so the number carries on from one to the next')}>
              {t('Apply to several files…')}
            </button>
          )}
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
              {t('Remove cropping')}
            </button>
          )}
          <button type="button" className="btn" onClick={onClose}>
            {t('Cancel')}
          </button>
          <button className="primary" type="submit">
            {mode === 'remove' ? t('Remove') : t('Apply')}
          </button>
        </div>
      </form>
    </Modal>
  )
}
