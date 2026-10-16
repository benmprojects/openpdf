import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { UpdateStatus } from '../../main/updates'
import type { Settings } from '../../preload'
import { languages, t } from './i18n'

/** A centred modal panel. Esc and a click on the backdrop close it. */
export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const panel = useRef<HTMLDivElement>(null)
  // Focus goes into the dialog when it opens and back to what opened it when it closes.
  const opener = useRef<HTMLElement | null>(null)
  useEffect(() => {
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    return () => {
      const el = opener.current
      if (el && el.isConnected) el.focus()
    }
  }, [])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      } else if (e.key === 'Tab' && panel.current) {
        // Tab stays inside the dialog: from the last control it goes to the first, and Shift+Tab the other way.
        const stops = [...panel.current.querySelectorAll<HTMLElement>('input:not(:disabled), select:not(:disabled), textarea:not(:disabled), button:not(:disabled), [href], [tabindex]:not([tabindex="-1"])')].filter((el) => el.offsetParent !== null)
        if (!stops.length) return
        const first = stops[0]
        const last = stops[stops.length - 1]
        const at = document.activeElement
        if (e.shiftKey && (at === first || !panel.current.contains(at))) {
          e.preventDefault()
          last.focus()
        } else if (!e.shiftKey && (at === last || !panel.current.contains(at))) {
          e.preventDefault()
          first.focus()
        }
      }
    }
    window.addEventListener('keydown', onKey, true)
    panel.current?.querySelector<HTMLElement>('input, select, button')?.focus()
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={panel} className={wide ? 'modal wide' : 'modal'} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

function UpdateSettings({ settings, onChange }: { settings: Settings; onChange: (patch: Partial<Settings>) => void }) {
  const [status, setStatus] = useState<UpdateStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const run = async (fn: () => Promise<UpdateStatus>) => {
    setBusy(true)
    try {
      setStatus(await fn())
    } finally {
      setBusy(false)
    }
  }
  const text = (s: UpdateStatus): string =>
    s.state === 'none'
      ? `You have the latest version (${s.current}).`
      : s.state === 'available'
        ? `Version ${s.version} is available (you have ${s.current}).`
        : s.state === 'downloading'
          ? `Downloading… ${s.percent ?? 0}%`
          : s.state === 'ready'
            ? `Version ${s.version} is ready. Restart to install it.`
            : (s.message ?? '')
  return (
    <section aria-label="Updates and privacy">
      <h3 style={{ marginBottom: 4 }}>Updates and privacy</h3>
      <p className="muted small">
        OpenPDF collects no usage data and sends nothing about you or your documents. It uses the network only when you ask it to: for updates (off unless you turn
        them on below), to download an OCR language, to ask a time-stamp server, or to read a plugin catalogue.
      </p>
      <label className="inline">
        <input
          type="checkbox"
          checked={settings.updates.check}
          onChange={(e) => onChange({ updates: { ...settings.updates, check: e.target.checked } })}
        />{' '}
        Check for updates when OpenPDF starts
      </label>
      <div className="form-grid" style={{ marginTop: 6 }}>
        <label htmlFor="set-update-feed">Update address (optional)</label>
        <input
          id="set-update-feed"
          placeholder="Leave empty to use OpenPDF's GitHub releases"
          value={settings.updates.feed}
          onChange={(e) => onChange({ updates: { ...settings.updates, feed: e.target.value } })}
        />
      </div>
      <div className="batch-actionbar">
        <button type="button" disabled={busy} onClick={() => void run(() => window.openpdf.checkForUpdates(settings.updates.feed))}>
          Check now
        </button>
        {status?.state === 'available' && (
          <button type="button" disabled={busy} onClick={() => void run(() => window.openpdf.downloadUpdate())}>
            {status.page ? 'Open download page' : 'Download'}
          </button>
        )}
        {status?.state === 'ready' && (
          <button type="button" className="primary" onClick={() => void window.openpdf.installUpdate()}>
            Restart and install
          </button>
        )}
      </div>
      {status && (
        <p role="status" className={status.state === 'error' ? 'error-text' : 'muted'}>
          {text(status)}
        </p>
      )}
    </section>
  )
}

export function SettingsDialog({
  settings,
  onChange,
  onClose
}: {
  settings: Settings
  onChange: (patch: Partial<Settings>) => void
  onClose: () => void
}) {
  return (
    <Modal title={t('Settings')} onClose={onClose}>
      <div className="form-grid">
        <label htmlFor="set-theme">Theme</label>
        <select id="set-theme" value={settings.theme} onChange={(e) => onChange({ theme: e.target.value as Settings['theme'] })}>
          <option value="system">Same as Windows</option>
          <option value="dark">Dark</option>
          <option value="light">Light</option>
        </select>
        <label htmlFor="set-language">{t('Language')}</label>
        <select id="set-language" value={settings.language} onChange={(e) => onChange({ language: e.target.value })}>
          <option value="system">{t('Same as Windows')}</option>
          {languages().map((l) => (
            <option key={l.code} value={l.code}>
              {l.name}
            </option>
          ))}
        </select>
        <label htmlFor="set-author">Author name for comments</label>
        <input id="set-author" value={settings.author} onChange={(e) => onChange({ author: e.target.value })} />
        <label htmlFor="set-autosave">Recovery snapshot of unsaved work</label>
        <select id="set-autosave" value={settings.autosaveMinutes} onChange={(e) => onChange({ autosaveMinutes: Number(e.target.value) })}>
          <option value={0}>Off</option>
          {[1, 2, 5, 10].map((m) => (
            <option key={m} value={m}>
              Every {m} minute{m === 1 ? '' : 's'}
            </option>
          ))}
          {![0, 1, 2, 5, 10].includes(settings.autosaveMinutes) && <option value={settings.autosaveMinutes}>Every {settings.autosaveMinutes} minutes</option>}
        </select>
      </div>
      <label className="inline" style={{ marginTop: 10 }}>
        <input type="checkbox" checked={settings.spellcheck} onChange={(e) => onChange({ spellcheck: e.target.checked })} /> Check spelling in text boxes (right-click a word for suggestions)
      </label>
      <p className="muted small">
        Recovery snapshots are kept only until you save or close a document. After a crash they are offered back the next
        time OpenPDF starts.
      </p>
      <UpdateSettings settings={settings} onChange={onChange} />
    </Modal>
  )
}

export const SHORTCUTS: [string, string][] = [
  ['Ctrl+O', 'Open'],
  ['Ctrl+S', 'Save'],
  ['Ctrl+Shift+S', 'Save a copy'],
  ['Ctrl+P', 'Print'],
  ['Ctrl+W', 'Close tab'],
  ['Ctrl+Tab / Ctrl+Shift+Tab', 'Next / previous tab'],
  ['Ctrl+F', 'Find'],
  ['Ctrl+Shift+F', 'Search in files (open documents or a folder)'],
  ['F3 / Shift+F3, Ctrl+G', 'Next / previous match'],
  ['Ctrl+C', 'Copy selected text'],
  ['Ctrl+Z / Ctrl+Y', 'Undo / redo'],
  ['Delete', 'Delete the selected annotation or pages'],
  ['Ctrl++ / Ctrl+−', 'Zoom in / out'],
  ['Ctrl+0', 'Fit width'],
  ['Ctrl+1', 'Actual size'],
  ['Ctrl+Shift++ / Ctrl+Shift+−', 'Rotate view clockwise / anticlockwise'],
  ['F5', 'Present (full screen); arrows, space or click to move, Esc to leave'],
  ['Ctrl+H', 'Reading mode (hide the ribbon and side pane)'],
  ['Esc', 'Close find, back to the Select tool, clear selection'],
  ['F1', 'This list']
]

export function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  return (
    <Modal title={t('Keyboard shortcuts')} onClose={onClose}>
      <table className="shortcuts">
        <tbody>
          {SHORTCUTS.map(([k, what]) => (
            <tr key={k}>
              <td>
                <kbd>{k}</kbd>
              </td>
              <td>{what}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Modal>
  )
}
