import { useEffect, useRef, type ReactNode } from 'react'
import type { Settings } from '../../preload'

/** A centred modal panel. Esc and a click on the backdrop close it. */
export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const panel = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey, true)
    panel.current?.querySelector<HTMLElement>('input, select, button')?.focus()
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={panel} className="modal" role="dialog" aria-modal="true" aria-label={title}>
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
    <Modal title="Settings" onClose={onClose}>
      <div className="form-grid">
        <label htmlFor="set-theme">Theme</label>
        <select id="set-theme" value={settings.theme} onChange={(e) => onChange({ theme: e.target.value as Settings['theme'] })}>
          <option value="system">Same as Windows</option>
          <option value="dark">Dark</option>
          <option value="light">Light</option>
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
      <p className="muted small">
        Recovery snapshots are kept only until you save or close a document. After a crash they are offered back the next
        time OpenPDF starts.
      </p>
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
  ['Esc', 'Close find, back to the Select tool, clear selection'],
  ['F1', 'This list']
]

export function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="Keyboard shortcuts" onClose={onClose}>
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
