import { useState } from 'react'
import { Frame, PagesControl, type DialogProps } from './PageOpsDialogs'
import { initialRange, pagesWord, resolveRange, type RangeValue } from './pageDialogLogic'
import { joinedSize, planJoin, type JoinMode } from './pageMerge'
import { t } from './i18n'

/** Join pages: two half pages become one page, side by side or one above the other. */
export function JoinPagesDialog({ ctx, onCancel, onSubmit }: DialogProps) {
  const [range, setRange] = useState<RangeValue>(() => ({ ...initialRange(ctx), preset: ctx.selected.length >= 2 ? 'selected' : 'all' }))
  const [mode, setMode] = useState<JoinMode>('side')
  const [reversed, setReversed] = useState(false)
  const r = resolveRange(range, ctx)
  const plan = planJoin(r.pages)
  let error = r.error
  if (!error && !plan.pairs.length) error = t('Choose at least two pages to join.')
  const first = plan.pairs[0]
  const example = first
    ? (() => {
        const a = ctx.sizes[first[0]]
        const b = ctx.sizes[first[1]]
        if (!a || !b) return ''
        const s = joinedSize({ w: a.width, h: a.height }, { w: b.width, h: b.height }, mode)
        const mm = (pt: number) => Math.round((pt * 25.4) / 72)
        return t('The first joined page will be {w} x {h} mm.', { w: mm(s.w), h: mm(s.h) })
      })()
    : ''
  const summary =
    t('{pairs} will be made from {pages}.', { pairs: pagesWord(plan.pairs.length), pages: pagesWord(plan.pairs.length * 2) }) +
    (plan.left !== null ? ' ' + t('Page {n} has no partner and stays as it is.', { n: plan.left + 1 }) : '') +
    (example ? ' ' + example : '')
  return (
    <Frame
      title={t('Join pages')}
      ok={t('Join')}
      error={error}
      summary={summary}
      warning={t('Comments and form fields on the joined pages become part of the page and can no longer be edited.')}
      onClose={onCancel}
      onOk={() => onSubmit({ kind: 'join', pages: r.pages, mode, reversed })}
    >
      <PagesControl value={range} onChange={setRange} ctx={ctx} />
      <div className="pod-field">
        <label>
          <span>{t('Join')}</span>
          <select aria-label={t('How to join the pages')} value={mode} onChange={(e) => setMode(e.target.value as JoinMode)}>
            <option value="side">{t('Side by side')}</option>
            <option value="stack">{t('One above the other')}</option>
          </select>
        </label>
      </div>
      <label className="pod-check">
        <input type="checkbox" checked={reversed} onChange={(e) => setReversed(e.target.checked)} /> {t('Put the second page of each pair first (right to left, or on top)')}
      </label>
      <p className="pod-hint">{t('The pages are taken two at a time in page order: 1 and 2, then 3 and 4, and so on.')}</p>
    </Frame>
  )
}
