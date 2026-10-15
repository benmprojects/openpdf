import { useCallback, useEffect, useRef, useState } from 'react'
import type { RecoveryEntry, Settings } from '../../preload'
import { CircleHelp, FileSearch, FileText, FolderOpen, History, Plus, Settings2, X } from 'lucide-react'
import { SettingsDialog, ShortcutsDialog } from './AppDialogs'
import type { SearchSource } from './multiSearch'
import { SearchPanel, type SearchJump } from './SearchPanel'
import { Logo } from './Logo'
import { IconButton } from './Ribbon'
import { DocView, type DocMeta } from './DocView'

interface Tab {
  id: number
  name: string
  path?: string
  data: Uint8Array
  /** Has annotations that are not saved yet. */
  dirty: boolean
  recovered?: boolean
  /** A search-in-files result to show: set the find bar and go to that match. */
  jump?: SearchJump
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
              <FileText className="recent-icon" size={18} strokeWidth={1.6} aria-hidden />
              <span className="recent-text">
                <span className="recent-name">{p.slice(cut + 1)}</span>
                <span className="recent-dir">{p.slice(0, cut)}</span>
              </span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}

const NO_DEFAULTS = {}
const NO_PRESETS: [] = []

export function App() {
  const [tabs, setTabs] = useState<Tab[]>([])
  const [activeId, setActiveId] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const [settings, setSettings] = useState<Settings | null>(null)
  const [dialog, setDialog] = useState<'settings' | 'shortcuts' | null>(null)
  const [recentOpen, setRecentOpen] = useState(false)
  const [recovery, setRecovery] = useState<RecoveryEntry[]>([])
  const [searchPanel, setSearchPanel] = useState(false)
  const jumpKey = useRef(1)
  const nextId = useRef(1)
  const tabsRef = useRef(tabs)
  tabsRef.current = tabs
  const activeRef = useRef(activeId)
  activeRef.current = activeId

  /** Adds tabs (or focuses ones already open). Returns the id of the tab that ends up in front. */
  const addFiles = useCallback((files: Incoming[]): number | null => {
    if (!files.length) return null
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
    return focus
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
  const setPaneSide = useCallback((side: 'left' | 'right') => changeSettings({ paneSide: side }), [changeSettings])

  // Settings, files opened from Explorer while running, and documents left over from a crash.
  useEffect(() => {
    window.openpdf.getSettings().then(setSettings)
    window.openpdf.recoveryList().then(setRecovery)
    return window.openpdf.onOpenFiles((files) => {
      addFiles(files)
      window.openpdf.getSettings().then(setSettings)
    })
  }, [addFiles])

  /** Opens (or focuses) the document a search result is in and asks it to show that match. */
  const openHit = async (source: SearchSource, j: Omit<SearchJump, 'key'>) => {
    let id = source.path ? (tabsRef.current.find((t) => t.path === source.path)?.id ?? null) : null
    if (id === null && !source.path) id = tabsRef.current.find((t) => t.data === source.data)?.id ?? null
    if (id === null && source.path) {
      try {
        id = addFiles([await window.openpdf.readFile(source.path)])
      } catch {
        setError(`${source.path} could not be opened.`)
        return
      }
    }
    if (id === null) return
    const jump = { ...j, key: jumpKey.current++ }
    setActiveId(id)
    setTabs((list) => list.map((t) => (t.id === id ? { ...t, jump } : t)))
  }

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
      if (k === 'f' && e.shiftKey) {
        e.preventDefault()
        e.stopImmediatePropagation()
        setSearchPanel(true)
      } else if (k === 'o') {
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
      <div className="tabstrip">
        <div className="brand" aria-hidden>
          <Logo size={18} />
        </div>
        <div className="tabs" role="tablist" aria-label="Open documents">
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
              <FileText className="tab-icon" size={14} strokeWidth={1.8} aria-hidden />
              <span className="tab-name">{t.name}</span>
              {t.dirty && <span className="tab-dirty" title="Unsaved changes" aria-label="Unsaved changes" />}
              <button
                className="tab-close"
                aria-label={`Close ${t.name}`}
                title="Close (Ctrl+W)"
                onClick={(e) => {
                  e.stopPropagation()
                  close(t.id)
                }}
              >
                <X size={13} strokeWidth={2} aria-hidden />
              </button>
            </div>
          ))}
          <IconButton icon={Plus} className="tab-new" label="Open file" title="Open (Ctrl+O)" onClick={open} />
        </div>
        <div className="menu-anchor">
          <button
            className="strip-btn"
            onClick={() => setRecentOpen((o) => !o)}
            disabled={!settings?.recent.length}
            aria-expanded={recentOpen}
            title="Recent files"
          >
            <History size={15} strokeWidth={1.8} aria-hidden />
            <span>Recent</span>
          </button>
          {recentOpen && settings && (
            <RecentList paths={settings.recent} onOpen={openRecent} onDismiss={() => setRecentOpen(false)} floating />
          )}
        </div>
 <button
          className="strip-btn"
          onClick={() => setSearchPanel((o) => !o)}
          aria-pressed={searchPanel}
          title="Search in files (Ctrl+Shift+F)"
        >
          <FileSearch size={15} strokeWidth={1.8} aria-hidden />
          <span>Search files</span>
        </button>
        <IconButton icon={Settings2} className="strip-btn" label="Settings" onClick={() => setDialog('settings')} disabled={!settings} />
        <IconButton icon={CircleHelp} className="strip-btn" label="Keyboard shortcuts" title="Keyboard shortcuts (F1)" onClick={() => setDialog('shortcuts')} />
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
      <div className="workspace">
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
            jump={t.jump}
            autosaveMinutes={settings?.autosaveMinutes ?? 0}
            sidebarWidth={settings?.sidebarWidth ?? 220}
            paneSide={settings?.paneSide ?? 'left'}
            onPaneSide={setPaneSide}
            onSidebarWidth={setSidebarWidth}
            onOpen={open}
            onNewDoc={(name, data) => addFiles([{ name, data, recovered: true }])}
            onCloseDoc={() => close(t.id)}
            author={settings?.author ?? ''}
            toolDefaults={settings?.toolDefaults ?? NO_DEFAULTS}
            toolPresets={settings?.toolPresets ?? NO_PRESETS}
            onSettings={changeSettings}
          />
        ))}
        {!tabs.length && (
          <div className="empty welcome">
            <div className="welcome-card">
              <div className="welcome-head">
                <Logo size={44} />
                <div>
                  <h1>OpenPDF</h1>
                  <p className="muted">Open, read, mark up and organise PDF documents.</p>
                </div>
              </div>
              <div className="welcome-actions">
                <button className="primary big" onClick={open}>
                  <FolderOpen size={18} strokeWidth={1.8} aria-hidden />
                  Open a PDF…
                </button>
                <span className="muted small">or drag files onto this window · Ctrl+O</span>
              </div>
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
      {searchPanel && (
        <SearchPanel
          openDocs={tabs.map((t) => ({ name: t.name, path: t.path, data: t.data }))}
          onOpenHit={(source, j) => void openHit(source, j)}
          onClose={() => setSearchPanel(false)}
        />
      )}
      </div>
    </div>
  )
}
