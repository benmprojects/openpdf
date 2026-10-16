import { useState, type ReactNode } from 'react'
import { PDFDocument } from 'pdf-lib'
import { Modal } from './AppDialogs'
import { msg, t } from './i18n'
import { getPageClip } from './pageClipboard'
import {
  ALL_PRESETS,
  PAPER_MM,
  blankPageSize,
  compactRanges,
  expandPattern,
  initialRange,
  insertIndex,
  moveTarget,
  pagesWord,
  parseSourceRange,
  patternProblem,
  planSplit,
  resolveRange,
  type DocContext,
  type InsertWhere,
  type MoveDest,
  type PageDialogResult,
  type PaperKind,
  type RangePreset,
  type RangeValue,
  type SourceItem,
  type SplitMode
} from './pageDialogLogic'

/** Modal dialogs for the Pages tab. Each shows a live summary, says why OK is unavailable, and hands a result to `onSubmit`. */

export interface DialogProps {
  ctx: DocContext
  /** The document's name without ".pdf". */
  name: string
  onCancel: () => void
  onSubmit: (r: PageDialogResult) => void
}

const PRESET_LABEL: Record<RangePreset, string> = {
  all: msg('All pages'),
  current: msg('Current page'),
  selected: msg('Selected pages'),
  odd: msg('Odd pages'),
  even: msg('Even pages'),
  landscape: msg('Landscape pages only'),
  portrait: msg('Portrait pages only'),
  custom: msg('Custom')
}

export function Frame({ title, ok, error, summary, warning, onClose, onOk, children, wide }: { title: string; ok: string; error: string | null; summary: string; warning?: string | null; onClose: () => void; onOk: () => void; children: ReactNode; wide?: boolean }) {
  return (
    <Modal title={title} onClose={onClose} wide={wide}>
      <form
        className="pod"
        onSubmit={(e) => {
          e.preventDefault()
          if (!error) onOk()
        }}
      >
        {children}
        {warning && <p className="pod-warn">{warning}</p>}
        {error ? (
          <p className="pod-error" role="alert">
            {error}
          </p>
        ) : (
          <p className="pod-summary" aria-live="polite">
            {summary}
          </p>
        )}
        <div className="pod-actions">
          <button type="submit" className="primary" disabled={!!error}>
            {ok}
          </button>
          <button type="button" onClick={onClose}>
            {t('Cancel')}
          </button>
        </div>
      </form>
    </Modal>
  )
}

/** The shared "Pages" control: a preset list, plus a text box for a custom range. */
export function PagesControl({ label = msg('Pages'), value, onChange, ctx, presets = ALL_PRESETS }: { label?: string; value: RangeValue; onChange: (v: RangeValue) => void; ctx: DocContext; presets?: RangePreset[] }) {
  const r = resolveRange(value, ctx)
  return (
    <div className="pod-field">
      <label>
        <span>{t(label)}</span>
        <select aria-label={t(label)} value={value.preset} onChange={(e) => onChange({ ...value, preset: e.target.value as RangePreset })}>
          {presets.map((p) => (
            <option key={p} value={p} disabled={p !== 'custom' && p !== value.preset && !!resolveRange({ preset: p, custom: '' }, ctx).error}>
              {t(PRESET_LABEL[p])}
            </option>
          ))}
        </select>
      </label>
      {value.preset === 'custom' ? (
        <input aria-label={t('Custom pages')} placeholder="1-3, 5" value={value.custom} onChange={(e) => onChange({ ...value, custom: e.target.value })} />
      ) : (
        <span className="pod-hint">{r.pages.length ? `${pagesWord(r.pages.length)}: ${compactRanges(r.pages)}` : ''}</span>
      )}
    </div>
  )
}

function FolderField({ dir, onChange }: { dir: string | null; onChange: (d: string | null) => void }) {
  return (
    <div className="pod-field">
      <span>{t('Folder')}</span>
      <button
        type="button"
        onClick={async () => {
          const d = await window.openpdf.pickFolder()
          if (d) onChange(d)
        }}
      >
        {t('Choose folder…')}
      </button>
      <span className="pod-hint" title={dir ?? undefined}>
        {dir ?? t('Asked for when you click OK')}
      </span>
    </div>
  )
}

// ---- Source files -------------------------------------------------------------------------------------

export interface SourceFile {
  id: number
  name: string
  data: Uint8Array
  count: number
  /** Text of the source pages to take; empty means all. */
  range: string
  error: string | null
}

let nextFileId = 1

async function readSource(f: { name: string; data: Uint8Array }): Promise<SourceFile> {
  try {
    const doc = await PDFDocument.load(f.data, { updateMetadata: false })
    return { id: nextFileId++, name: f.name, data: f.data, count: doc.getPageCount(), range: '', error: null }
  } catch {
    return { id: nextFileId++, name: f.name, data: f.data, count: 0, range: '', error: t('could not be read (it may be damaged or need a password)') }
  }
}

/** Why a file list cannot be used, the pages it would bring, and its items. */
function sourceTotals(files: SourceFile[]): { total: number; error: string | null; items: SourceItem[] } {
  let total = 0
  const items: SourceItem[] = []
  for (const f of files) {
    if (f.error) return { total: 0, error: `${f.name}: ${f.error}`, items: [] }
    const r = parseSourceRange(f.range, f.count)
    if (r.error) return { total: 0, error: `${f.name}: ${r.error}`, items: [] }
    total += r.pages ? r.pages.length : f.count
    items.push({ data: f.data, pages: r.pages })
  }
  return { total, error: null, items }
}

function FileList({ files, onChange }: { files: SourceFile[]; onChange: (f: SourceFile[]) => void }) {
  const add = async () => {
    const picked = await window.openpdf.pickFiles({ name: 'PDF documents', ext: ['pdf'] })
    if (!picked.length) return
    onChange([...files, ...(await Promise.all(picked.map(readSource)))])
  }
  const move = (i: number, d: -1 | 1) => {
    const next = [...files]
    ;[next[i], next[i + d]] = [next[i + d], next[i]]
    onChange(next)
  }
  return (
    <div className="pod-filelist">
      {files.length > 0 && (
        <ul className="pod-files" aria-label={t('Files')}>
          {files.map((f, i) => (
            <li key={f.id}>
              <span className="pod-file-name" title={f.name}>
                {f.name}
              </span>
              <span className="pod-hint">{f.error ? t('unreadable') : pagesWord(f.count)}</span>
              <input
                aria-label={t('Pages to take from {name}', { name: f.name })}
                placeholder={t('All pages')}
                value={f.range}
                disabled={!!f.error}
                onChange={(e) => onChange(files.map((x) => (x.id === f.id ? { ...x, range: e.target.value } : x)))}
              />
              <button type="button" aria-label={t('Move {name} up', { name: f.name })} disabled={i === 0} onClick={() => move(i, -1)}>
                ↑
              </button>
              <button type="button" aria-label={t('Move {name} down', { name: f.name })} disabled={i === files.length - 1} onClick={() => move(i, 1)}>
                ↓
              </button>
              <button type="button" aria-label={t('Remove {name}', { name: f.name })} onClick={() => onChange(files.filter((x) => x.id !== f.id))}>
                {t('Remove')}
              </button>
            </li>
          ))}
        </ul>
      )}
      <button type="button" onClick={() => void add()}>
        {t('Add files…')}
      </button>
    </div>
  )
}

const num = (s: string) => (s.trim() === '' ? Number.NaN : Number(s))

// ---- Insert -------------------------------------------------------------------------------------------

export function InsertDialog({ ctx, onCancel, onSubmit, initialPage }: DialogProps & { initialPage: number }) {
  const clip = getPageClip()
  const [source, setSource] = useState<'file' | 'blank' | 'clipboard'>('file')
  const [files, setFiles] = useState<SourceFile[]>([])
  const [blankCount, setBlankCount] = useState('1')
  const [paper, setPaper] = useState<PaperKind>('same')
  const [orient, setOrient] = useState<'portrait' | 'landscape'>('portrait')
  const [custom, setCustom] = useState({ w: '210', h: '297' })
  const [where, setWhere] = useState<InsertWhere>({ side: 'after', target: 'page', page: Math.min(Math.max(1, initialPage), ctx.count) })

  const loc = insertIndex(where, ctx.count)
  const cur = ctx.sizes[Math.min(ctx.current, ctx.sizes.length - 1)]
  const size = blankPageSize(paper, orient, cur, { w: num(custom.w), h: num(custom.h) })
  const bn = Number(blankCount)
  let n = 0
  let error: string | null
  let items: SourceItem[] = []
  if (source === 'file') {
    const s = sourceTotals(files)
    n = s.total
    items = s.items
    error = !files.length ? t('Add at least one PDF file.') : s.error
    if (!error && n < 1) error = t('The chosen files have no pages to insert.')
  } else if (source === 'blank') {
    n = Number.isInteger(bn) ? bn : 0
    error = !Number.isInteger(bn) || bn < 1 || bn > 500 ? t('Enter a number of blank pages from 1 to 500.') : size.error
  } else {
    n = clip?.count ?? 0
    error = clip ? null : t('No pages have been copied yet.')
  }
  error = error ?? loc.error

  return (
    <Frame
      title={t('Insert pages')}
      ok={t('Insert')}
      error={error}
      summary={t('{pages} will be inserted {where}. The document will have {total}.', { pages: pagesWord(n), where: loc.text, total: pagesWord(ctx.count + n) })}
      onClose={onCancel}
      onOk={() =>
        onSubmit({
          kind: 'insert',
          at: loc.index,
          count: n,
          items: source === 'file' ? items : source === 'clipboard' && clip ? [{ data: clip.bytes, pages: null }] : [],
          blank: source === 'blank' ? { count: bn, width: size.width, height: size.height } : null
        })
      }
      wide
    >
      <fieldset className="pod-group">
        <legend>{t('Source')}</legend>
        <label className="pod-radio">
          <input type="radio" name="insert-source" checked={source === 'file'} onChange={() => setSource('file')} /> {t('From a PDF file')}
        </label>
        <label className="pod-radio">
          <input type="radio" name="insert-source" checked={source === 'blank'} onChange={() => setSource('blank')} /> {t('Blank pages')}
        </label>
        <label className="pod-radio">
          <input type="radio" name="insert-source" checked={source === 'clipboard'} disabled={!clip} onChange={() => setSource('clipboard')} />{' '}
          {clip ? t('From the page clipboard ({pages} from {from})', { pages: pagesWord(clip.count), from: clip.from }) : t('From the page clipboard (no pages copied)')}
        </label>
      </fieldset>
      {source === 'file' && <FileList files={files} onChange={setFiles} />}
      {source === 'blank' && (
        <div className="pod-grid">
          <label>
            <span>{t('Number of pages')}</span>
            <input aria-label={t('Number of blank pages')} inputMode="numeric" value={blankCount} onChange={(e) => setBlankCount(e.target.value)} />
          </label>
          <label>
            <span>{t('Page size')}</span>
            <select aria-label={t('Page size')} value={paper} onChange={(e) => setPaper(e.target.value as PaperKind)}>
              <option value="same">{t('Same as the current page')}</option>
              <option value="a4">A4</option>
              <option value="a3">A3</option>
              <option value="letter">Letter</option>
              <option value="legal">Legal</option>
              <option value="custom">{t('Custom (mm)')}</option>
            </select>
          </label>
          {paper === 'custom' && (
            <div className="pod-field">
              <input aria-label={t('Width (mm)')} inputMode="decimal" value={custom.w} onChange={(e) => setCustom({ ...custom, w: e.target.value })} />
              <span>×</span>
              <input aria-label={t('Height (mm)')} inputMode="decimal" value={custom.h} onChange={(e) => setCustom({ ...custom, h: e.target.value })} />
              <span className="pod-hint">mm</span>
            </div>
          )}
          {paper !== 'same' && (
            <label>
              <span>{t('Orientation')}</span>
              <select aria-label={t('Orientation')} value={orient} onChange={(e) => setOrient(e.target.value as 'portrait' | 'landscape')}>
                <option value="portrait">{t('Portrait')}</option>
                <option value="landscape">{t('Landscape')}</option>
              </select>
            </label>
          )}
          {paper !== 'same' && paper !== 'custom' && (
            <span className="pod-hint">
              {PAPER_MM[paper].w} × {PAPER_MM[paper].h} mm
            </span>
          )}
        </div>
      )}
      <fieldset className="pod-group">
        <legend>{t('Location')}</legend>
        <div className="pod-field">
          <select aria-label={t('Before or after')} value={where.side} onChange={(e) => setWhere({ ...where, side: e.target.value as 'before' | 'after' })}>
            <option value="before">{t('Before')}</option>
            <option value="after">{t('After')}</option>
          </select>
          <select aria-label={t('Page to insert next to')} value={where.target} onChange={(e) => setWhere({ ...where, target: e.target.value as InsertWhere['target'] })}>
            <option value="first">{t('First page')}</option>
            <option value="last">{t('Last page')}</option>
            <option value="page">{t('Page number')}</option>
          </select>
          {where.target === 'page' && (
            <input aria-label={t('Page number')} inputMode="numeric" value={Number.isNaN(where.page) ? '' : String(where.page)} onChange={(e) => setWhere({ ...where, page: num(e.target.value) })} />
          )}
          <span className="pod-hint">{t('of {count}', { count: ctx.count })}</span>
        </div>
      </fieldset>
    </Frame>
  )
}

// ---- Extract ------------------------------------------------------------------------------------------

export function ExtractDialog({ ctx, name, onCancel, onSubmit }: DialogProps) {
  const [range, setRange] = useState<RangeValue>(() => initialRange(ctx))
  const [deleteAfter, setDeleteAfter] = useState(false)
  const [each, setEach] = useState(false)
  const [openAfter, setOpenAfter] = useState(false)
  const [pattern, setPattern] = useState('{name} (page {first})')
  const [dir, setDir] = useState<string | null>(null)
  const r = resolveRange(range, ctx)
  let error = r.error
  if (!error && deleteAfter && r.pages.length >= ctx.count) error = t('Removing every page is not allowed: a document must keep at least one page.')
  if (!error && each) error = patternProblem(pattern, r.pages.length)
  const example = r.pages.length ? expandPattern(pattern, { name, first: r.pages[0] + 1, last: r.pages[0] + 1, n: 1, total: r.pages.length }) : ''
  let summary = each ? t('{files} will be created, for example "{example}".', { files: `${r.pages.length} file${r.pages.length === 1 ? '' : 's'}`, example }) : t('{pages} will be extracted to a new file.', { pages: pagesWord(r.pages.length) })
  if (deleteAfter) summary += ' ' + t('They will then be removed from this document, which will have {total}.', { total: pagesWord(ctx.count - r.pages.length) })
  return (
    <Frame title={t('Extract pages')} ok={t('Extract…')} error={error} summary={summary} onClose={onCancel} onOk={() => onSubmit({ kind: 'extract', pages: r.pages, deleteAfter, openAfter: openAfter && !each, each: each ? { pattern, dir } : null })}>
      <PagesControl value={range} onChange={setRange} ctx={ctx} />
      <label className="pod-check">
        <input type="checkbox" checked={deleteAfter} onChange={(e) => setDeleteAfter(e.target.checked)} /> {t('Delete the pages from this document afterwards')}
      </label>
      <label className="pod-check">
        <input type="checkbox" checked={each} onChange={(e) => setEach(e.target.checked)} /> {t('Extract each page to its own file')}
      </label>
      {each && (
        <>
          <label className="pod-field">
            <span>{t('File name pattern')}</span>
            <input aria-label={t('File name pattern')} value={pattern} onChange={(e) => setPattern(e.target.value)} />
          </label>
          <p className="pod-hint">{t('Use {name}, {first} (the page number), {n} (1, 2, 3 …) and {title}.')}</p>
          <FolderField dir={dir} onChange={setDir} />
        </>
      )}
      <label className="pod-check">
        <input type="checkbox" checked={openAfter && !each} disabled={each} onChange={(e) => setOpenAfter(e.target.checked)} /> {t('Open the extracted file afterwards')}
      </label>
    </Frame>
  )
}

// ---- Delete -------------------------------------------------------------------------------------------

export function DeleteDialog({ ctx, onCancel, onSubmit }: DialogProps) {
  const [range, setRange] = useState<RangeValue>(() => initialRange(ctx))
  const r = resolveRange(range, ctx)
  const error = r.error ?? (r.pages.length >= ctx.count ? t('Every page is chosen. A document must keep at least one page.') : null)
  return (
    <Frame
      title={t('Delete pages')}
      ok={t('Delete')}
      error={error}
      summary={t('{pages} will be deleted. The document will have {total}. You can undo this.', { pages: pagesWord(r.pages.length), total: pagesWord(ctx.count - r.pages.length) })}
      onClose={onCancel}
      onOk={() => onSubmit({ kind: 'delete', pages: r.pages })}
    >
      <PagesControl value={range} onChange={setRange} ctx={ctx} />
    </Frame>
  )
}

// ---- Rotate -------------------------------------------------------------------------------------------

export function RotateDialog({ ctx, onCancel, onSubmit }: DialogProps) {
  const [range, setRange] = useState<RangeValue>(() => initialRange(ctx))
  const [dir, setDir] = useState<'90' | '-90' | '180'>('90')
  const r = resolveRange(range, ctx)
  const label = dir === '90' ? t('90° clockwise') : dir === '-90' ? t('90° anticlockwise') : t('180°')
  return (
    <Frame
      title={t('Rotate pages')}
      ok={t('Rotate')}
      error={r.error}
      summary={t('{pages} will be rotated {how}.', { pages: pagesWord(r.pages.length), how: label })}
      onClose={onCancel}
      onOk={() => onSubmit({ kind: 'rotate', pages: r.pages, delta: Number(dir) as 90 | -90 | 180 })}
    >
      <label className="pod-field">
        <span>{t('Direction')}</span>
        <select aria-label={t('Direction')} value={dir} onChange={(e) => setDir(e.target.value as '90' | '-90' | '180')}>
          <option value="90">{t('90° clockwise')}</option>
          <option value="-90">{t('90° anticlockwise')}</option>
          <option value="180">{t('180°')}</option>
        </select>
      </label>
      <PagesControl value={range} onChange={setRange} ctx={ctx} />
    </Frame>
  )
}

// ---- Replace ------------------------------------------------------------------------------------------

export function ReplaceDialog({ ctx, onCancel, onSubmit }: DialogProps) {
  const [range, setRange] = useState<RangeValue>(() => initialRange(ctx))
  const [file, setFile] = useState<SourceFile | null>(null)
  const r = resolveRange(range, ctx)
  const choose = async () => {
    const f = await window.openpdf.pickFile({ name: 'PDF documents', ext: ['pdf'] })
    if (!f) return
    const s = await readSource(f)
    const take = Math.min(s.count, resolveRange(range, ctx).pages.length || 1)
    setFile({ ...s, range: s.count ? (take === s.count ? '' : `1-${take}`) : '' })
  }
  const theirs = file ? parseSourceRange(file.range, file.count) : { pages: null, error: null }
  const theirCount = file ? (theirs.pages ? theirs.pages.length : file.count) : 0
  const error = r.error ?? (!file ? t('Choose the PDF that the replacement pages come from.') : (file.error ? `${file.name}: ${file.error}` : null) ?? (theirs.error ? `${file.name}: ${theirs.error}` : null) ?? (theirCount < 1 ? t('There are no replacement pages.') : null))
  const total = ctx.count - r.pages.length + theirCount
  return (
    <Frame
      title={t('Replace pages')}
      ok={t('Replace')}
      error={error}
      summary={t('{mine} will be replaced with {theirs} from {file}. The document will have {total}.', { mine: pagesWord(r.pages.length), theirs: pagesWord(theirCount), file: file?.name ?? '', total: pagesWord(total) })}
      warning={file && !error && theirCount !== r.pages.length ? t('The counts differ ({mine} replaced, {theirs} put in). The replaced pages are removed and all the replacement pages go where the first one was.', { mine: r.pages.length, theirs: theirCount }) : null}
      onClose={onCancel}
      onOk={() => file && onSubmit({ kind: 'replace', pages: r.pages, other: { name: file.name, data: file.data }, theirs: theirs.pages ?? Array.from({ length: file.count }, (_, i) => i) })}
      wide
    >
      <PagesControl label={msg('Pages to replace')} value={range} onChange={setRange} ctx={ctx} />
      <div className="pod-field">
        <span>{t('Replace with')}</span>
        <button type="button" onClick={() => void choose()}>
          {t('Choose PDF…')}
        </button>
        <span className="pod-hint">{file ? `${file.name} (${pagesWord(file.count)})` : ''}</span>
      </div>
      {file && !file.error && (
        <label className="pod-field">
          <span>{t('Pages of the other PDF')}</span>
          <input aria-label={t('Replacement pages')} placeholder={t('All pages')} value={file.range} onChange={(e) => setFile({ ...file, range: e.target.value })} />
          <span className="pod-hint">{t('1-{count}', { count: file.count })}</span>
        </label>
      )}
    </Frame>
  )
}

// ---- Split --------------------------------------------------------------------------------------------

export function SplitDialog({ ctx, name, onCancel, onSubmit, bookmarks }: DialogProps & { bookmarks: { title: string; page: number }[] }) {
  const [mode, setMode] = useState<SplitMode>('count')
  const [value, setValue] = useState('1')
  const [pattern, setPattern] = useState('{name} - {label}')
  const [dir, setDir] = useState<string | null>(null)
  const plan = planSplit(mode, value, ctx.count, bookmarks)
  const files = plan.ranges ? plan.ranges.length : null
  const error = plan.error ?? patternProblem(pattern, files ?? 2)
  const first = plan.ranges?.[0]
  const example = expandPattern(pattern, { name, first: first?.first ?? 1, last: first?.last ?? 1, n: 1, total: files ?? 2, title: first?.title })
  const summary = files !== null ? t('This will create {files}, for example "{example}".', { files: `${files} file${files === 1 ? '' : 's'}`, example }) : t('The number of files depends on the content; none will be larger than {mb} MB.', { mb: value })
  const modes: [SplitMode, string, boolean][] = [
    ['count', msg('Every N pages'), true],
    ['at', msg('At chosen page numbers'), true],
    ['bookmarks', msg('At each top-level bookmark'), bookmarks.length > 0],
    ['size', msg('By file size'), true]
  ]
  return (
    <Frame title={t('Split document')} ok={t('Split…')} error={error} summary={summary} onClose={onCancel} onOk={() => onSubmit({ kind: 'split', mode, value, ranges: plan.ranges, pattern, dir })} wide>
      <label className="pod-field">
        <span>{t('Split')}</span>
        <select
          aria-label={t('Split by')}
          value={mode}
          onChange={(e) => {
            const m = e.target.value as SplitMode
            setMode(m)
            setValue(m === 'size' ? '5' : m === 'at' ? '' : '1')
          }}
        >
          {modes.map(([m, label, ok]) => (
            <option key={m} value={m} disabled={!ok}>
              {t(label)}
            </option>
          ))}
        </select>
      </label>
      {mode !== 'bookmarks' && (
        <label className="pod-field">
          <span>{mode === 'count' ? t('Pages per file') : mode === 'size' ? t('Largest file size (MB)') : t('New file starts at pages (for example 4, 7)')}</span>
          <input aria-label={mode === 'count' ? t('Pages per file') : mode === 'size' ? t('Largest file size (MB)') : t('Start pages')} value={value} onChange={(e) => setValue(e.target.value)} />
        </label>
      )}
      <label className="pod-field">
        <span>{t('File name pattern')}</span>
        <input aria-label={t('File name pattern')} value={pattern} onChange={(e) => setPattern(e.target.value)} />
      </label>
      <p className="pod-hint">{t('Use {name}, {first}, {last}, {n} and {label} (the bookmark title, or the page range).')}</p>
      <FolderField dir={dir} onChange={setDir} />
    </Frame>
  )
}

// ---- Merge --------------------------------------------------------------------------------------------

export function MergeDialog({ ctx, onCancel, onSubmit }: DialogProps) {
  const [files, setFiles] = useState<SourceFile[]>([])
  const [includeThis, setIncludeThis] = useState(true)
  const [pos, setPos] = useState<'end' | 'start' | 'after'>('end')
  const [afterPage, setAfterPage] = useState(String(ctx.count))
  const s = sourceTotals(files)
  const ap = Number(afterPage)
  let error: string | null = !files.length ? t('Add at least one PDF file to merge.') : s.error
  if (!error && s.total < 1) error = t('The chosen files have no pages.')
  if (!error && includeThis && pos === 'after' && (!Number.isInteger(ap) || ap < 1 || ap > ctx.count)) error = t('Enter a page number from 1 to {count}.', { count: ctx.count })
  const at = pos === 'start' ? 0 : pos === 'after' ? ap : ctx.count
  const where = pos === 'start' ? t('at the start') : pos === 'after' ? t('after page {page}', { page: ap }) : t('at the end')
  const summary = includeThis
    ? t('{pages} from {files} will be added {where}. The document will have {total}.', { pages: pagesWord(s.total), files: `${files.length} file${files.length === 1 ? '' : 's'}`, where, total: pagesWord(ctx.count + s.total) })
    : t('{files} ({pages}) will be merged into a new document, which opens in a new tab.', { files: `${files.length} file${files.length === 1 ? '' : 's'}`, pages: pagesWord(s.total) })
  return (
    <Frame title={t('Merge documents')} ok={t('Merge')} error={error} summary={summary} onClose={onCancel} onOk={() => onSubmit({ kind: 'merge', items: s.items, includeThis, at, count: s.total })} wide>
      <FileList files={files} onChange={setFiles} />
      <label className="pod-check">
        <input type="checkbox" checked={includeThis} onChange={(e) => setIncludeThis(e.target.checked)} /> {t('Start with this document')}
      </label>
      {includeThis && (
        <div className="pod-field">
          <span>{t('Put the files')}</span>
          <select aria-label={t('Where to put the files')} value={pos} onChange={(e) => setPos(e.target.value as 'end' | 'start' | 'after')}>
            <option value="end">{t('At the end')}</option>
            <option value="start">{t('At the start')}</option>
            <option value="after">{t('After page number')}</option>
          </select>
          {pos === 'after' && <input aria-label={t('After page')} inputMode="numeric" value={afterPage} onChange={(e) => setAfterPage(e.target.value)} />}
        </div>
      )}
    </Frame>
  )
}

// ---- Duplicate ----------------------------------------------------------------------------------------

export function DuplicateDialog({ ctx, onCancel, onSubmit }: DialogProps) {
  const [range, setRange] = useState<RangeValue>(() => initialRange(ctx))
  const [copies, setCopies] = useState('1')
  const [where, setWhere] = useState<'block' | 'each' | 'end'>('block')
  const r = resolveRange(range, ctx)
  const c = Number(copies)
  const added = r.pages.length * (Number.isInteger(c) ? c : 0)
  const error = r.error ?? (!Number.isInteger(c) || c < 1 || c > 99 ? t('Enter a number of copies from 1 to 99.') : ctx.count + added > 5000 ? t('That would make the document longer than 5000 pages.') : null)
  return (
    <Frame
      title={t('Duplicate pages')}
      ok={t('Duplicate')}
      error={error}
      summary={t('{pages} will be added. The document will have {total}.', { pages: pagesWord(added), total: pagesWord(ctx.count + added) })}
      onClose={onCancel}
      onOk={() => onSubmit({ kind: 'duplicate', pages: r.pages, copies: c, where })}
    >
      <PagesControl value={range} onChange={setRange} ctx={ctx} />
      <label className="pod-field">
        <span>{t('Copies of each page')}</span>
        <input aria-label={t('Number of copies')} inputMode="numeric" value={copies} onChange={(e) => setCopies(e.target.value)} />
      </label>
      <label className="pod-field">
        <span>{t('Place the copies')}</span>
        <select aria-label={t('Place the copies')} value={where} onChange={(e) => setWhere(e.target.value as 'block' | 'each' | 'end')}>
          <option value="each">{t('After each page')}</option>
          <option value="block">{t('After the last of these pages')}</option>
          <option value="end">{t('At the end of the document')}</option>
        </select>
      </label>
    </Frame>
  )
}

// ---- Move ---------------------------------------------------------------------------------------------

export function MoveDialog({ ctx, onCancel, onSubmit }: DialogProps) {
  const [range, setRange] = useState<RangeValue>(() => initialRange(ctx))
  const [kind, setKind] = useState<'before' | 'after' | 'start' | 'end'>('after')
  const [page, setPage] = useState(String(ctx.count))
  const r = resolveRange(range, ctx)
  const dest: MoveDest = kind === 'start' || kind === 'end' ? { kind } : { kind, page: num(page) }
  const target = moveTarget(dest, r.pages, ctx.count)
  const where = kind === 'start' ? t('to the start') : kind === 'end' ? t('to the end') : kind === 'before' ? t('to before page {page}', { page }) : t('to after page {page}', { page })
  return (
    <Frame
      title={t('Move pages')}
      ok={t('Move')}
      error={r.error ?? target.error}
      summary={t('{pages} will be moved {where}.', { pages: pagesWord(r.pages.length), where })}
      onClose={onCancel}
      onOk={() => onSubmit({ kind: 'move', pages: r.pages, before: target.before })}
    >
      <PagesControl value={range} onChange={setRange} ctx={ctx} />
      <div className="pod-field">
        <span>{t('Move to')}</span>
        <select aria-label={t('Destination')} value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
          <option value="before">{t('Before page')}</option>
          <option value="after">{t('After page')}</option>
          <option value="start">{t('The start')}</option>
          <option value="end">{t('The end')}</option>
        </select>
        {(kind === 'before' || kind === 'after') && <input aria-label={t('Destination page')} inputMode="numeric" value={page} onChange={(e) => setPage(e.target.value)} />}
      </div>
    </Frame>
  )
}
