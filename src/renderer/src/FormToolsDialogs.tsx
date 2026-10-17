import { useMemo, useState } from 'react'
import { Modal } from './AppDialogs'
import type { DuplicateMode } from './formArrange'
import { csvTable, populateMatch, populateNames, type CsvTable } from './formData'
import type { FormField } from './forms'
import { t } from './i18n'
import { parsePageRanges } from './pageOps'

const MM = 72 / 25.4

/** Copy the selected field onto other pages at the same place, or down the page at a distance. */
export function DuplicateFieldDialog({ name, pageCount, currentPage, onSubmit, onClose }: { name: string; pageCount: number; currentPage: number; onSubmit: (m: DuplicateMode) => void; onClose: () => void }) {
  const [how, setHow] = useState<'pages' | 'offset'>(pageCount > 1 ? 'pages' : 'offset')
  const [pages, setPages] = useState(pageCount > 1 ? `1-${pageCount}` : '')
  const [copies, setCopies] = useState('1')
  const [dx, setDx] = useState('0')
  const [dy, setDy] = useState('10')
  const [error, setError] = useState('')

  const submit = () => {
    try {
      if (how === 'pages') {
        const list = parsePageRanges(pages, pageCount).filter((p) => p !== currentPage)
        if (!list.length) return setError(t('Choose at least one page other than this one.'))
        return onSubmit({ kind: 'pages', pages: list })
      }
      const n = Math.floor(Number(copies))
      if (!(n >= 1 && n <= 200)) return setError(t('Enter a number of copies from 1 to 200.'))
      onSubmit({ kind: 'offset', copies: n, dx: (Number(dx) || 0) * MM, dy: (Number(dy) || 0) * MM })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <Modal title={t('Duplicate field')} onClose={onClose}>
      <form
        className="marks-form props-form"
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        <p>{t('Copies of "{name}" are new fields with their own names and no value.', { name })}</p>
        <label className="props-row">
          <span>{t('Copy')}</span>
          <select aria-label={t('How to copy')} value={how} onChange={(e) => setHow(e.target.value as typeof how)}>
            <option value="pages" disabled={pageCount < 2}>
              {t('To other pages, at the same place')}
            </option>
            <option value="offset">{t('On this page, at a distance')}</option>
          </select>
        </label>
        {how === 'pages' ? (
          <label className="props-row">
            <span>{t('Pages')}</span>
            <input aria-label={t('Pages to copy to')} value={pages} onChange={(e) => setPages(e.target.value)} placeholder="1-3, 5" />
          </label>
        ) : (
          <div className="marks-row">
            <label className="inline">
              {t('Copies')}
              <input type="number" aria-label={t('Number of copies')} min={1} max={200} value={copies} onChange={(e) => setCopies(e.target.value)} />
            </label>
            <label className="inline">
              {t('Across (mm)')}
              <input type="number" aria-label={t('Distance across in millimetres')} value={dx} onChange={(e) => setDx(e.target.value)} />
            </label>
            <label className="inline">
              {t('Down (mm)')}
              <input type="number" aria-label={t('Distance down in millimetres')} value={dy} onChange={(e) => setDy(e.target.value)} />
            </label>
          </div>
        )}
        {error && (
          <p className="error-text" role="alert">
            {error}
          </p>
        )}
        <div className="marks-actions">
          <button type="button" onClick={onClose}>
            {t('Cancel')}
          </button>
          <button className="primary" type="submit">
            {t('Duplicate')}
          </button>
        </div>
      </form>
    </Modal>
  )
}

export interface PopulateRun {
  table: CsvTable
  nameColumn: string | null
  flatten: boolean
}

/** Fill the form from a CSV file: one PDF per row, each named from a column. */
export function PopulateDialog({ fields, stem, onRun, onClose }: { fields: FormField[]; stem: string; onRun: (r: PopulateRun) => void; onClose: () => void }) {
  const [file, setFile] = useState('')
  const [table, setTable] = useState<CsvTable | null>(null)
  const [nameColumn, setNameColumn] = useState('')
  const [flatten, setFlatten] = useState(false)
  const [error, setError] = useState('')

  const choose = async () => {
    const f = await window.openpdf.pickFile({ name: 'CSV (comma separated)', ext: ['csv'] })
    if (!f) return
    try {
      const tb = csvTable(new TextDecoder('utf-8').decode(f.data))
      setTable(tb)
      setFile(f.name)
      setError('')
      // A column called name or file is the likely choice for the file name.
      const guess = tb.header.find((h) => /^(file ?name|file|name)$/i.test(h)) ?? ''
      setNameColumn(guess)
    } catch (e) {
      setTable(null)
      setFile('')
      setError(e instanceof Error ? e.message : String(e))
    }
  }
  const match = useMemo(() => (table ? populateMatch(fields, table.header) : null), [fields, table])
  const names = useMemo(() => (table ? populateNames(table, nameColumn || null, stem) : []), [table, nameColumn, stem])
  const filled = table && match ? table.header.filter(Boolean).length - match.unknownColumns.length : 0

  return (
    <Modal title={t('Populate from CSV')} onClose={onClose}>
      <form
        className="marks-form props-form"
        onSubmit={(e) => {
          e.preventDefault()
          if (!table) return setError(t('Choose a CSV file first.'))
          if (!filled) return setError(t('No column of the CSV matches a field name.'))
          onRun({ table, nameColumn: nameColumn || null, flatten })
        }}
      >
        <p className="muted small">{t('The first row of the CSV holds field names; every other row makes one filled copy of this form. Fields the CSV does not mention keep their current values.')}</p>
        <div className="marks-row">
          <button type="button" onClick={() => void choose()}>
            {t('Choose CSV…')}
          </button>
          <span>{file || t('No file chosen')}</span>
        </div>
        {table && match && (
          <>
            <p>
              {t('{rows} rows. {cols} columns match fields.', { rows: table.rows.length, cols: filled })}
              {match.unknownColumns.length > 0 && ` ${t('Not used: {list}.', { list: match.unknownColumns.join(', ') })}`}
            </p>
            <label className="props-row">
              <span>{t('File name from')}</span>
              <select aria-label={t('File name column')} value={nameColumn} onChange={(e) => setNameColumn(e.target.value)}>
                <option value="">{t('Row number')}</option>
                {table.header.filter(Boolean).map((h) => (
                  <option key={h} value={h}>
                    {h}
                  </option>
                ))}
              </select>
            </label>
            <p className="muted small">
              {t('Files: {list}', { list: names.slice(0, 3).map((n) => `${n}.pdf`).join(', ') })}
              {names.length > 3 ? ', …' : ''}
            </p>
            <label className="inline">
              <input type="checkbox" checked={flatten} onChange={(e) => setFlatten(e.target.checked)} /> {t('Flatten each copy (the values can no longer be edited)')}
            </label>
          </>
        )}
        {error && (
          <p className="error-text" role="alert">
            {error}
          </p>
        )}
        <div className="marks-actions">
          <button type="button" onClick={onClose}>
            {t('Cancel')}
          </button>
          <button className="primary" type="submit">
            {t('Create PDFs')}
          </button>
        </div>
      </form>
    </Modal>
  )
}
