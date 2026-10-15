import { useState } from 'react'
import { Modal } from './AppDialogs'
import type { Detected } from './formDetect'
import { t } from './i18n'

/** The fields found on the pages: tick the ones to create and adjust their names. */
export function DetectDialog({ found, onApply, onClose }: { found: Detected[]; onApply: (chosen: Detected[]) => void; onClose: () => void }) {
  // Many rules or boxes on one page are most likely a table, not blanks to fill: leave those unticked.
  const crowded = new Set<string>()
  const tally = new Map<string, number>()
  for (const d of found) if (d.source === 'rule' || d.source === 'box') tally.set(`${d.page}:${d.source}`, (tally.get(`${d.page}:${d.source}`) ?? 0) + 1)
  for (const [k, n] of tally) if (n > 12) crowded.add(k)
  const [rows, setRows] = useState(() => found.map((d) => ({ ...d, on: !crowded.has(`${d.page}:${d.source}`) })))
  const chosen = rows.filter((r) => r.on)
  const names = chosen.map((r) => r.name.trim())
  const bad = names.some((n) => !n || n.includes('.')) || new Set(names).size !== names.length
  const set = (i: number, patch: Partial<(typeof rows)[number]>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)))
  return (
    <Modal title={t('Detected fields')} onClose={onClose}>
      {rows.length === 0 ? (
        <div className="marks-form">
          <p>No blanks, rules, boxes or check squares with labels were found on these pages.</p>
          <div className="marks-actions">
            <button className="primary" onClick={onClose}>
              Close
            </button>
          </div>
        </div>
      ) : (
        <form
          className="marks-form detect-form"
          onSubmit={(e) => {
            e.preventDefault()
            if (!bad) onApply(chosen.map((r) => ({ ...r, name: r.name.trim() })))
          }}
        >
          <p className="muted">
            Found {rows.length} place{rows.length === 1 ? '' : 's'} for a field, named from the text beside each. Untick any that are not fields.
            {crowded.size > 0 && ' Pages with many lines or boxes look like tables, so those start unticked.'}
          </p>
          <div className="marks-row">
            <button type="button" onClick={() => setRows(rows.map((r) => ({ ...r, on: true })))}>
              Select all
            </button>
            <button type="button" onClick={() => setRows(rows.map((r) => ({ ...r, on: false })))}>
              Select none
            </button>
          </div>
          <table className="labels-table detect-table">
            <thead>
              <tr>
                <th />
                <th>Page</th>
                <th>Kind</th>
                <th>Name</th>
                <th>Found as</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  <td>
                    <input type="checkbox" aria-label={`Create ${r.name}`} checked={r.on} onChange={(e) => set(i, { on: e.target.checked })} />
                  </td>
                  <td>{r.page + 1}</td>
                  <td>{r.type === 'text' ? 'Text' : 'Check box'}</td>
                  <td>
                    <input aria-label={`Name of field ${i + 1}`} value={r.name} onChange={(e) => set(i, { name: e.target.value })} />
                  </td>
                  <td className="muted">{r.source === 'blank' ? 'blank' : r.source === 'rule' ? 'line' : r.source === 'box' ? 'box' : 'square'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {bad && (
            <p className="error-text" role="alert">
              Each chosen field needs its own name, without full stops.
            </p>
          )}
          <div className="marks-actions">
            <button type="button" onClick={onClose}>
              Cancel
            </button>
            <button className="primary" type="submit" disabled={bad || !chosen.length}>
              Create {chosen.length} field{chosen.length === 1 ? '' : 's'}
            </button>
          </div>
        </form>
      )}
    </Modal>
  )
}
