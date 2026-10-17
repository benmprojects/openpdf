import { useRef, useState } from 'react'
import { Modal } from './AppDialogs'
import { t } from './i18n'
import type { PdfClient } from './pdfClient'
import { contrastText, type RedactStyle } from './redact'
import { PRESETS, collectMatches, contextOf, groupByPage, queryError, type PatternSpec } from './searchPatterns'
import { rangeRects, type Rect } from './textLogic'

const colourOr = (c: string | undefined, d: string) => (c && /^#[0-9a-f]{6}$/i.test(c) ? c : d)

interface MarkProps {
  /** Mark being edited, or null when editing the style given to new marks. */
  title: string
  style: RedactStyle
  onSave: (style: RedactStyle, toAll: boolean) => void
  onClose: () => void
  /** Offered when a single mark is open. */
  onApply?: (style: RedactStyle) => void
  onRemove?: () => void
  /** Offer "also set on every mark". */
  canApplyToAll?: boolean
}

/** What a redaction mark looks like once applied: box colour, outline, and text on the box. */
export function RedactMarkDialog({ title, style, onSave, onClose, onApply, onRemove, canApplyToAll }: MarkProps) {
  const [fill, setFill] = useState(colourOr(style.fill, '#000000'))
  const [useOutline, setUseOutline] = useState(!!style.outline)
  const [outline, setOutline] = useState(colourOr(style.outline, '#ff0000'))
  const [text, setText] = useState(style.text ?? '')
  const [autoColour, setAutoColour] = useState(!style.textColour)
  const [textColour, setTextColour] = useState(colourOr(style.textColour, contrastText(colourOr(style.fill, '#000000'))))
  const [size, setSize] = useState(String(style.fontSize ?? 0))
  const [repeat, setRepeat] = useState(!!style.repeat)
  const [toAll, setToAll] = useState(false)
  const result = (): RedactStyle => ({
    fill,
    ...(useOutline ? { outline } : {}),
    ...(text.trim() ? { text: text.trim() } : {}),
    ...(text.trim() && !autoColour ? { textColour } : {}),
    ...(text.trim() && Number(size) > 0 ? { fontSize: Math.min(200, Number(size)) } : {}),
    ...(text.trim() && repeat ? { repeat: true } : {})
  })
  return (
    <Modal title={title} onClose={onClose}>
      <div className="marks-form">
        <div className="marks-row">
          <label className="inline">
            {t('Fill colour')} <input type="color" value={fill} onChange={(e) => setFill(e.target.value)} aria-label={t('Fill colour')} />
          </label>
          <label className="inline">
            <input type="checkbox" checked={useOutline} onChange={(e) => setUseOutline(e.target.checked)} /> {t('Outline')}
            <input type="color" value={outline} disabled={!useOutline} onChange={(e) => setOutline(e.target.value)} aria-label={t('Outline colour')} />
          </label>
        </div>
        <label className="inline">
          {t('Overlay text')}
          <input type="text" value={text} maxLength={80} placeholder={t('REDACTED, or a code')} onChange={(e) => setText(e.target.value)} aria-label={t('Overlay text')} />
        </label>
        <div className="marks-row">
          <label className="inline">
            {t('Font size')} <input type="number" min={0} max={200} value={size} disabled={!text.trim()} onChange={(e) => setSize(e.target.value)} aria-label={t('Font size')} />
            <span className="muted small">{t('0 fits the box')}</span>
          </label>
          <label className="inline">
            <input type="checkbox" checked={repeat} disabled={!text.trim()} onChange={(e) => setRepeat(e.target.checked)} /> {t('Repeat across the box')}
          </label>
        </div>
        <div className="marks-row">
          <label className="inline">
            <input type="checkbox" checked={autoColour} disabled={!text.trim()} onChange={(e) => setAutoColour(e.target.checked)} /> {t('Text colour to suit the fill')}
          </label>
          <input type="color" value={textColour} disabled={!text.trim() || autoColour} onChange={(e) => setTextColour(e.target.value)} aria-label={t('Text colour')} />
        </div>
        {canApplyToAll && (
          <label className="inline">
            <input type="checkbox" checked={toAll} onChange={(e) => setToAll(e.target.checked)} /> {t('Also set this on every mark already placed')}
          </label>
        )}
        <div className="marks-actions">
          {onRemove && (
            <button type="button" onClick={onRemove}>
              {t('Remove mark')}
            </button>
          )}
          {onApply && (
            <button type="button" onClick={() => onApply(result())}>
              {t('Apply this mark')}
            </button>
          )}
          <button type="button" onClick={onClose}>
            {t('Cancel')}
          </button>
          <button className="primary" type="button" onClick={() => onSave(result(), toAll)}>
            {t('OK')}
          </button>
        </div>
      </div>
    </Modal>
  )
}

interface FindProps {
  client: PdfClient
  pageCount: number
  pageLabel: (page: number) => string
  onMark: (marks: { page: number; rect: Rect }[]) => void
  onClose: () => void
}

interface Found {
  page: number
  before: string
  match: string
  after: string
  rects: Rect[]
}

/** Find text by pattern (phone numbers, e-mail addresses, dates, ABNs and so on) and mark every match for redaction. */
export function FindRedactDialog({ client, pageCount, pageLabel, onMark, onClose }: FindProps) {
  const [chosen, setChosen] = useState<ReadonlySet<string>>(new Set())
  const [custom, setCustom] = useState('')
  const [isRegex, setIsRegex] = useState(false)
  const [matchCase, setMatchCase] = useState(false)
  const [wholeWord, setWholeWord] = useState(false)
  const [found, setFound] = useState<Found[] | null>(null)
  const [busy, setBusy] = useState(false)
  const run = useRef(0)
  const customError = custom ? queryError(custom, { regex: isRegex, matchCase, wholeWord }) : null
  const specs = (): PatternSpec[] => [
    ...PRESETS.filter((p) => chosen.has(p.id)).map((p) => ({
      query: p.pattern,
      opts: {
        regex: true,
        matchCase: false,
        wholeWord: false,
        validate: p.validate
      }
    })),
    ...(custom && !customError ? [{ query: custom, opts: { regex: isRegex, matchCase, wholeWord } }] : [])
  ]
  const canFind = !busy && specs().length > 0
  const find = async () => {
    const id = ++run.current
    setBusy(true)
    setFound(null)
    try {
      const hits = await collectMatches(
        (p) => client.pageText(p),
        pageCount,
        specs(),
        5000,
        () => id !== run.current
      )
      if (id !== run.current) return
      setFound(
        hits.map(({ page, pt, m }) => ({
          page,
          ...contextOf(pt, m),
          rects: rangeRects(pt.boxes, m.from, m.to)
        }))
      )
    } finally {
      if (id === run.current) setBusy(false)
    }
  }
  const groups = found ? groupByPage(found) : []
  return (
    <Modal title={t('Find and redact')} onClose={onClose} wide>
      <div className="marks-form">
        <fieldset className="marks-row" aria-label={t('Patterns')}>
          {PRESETS.map((p) => (
            <label key={p.id} className="inline">
              <input
                type="checkbox"
                checked={chosen.has(p.id)}
                onChange={(e) => {
                  const next = new Set(chosen)
                  if (e.target.checked) next.add(p.id)
                  else next.delete(p.id)
                  setChosen(next)
                  setFound(null)
                }}
              />{' '}
              {p.label}
            </label>
          ))}
        </fieldset>
        <label className="inline">
          {t('Other text or pattern')}
          <input
            type="text"
            value={custom}
            aria-label={t('Other text or pattern')}
            onChange={(e) => {
              setCustom(e.target.value)
              setFound(null)
            }}
          />
        </label>
        <div className="marks-row">
          <label className="inline">
            <input type="checkbox" checked={isRegex} onChange={(e) => setIsRegex(e.target.checked)} /> {t('Regular expression')}
          </label>
          <label className="inline">
            <input type="checkbox" checked={matchCase} onChange={(e) => setMatchCase(e.target.checked)} /> {t('Match case')}
          </label>
          <label className="inline">
            <input type="checkbox" checked={wholeWord} onChange={(e) => setWholeWord(e.target.checked)} /> {t('Whole word')}
          </label>
        </div>
        {customError && (
          <p className="search-error small">
            {t('Not a valid pattern:')} {customError}
          </p>
        )}
        <div className="marks-row">
          <button type="button" className="primary" disabled={!canFind} onClick={() => void find()}>
            {busy ? t('Searching…') : t('Find')}
          </button>
          <span className="muted" aria-live="polite">
            {found
              ? found.length
                ? `${found.length} ${found.length === 1 ? t('match') : t('matches')} ${t('on')} ${groups.length} ${groups.length === 1 ? t('page') : t('pages')}`
                : t('No matches')
              : ''}
          </span>
        </div>
        {found && found.length > 0 && (
          <div className="find-results" role="region" aria-label={t('Matches to mark')}>
            {groups.map((g) => (
              <div key={g.page} className="find-group">
                <h3>
                  {t('Page')} {pageLabel(g.page)} <span className="muted small">({g.items.length})</span>
                </h3>
                <ul>
                  {g.items.slice(0, 50).map((f, i) => (
                    <li key={i} className="find-hit">
                      {f.before}
                      <mark>{f.match}</mark>
                      {f.after}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
        <p className="muted small">{t('The matches are only marked; nothing is removed until you apply the marks.')}</p>
        <div className="marks-actions">
          <button type="button" onClick={onClose}>
            {t('Close')}
          </button>
          <button
            className="primary"
            type="button"
            disabled={!found || !found.length}
            onClick={() => {
              if (!found) return
              onMark(found.flatMap((f) => f.rects.map((rect) => ({ page: f.page, rect }))))
              onClose()
            }}
          >
            {t('Mark all matches')}
          </button>
        </div>
      </div>
    </Modal>
  )
}
