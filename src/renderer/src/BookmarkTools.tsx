import { useState } from 'react'
import { Modal } from './AppDialogs'
import { t } from './i18n'
import type { BookmarkNode, Path } from './outlineEdit'
import { findBrokenBookmarks, removeMany, type BrokenBookmark } from './outlineClip'
import type { NamedDestination } from './outlineRead'

const REASON: Record<BrokenBookmark['reason'], string> = {
  'no-destination': 'has no destination',
  'page-missing': 'points at a page this document does not have',
  'name-missing': 'points at a named destination that is not defined'
}

/** Lists the bookmarks that point nowhere, with a way to go to each or delete them all. */
export function ValidateBookmarksDialog({
  tree,
  pageCount,
  names,
  onGoTo,
  onDelete,
  onClose
}: {
  tree: BookmarkNode[]
  pageCount: number
  /** Defined named destinations, or null when they could not be read (named bookmarks are then not checked). */
  names: NamedDestination[] | null
  onGoTo: (path: Path) => void
  onDelete: (tree: BookmarkNode[]) => void
  onClose: () => void
}) {
  const broken = findBrokenBookmarks(tree, pageCount, names ? new Set(names.map((n) => n.name)) : null)
  return (
    <Modal title={t('Check bookmarks')} onClose={onClose}>
      <div className="pod">
        {broken.length === 0 ? (
          <p className="pod-summary" role="status">
            {t('Every bookmark leads somewhere.')}
          </p>
        ) : (
          <>
            <p className="pod-summary" role="status">
              {broken.length === 1 ? t('1 bookmark leads nowhere.') : t('{n} bookmarks lead nowhere.', { n: broken.length })}
            </p>
            <ul className="pod-files" aria-label={t('Bookmarks that lead nowhere')}>
              {broken.map((b) => (
                <li key={b.path.join('.')}>
                  <span className="pod-file-name" title={b.title}>
                    {b.title}
                  </span>
                  <span className="pod-hint">{t(REASON[b.reason])}</span>
                  <button type="button" onClick={() => onGoTo(b.path)}>
                    {t('Select')}
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
        <div className="pod-actions">
          {broken.length > 0 && (
            <button type="button" className="primary" onClick={() => onDelete(removeMany(tree, broken.map((b) => b.path)))}>
              {t('Delete these bookmarks')}
            </button>
          )}
          <button type="button" onClick={onClose}>
            {t('Close')}
          </button>
        </div>
      </div>
    </Modal>
  )
}

export interface ActionChange {
  page: number
  named: string | undefined
}

/** What a bookmark does when clicked: go to a page, or go to a named destination. */
export function BookmarkActionDialog({
  node,
  pageCount,
  names,
  onApply,
  onClose
}: {
  node: BookmarkNode
  pageCount: number
  names: NamedDestination[]
  onApply: (c: ActionChange) => void
  onClose: () => void
}) {
  const [kind, setKind] = useState<'page' | 'named'>(node.named ? 'named' : 'page')
  const [page, setPage] = useState(String(node.page >= 0 ? node.page + 1 : 1))
  const [named, setNamed] = useState(node.named ?? names[0]?.name ?? '')
  const n = Number(page)
  const pageOk = Number.isInteger(n) && n >= 1 && n <= pageCount
  const namedOk = !!named && names.some((x) => x.name === named)
  const error = kind === 'page' ? (pageOk ? null : t('Enter a page number from 1 to {count}.', { count: pageCount })) : namedOk ? null : names.length ? t('Choose a named destination.') : t('This document has no named destinations.')
  return (
    <Modal title={t('Bookmark action')} onClose={onClose}>
      <form
        className="pod"
        onSubmit={(e) => {
          e.preventDefault()
          if (error) return
          onApply(kind === 'page' ? { page: n - 1, named: undefined } : { page: names.find((x) => x.name === named)?.page ?? -1, named })
        }}
      >
        <p className="pod-hint">{node.title}</p>
        <label className="pod-radio">
          <input type="radio" name="bm-action" checked={kind === 'page'} onChange={() => setKind('page')} /> {t('Go to a page')}
        </label>
        {kind === 'page' && (
          <div className="pod-field">
            <input aria-label={t('Page to go to')} inputMode="numeric" value={page} onChange={(e) => setPage(e.target.value)} />
            <span className="pod-hint">{t('of {count}', { count: pageCount })}</span>
          </div>
        )}
        <label className="pod-radio">
          <input type="radio" name="bm-action" checked={kind === 'named'} onChange={() => setKind('named')} /> {t('Go to a named destination')}
        </label>
        {kind === 'named' && (
          <div className="pod-field">
            <select aria-label={t('Named destination')} value={named} onChange={(e) => setNamed(e.target.value)} disabled={!names.length}>
              {node.named && !names.some((x) => x.name === node.named) && <option value={node.named}>{node.named}</option>}
              {names.map((x) => (
                <option key={x.name} value={x.name}>
                  {x.name}
                  {x.page >= 0 ? ` (${t('page {n}', { n: x.page + 1 })})` : ''}
                </option>
              ))}
            </select>
          </div>
        )}
        {error ? (
          <p className="pod-error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="pod-actions">
          <button type="submit" className="primary" disabled={!!error}>
            {t('OK')}
          </button>
          <button type="button" onClick={onClose}>
            {t('Cancel')}
          </button>
        </div>
      </form>
    </Modal>
  )
}
