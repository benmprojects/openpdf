import { GitCompare, Plus, X } from 'lucide-react'
import { annotLabel, type Annot } from './annotations'
import type { Comparison } from './compareAnnots'
import { commentText } from './CommentsPane'

interface Props {
  otherName: string
  result: Comparison
  onFocus: (a: Annot) => void
  onAdd: (a: Annot) => void
  onAddAll: () => void
  onTakeTheirs: (index: number) => void
  onClose: () => void
}

const where = (a: Annot) => `${annotLabel(a.kind)} · page ${a.page + 1}${a.author ? ` · ${a.author}` : ''}`

/** Comments compared with another copy of the document: changed, only there, only here. */
export function ComparePanel({ otherName, result, onFocus, onAdd, onAddAll, onTakeTheirs, onClose }: Props) {
  const { changed, onlyMine, onlyTheirs, same } = result
  return (
    <aside className="search-panel" aria-label="Compare comments">
      <div className="search-panel-head">
        <GitCompare size={16} strokeWidth={1.8} aria-hidden />
        <h2>Compare comments</h2>
        <button className="icon-btn" onClick={onClose} aria-label="Close compare" title="Close">
          <X size={16} strokeWidth={1.8} aria-hidden />
        </button>
      </div>
      <div className="search-panel-status muted small">
        With {otherName}: {same} the same, {changed.length} changed, {onlyTheirs.length} only there, {onlyMine.length} only here.
      </div>
      <div className="compare-body">
        <h3>Changed ({changed.length})</h3>
        <ul className="compare-list" aria-label="Changed comments">
          {changed.map((c, i) => (
            <li key={i}>
              <button className="compare-item" onClick={() => onFocus(c.mine)}>
                <span className="comment-kind">{where(c.mine)}</span>
                <span className="muted small">Different: {c.diffs.join(', ')}</span>
                {c.diffs.includes('text') && (
                  <span className="compare-text">
                    <del>{commentText(c.mine) || '(empty)'}</del> <ins>{commentText(c.theirs) || '(empty)'}</ins>
                  </span>
                )}
              </button>
              <button className="btn small" onClick={() => onTakeTheirs(i)} title={`Use the text, colour and replies from ${otherName}`}>
                Use theirs
              </button>
            </li>
          ))}
        </ul>
        <h3>
          Only in {otherName} ({onlyTheirs.length})
          {onlyTheirs.length > 1 && (
            <button className="btn small" onClick={onAddAll}>
              <Plus size={12} aria-hidden /> Add all
            </button>
          )}
        </h3>
        <ul className="compare-list" aria-label="Comments only in the other copy">
          {onlyTheirs.map((a, i) => (
            <li key={i}>
              <div className="compare-item">
                <span className="comment-kind">{where(a)}</span>
                {commentText(a) && <span className="compare-text">{commentText(a)}</span>}
              </div>
              <button className="btn small" onClick={() => onAdd(a)} title="Add this comment to this document">
                <Plus size={12} aria-hidden /> Add
              </button>
            </li>
          ))}
        </ul>
        <h3>Only in this document ({onlyMine.length})</h3>
        <ul className="compare-list" aria-label="Comments only in this document">
          {onlyMine.map((a) => (
            <li key={a.id}>
              <button className="compare-item" onClick={() => onFocus(a)}>
                <span className="comment-kind">{where(a)}</span>
                {commentText(a) && <span className="compare-text">{commentText(a)}</span>}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </aside>
  )
}
