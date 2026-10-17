import { useState } from 'react'
import { Trash2 } from 'lucide-react'
import type { Settings } from '../../preload'
import { DEFAULT_ZOOMS, defaultPerformance, defaultSearchProviders, parseExtensions, validExePath, validProviderUrl, type DefaultZoom } from '../../shared/prefs'
import { t } from './i18n'

type Change = (patch: Partial<Settings>) => void

const ZOOM_NAMES: Record<DefaultZoom, () => string> = {
  'fit-width': () => t('Fit width'),
  'fit-page': () => t('Fit page'),
  'fit-visible': () => t('Fit visible'),
  actual: () => t('Actual size (100%)')
}

/** How a document opens: page layout, thin lines and zoom. Each document can still be changed on the View tab. */
export function PageDisplaySettings({ settings, onChange }: { settings: Settings; onChange: Change }) {
  const v = settings.viewDefaults
  const set = (patch: Partial<typeof v>) => onChange({ viewDefaults: { ...v, ...patch } })
  return (
    <section id="pref-display" aria-label={t('Page display')}>
      <h3>{t('Page display')}</h3>
      <p className="muted small">{t('How documents look when they open. You can still change the view of each document on the View tab.')}</p>
      <div className="form-grid">
        <label htmlFor="pref-zoom">{t('Zoom')}</label>
        <select id="pref-zoom" value={v.zoom} onChange={(e) => set({ zoom: e.target.value as DefaultZoom })}>
          {DEFAULT_ZOOMS.map((z) => (
            <option key={z} value={z}>
              {ZOOM_NAMES[z]()}
            </option>
          ))}
        </select>
      </div>
      <div className="pref-checks">
        <label className="inline">
          <input type="checkbox" checked={v.twoUp} onChange={(e) => set({ twoUp: e.target.checked })} /> {t('Two pages side by side')}
        </label>
        <label className="inline">
          <input type="checkbox" checked={v.continuous} onChange={(e) => set({ continuous: e.target.checked })} /> {t('Scroll through all pages (continuous)')}
        </label>
        <label className="inline">
          <input type="checkbox" checked={v.cover} onChange={(e) => set({ cover: e.target.checked })} /> {t('Show the first page on its own when two pages are shown')}
        </label>
        <label className="inline">
          <input type="checkbox" checked={v.rtl} onChange={(e) => set({ rtl: e.target.checked })} /> {t('Right-to-left page order')}
        </label>
        <label className="inline">
          <input type="checkbox" checked={v.gaps} onChange={(e) => set({ gaps: e.target.checked })} /> {t('Space between pages')}
        </label>
        <label className="inline">
          <input type="checkbox" checked={v.thinLines} onChange={(e) => set({ thinLines: e.target.checked })} /> {t('Thin lines: keep hairlines one solid pixel wide')}
        </label>
      </div>
    </section>
  )
}

/** Web search providers for "Search the web" on the Home tab. The address holds {q} where the selected text goes. */
export function SearchProviderSettings({ settings, onChange }: { settings: Settings; onChange: Change }) {
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [problem, setProblem] = useState<string | null>(null)
  const list = settings.searchProviders
  const add = () => {
    if (!name.trim()) return setProblem(t('Give the provider a name.'))
    if (!validProviderUrl(url.trim())) return setProblem(t('The address must start with https:// and contain {q} where the search words go.'))
    const base = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'provider'
    let id = base
    for (let n = 2; list.some((p) => p.id === id); n++) id = `${base}-${n}`
    onChange({ searchProviders: [...list, { id, name: name.trim(), url: url.trim() }] })
    setName('')
    setUrl('')
    setProblem(null)
  }
  return (
    <section id="pref-search" aria-label={t('Search providers')}>
      <h3>{t('Search providers')}</h3>
      <p className="muted small">{t('Choose which websites "Search the web" can use for the text you select. OpenPDF asks before it opens the browser.')}</p>
      <ul className="pref-list" aria-label={t('Search providers')}>
        {list.map((p) => (
          <li key={p.id}>
            <span className="pref-list-text">
              <strong>{p.name}</strong>
              <span className="muted small">{p.url}</span>
            </span>
            <button type="button" className="icon-btn" aria-label={t('Remove {name}', { name: p.name })} onClick={() => onChange({ searchProviders: list.filter((x) => x.id !== p.id) })}>
              <Trash2 size={14} strokeWidth={1.8} aria-hidden />
            </button>
          </li>
        ))}
        {!list.length && <li className="muted small">{t('No providers: "Search the web" is turned off.')}</li>}
      </ul>
      <div className="form-grid">
        <label htmlFor="pref-prov-name">{t('Name')}</label>
        <input id="pref-prov-name" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
        <label htmlFor="pref-prov-url">{t('Address')}</label>
        <input id="pref-prov-url" value={url} placeholder="https://example.com/search?q={q}" onChange={(e) => setUrl(e.target.value)} />
      </div>
      <div className="batch-actionbar">
        <button type="button" onClick={add}>
          {t('Add provider')}
        </button>
        <button type="button" onClick={() => onChange({ searchProviders: defaultSearchProviders() })}>
          {t('Restore the standard providers')}
        </button>
      </div>
      {problem && (
        <p role="alert" className="error-text">
          {problem}
        </p>
      )}
    </section>
  )
}

/** Name is the author name above; the rest is available to stamps as {initials}, {organisation}, {email} and {title}. */
export function IdentitySettings({ settings, onChange }: { settings: Settings; onChange: Change }) {
  const id = settings.identity
  const set = (patch: Partial<typeof id>) => onChange({ identity: { ...id, ...patch } })
  return (
    <section id="pref-identity" aria-label={t('Identity')}>
      <h3>{t('Identity')}</h3>
      <p className="muted small">{t('Your name is the author name for comments, set above. These details can be put into text stamps with the fields {initials}, {organisation}, {email} and {title}.')}</p>
      <div className="form-grid">
        <label htmlFor="pref-initials">{t('Initials')}</label>
        <input id="pref-initials" value={id.initials} maxLength={10} onChange={(e) => set({ initials: e.target.value })} />
        <label htmlFor="pref-title">{t('Job title')}</label>
        <input id="pref-title" value={id.title} maxLength={80} onChange={(e) => set({ title: e.target.value })} />
        <label htmlFor="pref-org">{t('Organisation')}</label>
        <input id="pref-org" value={id.organisation} maxLength={120} onChange={(e) => set({ organisation: e.target.value })} />
        <label htmlFor="pref-email">{t('E-mail address')}</label>
        <input id="pref-email" value={id.email} maxLength={120} onChange={(e) => set({ email: e.target.value })} />
      </div>
    </section>
  )
}

/** Programs for attached files: the extension list picks the program. Not carried by Export and Import settings. */
export function LaunchSettings({ settings, onChange }: { settings: Settings; onChange: Change }) {
  const [name, setName] = useState('')
  const [exts, setExts] = useState('')
  const [path, setPath] = useState('')
  const [problem, setProblem] = useState<string | null>(null)
  const list = settings.launchApps
  const add = () => {
    const e = parseExtensions(exts)
    if (!name.trim()) return setProblem(t('Give the program a name.'))
    if (!e.length) return setProblem(t('List the file types it opens, for example docx, xlsx.'))
    if (!validExePath(path.trim())) return setProblem(t('Enter the full path of the program, for example C:\\Program Files\\Example\\app.exe.'))
    const base = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'app'
    let id = base
    for (let n = 2; list.some((p) => p.id === id); n++) id = `${base}-${n}`
    onChange({ launchApps: [...list, { id, name: name.trim(), extensions: e, path: path.trim() }] })
    setName('')
    setExts('')
    setPath('')
    setProblem(null)
  }
  return (
    <section id="pref-launch" aria-label={t('Launch applications')}>
      <h3>{t('Launch applications')}</h3>
      <p className="muted small">{t('Programs that open the files attached to a document, by file type. The attached file is saved to a temporary folder and handed to the program. These settings stay on this computer: they are not part of Export settings.')}</p>
      <ul className="pref-list" aria-label={t('Launch applications')}>
        {list.map((a) => (
          <li key={a.id}>
            <span className="pref-list-text">
              <strong>{a.name}</strong>
              <span className="muted small">
                {a.extensions.join(', ')} · {a.path}
              </span>
            </span>
            <button type="button" className="icon-btn" aria-label={t('Remove {name}', { name: a.name })} onClick={() => onChange({ launchApps: list.filter((x) => x.id !== a.id) })}>
              <Trash2 size={14} strokeWidth={1.8} aria-hidden />
            </button>
          </li>
        ))}
        {!list.length && <li className="muted small">{t('No programs set: attached files can only be saved.')}</li>}
      </ul>
      <div className="form-grid">
        <label htmlFor="pref-app-name">{t('Name')}</label>
        <input id="pref-app-name" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
        <label htmlFor="pref-app-exts">{t('File types')}</label>
        <input id="pref-app-exts" value={exts} placeholder="docx, xlsx" onChange={(e) => setExts(e.target.value)} />
        <label htmlFor="pref-app-path">{t('Program')}</label>
        <input id="pref-app-path" value={path} placeholder="C:\Program Files\...\app.exe" onChange={(e) => setPath(e.target.value)} />
      </div>
      <div className="batch-actionbar">
        <button type="button" onClick={() => void window.openpdf.pickProgram().then((p) => p && setPath(p))}>
          {t('Browse…')}
        </button>
        <button type="button" onClick={add}>
          {t('Add program')}
        </button>
      </div>
      {problem && (
        <p role="alert" className="error-text">
          {problem}
        </p>
      )}
    </section>
  )
}

/** Limits on drawing: how large a bitmap is drawn in one piece, how far ahead pages are drawn, and pages drawn at once. */
export function PerformanceSettings({ settings, onChange }: { settings: Settings; onChange: Change }) {
  const p = settings.performance
  const set = (patch: Partial<typeof p>) => onChange({ performance: { ...p, ...patch } })
  return (
    <section id="pref-performance" aria-label={t('Performance')}>
      <h3>{t('Performance')}</h3>
      <p className="muted small">{t('Lower values use less memory; higher values scroll more smoothly on large drawings. The standard values suit most computers.')}</p>
      <div className="form-grid">
        <label htmlFor="pref-tile">{t('Draw a page in tiles above (megapixels)')}</label>
        <select id="pref-tile" value={p.tileMegapixels} onChange={(e) => set({ tileMegapixels: Number(e.target.value) })}>
          {[...new Set([4, 8, 16, 32, 64, p.tileMegapixels])]
            .sort((a, b) => a - b)
            .map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
        </select>
        <label htmlFor="pref-ahead">{t('Draw pages this far ahead of scrolling (pixels)')}</label>
        <select id="pref-ahead" value={p.renderAhead} onChange={(e) => set({ renderAhead: Number(e.target.value) })}>
          {[...new Set([0, 300, 600, 1200, 2400, p.renderAhead])]
            .sort((a, b) => a - b)
            .map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
        </select>
        <label htmlFor="pref-jobs">{t('Pages drawn at the same time')}</label>
        <select id="pref-jobs" value={p.renderJobs} onChange={(e) => set({ renderJobs: Number(e.target.value) })}>
          {[1, 2, 3, 4].map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </div>
      <div className="batch-actionbar">
        <button type="button" onClick={() => onChange({ performance: defaultPerformance() })}>
          {t('Use the standard values')}
        </button>
      </div>
    </section>
  )
}

/** Puts every preference back to its default after asking. Recent files, the last session and the update address stay. */
export function ResetSettings({ onReset }: { onReset: () => void }) {
  const [asking, setAsking] = useState(false)
  return (
    <section id="pref-reset" aria-label={t('Reset settings')}>
      <h3>{t('Reset settings')}</h3>
      <p className="muted small">{t('Puts every preference back to its standard value: view, tools, presets, quick-access toolbar, ribbon layout and the rest. Recent files, the last session and the update address are kept.')}</p>
      {asking ? (
        <div className="batch-actionbar" role="alert">
          <span>{t('Reset every setting to its standard value?')}</span>
          <button
            type="button"
            className="primary"
            onClick={() => {
              setAsking(false)
              onReset()
            }}
          >
            {t('Reset')}
          </button>
          <button type="button" onClick={() => setAsking(false)}>
            {t('Cancel')}
          </button>
        </div>
      ) : (
        <div className="batch-actionbar">
          <button type="button" onClick={() => setAsking(true)}>
            {t('Reset settings to defaults…')}
          </button>
        </div>
      )}
    </section>
  )
}
