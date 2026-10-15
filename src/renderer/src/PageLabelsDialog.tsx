import { useState } from 'react'
import { Modal } from './AppDialogs'
import { labelFor, type LabelRange, type LabelStyle } from './outlineEdit'

const STYLES: [LabelStyle, string][] = [
  ['D', '1, 2, 3'],
  ['r', 'i, ii, iii'],
  ['R', 'I, II, III'],
  ['a', 'a, b, c'],
  ['A', 'A, B, C'],
  ['', 'None (prefix only)']
]

/** Edits the page label ranges: each range starts at a page and numbers the pages up to the next range. */
export function PageLabelsDialog({
  initial,
  pageCount,
  currentPage,
  onApply,
  onClose
}: {
  initial: LabelRange[]
  pageCount: number
  currentPage: number
  onApply: (ranges: LabelRange[]) => void
  onClose: () => void
}) {
  const [ranges, setRanges] = useState<LabelRange[]>(initial.length ? initial : [{ start: 0, style: 'D', prefix: '', first: 1 }])
  const sorted = [...ranges].sort((a, b) => a.start - b.start)
  const starts = new Set(ranges.map((r) => r.start))
  const dupes = starts.size !== ranges.length
  const set = (i: number, patch: Partial<LabelRange>) => setRanges(ranges.map((r, j) => (j === i ? { ...r, ...patch } : r)))
  const rangeOf = (p: number) => sorted.filter((r) => r.start <= p).pop()
  const preview = Array.from({ length: Math.min(pageCount, 12) }, (_, p) => {
    const r = rangeOf(p)
    return r ? labelFor(r, p) : String(p + 1)
  })
  return (
    <Modal title="Page labels" onClose={onClose}>
      <form
        className="marks-form"
        onSubmit={(e) => {
          e.preventDefault()
          if (!dupes) onApply(ranges)
        }}
      >
        <p className="muted">Page labels are the page numbers a reader shows, such as i, ii for the front matter and 1, 2 for the body. Each range runs until the next one starts.</p>
        <table className="labels-table">
          <thead>
            <tr>
              <th>From page</th>
              <th>Style</th>
              <th>Prefix</th>
              <th>Start at</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {ranges.map((r, i) => (
              <tr key={i}>
                <td>
                  <input
                    type="number"
                    aria-label={`Range ${i + 1} first page`}
                    min={1}
                    max={pageCount}
                    value={r.start + 1}
                    onChange={(e) => set(i, { start: Math.min(pageCount, Math.max(1, Number(e.target.value) || 1)) - 1 })}
                  />
                </td>
                <td>
                  <select aria-label={`Range ${i + 1} style`} value={r.style} onChange={(e) => set(i, { style: e.target.value as LabelStyle })}>
                    {STYLES.map(([v, t]) => (
                      <option key={v || 'none'} value={v}>
                        {t}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <input aria-label={`Range ${i + 1} prefix`} value={r.prefix} onChange={(e) => set(i, { prefix: e.target.value })} />
                </td>
                <td>
                  <input type="number" aria-label={`Range ${i + 1} start number`} min={1} value={r.first} onChange={(e) => set(i, { first: Math.max(1, Number(e.target.value) || 1) })} />
                </td>
                <td>
                  <button type="button" onClick={() => setRanges(ranges.filter((_, j) => j !== i))} aria-label={`Remove range ${i + 1}`} disabled={ranges.length === 1 && i === 0}>
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="marks-row">
          <button type="button" onClick={() => setRanges([...ranges, { start: Math.min(pageCount - 1, currentPage), style: 'D', prefix: '', first: 1 }])}>
            Add range at page {currentPage + 1}
          </button>
          <button type="button" onClick={() => setRanges([])} title="Remove all labels; pages are numbered 1, 2, 3 …">
            Clear all
          </button>
        </div>
        {dupes && <p className="error-text">Two ranges start on the same page.</p>}
        <p className="muted" aria-label="Preview">
          Preview: {preview.join(', ')}
          {pageCount > preview.length ? ' …' : ''}
        </p>
        <div className="marks-actions">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="primary" type="submit" disabled={dupes}>
            Apply
          </button>
        </div>
      </form>
    </Modal>
  )
}
