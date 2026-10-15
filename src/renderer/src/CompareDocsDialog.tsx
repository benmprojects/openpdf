import { useEffect, useMemo, useRef, useState } from 'react'
import { Modal } from './AppDialogs'
import { diffTokens, groupChanges, padTo, tokenise, visualDiff, type Change } from './compareDocs'
import { PdfClient, type PageSize } from './pdfClient'

interface Side {
  name: string
  client: PdfClient
  pages: PageSize[]
  /** True when this client is ours to close. */
  owned: boolean
}

const SCALE = 1.25

/** Compare the open document with another PDF: what the words say, and what the pages look like. */
export function CompareDocsDialog({ current, onClose }: { current: { name: string; client: PdfClient; pages: PageSize[] }; onClose: () => void }) {
  const [other, setOther] = useState<Side | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [changes, setChanges] = useState<Change[] | null>(null)
  const [tab, setTab] = useState<'text' | 'visual'>('text')
  const [page, setPage] = useState(0)
  const [pageChange, setPageChange] = useState<Record<number, number>>({})
  const canvas = useRef<HTMLCanvasElement>(null)
  const otherRef = useRef<Side | null>(null)
  otherRef.current = other
  useEffect(
    () => () => {
      if (otherRef.current?.owned) otherRef.current.client.dispose()
    },
    []
  )

  const choose = async () => {
    setError('')
    const f = await window.openpdf.pickFile({ name: 'PDF documents', ext: ['pdf'] })
    if (!f) return
    setBusy(true)
    if (other?.owned) other.client.dispose()
    setChanges(null)
    setPageChange({})
    try {
      const client = new PdfClient()
      const pages = await client.load(f.data)
      const side: Side = { name: f.name, client, pages, owned: true }
      setOther(side)
      const text = async (c: PdfClient, n: number) => {
        const out: string[] = []
        for (let p = 0; p < n; p++) out.push((await c.pageText(p)).text)
        return out
      }
      const [a, b] = [await text(current.client, current.pages.length), await text(client, pages.length)]
      setChanges(groupChanges(diffTokens(tokenise(a), tokenise(b))))
    } catch (e) {
      setOther(null)
      setError(`That document could not be compared: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setBusy(false)
    }
  }

  const pageCount = Math.max(current.pages.length, other?.pages.length ?? 0)

  /** Renders page `p` of both documents on a common white canvas and returns the comparison. */
  const compareVisual = async (p: number) => {
    if (!other) return null
    const render = async (c: PdfClient, pages: PageSize[]) => (p < pages.length ? c.render(p, SCALE) : null)
    const [ra, rb] = [await render(current.client, current.pages), await render(other.client, other.pages)]
    const w = Math.max(ra?.width ?? 1, rb?.width ?? 1)
    const h = Math.max(ra?.height ?? 1, rb?.height ?? 1)
    const blank = (): Uint8Array => new Uint8Array(w * h * 4).fill(255)
    return visualDiff(ra ? padTo(ra.data, ra.width, ra.height, w, h) : blank(), rb ? padTo(rb.data, rb.width, rb.height, w, h) : blank(), w, h)
  }

  useEffect(() => {
    if (tab !== 'visual' || !other) return
    let live = true
    void compareVisual(page).then((d) => {
      if (!live || !d || !canvas.current) return
      const c = canvas.current
      c.width = d.width
      c.height = d.height
      c.getContext('2d')!.putImageData(new ImageData(d.overlay, d.width, d.height), 0, 0)
      setPageChange((m) => ({ ...m, [page]: d.changed }))
    })
    return () => {
      live = false
    }
  }, [tab, page, other]) // eslint-disable-line react-hooks/exhaustive-deps

  const checkAll = async () => {
    setBusy(true)
    try {
      const next: Record<number, number> = {}
      for (let p = 0; p < pageCount; p++) {
        const d = await compareVisual(p)
        if (d) next[p] = d.changed
        setPageChange({ ...next })
      }
    } finally {
      setBusy(false)
    }
  }

  const differing = useMemo(() => Object.entries(pageChange).filter(([, v]) => v > 0.0005).map(([k]) => Number(k) + 1), [pageChange])

  return (
    <Modal title="Compare documents" onClose={onClose} wide>
      <div className="marks-form compare-docs">
        <p>
          <strong>{current.name}</strong> ({current.pages.length} page{current.pages.length === 1 ? '' : 's'}) compared with{' '}
          {other ? (
            <strong>
              {other.name} ({other.pages.length} page{other.pages.length === 1 ? '' : 's'})
            </strong>
          ) : (
            'another document'
          )}
          . <button type="button" onClick={() => void choose()} disabled={busy}>{other ? 'Choose another…' : 'Choose a document…'}</button>
        </p>
        {error && (
          <p className="error-text" role="alert">
            {error}
          </p>
        )}
        {busy && !changes && <p className="muted">Comparing…</p>}
        {other && changes && (
          <>
            <div role="tablist" aria-label="Kind of comparison" className="compare-tabs">
              <button role="tab" aria-selected={tab === 'text'} onClick={() => setTab('text')}>
                Text ({changes.length} change{changes.length === 1 ? '' : 's'})
              </button>
              <button role="tab" aria-selected={tab === 'visual'} onClick={() => setTab('visual')}>
                Appearance
              </button>
            </div>
            {tab === 'text' && (
              <section aria-label="Text changes">
                {changes.length === 0 && <p>The text is the same in both documents.</p>}
                <ol className="compare-list">
                  {changes.slice(0, 500).map((c, i) => (
                    <li key={i}>
                      <span className="muted">
                        {c.pageA !== null && `Page ${c.pageA + 1}`}
                        {c.pageA !== null && c.pageB !== null && c.pageA !== c.pageB ? ` / now page ${c.pageB + 1}` : ''}
                        {c.pageA === null && c.pageB !== null ? `Page ${c.pageB + 1} of the second` : ''}
                        :{' '}
                      </span>
                      {c.before && <span>…{c.before} </span>}
                      {c.removed && <del>{c.removed}</del>} {c.added && <ins>{c.added}</ins>}
                      {c.after && <span> {c.after}…</span>}
                    </li>
                  ))}
                </ol>
                {changes.length > 500 && <p className="muted">Showing the first 500 of {changes.length} changes.</p>}
              </section>
            )}
            {tab === 'visual' && (
              <section aria-label="Appearance">
                <div className="batch-actionbar">
                  <label>
                    Page{' '}
                    <select aria-label="Compare page" value={page} onChange={(e) => setPage(Number(e.target.value))}>
                      {Array.from({ length: pageCount }, (_, i) => (
                        <option key={i} value={i}>
                          {i + 1}
                          {pageChange[i] !== undefined ? ` (${pageChange[i] > 0.0005 ? `${(pageChange[i] * 100).toFixed(1)}% differs` : 'same'})` : ''}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button type="button" onClick={() => void checkAll()} disabled={busy}>
                    Check every page
                  </button>
                  {differing.length > 0 && <span className="muted">Pages that differ: {differing.join(', ')}</span>}
                </div>
                <p className="muted">
                  <span style={{ color: '#dc3232' }}>Red</span>: only in {current.name}. <span style={{ color: '#285ae6' }}>Blue</span>: only in {other.name}. Grey: the same in both.
                </p>
                <div className="compare-canvas">
                  <canvas ref={canvas} aria-label="Overlay of the two pages" />
                </div>
                <p role="status" className="muted">
                  {pageChange[page] !== undefined ? (pageChange[page] > 0.0005 ? `${(pageChange[page] * 100).toFixed(2)}% of this page differs.` : 'This page looks the same in both.') : 'Comparing…'}
                </p>
              </section>
            )}
          </>
        )}
        <div className="marks-actions">
          <span style={{ flex: 1 }} />
          <button className="primary" type="button" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </Modal>
  )
}
