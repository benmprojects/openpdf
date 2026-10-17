import { useState } from 'react'
import { annotLabel, type Annot, type AnnotKind } from './annotations'
import { applyFilter, authorOf, COMMENT_KINDS, type CommentFilter } from './commentFilter'
import type { FlattenWhat } from './flatten'
import type { ExcelOptions, PowerPointOptions, WordOptions } from './exportRun'
import { t } from './i18n'
import { Frame, PagesControl } from './PageOpsDialogs'
import { initialRange, pagesWord, resolveRange, type DocContext, type RangePreset, type RangeValue } from './pageDialogLogic'

/** Modal dialogs for commands outside the Pages tab: Flatten, Export text, Comments import and export, Save as. */

const PRESETS: RangePreset[] = ['all', 'current', 'selected', 'odd', 'even', 'custom']
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

// ---- Flatten ------------------------------------------------------------------------------------------

export function FlattenDialog({ ctx, fieldPages, annotPages, onCancel, onSubmit }: { ctx: DocContext; fieldPages: number[]; annotPages: number[]; onCancel: () => void; onSubmit: (what: FlattenWhat, pages: number[]) => void }) {
  const [what, setWhat] = useState<FlattenWhat>(fieldPages.length || !annotPages.length ? 'fields' : 'annots')
  const [range, setRange] = useState<RangeValue>({ preset: 'all', custom: '' })
  const r = resolveRange(range, ctx)
  const on = new Set(r.pages)
  // Fields count as one only when all of their widgets are in range; this is a close, honest estimate for the summary.
  const fields = what === 'annots' ? 0 : fieldPages.filter((p) => on.has(p)).length
  const annots = what === 'fields' ? 0 : annotPages.filter((p) => on.has(p)).length
  let error = r.error
  if (!error && what === 'fields' && !fields) error = t('There are no form fields on these pages.')
  if (!error && what === 'annots' && !annots) error = t('There are no comments or annotations on these pages.')
  if (!error && what === 'both' && !fields && !annots) error = t('There are no form fields, comments or annotations on these pages.')
  const parts = [what !== 'annots' && plural(fields, 'form field'), what !== 'fields' && plural(annots, 'comment or annotation')].filter(Boolean).join(' and ')
  return (
    <Frame
      title={t('Flatten')}
      ok={t('Flatten')}
      error={error}
      summary={t('{what} on {pages} will become part of the page content.', { what: parts, pages: pagesWord(r.pages.length) })}
      warning={t('Flattened content can no longer be edited. You can undo this until you save; after saving it cannot be undone, so keep a copy of the original.')}
      onClose={onCancel}
      onOk={() => onSubmit(what, r.pages)}
    >
      <fieldset className="pod-group">
        <legend>{t('Flatten')}</legend>
        {(
          [
            ['fields', t('Form fields')],
            ['annots', t('Comments and annotations')],
            ['both', t('Both')]
          ] as [FlattenWhat, string][]
        ).map(([k, label]) => (
          <label key={k} className="pod-radio">
            <input type="radio" name="flatten-what" checked={what === k} onChange={() => setWhat(k)} /> {label}
          </label>
        ))}
      </fieldset>
      <PagesControl value={range} onChange={setRange} ctx={ctx} presets={PRESETS} />
    </Frame>
  )
}

// ---- Export text, HTML, Word --------------------------------------------------------------------------

export interface ExportOptions {
  word: WordOptions
  excel: ExcelOptions
  ppt: PowerPointOptions
}

export function ExportTextDialog({ kind, ctx, stem, dir, onCancel, onSubmit }: { kind: 'txt' | 'html' | 'docx' | 'xlsx' | 'pptx'; ctx: DocContext; stem: string; dir: string | null; onCancel: () => void; onSubmit: (pages: number[], keepLayout: boolean, options: ExportOptions) => void }) {
  const [range, setRange] = useState<RangeValue>({ preset: 'all', custom: '' })
  // Text keeps its line breaks unless told otherwise; HTML and Word build headings and paragraphs unless told otherwise.
  const [keepLayout, setKeepLayout] = useState(kind === 'txt')
  const [word, setWord] = useState<WordOptions>({ mode: 'flow', pictures: true, tables: true, columns: true })
  const [oneSheet, setOneSheet] = useState(false)
  const [ppt, setPpt] = useState<PowerPointOptions>({ dpi: 150, format: 'png', notes: true })
  const r = resolveRange(range, ctx)
  const title = { txt: t('Export as text'), html: t('Export as HTML'), docx: t('Export as Word'), xlsx: t('Export as Excel'), pptx: t('Export as PowerPoint') }[kind]
  const file = `${stem}.${kind}`
  const what = kind === 'xlsx' ? t('The tables found on {pages} will be saved as "{file}". You choose the folder next.', { pages: pagesWord(r.pages.length), file }) : kind === 'pptx' ? t('{pages} will be saved as "{file}", one slide each. You choose the folder next.', { pages: pagesWord(r.pages.length), file }) : t('The text of {pages} will be saved as "{file}". You choose the folder next.', { pages: pagesWord(r.pages.length), file })
  return (
    <Frame title={title} ok={t('Export…')} error={r.error} summary={what} onClose={onCancel} onOk={() => onSubmit(r.pages, kind === 'docx' || kind === 'xlsx' || kind === 'pptx' ? false : keepLayout, { word, excel: { oneSheet }, ppt })}>
      <PagesControl value={range} onChange={setRange} ctx={ctx} presets={PRESETS} />
      {kind === 'docx' && (
        <>
          <fieldset className="pod-group">
            <legend>{t('Layout')}</legend>
            <label className="pod-radio">
              <input type="radio" name="word-mode" checked={word.mode === 'flow'} onChange={() => setWord({ ...word, mode: 'flow' })} /> {t('Flowing text')}
            </label>
            <label className="pod-radio">
              <input type="radio" name="word-mode" checked={word.mode === 'exact'} onChange={() => setWord({ ...word, mode: 'exact' })} /> {t('Exact layout')}
            </label>
            <p className="pod-hint">
              {word.mode === 'flow'
                ? t('Headings, paragraphs, tables, pictures and columns are rebuilt as ordinary Word content that you can edit and reflow. The page looks may differ from the PDF.')
                : t('Each block of text is fixed where it is on the page and pictures sit behind it, so pages look like the PDF but are awkward to edit. Fonts that are not installed can make lines wrap differently. Tables are not rebuilt, and the hidden text of scanned pages is left out.')}
            </p>
          </fieldset>
          <label className="pod-check">
            <input type="checkbox" checked={word.pictures} onChange={(e) => setWord({ ...word, pictures: e.target.checked })} /> {t('Keep pictures (cut from the page as it is drawn)')}
          </label>
          <label className="pod-check">
            <input type="checkbox" checked={word.tables} disabled={word.mode === 'exact'} onChange={(e) => setWord({ ...word, tables: e.target.checked })} /> {t('Rebuild tables found from ruled lines and aligned text')}
          </label>
          <label className="pod-check">
            <input type="checkbox" checked={word.columns} disabled={word.mode === 'exact'} onChange={(e) => setWord({ ...word, columns: e.target.checked })} /> {t('Keep text columns')}
          </label>
        </>
      )}
      {kind === 'xlsx' && (
        <>
          <fieldset className="pod-group">
            <legend>{t('Sheets')}</legend>
            <label className="pod-radio">
              <input type="radio" name="xlsx-sheets" checked={!oneSheet} onChange={() => setOneSheet(false)} /> {t('One sheet for each page that has tables')}
            </label>
            <label className="pod-radio">
              <input type="radio" name="xlsx-sheets" checked={oneSheet} onChange={() => setOneSheet(true)} /> {t('One sheet for all the tables')}
            </label>
          </fieldset>
          <p className="pod-hint">{t('Numbers, percentages, dollar amounts and dates (DD/MM/YYYY) are saved as values; everything else stays text. Tables are found from ruled lines and from text lined up in rows and columns, so check the result.')}</p>
        </>
      )}
      {kind === 'pptx' && (
        <>
          <div className="pod-field">
            <span>{t('Resolution')}</span>
            <select aria-label={t('Resolution')} value={ppt.dpi} onChange={(e) => setPpt({ ...ppt, dpi: Number(e.target.value) })}>
              {[96, 150, 200].map((d) => (
                <option key={d} value={d}>
                  {d} dpi
                </option>
              ))}
            </select>
          </div>
          <div className="pod-field">
            <span>{t('Picture format')}</span>
            <select aria-label={t('Picture format')} value={ppt.format} onChange={(e) => setPpt({ ...ppt, format: e.target.value as 'png' | 'jpg' })}>
              <option value="png">{t('PNG (sharp text)')}</option>
              <option value="jpg">{t('JPEG (smaller file)')}</option>
            </select>
          </div>
          <label className="pod-check">
            <input type="checkbox" checked={ppt.notes} onChange={(e) => setPpt({ ...ppt, notes: e.target.checked })} /> {t('Put the text of each page in the speaker notes')}
          </label>
          <p className="pod-hint">{t('Each slide is a picture of the page, so its text cannot be edited in PowerPoint. The slide takes the shape of the first page.')}</p>
        </>
      )}
      {kind !== 'docx' && kind !== 'xlsx' && kind !== 'pptx' && (
        <label className="pod-check">
          <input type="checkbox" checked={keepLayout} onChange={(e) => setKeepLayout(e.target.checked)} /> {t('Keep the line breaks as they are on the page')}
        </label>
      )}
      {kind === 'html' && !keepLayout && <p className="pod-hint">{t('Lines are joined into headings and paragraphs.')}</p>}
      <div className="pod-field">
        <span>{t('Save as')}</span>
        <span className="pod-hint" title={dir ? `${dir}\\${file}` : file}>
          {dir ? `${dir}\\${file}` : file}
        </span>
      </div>
    </Frame>
  )
}

// ---- Comments import and export -----------------------------------------------------------------------

export type CommentFormat = 'xfdf' | 'fdf' | 'csv' | 'summary'

export type CommentsDialogResult = { mode: 'export'; format: CommentFormat; filter: CommentFilter } | { mode: 'import'; replace: boolean; filter: CommentFilter }

const FORMAT_LABEL: Record<CommentFormat, string> = { xfdf: 'XFDF (XML)', fdf: 'FDF', csv: 'CSV (Excel)', summary: 'Summary (PDF)' }

export function CommentsDialog({ mode, initialFormat, annots, ctx, onCancel, onSubmit }: { mode: 'import' | 'export'; initialFormat: CommentFormat; annots: Annot[]; ctx: DocContext; onCancel: () => void; onSubmit: (r: CommentsDialogResult) => void }) {
  const [format, setFormat] = useState<CommentFormat>(initialFormat)
  const [by, setBy] = useState<CommentFilter['by']>('all')
  const [range, setRange] = useState<RangeValue>(() => initialRange(ctx))
  const [kinds, setKinds] = useState<AnnotKind[]>([])
  const [authors, setAuthors] = useState<string[]>([])
  const [authorText, setAuthorText] = useState('')
  const [replace, setReplace] = useState(false)
  const r = resolveRange(range, ctx)
  const presentKinds = COMMENT_KINDS.filter((k) => annots.some((a) => a.kind === k))
  const known = [...new Set(annots.map(authorOf))].sort((a, b) => a.localeCompare(b))
  const importing = mode === 'import'
  const importAuthors = authorText.split(';').map((s) => s.trim()).filter(Boolean)
  const filter: CommentFilter = { by, pages: r.pages, kinds, authors: importing ? importAuthors : authors }
  const own = annots.filter((a) => a.kind !== 'link' && a.kind !== 'foreign')
  const matching = applyFilter(annots, filter).length

  let error: string | null = null
  if (by === 'pages') error = r.error
  if (!error && by === 'type' && !kinds.length) error = t('Choose at least one type of comment.')
  if (!error && by === 'author' && !(importing ? importAuthors : authors).length) error = importing ? t('Type at least one author name.') : t('Choose at least one author.')
  if (!error && !importing && !annots.length) error = t('There are no comments to export.')
  if (!error && !importing && !matching) error = t('No comments match these choices.')

  const kindList = importing ? COMMENT_KINDS : presentKinds
  const toggle = <T,>(list: T[], v: T, on: boolean) => (on ? [...list, v] : list.filter((x) => x !== v))
  const summary = importing
    ? replace
      ? t('The comments chosen from the file will replace the {n} here. You choose the file next.', { n: own.length })
      : t('The comments chosen from the file will be added to the {n} here. You choose the file next.', { n: own.length })
    : t('{n} will be exported as {format}. You choose where to save it next.', { n: plural(matching, 'comment'), format: FORMAT_LABEL[format] })

  return (
    <Frame
      title={importing ? t('Import comments') : t('Export comments')}
      ok={importing ? t('Import…') : t('Export…')}
      error={error}
      summary={summary}
      warning={importing && replace && own.length ? t('{n} will be removed first. You can undo this until you save.', { n: plural(own.length, 'existing comment') }) : null}
      onClose={onCancel}
      onOk={() => onSubmit(importing ? { mode: 'import', replace, filter } : { mode: 'export', format, filter })}
      wide
    >
      {!importing && (
        <label className="pod-field">
          <span>{t('Format')}</span>
          <select aria-label={t('Format')} value={format} onChange={(e) => setFormat(e.target.value as CommentFormat)}>
            {(Object.keys(FORMAT_LABEL) as CommentFormat[]).map((f) => (
              <option key={f} value={f}>
                {FORMAT_LABEL[f]}
              </option>
            ))}
          </select>
        </label>
      )}
      {importing && <p className="pod-hint">{t('XFDF and FDF files are both accepted; the type is detected from the file.')}</p>}
      <label className="pod-field">
        <span>{importing ? t('Comments to import') : t('Comments to export')}</span>
        <select aria-label={t('Which comments')} value={by} onChange={(e) => setBy(e.target.value as CommentFilter['by'])}>
          <option value="all">{t('All comments')}</option>
          <option value="pages">{t('Comments on certain pages')}</option>
          <option value="type">{t('Certain types of comment')}</option>
          <option value="author">{t('Comments by certain authors')}</option>
        </select>
      </label>
      {by === 'pages' && <PagesControl value={range} onChange={setRange} ctx={ctx} presets={PRESETS} />}
      {by === 'type' && (
        <fieldset className="pod-group">
          <legend>{t('Types')}</legend>
          {kindList.map((k) => (
            <label key={k} className="pod-check">
              <input type="checkbox" checked={kinds.includes(k)} onChange={(e) => setKinds(toggle(kinds, k, e.target.checked))} /> {t(annotLabel(k))}
            </label>
          ))}
          {!kindList.length && <span className="pod-hint">{t('There are no comments.')}</span>}
        </fieldset>
      )}
      {by === 'author' &&
        (importing ? (
          <label className="pod-field">
            <span>{t('Author names (separate with ;)')}</span>
            <input aria-label={t('Author names')} value={authorText} onChange={(e) => setAuthorText(e.target.value)} />
          </label>
        ) : (
          <fieldset className="pod-group">
            <legend>{t('Authors')}</legend>
            {known.map((a) => (
              <label key={a} className="pod-check">
                <input type="checkbox" checked={authors.includes(a)} onChange={(e) => setAuthors(toggle(authors, a, e.target.checked))} /> {a || t('(no author)')}
              </label>
            ))}
          </fieldset>
        ))}
      {importing && (
        <fieldset className="pod-group">
          <legend>{t('Existing comments')}</legend>
          <label className="pod-radio">
            <input type="radio" name="import-how" checked={!replace} onChange={() => setReplace(false)} /> {t('Add to the existing comments')}
          </label>
          <label className="pod-radio">
            <input type="radio" name="import-how" checked={replace} onChange={() => setReplace(true)} /> {t('Replace the existing comments')}
          </label>
        </fieldset>
      )}
    </Frame>
  )
}

// ---- Save as ------------------------------------------------------------------------------------------

export interface SaveAsChoice {
  /** Write a copy and keep working on this document. */
  copy: boolean
  /** Reduce the size of what is written. */
  optimise: boolean
}

export function SaveAsDialog({ name, size, onCancel, onSubmit }: { name: string; size: string; onCancel: () => void; onSubmit: (c: SaveAsChoice) => void }) {
  const [copy, setCopy] = useState(false)
  const [optimise, setOptimise] = useState(false)
  return (
    <Frame
      title={t('Save as')}
      ok={t('Save as…')}
      error={null}
      summary={copy ? t('A copy of "{name}" will be written. This document stays open under its current name. You choose where next.', { name }) : t('"{name}" will be written to the file you choose, and this tab will switch to it.', { name })}
      onClose={onCancel}
      onOk={() => onSubmit({ copy, optimise })}
    >
      <label className="pod-check">
        <input type="checkbox" checked={copy} onChange={(e) => setCopy(e.target.checked)} /> {t('Save a copy and keep working on this document')}
      </label>
      <label className="pod-check">
        <input type="checkbox" checked={optimise} onChange={(e) => setOptimise(e.target.checked)} /> {t('Reduce the file size (balanced settings: pictures to 150 dpi, compressed structure)')}
      </label>
      <p className="pod-hint">{t('Current size: {size}. For finer control use Optimise.', { size })}</p>
    </Frame>
  )
}
