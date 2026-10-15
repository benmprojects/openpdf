import { useCallback, useEffect, useRef, useState } from 'react'
import type { RecoveryEntry, Settings } from '../../preload'
import { SettingsDialog, ShortcutsDialog } from './AppDialogs'
import { DocView, type DocMeta } from './DocView'

interface Tab {
  id: number
  name: string
  path?: string
  data: Uint8Array
  /** Has annotations that are not saved yet. */
  dirty: boolean
  recovered?: boolean
}

interface Incoming {
  name: string
  path?: string
  data: Uint8Array
  recovered?: boolean
}

function RecentList({
  paths,
  onOpen,
  onDismiss,
  floating
}: {
  paths: string[]
  onOpen: (path: string) => void
  onDismiss?: () => void
  floating?: boolean
}) {
  useEffect(() => {
    if (!onDismiss) return
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !(e.target as HTMLElement).closest('.menu-anchor')) onDismiss()
    }
    window.addEventListener('mousedown', close)
    window.addEventListener('keydown', close)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('keydown', close)
    }
  }, [onDismiss])
  return (
    <ul className={floating ? 'recent-list floating' : 'recent-list'} role="menu" aria-label="Recent files">
      {paths.map((p) => {
        const cut = Math.max(p.lastIndexOf('\\'), p.lastIndexOf('/'))
        return (
          <li key={p} role="none">
            <button role="menuitem" onClick={() => onOpen(p)} title={p}>
              <span className="recent-name">{p.slice(cut + 1)}</span>
              <span className="recent-dir">{p.slice(0, cut)}</span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}

export function App() {
  const [tabs, setTabs] = useState<Tab[]>([])
  const [activeId, setActiveId] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const [settings, setSettings] = useState<Settings | null>(null)
  const [dialog, setDialog] = useState<'settings' | 'shortcuts' | null>(null)
  const [recentOpen, setRecentOpen] = useState(false)
  const [recovery, setRecovery] = useState<RecoveryEntry[]>([])
  const nextId = useRef(1)
  const tabsRef = useRef(tabs)
  tabsRef.current = tabs
  const activeRef = useRef(activeId)
  activeRef.current = activeId

  const addFiles = useCallback((files: Incoming[]) => {
    if (!files.length) return
    let focus: number | null = null
    const fresh: Tab[] = []
    for (const f of files) {
      // A file that is already open is brought to the front instead of opening a second copy.
      const existing = f.path && !f.recovered ? tabsRef.current.find((t) => t.path === f.path) : undefined
      if (existing) {
        focus = existing.id
        continue
      }
      const tab: Tab = { id: nextId.current++, name: f.name, path: f.path, data: f.data, dirty: !!f.recovered, recovered: f.recovered }
      fresh.push(tab)
      focus = tab.id
    }
    if (fresh.length) setTabs((t) => [...t, ...fresh])
    if (focus !== null) setActiveId(focus)
  }, [])

  const open = useCallback(async () => {
    setError(null)
    addFiles(await window.openpdf.openFileDialog())
    window.openpdf.getSettings().then(setSettings)
  }, [addFiles])

  const openRecent = useCallback(
    async (path: string) => {
      setRecentOpen(false)
      setError(null)
      const f = await window.openpdf.openRecent(path)
      if (f) addFiles([f])
      else setError(`${path} could not be opened, so it was removed from the recent list.`)
      setSettings(await window.openpdf.getSettings())
    },
    [addFiles]
  )

  const changeSettings = useCallback((patch: Partial<Settings>) => {
    setSettings((s) => (s ? { ...s, ...patch } : s))
    void window.openpdf.setSettings(patch).then(setSettings)
  }, [])

  // Opening, saving and closing documents change the recent list in the main process; fetch it again then.
  const pathsKey = tabs.map((t) => t.path ?? '').join('|')
  useEffect(() => {
    window.openpdf.getSettings().then(setSettings)
  }, [pathsKey])

  const setSidebarWidth = useCallback((w: number) => changeSettings({ sidebarWidth: w }), [changeSettings])

  // Settings, files opened from Explorer while running, and documents left over from a crash.
  useEffect(() => {
    window.openpdf.getSettings().then(setSettings)
    window.openpdf.recoveryList().then(setRecovery)
    return window.openpdf.onOpenFiles((files) => {
      addFiles(files)
      window.openpdf.getSettings().then(setSettings)
    })
  }, [addFiles])

  const restoreRecovered = async () => {
    const list = recovery
    setRecovery([])
    const files: Incoming[] = []
    for (const r of list) {
      try {
        files.push({ name: r.name, path: r.path, data: await window.openpdf.recoveryRead(r.key), recovered: true })
      } catch {
        // A snapshot that cannot be read is skipped.
      }
    }
    await window.openpdf.recoveryClearAll()
    addFiles(files)
  }

  const discardRecovered = () => {
    setRecovery([])
    void window.openpdf.recoveryClearAll()
  }

  const updateMeta = useCallback((id: number, meta: DocMeta) => {
    setTabs((list) => {
      const t = list.find((x) => x.id === id)
      if (!t || (meta.dirty ?? t.dirty) === t.dirty && (meta.name ?? t.name) === t.name && (meta.path ?? t.path) === t.path) return list
      return list.map((x) => (x.id === id ? { ...x, ...meta } : x))
    })
  }, [])

  const close = useCallback((id: number) => {
    const list = tabsRef.current
    const idx = list.findIndex((t) => t.id === id)
    if (idx < 0) return
    if (list[idx].dirty && !window.confirm(`${list[idx].name} has unsaved changes. Close it and discard them?`)) return
    const rest = list.filter((t) => t.id !== id)
    setTabs(rest)
    if (activeRef.current === id) setActiveId(rest.length ? rest[Math.min(idx, rest.length - 1)].id : null)
  }, [])

  const anyDirty = tabs.some((t) => t.dirty)
  useEffect(() => {
    if (!anyDirty) return
    const block = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', block)
    return () => window.removeEventListener('beforeunload', block)
  }, [anyDirty])

  const initDone = useRef(false)
  useEffect(() => {
    if (initDone.current) return // StrictMode runs effects twice in development
    initDone.current = true
    window.openpdf.initialFiles().then(addFiles)
  }, [addFiles])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'F1') {
        e.preventDefault()
        setDialog('shortcuts')
        return
      }
      if (!(e.ctrlKey || e.metaKey)) return
      const k = e.key.toLowerCase()
      if (k === 'o') {
        e.preventDefault()
        void open()
      } else if (k === 'w' && activeRef.current !== null) {
        e.preventDefault()
        close(activeRef.current)
      } else if (k === 'tab' && tabsRef.current.length > 1) {
        e.preventDefault()
        const list = tabsRef.current
        const i = list.findIndex((t) => t.id === activeRef.current)
        setActiveId(list[(i + (e.shiftKey ? -1 : 1) + list.length) % list.length].id)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, close])

  const onDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault()
      setDragging(false)
      const all = Array.from(e.dataTransfer.files)
      const pdfs = all.filter((f) => f.name.toLowerCase().endsWith('.pdf'))
      setError(all.length > pdfs.length ? 'Only PDF files can be opened.' : null)
      addFiles(await Promise.all(pdfs.map(async (f) => ({ name: f.name, data: new Uint8Array(await f.arrayBuffer()) }))))
    },
    [addFiles]
  )

  return (
    <div
      className="app"
      onDragOver={(e) => {
        e.preventDefault()
        setDragging(true)
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDragging(false)
      }}
      onDrop={onDrop}
    >
      <div className="tabstrip" role="tablist" aria-label="Open documents">
        {tabs.map((t) => (
          <div
            key={t.id}
            className={t.id === activeId ? 'tab active' : 'tab'}
            role="tab"
            aria-selected={t.id === activeId}
            title={t.path ?? t.name}
            onClick={() => setActiveId(t.id)}
            onAuxClick={(e) => e.button === 1 && close(t.id)}
          >
            <span className="tab-name">
              {t.dirty && (
                <span className="tab-dirty" title="Unsaved changes" aria-label="Unsaved changes">
                  •{' '}
                </span>
              )}
              {t.name}
            </span>
            <button
              className="tab-close"
              aria-label={`Close ${t.name}`}
              onClick={(e) => {
                e.stopPropagation()
                close(t.id)
              }}
            >
              ✕
            </button>
          </div>
        ))}
        <button className="tab-new" onClick={open} title="Open (Ctrl+O)" aria-label="Open file">
          +
        </button>
        <span className="tabstrip-fill" />
        <div className="menu-anchor">
          <button
            className="strip-btn"
            onClick={() => setRecentOpen((o) => !o)}
            disabled={!settings?.recent.length}
            aria-expanded={recentOpen}
            title="Recent files"
          >
            Recent ▾
          </button>
          {recentOpen && settings && (
            <RecentList paths={settings.recent} onOpen={openRecent} onDismiss={() => setRecentOpen(false)} floating />
          )}
        </div>
        <button className="strip-btn" onClick={() => setDialog('settings')} disabled={!settings} title="Settings" aria-label="Settings">
          ⚙
        </button>
        <button className="strip-btn" onClick={() => setDialog('shortcuts')} title="Keyboard shortcuts (F1)" aria-label="Keyboard shortcuts">
          ?
        </button>
      </div>
      {recovery.length > 0 && (
        <div className="recovery-bar" role="alert">
          <span>
            OpenPDF closed unexpectedly. Unsaved work was recovered for {recovery.map((r) => r.name).join(', ')}.
          </span>
          <button className="primary" onClick={() => void restoreRecovered()}>
            Restore
          </button>
          <button onClick={discardRecovered}>Discard</button>
        </div>
      )}
      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}
      {dialog === 'settings' && settings && <SettingsDialog settings={settings} onChange={changeSettings} onClose={() => setDialog(null)} />}
      {dialog === 'shortcuts' && <ShortcutsDialog onClose={() => setDialog(null)} />}
      <main className="content">
        {tabs.map((t) => (
          <DocView
            key={t.id}
            id={t.id}
            data={t.data}
            name={t.name}
            path={t.path}
            active={t.id === activeId}
            onMeta={updateMeta}
            recovered={t.recovered}
            autosaveMinutes={settings?.autosaveMinutes ?? 0}
            sidebarWidth={settings?.sidebarWidth ?? 220}
            onSidebarWidth={setSidebarWidth}
            onOpen={open}
            onCloseDoc={() => close(t.id)}
          />
        ))}
        {!tabs.length && (
          <div className="empty">
            <div>
              <p>Open a PDF, or drop one here.</p>
              <button className="primary" onClick={open}>
                Open…
              </button>
              {!!settings?.recent.length && (
                <>
                  <h3>Recent files</h3>
                  <RecentList paths={settings.recent} onOpen={openRecent} />
                </>
              )}
            </div>
          </div>
        )}
        {dragging && <div className="drop-overlay">Drop PDFs to open</div>}
      </main>
    </div>
  )
}
