import { ChevronDown, ChevronRight, ChevronUp, Download, Eye, EyeOff, FileText, Lock, MessageSquare, Trash2 } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { annotLabel, formatWhen, isLocked, isPrintable, REVIEW_STATES, reviewState, type Annot, type ReviewState } from './annotations'
import { deletable, filterComments, flatten, groupComments, NO_FILTER, sortComments, stepComment, commentText, type CommentFilter, type GroupKey, type SortKey } from './commentList'
import { plural, t } from './i18n'

export { commentText }

interface Props {
  annots: Annot[]
  /** Page labels, or null to use page numbers. */
  labels: string[] | null
  selectedId: number | null
  onFocus: (id: number) => void
  onReply: (id: number, text: string) => void
  onStatus: (id: number, state: ReviewState) => void
  onDeleteReply: (id: number, replyId: number) => void
  onSummarise: () => void
  onExportCsv: () => void
  /** Comments hidden on the page (the view only: they stay in the file and still print). */
  hiddenIds?: ReadonlySet<number>
  onSetHidden?: (ids: number[], hidden: boolean) => void
  /** Sets the review status of several comments at once. */
  onStatusMany?: (ids: number[], state: ReviewState) => void
  /** Deletes comments (the caller keeps locked ones). */
  onDeleteMany?: (ids: number[]) => void
  /** Selects these comments on the page (the first is the main one). */
  onSelectMany?: (ids: number[]) => void
}

/** Every annotation as a comment: filter, group, sort, read and answer threads, set review status, show and hide. */
export function CommentsPane({
  annots,
  labels,
  selectedId,
  onFocus,
  onReply,
  onStatus,
  onDeleteReply,
  onSummarise,
  onExportCsv,
  hiddenIds,
  onSetHidden,
  onStatusMany,
  onDeleteMany,
  onSelectMany
}: Props) {
  const [filter, setFilter] = useState<CommentFilter>(NO_FILTER)
  const [sort, setSort] = useState<SortKey>('page')
  const [group, setGroup] = useState<GroupKey>('none')
  const [open, setOpen] = useState<ReadonlySet<number>>(new Set())
  const [drafts, setDrafts] = useState<Record<number, string>>({})
  const [checked, setChecked] = useState<ReadonlySet<number>>(new Set())
  const [confirm, setConfirm] = useState<{ ids: number[]; text: string } | null>(null)
  const pane = useRef<HTMLDivElement>(null)
  const hidden = hiddenIds ?? new Set<number>()

  const kinds = useMemo(() => [...new Set(annots.map((a) => a.kind))].sort(), [annots])
  const authors = useMemo(() => [...new Set(annots.map((a) => a.author ?? ''))].sort(), [annots])
  const colours = useMemo(() => [...new Set(annots.map((a) => a.color.toLowerCase()))].sort(), [annots])

  const pageName = (p: number) => (labels?.[p] ? t('Page {n}', { n: labels[p] }) : t('Page {n}', { n: p + 1 }))
  const shown = useMemo(() => sortComments(filterComments(annots, filter), sort), [annots, filter, sort])
  const groups = useMemo(() => groupComments(shown, group, pageName), [shown, group, labels]) // eslint-disable-line react-hooks/exhaustive-deps
  const order = useMemo(() => flatten(groups).map((a) => a.id), [groups])
  const set = (patch: Partial<CommentFilter>) => setFilter((f) => ({ ...f, ...patch }))
  const toggle = (id: number) => setOpen((o) => (o.has(id) ? new Set([...o].filter((x) => x !== id)) : new Set(o).add(id)))

  // Only comments still in the document count as checked (they can be deleted from elsewhere).
  const live = new Set(annots.map((a) => a.id))
  const checkedIds = [...checked].filter((id) => live.has(id))
  const setCheckedIds = (ids: number[]) => {
    setChecked(new Set(ids))
    onSelectMany?.(ids)
  }
  const toggleChecked = (id: number) => setCheckedIds(checked.has(id) ? checkedIds.filter((x) => x !== id) : [...checkedIds, id])

  /** Moves to the next or previous comment in the order shown, and keeps keyboard focus on it. */
  const step = (dir: 1 | -1) => {
    const id = stepComment(order, selectedId, dir)
    if (id === null) return
    onFocus(id)
    requestAnimationFrame(() => pane.current?.querySelector<HTMLElement>(`[data-comment-head="${id}"]`)?.focus())
  }
  const onKeyDown = (e: React.KeyboardEvent) => {
    const tag = (e.target as HTMLElement).tagName
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      step(e.key === 'ArrowDown' ? 1 : -1)
    }
  }

  const ask = (ids: number[], what: string) => {
    const ok = deletable(annots.filter((a) => ids.includes(a.id)))
    if (!ok.length) return
    const skipped = ids.length - ok.length
    setConfirm({
      ids: ok.map((a) => a.id),
      text: `${plural(ok.length, { one: 'Delete {n} comment ({what})?', other: 'Delete {n} comments ({what})?' }, { what })}${skipped ? ' ' + plural(skipped, { one: '{n} locked comment will be kept.', other: '{n} locked comments will be kept.' }) : ''}`
    })
  }
  const doDelete = () => {
    if (!confirm) return
    onDeleteMany?.(confirm.ids)
    setChecked(new Set())
    setConfirm(null)
  }

  const everyShownChecked = shown.length > 0 && shown.every((a) => checked.has(a.id))
  const visibleCount = annots.filter((a) => !hidden.has(a.id)).length

  return (
    <div className="comments-pane" ref={pane} onKeyDown={onKeyDown}>
      <div className="comments-tools">
        <input type="search" placeholder={t('Search comments')} aria-label={t('Search comments')} value={filter.query} onChange={(e) => set({ query: e.target.value })} />
        <div className="comments-filters">
          <select aria-label={t('Filter by type')} value={filter.kind} onChange={(e) => set({ kind: e.target.value })}>
            <option value="">{t('All types')}</option>
            {kinds.map((k) => (
              <option key={k} value={k}>
                {annotLabel(k)}
              </option>
            ))}
          </select>
          <select aria-label={t('Filter by author')} value={filter.author} onChange={(e) => set({ author: e.target.value })}>
            <option value="">{t('All authors')}</option>
            {authors.map((a) => (
              <option key={a} value={a}>
                {a || t('(no author)')}
              </option>
            ))}
          </select>
          <select aria-label={t('Filter by status')} value={filter.status} onChange={(e) => set({ status: e.target.value })}>
            <option value="">{t('Any status')}</option>
            {REVIEW_STATES.map((s) => (
              <option key={s} value={s}>
                {s === 'None' ? t('No status') : s}
              </option>
            ))}
          </select>
          <select aria-label={t('Filter by colour')} value={filter.colour} onChange={(e) => set({ colour: e.target.value })}>
            <option value="">{t('Any colour')}</option>
            {colours.map((c) => (
              <option key={c} value={c}>
                {c.toUpperCase()}
              </option>
            ))}
          </select>
        </div>
        <div className="comments-filters">
          <select aria-label={t('Group comments')} value={group} onChange={(e) => setGroup(e.target.value as GroupKey)}>
            <option value="none">{t('No grouping')}</option>
            <option value="page">{t('Group by page')}</option>
            <option value="author">{t('Group by author')}</option>
            <option value="type">{t('Group by type')}</option>
            <option value="colour">{t('Group by colour')}</option>
            <option value="date">{t('Group by date')}</option>
            <option value="status">{t('Group by status')}</option>
          </select>
          <select aria-label={t('Sort comments')} value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
            <option value="page">{t('By page')}</option>
            <option value="date">{t('Newest first')}</option>
            <option value="author">{t('By author')}</option>
            <option value="type">{t('By type')}</option>
            <option value="status">{t('By status')}</option>
          </select>
        </div>
        <div className="comments-actions">
          <span className="muted small" aria-live="polite">
            {t('{shown} of {total}', { shown: shown.length, total: annots.length })}
            {checkedIds.length ? ` · ${t('{n} selected', { n: checkedIds.length })}` : ''}
            {visibleCount < annots.length ? ` · ${t('{n} hidden', { n: annots.length - visibleCount })}` : ''}
          </span>
          <button className="icon-btn" onClick={() => step(-1)} disabled={!order.length} aria-label={t('Previous comment')} title={t('Previous comment (Up arrow)')}>
            <ChevronUp size={16} strokeWidth={1.8} aria-hidden />
          </button>
          <button className="icon-btn" onClick={() => step(1)} disabled={!order.length} aria-label={t('Next comment')} title={t('Next comment (Down arrow)')}>
            <ChevronDown size={16} strokeWidth={1.8} aria-hidden />
          </button>
          <button className="icon-btn" onClick={onSummarise} disabled={!annots.length} aria-label={t('Summarise comments')} title={t('Summarise comments as a PDF')}>
            <FileText size={16} strokeWidth={1.8} aria-hidden />
          </button>
          <button className="icon-btn" onClick={onExportCsv} disabled={!annots.length} aria-label={t('Export comments to CSV')} title={t('Export comments to a CSV file (Excel)')}>
            <Download size={16} strokeWidth={1.8} aria-hidden />
          </button>
        </div>
        <div className="comments-actions comments-bulk">
          <label className="small">
            <input type="checkbox" checked={everyShownChecked} disabled={!shown.length} onChange={() => setCheckedIds(everyShownChecked ? [] : shown.map((a) => a.id))} aria-label={t('Select all comments')} />
            {t('Select all')}
          </label>
          {onSetHidden && (
            <>
              <button className="icon-btn" disabled={!checkedIds.length} onClick={() => onSetHidden(checkedIds, true)} aria-label={t('Hide selected comments on the page')} title={t('Hide the selected comments on the page (the view only: they stay in the file and still print)')}>
                <EyeOff size={16} strokeWidth={1.8} aria-hidden />
              </button>
              <button className="icon-btn" disabled={!hidden.size} onClick={() => onSetHidden(annots.filter((a) => hidden.has(a.id) && (!checkedIds.length || checked.has(a.id))).map((a) => a.id), false)} aria-label={t('Show hidden comments on the page')} title={t('Show the hidden comments again (the selected ones, or all of them when none is selected)')}>
                <Eye size={16} strokeWidth={1.8} aria-hidden />
              </button>
            </>
          )}
          {onStatusMany && (
            <select aria-label={t('Set status of selected comments')} value="" disabled={!checkedIds.length} onChange={(e) => e.target.value && onStatusMany(checkedIds, e.target.value as ReviewState)}>
              <option value="">{t('Status of selected…')}</option>
              {REVIEW_STATES.map((s) => (
                <option key={s} value={s}>
                  {s === 'None' ? t('Clear status') : s}
                </option>
              ))}
            </select>
          )}
          {onDeleteMany && (
            <>
              <button className="icon-btn" disabled={!checkedIds.length} onClick={() => ask(checkedIds, t('selected'))} aria-label={t('Delete selected comments')} title={t('Delete the selected comments')}>
                <Trash2 size={16} strokeWidth={1.8} aria-hidden />
              </button>
              <button className="btn small" disabled={!shown.length} onClick={() => ask(shown.map((a) => a.id), t('visible'))} title={t('Delete the comments the list shows now (locked ones are kept)')}>
                {t('Delete visible')}
              </button>
              <button className="btn small" disabled={!annots.length} onClick={() => ask(annots.map((a) => a.id), t('all'))} title={t('Delete every comment in the document (locked ones are kept)')}>
                {t('Delete all')}
              </button>
            </>
          )}
        </div>
        {confirm && (
          <div className="comments-confirm" role="alertdialog" aria-label={t('Confirm delete')}>
            <span>{confirm.text}</span>
            <button className="btn danger" onClick={doDelete}>
              {t('Delete')}
            </button>
            <button className="btn" onClick={() => setConfirm(null)}>
              {t('Cancel')}
            </button>
          </div>
        )}
      </div>
      {!annots.length ? (
        <div className="side-empty">
          <MessageSquare size={20} strokeWidth={1.5} aria-hidden />
          <p>{t('No comments in this document yet.')}</p>
        </div>
      ) : (
        <ul className="comment-list" aria-label={t('Comments')}>
          {groups.map((g) => [
            group !== 'none' && (
              <li key={`group-${g.key}`} className="comment-group" role="presentation">
                {g.label} <span className="muted small">({g.items.length})</span>
              </li>
            ),
            ...g.items.map((a) => {
              const st = reviewState(a)
              const replies = (a.replies ?? []).filter((r) => !r.state)
              const expanded = open.has(a.id) || a.id === selectedId
              const isHidden = hidden.has(a.id)
              return (
                <li key={a.id} className={`${a.id === selectedId ? 'comment on' : 'comment'}${isHidden ? ' off' : ''}`}>
                  <div className="comment-row">
                    <input type="checkbox" checked={checked.has(a.id)} onChange={() => toggleChecked(a.id)} aria-label={t('Select this comment')} />
                    <button
                      className="comment-head"
                      data-comment-head={a.id}
                      onClick={() => onFocus(a.id)}
                      aria-label={`${annotLabel(a.kind)} on ${pageName(a.page)}${a.author ? ` by ${a.author}` : ''}`}
                    >
                      <span className="comment-swatch" style={{ background: a.color }} aria-hidden />
                      <span className="comment-meta">
                        <span className="comment-kind">{annotLabel(a.kind)}</span>
                        <span className="muted small">
                          {pageName(a.page)}
                          {a.author ? ` · ${a.author}` : ''}
                          {a.modified || a.created ? ` · ${formatWhen(a.modified ?? a.created)}` : ''}
                        </span>
                      </span>
                      {isLocked(a) && <Lock size={12} aria-label={t('Locked')} />}
                      {!isPrintable(a) && <span className="muted small">{t('Not printed')}</span>}
                      {st !== 'None' && <span className={`comment-state ${st.toLowerCase()}`}>{st}</span>}
                    </button>
                    {onSetHidden && (
                      <button className="icon-btn tiny" onClick={() => onSetHidden([a.id], !isHidden)} aria-label={isHidden ? t('Show this comment on the page') : t('Hide this comment on the page')} aria-pressed={isHidden} title={isHidden ? t('Show on the page') : t('Hide on the page (the view only)')}>
                        {isHidden ? <EyeOff size={12} aria-hidden /> : <Eye size={12} aria-hidden />}
                      </button>
                    )}
                  </div>
                  {commentText(a) && <div className="comment-text">{commentText(a)}</div>}
                  <button className="comment-toggle muted small" onClick={() => toggle(a.id)} aria-expanded={expanded}>
                    {expanded ? <ChevronDown size={12} aria-hidden /> : <ChevronRight size={12} aria-hidden />}
                    {replies.length ? plural(replies.length, { one: '{n} reply', other: '{n} replies' }) : t('Reply')}
                  </button>
                  {expanded && (
                    <div className="comment-thread">
                      {replies.map((r) => (
                        <div key={r.id} className="comment-reply">
                          <div className="muted small">
                            {r.author || t('(no author)')} · {formatWhen(r.date)}
                            <button className="icon-btn tiny" onClick={() => onDeleteReply(a.id, r.id)} aria-label={t('Delete reply')} title={t('Delete reply')}>
                              <Trash2 size={12} aria-hidden />
                            </button>
                          </div>
                          <div>{r.text}</div>
                        </div>
                      ))}
                      <form
                        className="comment-reply-form"
                        onSubmit={(e) => {
                          e.preventDefault()
                          const text = (drafts[a.id] ?? '').trim()
                          if (!text) return
                          onReply(a.id, text)
                          setDrafts((d) => ({ ...d, [a.id]: '' }))
                        }}
                      >
                        <input aria-label={t('Reply')} placeholder={t('Write a reply')} value={drafts[a.id] ?? ''} onChange={(e) => setDrafts((d) => ({ ...d, [a.id]: e.target.value }))} />
                        <select aria-label={t('Set status')} value="" onChange={(e) => e.target.value && onStatus(a.id, e.target.value as ReviewState)}>
                          <option value="">{t('Status…')}</option>
                          {REVIEW_STATES.map((s) => (
                            <option key={s} value={s}>
                              {s === 'None' ? t('Clear status') : s}
                            </option>
                          ))}
                        </select>
                      </form>
                    </div>
                  )}
                </li>
              )
            })
          ])}
        </ul>
      )}
    </div>
  )
}
