import { ChevronDown, ChevronRight, Download, FileText, MessageSquare, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { annotLabel, formatWhen, REVIEW_STATES, reviewState, type Annot, type ReviewState } from './annotations'

type SortKey = 'page' | 'date' | 'author' | 'type'

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
}

/** Text an annotation shows in the list: its comment, or for a stamp or measurement its label. */
export function commentText(a: Annot): string {
  if (a.measure) return a.measure.label
  if (a.kind === 'stamp') return a.text + (a.stampInfo ? ` (${a.stampInfo})` : '')
  return a.text
}

/** Every annotation as a comment: filter, sort, read and answer threads, set review status. */
export function CommentsPane({ annots, labels, selectedId, onFocus, onReply, onStatus, onDeleteReply, onSummarise, onExportCsv }: Props) {
  const [query, setQuery] = useState('')
  const [kind, setKind] = useState<string>('')
  const [author, setAuthor] = useState<string>('')
  const [status, setStatus] = useState<string>('')
  const [sort, setSort] = useState<SortKey>('page')
  const [open, setOpen] = useState<ReadonlySet<number>>(new Set())
  const [drafts, setDrafts] = useState<Record<number, string>>({})

  const kinds = useMemo(() => [...new Set(annots.map((a) => a.kind))].sort(), [annots])
  const authors = useMemo(() => [...new Set(annots.map((a) => a.author ?? ''))].sort(), [annots])

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = annots.filter(
      (a) =>
        (!kind || a.kind === kind) &&
        (!author || (a.author ?? '') === author) &&
        (!status || reviewState(a) === status) &&
        (!q ||
          commentText(a).toLowerCase().includes(q) ||
          (a.author ?? '').toLowerCase().includes(q) ||
          (a.replies ?? []).some((r) => r.text.toLowerCase().includes(q)))
    )
    const by: Record<SortKey, (x: Annot, y: Annot) => number> = {
      page: (x, y) => x.page - y.page || (x.rects[0]?.y ?? 0) - (y.rects[0]?.y ?? 0),
      date: (x, y) => (y.modified ?? y.created ?? '').localeCompare(x.modified ?? x.created ?? ''),
      author: (x, y) => (x.author ?? '').localeCompare(y.author ?? '') || x.page - y.page,
      type: (x, y) => annotLabel(x.kind).localeCompare(annotLabel(y.kind)) || x.page - y.page
    }
    return [...list].sort(by[sort])
  }, [annots, query, kind, author, status, sort])

  const pageName = (p: number) => (labels?.[p] ? `Page ${labels[p]}` : `Page ${p + 1}`)
  const toggle = (id: number) => setOpen((o) => (o.has(id) ? new Set([...o].filter((x) => x !== id)) : new Set(o).add(id)))

  return (
    <div className="comments-pane">
      <div className="comments-tools">
        <input type="search" placeholder="Search comments" aria-label="Search comments" value={query} onChange={(e) => setQuery(e.target.value)} />
        <div className="comments-filters">
          <select aria-label="Filter by type" value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="">All types</option>
            {kinds.map((k) => (
              <option key={k} value={k}>
                {annotLabel(k)}
              </option>
            ))}
          </select>
          <select aria-label="Filter by author" value={author} onChange={(e) => setAuthor(e.target.value)}>
            <option value="">All authors</option>
            {authors.map((a) => (
              <option key={a} value={a}>
                {a || '(no author)'}
              </option>
            ))}
          </select>
          <select aria-label="Filter by status" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">Any status</option>
            {REVIEW_STATES.map((s) => (
              <option key={s} value={s}>
                {s === 'None' ? 'No status' : s}
              </option>
            ))}
          </select>
          <select aria-label="Sort comments" value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
            <option value="page">By page</option>
            <option value="date">Newest first</option>
            <option value="author">By author</option>
            <option value="type">By type</option>
          </select>
        </div>
        <div className="comments-actions">
          <span className="muted small" aria-live="polite">
            {shown.length} of {annots.length}
          </span>
          <button className="icon-btn" onClick={onSummarise} disabled={!annots.length} aria-label="Summarise comments" title="Summarise comments as a PDF">
            <FileText size={16} strokeWidth={1.8} aria-hidden />
          </button>
          <button className="icon-btn" onClick={onExportCsv} disabled={!annots.length} aria-label="Export comments to CSV" title="Export comments to a CSV file (Excel)">
            <Download size={16} strokeWidth={1.8} aria-hidden />
          </button>
        </div>
      </div>
      {!annots.length ? (
        <div className="side-empty">
          <MessageSquare size={20} strokeWidth={1.5} aria-hidden />
          <p>No comments in this document yet.</p>
        </div>
      ) : (
        <ul className="comment-list" aria-label="Comments">
          {shown.map((a) => {
            const st = reviewState(a)
            const replies = (a.replies ?? []).filter((r) => !r.state)
            const expanded = open.has(a.id) || a.id === selectedId
            return (
              <li key={a.id} className={a.id === selectedId ? 'comment on' : 'comment'}>
                <button className="comment-head" onClick={() => onFocus(a.id)} aria-label={`${annotLabel(a.kind)} on ${pageName(a.page)}${a.author ? ` by ${a.author}` : ''}`}>
                  <span className="comment-swatch" style={{ background: a.color }} aria-hidden />
                  <span className="comment-meta">
                    <span className="comment-kind">{annotLabel(a.kind)}</span>
                    <span className="muted small">
                      {pageName(a.page)}
                      {a.author ? ` · ${a.author}` : ''}
                      {a.modified || a.created ? ` · ${formatWhen(a.modified ?? a.created)}` : ''}
                    </span>
                  </span>
                  {st !== 'None' && <span className={`comment-state ${st.toLowerCase()}`}>{st}</span>}
                </button>
                {commentText(a) && <div className="comment-text">{commentText(a)}</div>}
                <button className="comment-toggle muted small" onClick={() => toggle(a.id)} aria-expanded={expanded}>
                  {expanded ? <ChevronDown size={12} aria-hidden /> : <ChevronRight size={12} aria-hidden />}
                  {replies.length ? `${replies.length} repl${replies.length === 1 ? 'y' : 'ies'}` : 'Reply'}
                </button>
                {expanded && (
                  <div className="comment-thread">
                    {replies.map((r) => (
                      <div key={r.id} className="comment-reply">
                        <div className="muted small">
                          {r.author || '(no author)'} · {formatWhen(r.date)}
                          <button className="icon-btn tiny" onClick={() => onDeleteReply(a.id, r.id)} aria-label="Delete reply" title="Delete reply">
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
                        const t = (drafts[a.id] ?? '').trim()
                        if (!t) return
                        onReply(a.id, t)
                        setDrafts((d) => ({ ...d, [a.id]: '' }))
                      }}
                    >
                      <input
                        aria-label="Reply"
                        placeholder="Write a reply"
                        value={drafts[a.id] ?? ''}
                        onChange={(e) => setDrafts((d) => ({ ...d, [a.id]: e.target.value }))}
                      />
                      <select aria-label="Set status" value="" onChange={(e) => e.target.value && onStatus(a.id, e.target.value as ReviewState)}>
                        <option value="">Status…</option>
                        {REVIEW_STATES.map((s) => (
                          <option key={s} value={s}>
                            {s === 'None' ? 'Clear status' : s}
                          </option>
                        ))}
                      </select>
                    </form>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
