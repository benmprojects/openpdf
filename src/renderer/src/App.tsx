import { useCallback, useEffect, useRef, useState } from 'react'
import type { Place } from '../../shared/places'
import type { RecoveryEntry, Settings } from '../../preload'
import { Cloud, CircleHelp, FileSearch, FileText, FolderOpen, History, Settings2 } from 'lucide-react'
import { SettingsDialog, ShortcutsDialog } from './AppDialogs'
import type { SearchSource } from './multiSearch'
import { SearchPanel, type SearchJump } from './SearchPanel'
import { Logo } from './Logo'
import { OpenUrlDialog } from './FileDialogs'
import { IconButton } from './Ribbon'
import { DocView, type DocMeta } from './DocView'
import { prefsFrom, useStable } from './appPrefs'
import { DocTabs, TAB_MIME, type TabActions } from './DocTabs'
import { addToGroup, idsToClose, moveTab, nextGroupColour, nextGroupId, freshGroupName, pruneGroups, removeFromGroup, type CloseScope, type TabGroup } from './tabGroups'
import { setRenderJobs } from './pdfClient'
import { addCatalogues, setLanguage, t, useLanguage } from './i18n'

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
  /** The tab group it belongs to. */
  group?: number
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

function PlacesList({ places, onPick, onDismiss }: { places: Place[] | null; onPick: (p: Place) => void; onDismiss: () => void }) {
  useEffect(() => {
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
    <ul className="recent-list floating" role="menu" aria-label="Places">
      {places === null && <li className="muted" style={{ padding: '8px 12px' }}>Looking for synced folders…</li>}
      {places?.length === 0 && <li className="muted" style={{ padding: '8px 12px' }}>No synced OneDrive, SharePoint, Google Drive or Dropbox folders were found.</li>}
      {places?.map((p) => (
        <li key={p.path} role="none">
          <button role="menuitem" onClick={() => onPick(p)} title={p.path}>
            <Cloud className="recent-icon" size={18} strokeWidth={1.6} aria-hidden />
            <span className="recent-text">
              <span className="recent-name">{p.label}</span>
              <span className="recent-dir">{p.path}</span>
            </span>
          </button>
        </li>
      ))}
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
  const [placesOpen, setPlacesOpen] = useState(false)
  const [places, setPlaces] = useState<Place[] | null>(null)
  const [recovery, setRecovery] = useState<RecoveryEntry[]>([])
  const [searchPanel, setSearchPanel] = useState(false)
  const [groups, setGroups] = useState<TabGroup[]>([])
  // A window opened for a moved tab has its own tabs only: it neither restores nor saves the session, and does not offer crash recovery.
  const secondary = useRef(new URLSearchParams(window.location.search).has('secondary')).current
  useLanguage() // re-render everything below when the language changes
  const [catalogues, setCatalogues] = useState(false)
  useEffect(() => {
    // Translations the user added come first, so choosing one of them works from the start.
    void window.openpdf.userLocales().then((c) => addCatalogues(c), () => undefined).finally(() => setCatalogues(true))
  }, [])
  useEffect(() => {
    if (settings && catalogues) setLanguage(settings.language)
  }, [settings?.language, catalogues]) // eslint-disable-line react-hooks/exhaustive-deps
  const prefs = useStable(prefsFrom(settings))
  useEffect(() => setRenderJobs(prefs.performance.renderJobs), [prefs.performance.renderJobs])
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
    if (!secondary) window.openpdf.recoveryList().then(setRecovery)
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
      // A path of null means the file is gone (moved to the Recycle Bin): the document carries on as an unsaved one.
      const path = meta.path === null ? undefined : (meta.path ?? t?.path)
      if (!t || ((meta.dirty ?? t.dirty) === t.dirty && (meta.name ?? t.name) === t.name && path === t.path)) return list
      return list.map((x) => (x.id === id ? { ...x, ...meta, path } : x))
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

  /** Closes several tabs at once, asking once when some have unsaved changes. */
  const closeIds = useCallback((ids: number[]) => {
    const list = tabsRef.current
    const doomed = list.filter((t) => ids.includes(t.id))
    if (!doomed.length) return
    const dirty = doomed.filter((t) => t.dirty)
    if (dirty.length && !window.confirm(dirty.length === 1 ? `${dirty[0].name} has unsaved changes. Close it and discard them?` : `${dirty.length} documents have unsaved changes. Close them and discard the changes?`)) return
    const rest = list.filter((t) => !ids.includes(t.id))
    setTabs(rest)
    if (activeRef.current !== null && ids.includes(activeRef.current)) {
      // The nearest tab that stays: the next one along, else the one before.
      const at = list.findIndex((t) => t.id === activeRef.current)
      const next = list.slice(at).find((t) => !ids.includes(t.id)) ?? [...list.slice(0, at)].reverse().find((t) => !ids.includes(t.id))
      setActiveId(next?.id ?? null)
    }
  }, [])

  // Groups with no tabs left go away.
  useEffect(() => {
    setGroups((g) => {
      const kept = pruneGroups(tabs, g)
      return kept.length === g.length ? g : kept
    })
  }, [tabs])

  /** A saved document moves to a window of its own (and leaves this one). */
  const toNewWindow = useCallback(async (id: number) => {
    const tab = tabsRef.current.find((t) => t.id === id)
    if (!tab) return
    if (!tab.path) return setError(`${tab.name} has not been saved yet. Save it first, then open it in a new window.`)
    if (tab.dirty) return setError(`${tab.name} has unsaved changes. Save it first, then open it in a new window.`)
    setError(null)
    try {
      await window.openpdf.openInNewWindow({ name: tab.name, path: tab.path })
      setTabs((list) => list.filter((t) => t.id !== id))
      if (activeRef.current === id) {
        const rest = tabsRef.current.filter((t) => t.id !== id)
        setActiveId(rest.length ? rest[Math.min(tabsRef.current.findIndex((t) => t.id === id), rest.length - 1)].id : null)
      }
    } catch {
      setError(`${tab.name} could not be opened in a new window.`)
    }
  }, [])

  const tabActions: TabActions = {
    onActivate: setActiveId,
    onClose: (id) => close(id),
    onNew: () => void open(),
    onMove: (id, before) => setTabs((list) => moveTab(list, id, before)),
    onNewWindow: (id) => void toNewWindow(id),
    onCloseMany: (id, scope: CloseScope) => closeIds(idsToClose(tabsRef.current, id, scope)),
    onAddToGroup: (id, group) => {
      let target = group
      if (target === null) {
        target = nextGroupId(groups)
        setGroups((g) => [...g, { id: target as number, name: freshGroupName(g, t('Group')), colour: nextGroupColour(g), collapsed: false }])
      }
      setTabs((list) => addToGroup(list, [id], target as number))
    },
    onRemoveFromGroup: (id) => setTabs((list) => removeFromGroup(list, id)),
    onToggleGroup: (group) => setGroups((g) => g.map((x) => (x.id === group ? { ...x, collapsed: !x.collapsed } : x))),
    onRenameGroup: (group, name) => setGroups((g) => g.map((x) => (x.id === group ? { ...x, name } : x))),
    onGroupColour: (group, colour) => setGroups((g) => g.map((x) => (x.id === group ? { ...x, colour } : x))),
    onUngroup: (group) => setTabs((list) => list.reduce<Tab[]>((out, tb) => (tb.group === group ? [...out, removeFromGroup([tb], tb.id)[0]] : [...out, tb]), [])),
    onCloseGroup: (group) => closeIds(tabsRef.current.filter((tb) => tb.group === group).map((tb) => tb.id))
  }

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

  // ---- Session: the saved documents that were open, to reopen next time ----
  /** What was open when OpenPDF last closed (as read at the start; the saved list changes as tabs do). */
  const [previousSession, setPreviousSession] = useState<string[]>([])
  const [sessionReady, setSessionReady] = useState(false)

  /** Reads the files of a session; the ones that are gone are counted and left out. */
  const readSession = useCallback(async (paths: string[]): Promise<{ files: Incoming[]; missing: number }> => {
    const files: Incoming[] = []
    let missing = 0
    for (const p of paths) {
      if (tabsRef.current.some((t) => t.path === p)) continue
      try {
        files.push(await window.openpdf.readFile(p))
      } catch {
        missing++
      }
    }
    return { files, missing }
  }, [])

  /** The File command: reopen what was open last time, skipping what is open now. */
  const reopenSession = useCallback(async () => {
    setError(null)
    if (!previousSession.length) return setError('There is no earlier session to reopen.')
    const { files, missing } = await readSession(previousSession)
    addFiles(files)
    if (missing) setError(`${missing} of the earlier documents could not be found, so ${missing === 1 ? 'it was' : 'they were'} left out.`)
    else if (!files.length) setError('The documents from the last session are already open.')
  }, [previousSession, readSession, addFiles])

  const initDone = useRef(false)
  useEffect(() => {
    if (initDone.current) return // StrictMode runs effects twice in development
    initDone.current = true
    void (async () => {
      const [initial, s] = await Promise.all([window.openpdf.initialFiles(), window.openpdf.getSettings()])
      setPreviousSession(s.lastSession)
      let restored: Incoming[] = []
      if (s.restoreSession && !secondary) {
        const r = await readSession(s.lastSession.filter((p) => !initial.some((f) => f.path === p)))
        restored = r.files
        if (r.missing) setError(`${r.missing} of the documents from the last session could not be found, so ${r.missing === 1 ? 'it was' : 'they were'} left out.`)
      }
      addFiles([...restored, ...initial])
      setSessionReady(true)
    })()
  }, [addFiles, readSession])

  // Keep the saved list of open documents current (only once the start-up restore has run, so it cannot erase itself).
  useEffect(() => {
    if (!sessionReady || secondary) return
    void window.openpdf.setSettings({ lastSession: tabsRef.current.flatMap((t) => (t.path ? [t.path] : [])) })
  }, [pathsKey, sessionReady])
  const [urlDialog, setUrlDialog] = useState(false)

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
        // A tab being dragged is not a file arriving: no drop overlay, and the window is not a drop target for it
        // (so letting go outside the strip reads as "dragged out").
        if (e.dataTransfer.types.includes(TAB_MIME)) return
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
        <DocTabs tabs={tabs} groups={groups} activeId={activeId} actions={tabActions} />
        <div className="menu-anchor">
          <button
            className="strip-btn"
            onClick={() => {
              setPlacesOpen((o) => !o)
              void window.openpdf.places().then(setPlaces, () => setPlaces([]))
            }}
            aria-expanded={placesOpen}
            title="Open from OneDrive, SharePoint, Google Drive or Dropbox folders synced to this computer"
          >
            <Cloud size={15} strokeWidth={1.8} aria-hidden />
            <span>Places</span>
          </button>
          {placesOpen && (
            <PlacesList
              places={places}
              onPick={async (p) => {
                setPlacesOpen(false)
                setError(null)
                addFiles(await window.openpdf.openFileDialog(p.path))
              }}
              onDismiss={() => setPlacesOpen(false)}
            />
          )}
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
        <IconButton icon={Settings2} className="strip-btn" label={t('Settings')} onClick={() => setDialog('settings')} disabled={!settings} />
        <IconButton icon={CircleHelp} className="strip-btn" label={t('Keyboard shortcuts')} title={t('Keyboard shortcuts (F1)')} onClick={() => setDialog('shortcuts')} />
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
      {dialog === 'settings' && settings && <SettingsDialog settings={settings} onChange={changeSettings} onImported={setSettings} onClose={() => setDialog(null)} />}
      {urlDialog && <OpenUrlDialog onOpen={(f) => addFiles([{ name: f.name, data: f.data, recovered: true }])} onClose={() => setUrlDialog(false)} />}
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
            onOpenUrl={() => setUrlDialog(true)}
            onRestoreSession={() => void reopenSession()}
            onNewDoc={(name, data) => addFiles([{ name, data, recovered: true }])}
            onCloseDoc={() => close(t.id)}
            author={settings?.author ?? ''}
            toolDefaults={settings?.toolDefaults ?? NO_DEFAULTS}
            toolPresets={settings?.toolPresets ?? NO_PRESETS}
            onSettings={changeSettings}
            prefs={prefs}
            onOpenRecovered={(name, path, data) => addFiles([{ name, path, data, recovered: true }])}
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
                <button className="big" onClick={() => setUrlDialog(true)}>
                  {t('Open from URL…')}
                </button>
                <button className="big" onClick={() => void reopenSession()} disabled={!previousSession.length}>
                  {t('Reopen last session')}
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
