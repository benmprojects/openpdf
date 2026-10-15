import { useEffect, useState } from 'react'
import { Modal } from './AppDialogs'
import type { CatalogueEntry, InstalledPlugin } from '../../main/plugins'
import type { PluginAction } from '../../shared/plugins'

const CATALOGUE_KEY = 'openpdf.pluginCatalogue'
const saved = (): string => {
  try {
    return localStorage.getItem(CATALOGUE_KEY) ?? ''
  } catch {
    return ''
  }
}

const PERMIT_WORDS: Record<string, string> = {
  watermark: 'add watermarks',
  headerFooter: 'add headers, footers and page numbers',
  properties: 'change the document properties',
  rotate: 'rotate pages',
  flatten: 'flatten form fields',
  sanitise: 'remove hidden information',
  optimise: 'reduce the file size',
  pdfa: 'convert to PDF/A'
}

/** Installed plugins, running their actions on the open document, installing and removing them. */
export function PluginsDialog({ onRun, onClose }: { onRun: (plugin: InstalledPlugin, action: PluginAction, params: Record<string, string>) => Promise<string>; onClose: () => void }) {
  const [list, setList] = useState<InstalledPlugin[]>([])
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [address, setAddress] = useState(saved)
  const [catalogue, setCatalogue] = useState<CatalogueEntry[] | null>(null)
  const [params, setParams] = useState<Record<string, string>>({})

  const refresh = () => window.openpdf.pluginsList().then(setList)
  useEffect(() => {
    void refresh()
  }, [])

  const attempt = async (fn: () => Promise<string | null>) => {
    setBusy(true)
    setError('')
    setMessage('')
    try {
      const m = await fn()
      if (m) setMessage(m)
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e))
    } finally {
      setBusy(false)
    }
  }
  const installed = (id: string) => list.find((p) => p.manifest.id === id)?.manifest.version
  const can = (p: InstalledPlugin) => p.manifest.permits.map((k) => PERMIT_WORDS[k] ?? k).join(', ')

  return (
    <Modal title="Plugins" onClose={onClose} wide>
      <div className="marks-form plugins">
        <p className="muted">
          A plugin is a small script that looks at the document and asks for changes from a fixed list. It runs in a sandbox: it cannot read files, use the network or change anything beyond what its permissions below allow.
        </p>
        <section aria-label="Installed plugins">
          <h3>Installed</h3>
          {list.length === 0 && <p>No plugins are installed.</p>}
          {list.map((p) => (
            <div key={p.manifest.id} className="plugin-card" role="group" aria-label={p.manifest.name}>
              <div className="batch-step-head">
                <strong>{p.manifest.name}</strong>
                <span className="muted">
                  {p.manifest.version}
                  {p.manifest.author ? ` by ${p.manifest.author}` : ''}
                </span>
                <span style={{ flex: 1 }} />
                <button type="button" disabled={busy} onClick={() => void attempt(async () => (await window.openpdf.pluginUninstall(p.manifest.id), `Removed ${p.manifest.name}.`))}>
                  Uninstall
                </button>
              </div>
              {p.manifest.description && <p>{p.manifest.description}</p>}
              <p className="muted">It can: {can(p)}.</p>
              {p.manifest.actions.map((a) => (
                <div key={a.id} className="plugin-action">
                  <strong>{a.label}</strong>
                  {(a.params ?? []).map((q) => (
                    <label key={q.id} className="inline">
                      {q.label}{' '}
                      <input
                        aria-label={`${a.label}: ${q.label}`}
                        value={params[`${p.manifest.id}/${a.id}/${q.id}`] ?? q.default ?? ''}
                        onChange={(e) => setParams({ ...params, [`${p.manifest.id}/${a.id}/${q.id}`]: e.target.value })}
                      />
                    </label>
                  ))}
                  <button
                    type="button"
                    className="primary"
                    disabled={busy}
                    onClick={() =>
                      void attempt(() =>
                        onRun(p, a, Object.fromEntries((a.params ?? []).map((q) => [q.id, params[`${p.manifest.id}/${a.id}/${q.id}`] ?? q.default ?? ''])))
                      )
                    }
                  >
                    Run on this document
                  </button>
                </div>
              ))}
            </div>
          ))}
        </section>

        <section aria-label="Install">
          <h3>Install</h3>
          <div className="batch-actionbar">
            <button type="button" disabled={busy} onClick={() => void attempt(async () => ((await window.openpdf.pluginInstallFolder())?.name ? 'Installed.' : null))}>
              From a folder…
            </button>
            <button type="button" disabled={busy} onClick={() => void attempt(async () => ((await window.openpdf.pluginInstallZip())?.name ? 'Installed.' : null))}>
              From a zip file…
            </button>
          </div>
          <div className="batch-actionbar">
            <input aria-label="Catalogue address" placeholder="Address of a plugin catalogue (https://…)" value={address} onChange={(e) => setAddress(e.target.value)} />
            <button
              type="button"
              disabled={busy || !address.trim()}
              onClick={() =>
                void attempt(async () => {
                  try {
                    localStorage.setItem(CATALOGUE_KEY, address.trim())
                  } catch {
                    // not remembered
                  }
                  const c = await window.openpdf.pluginCatalogue(address.trim())
                  setCatalogue(c)
                  return c.length ? null : 'The catalogue lists no plugins.'
                })
              }
            >
              Browse catalogue
            </button>
          </div>
          {catalogue && (
            <ul className="batch-results" aria-label="Catalogue">
              {catalogue.map((c) => (
                <li key={c.id}>
                  <strong>{c.name}</strong> <span className="muted">{c.version}{c.author ? ` by ${c.author}` : ''}</span>
                  {c.description && <div>{c.description}</div>}
                  {c.permits && <div className="muted">It can: {c.permits.map((k) => PERMIT_WORDS[k] ?? k).join(', ')}.</div>}
                  <button type="button" disabled={busy} onClick={() => void attempt(async () => `Installed ${(await window.openpdf.pluginInstallCatalogue(c)).name}.`)}>
                    {installed(c.id) ? (installed(c.id) === c.version ? 'Reinstall' : `Update from ${installed(c.id)}`) : 'Install'}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
        {message && <p role="status">{message}</p>}
        {error && (
          <p role="alert" className="error-text">
            {error}
          </p>
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
