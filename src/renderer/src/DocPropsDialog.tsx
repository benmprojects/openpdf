import { useEffect, useState } from 'react'
import { Modal } from './AppDialogs'
import { formatSize } from './OptimiseDialog'
import type { DocProps } from './metadata'
import { checkCustomProps, listFonts, readCustomProps, type CustomProp, type FontInfo } from './docExtras'
import { DEFAULT_VIEW_PREFS, parsePrintRange, printRangeText, readViewPrefs, type DuplexName, type Magnification, type PageLayoutName, type PageModeName, type ViewPrefs } from './viewPrefs'
import { t } from './i18n'

/** The properties beyond the standard fields: custom Info entries, and the initial view and print presets. */
export interface DocExtras {
  custom: CustomProp[]
  view: ViewPrefs
}

/** The ISO string as the value of a datetime-local input (local time), and back. */
const toLocal = (iso: string) => {
  const d = new Date(iso)
  if (!iso || Number.isNaN(d.getTime())) return ''
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}
const fromLocal = (v: string) => (v ? new Date(v).toISOString() : '')
/** DD/MM/YYYY, 24-hour. */
const show = (iso: string) => (iso && !Number.isNaN(new Date(iso).getTime()) ? new Date(iso).toLocaleString('en-AU', { hour12: false }) : 'not set')

type Tab = 'description' | 'view' | 'fonts' | 'custom' | 'print'

const LAYOUTS: [PageLayoutName, string][] = [
  ['Default', 'Default'],
  ['SinglePage', 'Single page'],
  ['OneColumn', 'Single page, continuous'],
  ['TwoColumnLeft', 'Two pages, continuous'],
  ['TwoColumnRight', 'Two pages, continuous, cover page first'],
  ['TwoPageLeft', 'Two pages'],
  ['TwoPageRight', 'Two pages, cover page first']
]
const MODES: [PageModeName, string][] = [
  ['Default', 'Default'],
  ['UseNone', 'Page only'],
  ['UseOutlines', 'Bookmarks and page'],
  ['UseThumbs', 'Page thumbnails and page'],
  ['UseAttachments', 'Attachments and page'],
  ['UseOC', 'Layers and page'],
  ['FullScreen', 'Full screen']
]
const DUPLEXES: [DuplexName, string][] = [
  ['Default', 'Printer default'],
  ['Simplex', 'One side'],
  ['DuplexFlipLongEdge', 'Both sides, flip on the long edge'],
  ['DuplexFlipShortEdge', 'Both sides, flip on the short edge']
]

/** Document properties: the Info entries (and matching XMP), initial view, fonts, custom properties and print presets. */
export function DocPropsDialog({
  initial,
  bytes,
  fileName,
  pageCount,
  size,
  onApply,
  onRemove,
  onClose
}: {
  initial: DocProps
  /** The file, to read the fonts, the custom properties and the view settings from. */
  bytes: Uint8Array
  fileName: string
  pageCount: number
  size: number
  onApply: (p: DocProps, extras: DocExtras | null) => void
  onRemove: () => void
  onClose: () => void
}) {
  const [p, setP] = useState(initial)
  const [tab, setTab] = useState<Tab>('description')
  const [custom, setCustom] = useState<CustomProp[] | null>(null)
  const [view, setView] = useState<ViewPrefs | null>(null)
  const [magKind, setMagKind] = useState<Magnification['kind']>('default')
  const [percent, setPercent] = useState(100)
  const [rangeText, setRangeText] = useState('')
  const [fonts, setFonts] = useState<FontInfo[] | null>(null)
  const [fontError, setFontError] = useState('')
  const [problem, setProblem] = useState('')

  useEffect(() => {
    let live = true
    void Promise.all([readCustomProps(bytes), readViewPrefs(bytes)])
      .then(([c, v]) => {
        if (!live) return
        setCustom(c)
        setView(v)
        setMagKind(v.magnification.kind)
        setPercent(v.magnification.kind === 'zoom' ? v.magnification.percent : 100)
        setRangeText(printRangeText(v.printRange))
      })
      .catch(() => {
        if (!live) return
        setCustom([])
        setView({ ...DEFAULT_VIEW_PREFS, printRange: [] })
        setProblem(t('The initial view and custom properties could not be read from this file.'))
      })
    return () => {
      live = false
    }
  }, [bytes])
  useEffect(() => {
    if (tab !== 'fonts' || fonts) return
    let live = true
    listFonts(bytes).then(
      (f) => live && setFonts(f),
      (e: unknown) => live && (setFonts([]), setFontError(e instanceof Error ? e.message : String(e)))
    )
    return () => {
      live = false
    }
  }, [tab, fonts, bytes])

  const text = (key: 'title' | 'author' | 'subject' | 'keywords' | 'creator' | 'producer', label: string) => (
    <label className="props-row">
      <span>{t(label)}</span>
      <input aria-label={t(label)} value={p[key]} onChange={(e) => setP({ ...p, [key]: e.target.value })} />
    </label>
  )
  const setV = (patch: Partial<ViewPrefs>) => setView((v) => (v ? { ...v, ...patch } : v))

  const submit = () => {
    if (!view || !custom) return onApply({ ...p, modified: new Date().toISOString() }, null)
    if (view.baseUrl.trim() && !/^https?:\/\/[^\s/]+\S*$/i.test(view.baseUrl.trim())) {
      setTab('description')
      return setProblem(t('The base URL must be a web address starting with http:// or https://'))
    }
    const bad = checkCustomProps(custom)
    if (bad) {
      setTab('custom')
      return setProblem(bad)
    }
    let printRange: [number, number][]
    try {
      printRange = parsePrintRange(rangeText, pageCount)
    } catch (e) {
      setTab('print')
      return setProblem(e instanceof Error ? e.message : String(e))
    }
    const magnification: Magnification = magKind === 'zoom' ? { kind: 'zoom', percent: Math.min(6400, Math.max(1, Math.round(percent) || 100)) } : { kind: magKind }
    onApply(
      { ...p, modified: new Date().toISOString() },
      { custom: custom.map((c) => ({ key: c.key.trim(), value: c.value })), view: { ...view, magnification, printRange } }
    )
  }

  const tabs: [Tab, string][] = [
    ['description', 'Description'],
    ['view', 'Initial View'],
    ['fonts', 'Fonts'],
    ['custom', 'Custom'],
    ['print', 'Print presets']
  ]

  return (
    <Modal title={t('Document properties')} onClose={onClose} wide>
      <form
        className="marks-form props-form"
        onSubmit={(e) => {
          e.preventDefault()
          setProblem('')
          submit()
        }}
      >
        <p className="muted">
          {fileName} · {pageCount} page{pageCount === 1 ? '' : 's'} · {formatSize(size)}
        </p>
        <div role="tablist" aria-label={t('Properties')} className="props-tabs">
          {tabs.map(([k, label]) => (
            <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>
              {t(label)}
            </button>
          ))}
        </div>

        {tab === 'description' && (
          <div role="tabpanel" aria-label={t('Description')} className="props-panel">
            {text('title', 'Title')}
            {text('author', 'Author')}
            {text('subject', 'Subject')}
            {text('keywords', 'Keywords')}
            {text('creator', 'Application')}
            {text('producer', 'PDF producer')}
            <label className="props-row">
              <span>Created</span>
              <input type="datetime-local" aria-label="Created" value={toLocal(p.created)} onChange={(e) => setP({ ...p, created: fromLocal(e.target.value) })} />
            </label>
            {view && (
              <>
                <label className="props-row">
                  <span>{t('Base URL')}</span>
                  <input aria-label={t('Base URL')} placeholder="https://" value={view.baseUrl} onChange={(e) => setV({ baseUrl: e.target.value })} spellCheck={false} />
                </label>
                <label className="props-row">
                  <span>{t('Trapped')}</span>
                  <select aria-label={t('Trapped')} value={view.trapped} onChange={(e) => setV({ trapped: e.target.value as ViewPrefs['trapped'] })}>
                    <option value="Unknown">{t('Unknown')}</option>
                    <option value="True">{t('Yes')}</option>
                    <option value="False">{t('No')}</option>
                  </select>
                </label>
              </>
            )}
            <p className="muted">Last modified: {show(initial.modified)}. Saving the properties sets it to now.</p>
          </div>
        )}

        {tab === 'view' && view && (
          <div role="tabpanel" aria-label={t('Initial View')} className="props-panel">
            <p className="muted small">{t('How the document opens in OpenPDF and other viewers.')}</p>
            <label className="props-row">
              <span>{t('Page layout')}</span>
              <select aria-label={t('Page layout')} value={view.layout} onChange={(e) => setV({ layout: e.target.value as PageLayoutName })}>
                {LAYOUTS.map(([k, label]) => (
                  <option key={k} value={k}>
                    {t(label)}
                  </option>
                ))}
              </select>
            </label>
            <label className="props-row">
              <span>{t('Navigation tab')}</span>
              <select aria-label={t('Navigation tab')} value={view.pageMode} onChange={(e) => setV({ pageMode: e.target.value as PageModeName })}>
                {MODES.map(([k, label]) => (
                  <option key={k} value={k}>
                    {t(label)}
                  </option>
                ))}
              </select>
            </label>
            <label className="props-row">
              <span>{t('Magnification')}</span>
              <span className="props-inline">
                <select aria-label={t('Magnification')} value={magKind} disabled={view.foreignOpenAction} onChange={(e) => setMagKind(e.target.value as Magnification['kind'])}>
                  <option value="default">{t('Default')}</option>
                  <option value="fit-page">{t('Fit page')}</option>
                  <option value="fit-width">{t('Fit width')}</option>
                  <option value="fit-visible">{t('Fit visible')}</option>
                  <option value="zoom">{t('Percentage')}</option>
                </select>
                {magKind === 'zoom' && (
                  <>
                    <input type="number" aria-label={t('Magnification percentage')} min={1} max={6400} value={percent} onChange={(e) => setPercent(Number(e.target.value))} />
                    <span>%</span>
                  </>
                )}
              </span>
            </label>
            <label className="props-row">
              <span>{t('Open to page')}</span>
              <input
                type="number"
                aria-label={t('Open to page')}
                min={1}
                max={Math.max(1, pageCount)}
                value={view.openPage}
                disabled={view.foreignOpenAction}
                onChange={(e) => setV({ openPage: Math.min(Math.max(1, pageCount), Math.max(1, Math.round(Number(e.target.value)) || 1)) })}
              />
            </label>
            {view.foreignOpenAction && <p className="muted small">{t('This file runs an action when it opens, so its magnification and page are left as they are.')}</p>}
            <fieldset className="props-checks">
              <legend>{t('Window options')}</legend>
              <label className="inline">
                <input type="checkbox" checked={view.fitWindow} onChange={(e) => setV({ fitWindow: e.target.checked })} /> {t('Resize window to the first page')}
              </label>
              <label className="inline">
                <input type="checkbox" checked={view.centreWindow} onChange={(e) => setV({ centreWindow: e.target.checked })} /> {t('Centre window on screen')}
              </label>
              <label className="inline">
                <input type="checkbox" checked={view.displayTitle} onChange={(e) => setV({ displayTitle: e.target.checked })} /> {t('Show document title in the title bar')}
              </label>
              <label className="inline">
                <input type="checkbox" checked={view.hideToolbar} onChange={(e) => setV({ hideToolbar: e.target.checked })} /> {t('Hide toolbars')}
              </label>
              <label className="inline">
                <input type="checkbox" checked={view.hideMenubar} onChange={(e) => setV({ hideMenubar: e.target.checked })} /> {t('Hide menu bar')}
              </label>
              <label className="inline">
                <input type="checkbox" checked={view.hideWindowUI} onChange={(e) => setV({ hideWindowUI: e.target.checked })} /> {t('Hide window controls')}
              </label>
            </fieldset>
            <p className="muted small">{t('OpenPDF follows the layout, navigation tab, magnification, page, title and toolbar settings. It has one window with tabs, so it does not resize or centre the window; other viewers may.')}</p>
          </div>
        )}

        {tab === 'fonts' && (
          <div role="tabpanel" aria-label={t('Fonts')} className="props-panel">
            {fonts === null && <p className="muted">{t('Reading the fonts…')}</p>}
            {fontError && <p className="error-text">{fontError}</p>}
            {fonts && fonts.length === 0 && !fontError && <p className="muted">{t('No fonts are used in this document.')}</p>}
            {fonts && fonts.length > 0 && (
              <div className="props-scroll">
                <table className="labels-table props-fonts" aria-label={t('Fonts used')}>
                  <thead>
                    <tr>
                      <th>{t('Name')}</th>
                      <th>{t('Type')}</th>
                      <th>{t('Encoding')}</th>
                      <th>{t('Embedded')}</th>
                      <th>{t('Subset')}</th>
                      <th>{t('Pages')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {fonts.map((f, i) => (
                      <tr key={i}>
                        <td>{f.name}</td>
                        <td>{f.type}</td>
                        <td>{f.encoding || '–'}</td>
                        <td>{f.embedded ? t('Yes') : t('No')}</td>
                        <td>{f.subset ? t('Yes') : t('No')}</td>
                        <td>{f.pages.length > 4 ? `${f.pages.slice(0, 4).join(', ')}…` : f.pages.join(', ')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {tab === 'custom' && custom && (
          <div role="tabpanel" aria-label={t('Custom properties')} className="props-panel">
            <p className="muted small">{t('Extra named entries in the document information, such as a project or stage.')}</p>
            {custom.length === 0 && <p className="muted">{t('There are no custom properties.')}</p>}
            {custom.map((c, i) => (
              <div key={i} className="props-custom">
                <input aria-label={`${t('Property name')} ${i + 1}`} placeholder={t('Name')} value={c.key} onChange={(e) => setCustom(custom.map((x, j) => (j === i ? { ...x, key: e.target.value } : x)))} />
                <input aria-label={`${t('Property value')} ${i + 1}`} placeholder={t('Value')} value={c.value} onChange={(e) => setCustom(custom.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))} />
                <button type="button" aria-label={`${t('Delete property')} ${i + 1}`} title={t('Delete this property')} onClick={() => setCustom(custom.filter((_, j) => j !== i))}>
                  ✕
                </button>
              </div>
            ))}
            <div>
              <button type="button" onClick={() => setCustom([...custom, { key: '', value: '' }])}>
                {t('Add property')}
              </button>
            </div>
          </div>
        )}

        {tab === 'print' && view && (
          <div role="tabpanel" aria-label={t('Print presets')} className="props-panel">
            <p className="muted small">{t('What the Print dialog starts with for this document.')}</p>
            <label className="props-row">
              <span>{t('Page scaling')}</span>
              <select aria-label={t('Preset page scaling')} value={view.printScaling} onChange={(e) => setV({ printScaling: e.target.value as ViewPrefs['printScaling'] })}>
                <option value="AppDefault">{t('Application default')}</option>
                <option value="None">{t('None (actual size)')}</option>
              </select>
            </label>
            <label className="props-row">
              <span>{t('Two-sided')}</span>
              <select aria-label={t('Preset two-sided printing')} value={view.duplex} onChange={(e) => setV({ duplex: e.target.value as DuplexName })}>
                {DUPLEXES.map(([k, label]) => (
                  <option key={k} value={k}>
                    {t(label)}
                  </option>
                ))}
              </select>
            </label>
            <label className="props-row">
              <span>{t('Copies')}</span>
              <input type="number" aria-label={t('Preset copies')} min={1} max={5} value={view.numCopies} onChange={(e) => setV({ numCopies: Math.min(5, Math.max(1, Math.round(Number(e.target.value)) || 1)) })} />
            </label>
            <label className="props-row">
              <span>{t('Page range')}</span>
              <input aria-label={t('Preset page range')} placeholder={t('All pages, or for example 1-3, 5')} value={rangeText} onChange={(e) => setRangeText(e.target.value)} />
            </label>
            <label className="inline">
              <input type="checkbox" checked={view.pickTray} onChange={(e) => setV({ pickTray: e.target.checked })} /> {t('Choose the paper source by page size')}
            </label>
          </div>
        )}

        {problem && (
          <p role="alert" className="error-text">
            {problem}
          </p>
        )}
        <div className="marks-actions">
          <button type="button" onClick={onRemove} title="Remove the title, author and every other piece of document information, including XMP">
            Remove all metadata
          </button>
          <span style={{ flex: 1 }} />
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="primary" type="submit">
            Apply
          </button>
        </div>
      </form>
    </Modal>
  )
}
