import { useState } from 'react'
import { Modal } from './AppDialogs'
import { t } from './i18n'
import { newLinkDraft, targetFromDraft, type LinkAction, type LinkDraft, type LinkTo } from './linkLogic'

export type LinkToolMode = 'auto' | 'remove' | 'batch'

/** What to find and what to link it to. */
export type BatchLinkSpec = { query: string; matchCase: boolean; wholeWord: boolean; regex: boolean; scope: 'all' | 'current' } & { linkUri?: string; linkPage?: number; linkAction?: LinkAction }

/**
 * Link tools that work on many places at once: turn web addresses in the text into links, remove every web link, and
 * make a link out of each place a word or phrase appears.
 */
export function LinkToolsDialog({
  mode,
  pageCount,
  currentPage,
  webLinkCount,
  destinations,
  onAuto,
  onRemove,
  onBatch,
  onClose
}: {
  mode: LinkToolMode
  pageCount: number
  /** Zero-based. */
  currentPage: number
  webLinkCount: number
  destinations: string[]
  onAuto: (scope: 'all' | 'current') => void
  onRemove: () => void
  onBatch: (spec: BatchLinkSpec) => void
  onClose: () => void
}) {
  const [scope, setScope] = useState<'all' | 'current'>('all')
  const [query, setQuery] = useState('')
  const [matchCase, setMatchCase] = useState(false)
  const [wholeWord, setWholeWord] = useState(false)
  const [regex, setRegex] = useState(false)
  const [draft, setDraft] = useState<LinkDraft>(() => newLinkDraft(currentPage, { x: 0, y: 0, w: 1, h: 1 }, pageCount))
  const [error, setError] = useState('')
  const set = (patch: Partial<LinkDraft>) => setDraft({ ...draft, ...patch })

  const scopeRow = (
    <label className="props-row">
      <span>{t('Pages')}</span>
      <select aria-label={t('Pages to search')} value={scope} onChange={(e) => setScope(e.target.value as 'all' | 'current')}>
        <option value="all">{t('Every page')}</option>
        <option value="current">{t('This page only')}</option>
      </select>
    </label>
  )

  const submit = () => {
    setError('')
    if (mode === 'auto') return onAuto(scope)
    if (mode === 'remove') return onRemove()
    if (!query.trim()) return setError(t('Enter the text to turn into links.'))
    if (regex) {
      try {
        new RegExp(query)
      } catch {
        return setError(t('That is not a valid pattern.'))
      }
    }
    const r = targetFromDraft(draft, pageCount)
    if (!r.ok) return setError(t(r.error))
    onBatch({ ...r.target, query, matchCase, wholeWord, regex, scope })
  }

  const title = mode === 'auto' ? t('Make links from web addresses') : mode === 'remove' ? t('Remove web links') : t('Link every match of some text')
  return (
    <Modal title={title} onClose={onClose}>
      <form
        className="marks-form props-form"
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        {mode === 'auto' && (
          <>
            <p className="muted">{t('Looks through the page text for web addresses (https://… or www.…) and puts a link over each one. Addresses that already have a link are left alone.')}</p>
            {scopeRow}
          </>
        )}
        {mode === 'remove' && (
          <p>
            {webLinkCount === 0 ? t('This document has no web links.') : webLinkCount === 1 ? t('Remove the 1 web link (web and e-mail addresses) from this document? The text under it stays.') : t('Remove all {n} web links (web and e-mail addresses) from this document? The text under them stays.', { n: webLinkCount })}
          </p>
        )}
        {mode === 'batch' && (
          <>
            <label className="props-row">
              <span>{t('Text')}</span>
              <input aria-label={t('Text to link')} value={query} onChange={(e) => setQuery(e.target.value)} autoFocus />
            </label>
            <div className="marks-row">
              <label className="inline">
                <input type="checkbox" checked={matchCase} onChange={(e) => setMatchCase(e.target.checked)} /> {t('Match case')}
              </label>
              <label className="inline">
                <input type="checkbox" checked={wholeWord} onChange={(e) => setWholeWord(e.target.checked)} /> {t('Whole words')}
              </label>
              <label className="inline">
                <input type="checkbox" checked={regex} onChange={(e) => setRegex(e.target.checked)} /> {t('Pattern (regular expression)')}
              </label>
            </div>
            {scopeRow}
            <label className="props-row">
              <span>{t('Link to')}</span>
              <select aria-label={t('Kind of link')} value={draft.to} onChange={(e) => set({ to: e.target.value as LinkTo })}>
                <option value="uri">{t('Web address')}</option>
                <option value="page">{t('Page')}</option>
                <option value="named">{t('Named destination')}</option>
                <option value="file">{t('File')}</option>
                <option value="js">{t('JavaScript')}</option>
              </select>
            </label>
            {draft.to === 'uri' && (
              <label className="props-row">
                <span>{t('Address')}</span>
                <input aria-label={t('Link address')} value={draft.uri} onChange={(e) => set({ uri: e.target.value })} />
              </label>
            )}
            {draft.to === 'page' && (
              <label className="props-row">
                <span>{t('Page')}</span>
                <input aria-label={t('Link page')} value={draft.page1} onChange={(e) => set({ page1: e.target.value })} />
              </label>
            )}
            {draft.to === 'named' && (
              <label className="props-row">
                <span>{t('Destination')}</span>
                <input aria-label={t('Link destination')} list="batch-link-dests" value={draft.named} onChange={(e) => set({ named: e.target.value })} />
                <datalist id="batch-link-dests">
                  {destinations.map((n) => (
                    <option key={n} value={n} />
                  ))}
                </datalist>
              </label>
            )}
            {draft.to === 'file' && (
              <label className="props-row">
                <span>{t('File')}</span>
                <input aria-label={t('Link file')} value={draft.file} onChange={(e) => set({ file: e.target.value })} />
              </label>
            )}
            {draft.to === 'js' && (
              <label className="props-row">
                <span>{t('Script')}</span>
                <input aria-label={t('Link script')} value={draft.code} onChange={(e) => set({ code: e.target.value })} spellCheck={false} />
              </label>
            )}
          </>
        )}
        {error && (
          <p className="error-text" role="alert">
            {error}
          </p>
        )}
        <div className="marks-actions">
          <span style={{ flex: 1 }} />
          <button type="button" onClick={onClose}>
            {t('Cancel')}
          </button>
          <button className="primary" type="submit" disabled={mode === 'remove' && webLinkCount === 0}>
            {mode === 'remove' ? t('Remove') : t('Make links')}
          </button>
        </div>
      </form>
    </Modal>
  )
}
