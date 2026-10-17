import { useEffect, useRef, useState } from 'react'
import type { PdfClient } from './pdfClient'
import { contextOf, groupByPage, type Context, type ListHit } from './searchPatterns'
import type { Match } from './textLogic'

const SHOWN = 400

interface Props {
  client: PdfClient
  matches: Match[]
  current: number
  onPickMatch: (index: number) => void
  /** Hits in comments and bookmarks. */
  others: ListHit[]
  onPickOther: (hit: ListHit) => void
  pageLabel: (page: number) => string
  truncated: boolean
}

/** The results of a search in the open document, grouped by page, each with the words around it. */
export function SearchResults({ client, matches, current, onPickMatch, others, onPickOther, pageLabel, truncated }: Props) {
  const [ctx, setCtx] = useState<Map<string, Context>>(new Map())
  const run = useRef(0)
  const shown = matches.slice(0, SHOWN)

  useEffect(() => {
    const id = ++run.current
    const pages = [...new Set(shown.map((m) => m.page))]
    void (async () => {
      const next = new Map<string, Context>()
      for (const p of pages) {
        try {
          const pt = await client.pageText(p)
          for (const m of shown) if (m.page === p) next.set(`${m.page}:${m.from}`, contextOf(pt, m))
        } catch {
          // A page that cannot be read shows its matches without context.
        }
        if (id !== run.current) return
      }
      setCtx(next)
    })()
    return () => {
      run.current++
    }
  }, [matches, client]) // eslint-disable-line react-hooks/exhaustive-deps

  const groups = groupByPage(shown.map((m, i) => ({ page: m.page, i, m })))
  const comments = others.filter((h) => h.kind === 'comment')
  const marks = others.filter((h) => h.kind === 'bookmark')
  const nothing = !groups.length && !others.length
  return (
    <div className="find-results" role="region" aria-label="Search results list">
      {nothing && <p className="muted small">No results.</p>}
      {groups.map((g) => (
        <div key={g.page} className="find-group">
          <h3>
            Page {pageLabel(g.page)} <span className="muted small">({g.items.length})</span>
          </h3>
          <ul>
            {g.items.map(({ i, m }) => {
              const c = ctx.get(`${m.page}:${m.from}`)
              return (
                <li key={i}>
                  <button className={i === current ? 'find-hit on' : 'find-hit'} onClick={() => onPickMatch(i)} aria-current={i === current}>
                    {c ? (
                      <>
                        {c.before}
                        <mark>{c.match}</mark>
                        {c.after}
                      </>
                    ) : (
                      '…'
                    )}
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
      ))}
      {(matches.length > SHOWN || truncated) && <p className="muted small">Showing the first {SHOWN} matches in the list; all of them are marked on the pages.</p>}
      {comments.length > 0 && (
        <div className="find-group">
          <h3>
            In comments <span className="muted small">({comments.length})</span>
          </h3>
          <ul>
            {comments.map((h, i) => (
              <li key={i}>
                <button className="find-hit" onClick={() => onPickOther(h)}>
                  <span className="muted small">p. {pageLabel(h.page)} </span>
                  {h.before}
                  <mark>{h.match}</mark>
                  {h.after}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {marks.length > 0 && (
        <div className="find-group">
          <h3>
            In bookmarks <span className="muted small">({marks.length})</span>
          </h3>
          <ul>
            {marks.map((h, i) => (
              <li key={i}>
                <button className="find-hit" onClick={() => onPickOther(h)} title={h.trail}>
                  {h.before}
                  <mark>{h.match}</mark>
                  {h.after}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
