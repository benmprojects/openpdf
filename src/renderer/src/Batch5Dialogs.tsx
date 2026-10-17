import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Modal } from './AppDialogs'
import { pictures8ToBilevel } from './bilevel'
import { convertColours, describeColourReport, type ColourMode } from './colourConvert'
import { findReplaceText } from './contentFind'
import { enhanceRgba } from './enhance'
import { encodePage } from './exportDoc'
import { listDocumentFonts, replaceFonts, suggestTarget, type DocFont, type FontRule, type FontTarget } from './fontReplace'
import { msg, t } from './i18n'
import { addLayer, deleteLayer, flattenLayers, mergeLayers, renameLayer } from './layersEdit'
import { readLayers, withHiddenLayers, type Layer } from './layers'
import { Frame, PagesControl } from './PageOpsDialogs'
import { initialRange, pagesWord, resolveRange, type DocContext, type RangeValue } from './pageDialogLogic'
import { PdfClient } from './pdfClient'
import { convertToPdfA, type PdfAPart, type PdfAReport } from './pdfa'
import { checkPdfX, convertToPdfX, DEFAULT_CONDITION, type PdfXCheck, type PdfXVariant } from './pdfx'
import { recompressPictures } from './optimise'
import { rasterisePages } from './rasterise'

/** What the dialogs of the Convert, Organise and Edit tabs need from the document view. */
export interface B5Env {
  bytes: Uint8Array
  pages: { width: number; height: number }[]
  currentPage: number
  selected: number[]
  /** Runs a change as one undoable page edit; `fn` returns the new file, or null for no change. */
  applyPageEdit: (fn: (base: Uint8Array) => Promise<Uint8Array | null>, done?: string) => Promise<void>
  notify: (n: { kind: 'info' | 'error'; text: string }) => void
  findFont: (family: string, bold: boolean, italic: boolean) => Promise<Uint8Array | null>
  /** Layers the view has switched off (null when it has not been changed). */
  hiddenLayers: ReadonlySet<string> | null
}

export type B5Kind = 'colours' | 'rasterise' | 'enhance' | 'fonts' | 'recompress' | 'convert' | 'layers'

const ctxOf = (env: B5Env): DocContext => ({ count: env.pages.length, current: Math.min(env.currentPage, Math.max(0, env.pages.length - 1)), selected: env.selected, sizes: env.pages })

const formatSize = (n: number) => (n < 1024 ? `${n} bytes` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 / 1024).toFixed(2)} MB`)

/** A dialog that reports what happened, with a Close button. */
function ResultView({ title, lines, warnings, onClose }: { title: string; lines: string[]; warnings?: string[]; onClose: () => void }) {
  return (
    <Modal title={title} onClose={onClose}>
      <div className="marks-form">
        <ul className="std-list">
          {lines.map((l) => (
            <li key={l} className="std-pass">
              <span aria-hidden>✔</span> {l}
            </li>
          ))}
          {(warnings ?? []).map((l) => (
            <li key={l} className="std-warn">
              <span aria-hidden>⚠</span> {l}
            </li>
          ))}
        </ul>
        <div className="marks-actions">
          <span style={{ flex: 1 }} />
          <button className="primary" type="button" onClick={onClose}>
            {t('Close')}
          </button>
        </div>
      </div>
    </Modal>
  )
}

// ---- Convert colours -------------------------------------------------------------------------------

function ColoursDialog({ env, onClose }: { env: B5Env; onClose: () => void }) {
  const [mode, setMode] = useState<ColourMode>('gray')
  const [result, setResult] = useState<string[] | null>(null)
  if (result) return <ResultView title={t('Convert colours')} lines={result} onClose={onClose} />
  return (
    <Frame
      title={t('Convert colours')}
      ok={t('Convert')}
      error={null}
      summary={t('The whole document is converted. You can undo this until you save.')}
      warning={t('This is an approximate conversion of device colours (no colour profiles). Spot colours, shadings and some pictures are left as they are, and the result will not match a press or a colour-managed viewer exactly.')}
      onClose={onClose}
      onOk={() => {
        const box: { lines: string[] } = { lines: [] }
        void env
          .applyPageEdit(async (b) => {
            const r = await convertColours(b, mode)
            box.lines = describeColourReport(r.report)
            return r.report.operators + r.report.pictures ? r.bytes : null
          })
          .then(() => setResult(box.lines.length ? box.lines : [t('Nothing needed converting.')]))
      }}
    >
      <label className="pod-field">
        <span>{t('Convert to')}</span>
        <select aria-label={t('Convert to')} value={mode} onChange={(e) => setMode(e.target.value as ColourMode)}>
          <option value="gray">{t('Greyscale')}</option>
          <option value="cmyk">{t('CMYK (approximate)')}</option>
          <option value="rgb">{t('RGB (approximate)')}</option>
        </select>
      </label>
    </Frame>
  )
}

// ---- Rasterise and enhance -------------------------------------------------------------------------

const DPIS = [96, 150, 200, 300, 400, 600]

type RasterFormat = 'jpeg' | 'flate' | 'g4'

function RasteriseDialog({ env, enhance, onClose }: { env: B5Env; enhance: boolean; onClose: () => void }) {
  const ctx = ctxOf(env)
  const [range, setRange] = useState<RangeValue>(() => ({ ...initialRange(ctx), preset: 'all' }))
  const [dpi, setDpi] = useState(enhance ? 300 : 150)
  const [format, setFormat] = useState<RasterFormat>(enhance ? 'g4' : 'jpeg')
  const [quality, setQuality] = useState(0.8)
  const [deskew, setDeskew] = useState(true)
  const [despeckle, setDespeckle] = useState(true)
  const [crop, setCrop] = useState(false)
  const [result, setResult] = useState<string[] | null>(null)
  const r = resolveRange(range, ctx)
  const title = enhance ? t('Enhance scanned pages') : t('Rasterise pages')
  if (result) return <ResultView title={title} lines={result} warnings={[t('The text on these pages can no longer be searched or copied. Use Recognise text (OCR) to add it back.')]} onClose={onClose} />
  const error = r.error ?? (enhance && !deskew && !despeckle && !crop ? t('Choose at least one clean-up step.') : null)
  return (
    <Frame
      title={title}
      ok={enhance ? t('Enhance') : t('Rasterise')}
      error={error}
      summary={t('{pages} will become pictures at {dpi} dpi. You can undo this until you save.', { pages: pagesWord(r.pages.length), dpi: String(dpi) })}
      warning={
        enhance
          ? t('Each chosen page is drawn, cleaned up and put back as one picture. Text, comments and form fields on those pages become part of the picture.')
          : t('Each chosen page is drawn and put back as one picture. Text, vector drawing, comments and form fields on those pages become part of the picture and cannot be searched, selected or edited afterwards.')
      }
      onClose={onClose}
      onOk={() => {
        const box: { lines: string[] } = { lines: [] }
        void env
          .applyPageEdit(async (b) => {
            const c = new PdfClient()
            try {
              const sizes = await c.load(b)
              const out = await rasterisePages(
                b,
                { dpi, pages: r.pages, format, quality },
                {
                  pages: sizes,
                  render: (p, scale) => c.render(p, scale),
                  encodeJpeg: (rgba, w, h, q) => encodePage(rgba, w, h, 'jpg', q),
                  enhance: enhance ? async (rgba, w, h, d) => enhanceRgba(rgba, w, h, d, { deskew, despeckle, autoCrop: crop }) : undefined,
                  progress: (done, total) => env.notify({ kind: 'info', text: t('Page {n} of {total}…', { n: String(Math.min(done + 1, total)), total: String(total) }) })
                }
              )
              box.lines = [
                t('{pages} turned into pictures ({before} to {after}).', { pages: pagesWord(out.pages), before: formatSize(b.length), after: formatSize(out.bytes.length) }),
                ...(out.annotationsFlattened ? [t('{n} comments, links or form fields on those pages are now part of the picture.', { n: String(out.annotationsFlattened) })] : [])
              ]
              return out.bytes
            } finally {
              c.dispose()
            }
          })
          .then(() => setResult(box.lines.length ? box.lines : null))
      }}
    >
      <PagesControl value={range} onChange={setRange} ctx={ctx} />
      <label className="pod-field">
        <span>{t('Resolution')}</span>
        <select aria-label={t('Resolution')} value={dpi} onChange={(e) => setDpi(Number(e.target.value))}>
          {DPIS.map((d) => (
            <option key={d} value={d}>
              {d} dpi
            </option>
          ))}
        </select>
      </label>
      <label className="pod-field">
        <span>{t('Store as')}</span>
        <select aria-label={t('Store as')} value={format} onChange={(e) => setFormat(e.target.value as RasterFormat)}>
          <option value="jpeg">{t('Colour, smaller (JPEG)')}</option>
          <option value="flate">{t('Colour, lossless (larger)')}</option>
          <option value="g4">{t('Black and white (CCITT G4, smallest; grey and colour are lost)')}</option>
        </select>
      </label>
      {format === 'jpeg' && (
        <label className="pod-field">
          <span>{t('JPEG quality')}</span>
          <input type="range" aria-label={t('JPEG quality')} min={0.3} max={0.95} step={0.05} value={quality} onChange={(e) => setQuality(Number(e.target.value))} />
          <span className="pod-hint">{Math.round(quality * 100)}%</span>
        </label>
      )}
      {enhance && (
        <fieldset className="pod-group">
          <legend>{t('Clean up')}</legend>
          <label className="pod-check">
            <input type="checkbox" checked={deskew} onChange={(e) => setDeskew(e.target.checked)} /> {t('Straighten crooked pages')}
          </label>
          <label className="pod-check">
            <input type="checkbox" checked={despeckle} onChange={(e) => setDespeckle(e.target.checked)} /> {t('Remove specks')}
          </label>
          <label className="pod-check">
            <input type="checkbox" checked={crop} onChange={(e) => setCrop(e.target.checked)} /> {t('Crop to the content')}
          </label>
        </fieldset>
      )}
    </Frame>
  )
}

// ---- Recompress pictures ---------------------------------------------------------------------------

function RecompressDialog({ env, onClose }: { env: B5Env; onClose: () => void }) {
  const [quality, setQuality] = useState(0.7)
  const [limit, setLimit] = useState(true)
  const [dpi, setDpi] = useState(150)
  const [bw, setBw] = useState(false)
  const [result, setResult] = useState<string[] | null>(null)
  if (result) return <ResultView title={t('Recompress pictures')} lines={result} onClose={onClose} />
  return (
    <Frame
      title={t('Recompress pictures')}
      ok={t('Recompress')}
      error={null}
      summary={t('Current size: {size}. Only pictures are changed. You can undo this until you save.', { size: formatSize(env.bytes.length) })}
      warning={bw ? t('Black and white turns every large grey or colour picture into black and white. Use it only for scans of text and line drawings.') : t('Pictures are re-encoded as JPEG, which loses a little quality each time. A picture is only replaced when the result is smaller.')}
      onClose={onClose}
      onOk={() => {
        const box: { lines: string[] } = { lines: [] }
        void env
          .applyPageEdit(async (b) => {
            if (bw) {
              const r = await pictures8ToBilevel(b)
              box.lines = [t('{n} pictures changed to black and white ({before} to {after}).', { n: String(r.pictures), before: formatSize(r.before), after: formatSize(r.after) })]
              if (r.left) box.lines.push(t('{n} pictures could not be read and were left as they are.', { n: String(r.left) }))
              return r.pictures ? r.bytes : null
            }
            const r = await recompressPictures(b, { quality, maxDpi: limit ? dpi : null })
            box.lines = [t('{n} pictures recompressed: {before} to {after} for the whole file.', { n: String(r.images), before: formatSize(b.length), after: formatSize(r.bytes.length) })]
            return r.images ? r.bytes : null
          })
          .then(() => setResult(box.lines.length ? box.lines : [t('No picture could be made smaller.')]))
      }}
    >
      <label className="pod-check">
        <input type="checkbox" checked={bw} onChange={(e) => setBw(e.target.checked)} /> {t('Black and white scans (CCITT Group 4)')}
      </label>
      {!bw && (
        <>
          <label className="pod-field">
            <span>{t('JPEG quality')}</span>
            <input type="range" aria-label={t('JPEG quality')} min={0.3} max={0.95} step={0.05} value={quality} onChange={(e) => setQuality(Number(e.target.value))} />
            <span className="pod-hint">{Math.round(quality * 100)}%</span>
          </label>
          <label className="pod-check">
            <input type="checkbox" checked={limit} onChange={(e) => setLimit(e.target.checked)} /> {t('Also reduce pictures above')}
            <input type="number" aria-label={t('Resolution limit')} min={36} max={1200} value={dpi} disabled={!limit} onChange={(e) => setDpi(Math.max(36, Number(e.target.value) || 150))} /> dpi
          </label>
        </>
      )}
    </Frame>
  )
}

// ---- Fonts: replace, find and replace --------------------------------------------------------------

const TARGETS: { value: string; label: string; target: (bold: boolean, italic: boolean) => FontTarget | null }[] = [
  { value: 'keep', label: msg('Keep'), target: () => null },
  { value: 'arial', label: msg('Arial (installed)'), target: (bold, italic) => ({ kind: 'installed', family: 'Arial', bold, italic }) },
  { value: 'times', label: msg('Times New Roman (installed)'), target: (bold, italic) => ({ kind: 'installed', family: 'Times New Roman', bold, italic }) },
  { value: 'courier', label: msg('Courier New (installed)'), target: (bold, italic) => ({ kind: 'installed', family: 'Courier New', bold, italic }) },
  { value: 'helvetica', label: msg('Helvetica (standard, not embedded)'), target: (bold, italic) => ({ kind: 'standard', family: 'helvetica', bold, italic }) },
  { value: 'tms', label: msg('Times (standard, not embedded)'), target: (bold, italic) => ({ kind: 'standard', family: 'times', bold, italic }) },
  { value: 'cour', label: msg('Courier (standard, not embedded)'), target: (bold, italic) => ({ kind: 'standard', family: 'courier', bold, italic }) }
]

function FontsDialog({ env, onClose }: { env: B5Env; onClose: () => void }) {
  const [tab, setTab] = useState<'fonts' | 'text'>('fonts')
  const [fonts, setFonts] = useState<DocFont[] | null>(null)
  const [pick, setPick] = useState<Record<string, string>>({})
  const [find, setFind] = useState('')
  const [replace, setReplace] = useState('')
  const [matchCase, setMatchCase] = useState(false)
  const [whole, setWhole] = useState(false)
  const ctx = ctxOf(env)
  const [range, setRange] = useState<RangeValue>(() => ({ ...initialRange(ctx), preset: 'all' }))
  const [result, setResult] = useState<{ lines: string[]; warnings: string[] } | null>(null)

  useEffect(() => {
    let live = true
    void listDocumentFonts(env.bytes).then((f) => live && setFonts(f), () => live && setFonts([]))
    return () => {
      live = false
    }
  }, [env.bytes])

  const rules: FontRule[] = useMemo(() => {
    const out: FontRule[] = []
    for (const f of fonts ?? []) {
      const v = pick[f.name]
      if (!v || v === 'keep') continue
      const s = suggestTarget(f.name)
      const target = TARGETS.find((x) => x.value === v)?.target(s.bold, s.italic)
      if (target) out.push({ from: f.name, to: target })
    }
    return out
  }, [fonts, pick])

  if (result) return <ResultView title={t('Fonts and text')} lines={result.lines} warnings={result.warnings} onClose={onClose} />
  const r = resolveRange(range, ctx)
  const body: ReactNode =
    tab === 'fonts' ? (
      fonts === null ? (
        <p className="muted">{t('Reading the fonts…')}</p>
      ) : !fonts.length ? (
        <p className="muted">{t('This document has no fonts to replace.')}</p>
      ) : (
        <table className="b5-table" aria-label={t('Fonts in this document')}>
          <thead>
            <tr>
              <th>{t('Font')}</th>
              <th>{t('Embedded')}</th>
              <th>{t('Replace with')}</th>
            </tr>
          </thead>
          <tbody>
            {fonts.map((f) => (
              <tr key={f.name}>
                <td>{f.name}</td>
                <td>{f.embedded ? t('Yes') : t('No')}</td>
                <td>
                  {f.replaceable ? (
                    <select aria-label={t('Replace {name} with', { name: f.name })} value={pick[f.name] ?? 'keep'} onChange={(e) => setPick({ ...pick, [f.name]: e.target.value })}>
                      {TARGETS.map((x) => (
                        <option key={x.value} value={x.value}>
                          {t(x.label)}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span className="muted" title={f.reason}>
                      {f.reason}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )
    ) : (
      <>
        <label className="pod-field">
          <span>{t('Find')}</span>
          <input aria-label={t('Find')} value={find} onChange={(e) => setFind(e.target.value)} />
        </label>
        <label className="pod-field">
          <span>{t('Replace with')}</span>
          <input aria-label={t('Replace with')} value={replace} onChange={(e) => setReplace(e.target.value)} />
        </label>
        <label className="pod-check">
          <input type="checkbox" checked={matchCase} onChange={(e) => setMatchCase(e.target.checked)} /> {t('Match case')}
        </label>
        <label className="pod-check">
          <input type="checkbox" checked={whole} onChange={(e) => setWhole(e.target.checked)} /> {t('Whole words only')}
        </label>
        <PagesControl value={range} onChange={setRange} ctx={ctx} />
      </>
    )
  const error = tab === 'fonts' ? (rules.length ? null : t('Choose a replacement for at least one font.')) : (r.error ?? (find ? null : t('Type the text to find.')))
  return (
    <Frame
      title={t('Fonts and text')}
      ok={tab === 'fonts' ? t('Replace fonts') : t('Replace all')}
      error={error}
      summary={tab === 'fonts' ? t('{n} fonts will be replaced everywhere they are used. You can undo this until you save.', { n: String(rules.length) }) : t('Every match on the chosen pages will be replaced. You can undo this until you save.')}
      warning={
        tab === 'fonts'
          ? t('Letters take the widths of the new font, so lines may space differently. Arial and Times New Roman match Helvetica and Times exactly. Fonts with their own character codes cannot be replaced.')
          : t('Text is changed through each font, so a subset font can only write characters it already holds. A longer or shorter replacement moves what follows it on the same line.')
      }
      wide
      onClose={onClose}
      onOk={() => {
        const box: { lines: string[]; warnings: string[] } = { lines: [], warnings: [] }
        void env
          .applyPageEdit(async (b) => {
            if (tab === 'fonts') {
              const out = await replaceFonts(b, rules, env.findFont)
              box.lines = [t('Replaced {n} fonts.', { n: String(out.replaced) })]
              box.warnings = [...out.refused.map((x) => `${x.name}: ${x.reason}`), ...out.missing.map((n) => t('No installed font was found to replace {name}.', { name: n }))]
              return out.replaced ? out.bytes : null
            }
            const out = await findReplaceText(b, { find, replace, matchCase, wholeWord: whole, pages: r.pages })
            box.lines = [t('Replaced {n} matches on {pages}.', { n: String(out.replaced), pages: pagesWord(out.pages.length) })]
            box.warnings = out.skipped.map((s) => `${s.reason} (${s.count})`)
            if (out.joined) box.warnings.push(t('{n} lines were written as one piece because the match was split; spacing between letters on them is lost.', { n: String(out.joined) }))
            if (!out.replaced) box.lines = [t('Nothing was found to replace.')]
            return out.replaced ? out.bytes : null
          })
          .then(() => setResult(box))
      }}
    >
      <div role="tablist" className="b5-tabs">
        <button type="button" role="tab" aria-selected={tab === 'fonts'} className={tab === 'fonts' ? 'on' : ''} onClick={() => setTab('fonts')}>
          {t('Replace fonts')}
        </button>
        <button type="button" role="tab" aria-selected={tab === 'text'} className={tab === 'text' ? 'on' : ''} onClick={() => setTab('text')}>
          {t('Find and replace text')}
        </button>
      </div>
      {body}
    </Frame>
  )
}

// ---- PDF/A and PDF/X -------------------------------------------------------------------------------

export type Standard = 'a1' | 'a2' | 'a3' | 'x1a' | 'x4'

const STANDARD_LABEL: Record<Standard, string> = {
  a1: msg('PDF/A-1b (ISO 19005-1, PDF 1.4, no transparency or layers)'),
  a2: msg('PDF/A-2b (ISO 19005-2, the usual choice for archives)'),
  a3: msg('PDF/A-3b (ISO 19005-3, may carry attached files)'),
  x1a: msg('PDF/X-1a:2003 (print, CMYK only, no transparency)'),
  x4: msg('PDF/X-4 (print, colour managed, transparency allowed)')
}

function ConvertStandardDialog({ env, initial, onClose }: { env: B5Env; initial: Standard; onClose: () => void }) {
  const [std, setStd] = useState<Standard>(initial)
  const [condition, setCondition] = useState(DEFAULT_CONDITION.condition)
  const [result, setResult] = useState<{ title: string; report: PdfAReport; checks: PdfXCheck[] } | null>(null)
  const isX = std === 'x1a' || std === 'x4'
  if (result) {
    return (
      <Modal title={t('Converted to {target}', { target: result.title })} onClose={onClose}>
        <div className="marks-form">
          <p className="muted">{t('Best effort: this program does not guarantee that the result conforms. PDF/A results are checked with veraPDF on this program’s own test files; PDF/X results are not checked with a validator at all. Check the file with a validator or a preflight tool before it is relied on.')}</p>
          <ul className="std-list">
            {result.report.fixed.map((x) => (
              <li key={x} className="std-pass">
                <span aria-hidden>✔</span> {x}
              </li>
            ))}
            {result.report.remaining.map((x) => (
              <li key={x} className="std-warn">
                <span aria-hidden>⚠</span> {x}
              </li>
            ))}
          </ul>
          {result.checks.length > 0 && (
            <>
              <h3>{t('Quick checks of the result')}</h3>
              <ul className="std-list">
                {result.checks.map((c) => (
                  <li key={c.label} className={`std-${c.status}`}>
                    <span aria-hidden>{c.status === 'pass' ? '✔' : c.status === 'fail' ? '✖' : '⚠'}</span> {c.label}
                    {c.detail && <span className="muted"> ({c.detail})</span>}
                  </li>
                ))}
              </ul>
            </>
          )}
          <div className="marks-actions">
            <span style={{ flex: 1 }} />
            <button className="primary" type="button" onClick={onClose}>
              {t('Close')}
            </button>
          </div>
        </div>
      </Modal>
    )
  }
  return (
    <Frame
      title={t('Convert to PDF/A or PDF/X')}
      ok={t('Convert')}
      error={isX && std === 'x1a' && !condition.trim() ? t('Name the print condition.') : null}
      summary={t('The file is converted as one undoable edit. Anything it could not do is listed afterwards.')}
      warning={t('Best effort. PDF/A conversions are checked with veraPDF on this program’s own test files, but a real-world file can still fail. PDF/X is not checked with any validator, and X-1a only names a print condition (it has no CMYK profile).')}
      onClose={onClose}
      onOk={() => {
        const box: { v: { title: string; report: PdfAReport; checks: PdfXCheck[] } | null } = { v: null }
        void env
          .applyPageEdit(async (b) => {
            if (std === 'x1a' || std === 'x4') {
              const variant: PdfXVariant = std
              const r = await convertToPdfX(b, env.findFont, variant, { condition: condition.trim() || DEFAULT_CONDITION.condition, registry: DEFAULT_CONDITION.registry })
              box.v = { title: r.report.target ?? '', report: r.report, checks: await checkPdfX(r.bytes, variant) }
              return r.bytes
            }
            const part: PdfAPart = std === 'a1' ? 1 : std === 'a3' ? 3 : 2
            const r = await convertToPdfA(b, env.findFont, new Date(), part)
            box.v = { title: r.report.target ?? '', report: r.report, checks: [] }
            return r.bytes
          })
          .then(() => box.v && setResult(box.v))
      }}
    >
      {(Object.keys(STANDARD_LABEL) as Standard[]).map((k) => (
        <label key={k} className="pod-radio">
          <input type="radio" name="b5-standard" checked={std === k} onChange={() => setStd(k)} /> {t(STANDARD_LABEL[k])}
        </label>
      ))}
      {std === 'x1a' && (
        <label className="pod-field">
          <span>{t('Print condition')}</span>
          <input aria-label={t('Print condition')} value={condition} onChange={(e) => setCondition(e.target.value)} />
          <span className="pod-hint">{t('A registered name such as CGATS TR 001; ask your printer.')}</span>
        </label>
      )}
    </Frame>
  )
}

// ---- Layers ----------------------------------------------------------------------------------------

function LayersDialog({ env, onClose }: { env: B5Env; onClose: () => void }) {
  const [layers, setLayers] = useState<Layer[] | null>(null)
  const [open, setOpen] = useState<Set<string>>(new Set())
  const [names, setNames] = useState<Record<string, string>>({})
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [newName, setNewName] = useState('')
  const [content, setContent] = useState<'keep' | 'remove'>('keep')
  const [message, setMessage] = useState('')
  useEffect(() => {
    let live = true
    void readLayers(env.bytes).then((l) => {
      if (!live) return
      setLayers(l)
      setOpen(new Set(l.filter((x) => (env.hiddenLayers ? !env.hiddenLayers.has(x.key) : x.defaultOn)).map((x) => x.key)))
      setNames(Object.fromEntries(l.map((x) => [x.key, x.name])))
      setSel(new Set())
    })
    return () => {
      live = false
    }
  }, [env.bytes, env.hiddenLayers])
  const toggle = (set: Set<string>, key: string): Set<string> => {
    const n = new Set(set)
    if (n.has(key)) n.delete(key)
    else n.add(key)
    return n
  }
  const run = (what: string, fn: (b: Uint8Array) => Promise<Uint8Array | null>) => void env.applyPageEdit(fn, what).then(() => setMessage(what))
  if (!layers) return null
  const chosen = layers.filter((l) => sel.has(l.key))
  return (
    <Modal title={t('Edit layers')} onClose={onClose} wide>
      <div className="marks-form">
        {!layers.length ? <p className="muted">{t('This document has no layers. Add one to start.')}</p> : null}
        {layers.length > 0 && (
          <table className="b5-table" aria-label={t('Layers')}>
            <thead>
              <tr>
                <th>{t('Select')}</th>
                <th>{t('Visible when opened')}</th>
                <th>{t('Name')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {layers.map((l) => (
                <tr key={l.key}>
                  <td>
                    <input type="checkbox" aria-label={t('Select {name}', { name: l.name })} checked={sel.has(l.key)} onChange={() => setSel(toggle(sel, l.key))} />
                  </td>
                  <td>
                    <input type="checkbox" aria-label={t('{name} visible when opened', { name: l.name })} checked={open.has(l.key)} onChange={() => setOpen(toggle(open, l.key))} />
                  </td>
                  <td>
                    <input aria-label={t('Name of {name}', { name: l.name })} value={names[l.key] ?? l.name} onChange={(e) => setNames({ ...names, [l.key]: e.target.value })} />
                  </td>
                  <td>
                    <button type="button" disabled={!(names[l.key] ?? '').trim() || names[l.key] === l.name} onClick={() => run(t('Layer renamed'), (b) => renameLayer(b, l.key, names[l.key].trim()))}>
                      {t('Rename')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div className="marks-actions">
          <button
            type="button"
            disabled={!layers.length}
            title={t('Write the ticked layers as the ones shown when the document opens')}
            onClick={() => run(t('The opening view was saved'), (b) => withHiddenLayers(b, new Set(layers.filter((l) => !open.has(l.key)).map((l) => l.key))))}
          >
            {t('Save opening view')}
          </button>
          <button type="button" disabled={chosen.length < 2} title={t('Put everything on the selected layers onto the first selected one')} onClick={() => run(t('Layers merged'), async (b) => (await mergeLayers(b, chosen.map((l) => l.key), chosen[0].key)).bytes)}>
            {t('Merge selected')}
          </button>
          <button
            type="button"
            disabled={!chosen.length}
            title={content === 'keep' ? t('Remove the selected layers; what is on them stays on the pages') : t('Remove the selected layers and everything on them')}
            onClick={() =>
              run(t('Layers deleted'), async (b) => {
                let cur = b
                for (const l of chosen) cur = (await deleteLayer(cur, l.key, content)).bytes
                return cur
              })
            }
          >
            {t('Delete selected')}
          </button>
          <select aria-label={t('What happens to the content of deleted layers')} value={content} onChange={(e) => setContent(e.target.value as 'keep' | 'remove')}>
            <option value="keep">{t('Keep their content')}</option>
            <option value="remove">{t('Delete their content too')}</option>
          </select>
        </div>
        <div className="marks-actions">
          <input aria-label={t('New layer name')} placeholder={t('New layer name')} value={newName} onChange={(e) => setNewName(e.target.value)} />
          <button type="button" disabled={!newName.trim()} onClick={() => run(t('Layer added'), async (b) => (await addLayer(b, newName.trim())).bytes)}>
            {t('Add layer')}
          </button>
          <span style={{ flex: 1 }} />
          <button
            type="button"
            disabled={!layers.length}
            title={t('Make the layers as they open permanent: hidden content is removed and the layers are taken out')}
            onClick={() =>
              run(t('Layers flattened'), async (b) => {
                const r = await flattenLayers(b)
                return r.layers ? r.bytes : null
              })
            }
          >
            {t('Flatten layers')}
          </button>
        </div>
        {message && <p className="muted" role="status">{message}</p>}
        <div className="marks-actions">
          <span style={{ flex: 1 }} />
          <button className="primary" type="button" onClick={onClose}>
            {t('Close')}
          </button>
        </div>
      </div>
    </Modal>
  )
}

// ---- Host ------------------------------------------------------------------------------------------

/** The dialog for `kind`, or nothing. */
export function Batch5Dialog({ kind, env, standard, onClose }: { kind: B5Kind | null; env: B5Env; standard?: Standard; onClose: () => void }) {
  if (!kind) return null
  if (kind === 'colours') return <ColoursDialog env={env} onClose={onClose} />
  if (kind === 'rasterise') return <RasteriseDialog env={env} enhance={false} onClose={onClose} />
  if (kind === 'enhance') return <RasteriseDialog env={env} enhance onClose={onClose} />
  if (kind === 'recompress') return <RecompressDialog env={env} onClose={onClose} />
  if (kind === 'fonts') return <FontsDialog env={env} onClose={onClose} />
  if (kind === 'convert') return <ConvertStandardDialog env={env} initial={standard ?? 'a2'} onClose={onClose} />
  return <LayersDialog env={env} onClose={onClose} />
}
