import { useState } from 'react'
import { Download, Trash2 } from 'lucide-react'
import { MEASURE_TYPE_NAMES, measureTotals, type MeasureRow } from './measureList'
import { formatNumber } from './measure'
import { t } from './i18n'

interface Props {
  rows: MeasureRow[]
  selectedId: number | null
  /** Go to the measurement and select it. */
  onGo: (id: number) => void
  /** Rename (a count's group, or the label of any other measurement). */
  onLabel: (id: number, label: string) => void
  onDelete: (ids: number[]) => void
  onExportCsv: () => void
}

/** A text box that keeps its own draft and commits on Enter or when it loses focus. */
function LabelInput({ value, onCommit, label }: { value: string; onCommit: (v: string) => void; label: string }) {
  const [draft, setDraft] = useState<string | null>(null)
  const commit = () => {
    if (draft !== null && draft !== value) onCommit(draft)
    setDraft(null)
  }
  return (
    <input
      className="mp-label"
      aria-label={label}
      value={draft ?? value}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
        else if (e.key === 'Escape') setDraft(null)
      }}
    />
  )
}

/** Every measurement and count marker in the document: click to go to it, label it, delete it, export to CSV. */
export function MeasurePane({ rows, selectedId, onGo, onLabel, onDelete, onExportCsv }: Props) {
  const totals = measureTotals(rows)
  return (
    <div className="measure-pane" aria-label={t('Measurements')}>
      <div className="mp-actions">
        <button type="button" onClick={onExportCsv} disabled={!rows.length} title={t('Save every measurement as a CSV file')}>
          <Download size={14} aria-hidden /> {t('Export CSV')}
        </button>
        <button type="button" onClick={() => onDelete(rows.map((r) => r.id))} disabled={!rows.length} title={t('Delete every measurement and count marker')}>
          <Trash2 size={14} aria-hidden /> {t('Delete all')}
        </button>
      </div>
      {rows.length === 0 ? (
        <p className="muted">{t('No measurements yet. Use the Measure tab to measure a distance, perimeter or area, or to count.')}</p>
      ) : (
        <>
          <table>
            <thead>
              <tr>
                <th>{t('Page')}</th>
                <th>{t('Type')}</th>
                <th>{t('Value')}</th>
                <th>{t('Label')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className={`mp-row${r.id === selectedId ? ' selected' : ''}`} data-measure-id={r.id} onClick={() => onGo(r.id)}>
                  <td>{r.pageLabel}</td>
                  <td>{t(MEASURE_TYPE_NAMES[r.type])}</td>
                  <td>{r.result}</td>
                  <td>
                    <LabelInput value={r.label} onCommit={(v) => onLabel(r.id, v)} label={`${t('Label')} ${r.type === 'count' ? r.result : `${t(MEASURE_TYPE_NAMES[r.type])} ${r.pageLabel}`}`} />
                  </td>
                  <td>
                    <button type="button" aria-label={`${t('Delete')} ${r.result}`} title={t('Delete this measurement')} onClick={(e) => { e.stopPropagation(); onDelete([r.id]) }}>
                      <Trash2 size={13} aria-hidden />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <strong>{t('Totals')}</strong>
          <ul className="mp-totals">
            {totals.map((x) => (
              <li key={`${x.type}-${x.label}-${x.unit}`}>
                {x.type === 'count' ? `${x.label}: ${x.items}` : `${t(MEASURE_TYPE_NAMES[x.type])}: ${formatNumber(x.value)} ${x.unit} (${x.items})`}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}
