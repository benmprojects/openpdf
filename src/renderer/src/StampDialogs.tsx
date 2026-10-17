import { useState } from 'react'
import { t } from './i18n'
import { Frame, PagesControl } from './PageOpsDialogs'
import { compactRanges, initialRange, resolveRange, type DocContext, type RangeValue } from './pageDialogLogic'
import { previewLines } from './StampPicker'
import { StampThumb } from './StampThumb'
import { CAT_MINE, DATE_FORMATS, TIME_FORMATS, usesNumber, type Counters, type StampDef } from './stampLogic'

const COLOURS = ['#1c8a3a', '#e5322d', '#1f5fd1', '#ff9a3c', '#7b3fe4', '#000000']

function CategoryField({ id, value, onChange, categories }: { id: string; value: string; onChange: (v: string) => void; categories: string[] }) {
  return (
    <div className="pod-field">
      <label htmlFor={id}>
        <span>{t('Category')}</span>
        <input id={id} list={`${id}-list`} value={value} maxLength={60} onChange={(e) => onChange(e.target.value)} />
      </label>
      <datalist id={`${id}-list`}>
        {categories.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>
    </div>
  )
}

/** Make or change a text stamp: wording with fields, colour, category and numbering. */
export function TextStampDialog({
  initial,
  categories,
  author,
  counters,
  onSave,
  onCancel
}: {
  initial: StampDef | null
  categories: string[]
  author: string
  counters: Counters
  onSave: (def: Omit<StampDef, 'id'> & { id?: string }) => void
  onCancel: () => void
}) {
  const [name, setName] = useState(initial?.name ?? '')
  const [category, setCategory] = useState(initial?.category ?? CAT_MINE)
  const [title, setTitle] = useState(initial?.title ?? '')
  const [detail, setDetail] = useState(initial?.detail ?? '')
  const [color, setColor] = useState(initial?.color ?? COLOURS[2])
  const [prefix, setPrefix] = useState(initial?.numberPrefix ?? '')
  const [digits, setDigits] = useState(initial?.numberDigits ?? 3)
  const [start, setStart] = useState(initial ? (counters[initial.id] ?? initial.numberStart ?? 1) : 1)
  const [target, setTarget] = useState<'title' | 'detail'>('title')
  const numbered = usesNumber(title, detail)
  const insert = (field: string) => (target === 'title' ? setTitle((v) => v + field) : setDetail((v) => v + field))
  const draft: StampDef = {
    id: initial?.id ?? 'draft',
    name: name.trim() || title.trim(),
    category: category.trim() || CAT_MINE,
    kind: 'text',
    title: title.trim(),
    detail: detail.trim(),
    color,
    ...(numbered ? { numberPrefix: prefix, numberDigits: digits, numberStart: start } : {})
  }
  const preview = previewLines(draft, author, {})
  const error = !title.trim() ? t('Type the wording for the stamp.') : null
  return (
    <Frame
      title={initial ? t('Edit text stamp') : t('New text stamp')}
      ok={t('Save')}
      error={error}
      summary={t('Fields are filled in when the stamp is placed.')}
      onClose={onCancel}
      onOk={() => onSave({ ...draft, ...(initial ? { id: initial.id } : {}) })}
      wide
    >
      <div className="stamp-editor">
        <div className="stamp-editor-preview" aria-label={t('Preview')}>
          <StampThumb def={draft} title={preview.title || ' '} detail={preview.detail} maxW={300} maxH={90} />
        </div>
        <div className="pod-field">
          <label>
            <span>{t('Name')}</span>
            <input value={name} maxLength={80} placeholder={title} onChange={(e) => setName(e.target.value)} />
          </label>
        </div>
        <CategoryField id="stamp-cat" value={category} onChange={setCategory} categories={categories} />
        <div className="pod-field">
          <label>
            <span>{t('Wording')}</span>
            <input aria-label={t('Wording')} value={title} maxLength={120} onFocus={() => setTarget('title')} onChange={(e) => setTitle(e.target.value)} />
          </label>
        </div>
        <div className="pod-field">
          <label>
            <span>{t('Second line')}</span>
            <input aria-label={t('Second line')} value={detail} maxLength={160} placeholder="{author}, {date}" onFocus={() => setTarget('detail')} onChange={(e) => setDetail(e.target.value)} />
          </label>
        </div>
        <div className="pod-field stamp-fields">
          <span>{t('Insert field')}</span>
          <button type="button" onClick={() => insert('{date}')}>{t('Date')}</button>
          <button type="button" onClick={() => insert('{time}')}>{t('Time')}</button>
          <button type="button" onClick={() => insert('{author}')}>{t('Author')}</button>
          <button type="button" onClick={() => insert('{number}')}>{t('Number')}</button>
          <select aria-label={t('Date format')} value="" onChange={(e) => e.target.value && insert(`{date:${e.target.value}}`)}>
            <option value="">{t('Date format…')}</option>
            {DATE_FORMATS.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
          <select aria-label={t('Time format')} value="" onChange={(e) => e.target.value && insert(`{time:${e.target.value}}`)}>
            <option value="">{t('Time format…')}</option>
            {TIME_FORMATS.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </div>
        {numbered && (
          <div className="pod-field stamp-fields">
            <span>{t('Numbering')}</span>
            <label>
              {t('Prefix')} <input aria-label={t('Number prefix')} value={prefix} maxLength={20} onChange={(e) => setPrefix(e.target.value)} />
            </label>
            <label>
              {t('Digits')} <input type="number" min={1} max={10} aria-label={t('Number digits')} value={digits} onChange={(e) => setDigits(Math.max(1, Math.min(10, Number(e.target.value) || 1)))} />
            </label>
            <label>
              {t('Next number')} <input type="number" min={0} aria-label={t('Next number')} value={start} onChange={(e) => setStart(Math.max(0, Math.floor(Number(e.target.value) || 0)))} />
            </label>
          </div>
        )}
        <div className="pod-field">
          <span>{t('Colour')}</span>
          <span className="stamp-colours">
            {COLOURS.map((c) => (
              <button key={c} type="button" className={c === color ? 'swatch on' : 'swatch'} style={{ background: c }} aria-label={`${t('Colour')} ${c}`} aria-pressed={c === color} onClick={() => setColor(c)} />
            ))}
          </span>
        </div>
      </div>
    </Frame>
  )
}

/** Name and category for a stamp made from a picture; also renames an existing image stamp. */
export function ImageStampDialog({
  title,
  initialName,
  initialCategory,
  image,
  categories,
  ok,
  offerTransparent,
  onSave,
  onCancel
}: {
  title: string
  initialName: string
  initialCategory: string
  image: string | null
  categories: string[]
  ok: string
  /** Show the option to make white transparent and trim the margins. */
  offerTransparent?: boolean
  onSave: (name: string, category: string, transparent: boolean) => void
  onCancel: () => void
}) {
  const [name, setName] = useState(initialName)
  const [category, setCategory] = useState(initialCategory)
  const [transparent, setTransparent] = useState(!!offerTransparent)
  return (
    <Frame title={title} ok={ok} error={!name.trim() ? t('Type a name for the stamp.') : null} summary="" onClose={onCancel} onOk={() => onSave(name.trim(), category.trim() || CAT_MINE, transparent)}>
      {image && (
        <div className="stamp-editor-preview">
          <img className="stamp-thumb" src={image} alt="" style={{ maxWidth: 240, maxHeight: 120 }} />
        </div>
      )}
      <div className="pod-field">
        <label>
          <span>{t('Name')}</span>
          <input aria-label={t('Name')} value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
        </label>
      </div>
      <CategoryField id="stamp-img-cat" value={category} onChange={setCategory} categories={categories} />
      {offerTransparent && (
        <label className="stamp-dated">
          <input type="checkbox" checked={transparent} onChange={(e) => setTransparent(e.target.checked)} /> {t('Make white transparent and trim the margins')}
        </label>
      )}
    </Frame>
  )
}

/** Choose the pages a stamp is placed on (or copied to); the stamp goes at the same spot on each. */
export function StampPagesDialog({ ctx, heading, onCancel, onSubmit }: { ctx: DocContext; heading: string; onCancel: () => void; onSubmit: (pages: number[]) => void }) {
  const [range, setRange] = useState<RangeValue>(() => initialRange(ctx))
  const r = resolveRange(range, ctx)
  return (
    <Frame
      title={heading}
      ok={t('Apply')}
      error={r.error}
      summary={r.pages.length ? t('The stamp goes on pages {pages}, in the same place on each.', { pages: compactRanges(r.pages) }) : ''}
      onClose={onCancel}
      onOk={() => onSubmit(r.pages)}
    >
      <PagesControl value={range} onChange={setRange} ctx={ctx} />
    </Frame>
  )
}
