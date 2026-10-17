import { useEffect, useRef, useState } from 'react'
import { FileText, Plus, X } from 'lucide-react'
import { IconButton } from './Ribbon'
import { GROUP_COLOURS, shownTabs, type CloseScope, type TabGroup } from './tabGroups'
import { t } from './i18n'

export interface TabInfo {
  id: number
  name: string
  path?: string
  dirty: boolean
  group?: number
}

/** The mime type a dragged tab carries, so drops from elsewhere (files, text) are told apart. */
export const TAB_MIME = 'application/x-openpdf-tab'

export interface TabActions {
  onActivate: (id: number) => void
  onClose: (id: number) => void
  onNew: () => void
  /** Move a tab before another one (or to the end when null). */
  onMove: (id: number, beforeId: number | null) => void
  onNewWindow: (id: number) => void
  onCloseMany: (id: number, scope: CloseScope) => void
  /** Add a tab to a group, or to a new one when `group` is null. */
  onAddToGroup: (id: number, group: number | null) => void
  onRemoveFromGroup: (id: number) => void
  onToggleGroup: (group: number) => void
  onRenameGroup: (group: number, name: string) => void
  onGroupColour: (group: number, colour: string) => void
  onUngroup: (group: number) => void
  onCloseGroup: (group: number) => void
}

type Menu = { kind: 'tab'; id: number; x: number; y: number } | { kind: 'group'; group: number; x: number; y: number }

/** The strip of document tabs: grouping, reordering by drag, a drag out into a window of its own, and a context menu. */
export function DocTabs({ tabs, groups, activeId, actions }: { tabs: TabInfo[]; groups: TabGroup[]; activeId: number | null; actions: TabActions }) {
  const [menu, setMenu] = useState<Menu | null>(null)
  const [dragId, setDragId] = useState<number | null>(null)
  const [overId, setOverId] = useState<number | 'end' | null>(null)
  const strip = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menu) return
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !(e.target as HTMLElement).closest('.tab-menu')) setMenu(null)
    }
    window.addEventListener('mousedown', close)
    window.addEventListener('keydown', close)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('keydown', close)
    }
  }, [menu])

  const shown = shownTabs(tabs, groups, activeId)
  const groupOf = (id: number | undefined) => groups.find((g) => g.id === id)
  const run = (fn: () => void) => () => {
    setMenu(null)
    fn()
  }
  const isTabDrag = (e: React.DragEvent) => e.dataTransfer.types.includes(TAB_MIME)

  return (
    <div className="tabs" role="tablist" aria-label={t('Open documents')} ref={strip}>
      {shown.map((tab, i) => {
        const grp = groupOf(tab.group)
        const startsGroup = grp && (i === 0 || shown[i - 1].group !== tab.group)
        const hiddenInGroup = grp?.collapsed ? tabs.filter((x) => x.group === grp.id && !shown.includes(x)).length : 0
        return (
          <span key={tab.id} className="tab-slot" style={grp ? ({ '--group': grp.colour } as React.CSSProperties) : undefined}>
            {startsGroup && grp && (
              <button
                type="button"
                className="tab-group"
                aria-expanded={!grp.collapsed}
                aria-label={t('Tab group {name}', { name: grp.name })}
                title={grp.collapsed ? t('Show the tabs of this group') : t('Collapse this group (right-click for more)')}
                onClick={() => actions.onToggleGroup(grp.id)}
                onContextMenu={(e) => {
                  e.preventDefault()
                  setMenu({ kind: 'group', group: grp.id, x: e.clientX, y: e.clientY })
                }}
              >
                {grp.name}
                {grp.collapsed && hiddenInGroup > 0 ? ` (+${hiddenInGroup})` : ''}
              </button>
            )}
            <div
              className={`${tab.id === activeId ? 'tab active' : 'tab'}${grp ? ' grouped' : ''}${overId === tab.id && dragId !== tab.id ? ' drop-before' : ''}${dragId === tab.id ? ' dragging' : ''}`}
              role="tab"
              aria-selected={tab.id === activeId}
              title={tab.path ?? tab.name}
              draggable
              onClick={() => actions.onActivate(tab.id)}
              onAuxClick={(e) => e.button === 1 && actions.onClose(tab.id)}
              onContextMenu={(e) => {
                e.preventDefault()
                setMenu({ kind: 'tab', id: tab.id, x: e.clientX, y: e.clientY })
              }}
              onDragStart={(e) => {
                e.dataTransfer.setData(TAB_MIME, String(tab.id))
                e.dataTransfer.effectAllowed = 'move'
                setDragId(tab.id)
              }}
              onDragOver={(e) => {
                if (!isTabDrag(e)) return
                e.preventDefault()
                e.dataTransfer.dropEffect = 'move'
                setOverId(tab.id)
              }}
              onDragLeave={() => setOverId((o) => (o === tab.id ? null : o))}
              onDrop={(e) => {
                if (!isTabDrag(e)) return
                e.preventDefault()
                e.stopPropagation()
                const from = Number(e.dataTransfer.getData(TAB_MIME))
                setOverId(null)
                if (Number.isFinite(from)) actions.onMove(from, tab.id)
              }}
              onDragEnd={(e) => {
                setDragId(null)
                setOverId(null)
                // Let go well away from the strip (or outside the window) and the tab moves to a window of its own.
                const room = strip.current?.getBoundingClientRect()
                const outside = e.clientX < 0 || e.clientY < 0 || e.clientX > window.innerWidth || e.clientY > window.innerHeight
                const below = !!room && e.clientY > room.bottom + 60
                if (e.dataTransfer.dropEffect === 'none' && (outside || below)) actions.onNewWindow(tab.id)
              }}
            >
              <FileText className="tab-icon" size={14} strokeWidth={1.8} aria-hidden />
              <span className="tab-name">{tab.name}</span>
              {tab.dirty && <span className="tab-dirty" title={t('Unsaved changes')} aria-label={t('Unsaved changes')} />}
              <button
                className="tab-close"
                aria-label={t('Close {name}', { name: tab.name })}
                title={t('Close (Ctrl+W)')}
                onClick={(e) => {
                  e.stopPropagation()
                  actions.onClose(tab.id)
                }}
              >
                <X size={13} strokeWidth={2} aria-hidden />
              </button>
            </div>
          </span>
        )
      })}
      <span
        className={`tab-end${overId === 'end' ? ' drop-before' : ''}`}
        onDragOver={(e) => {
          if (!isTabDrag(e)) return
          e.preventDefault()
          setOverId('end')
        }}
        onDragLeave={() => setOverId((o) => (o === 'end' ? null : o))}
        onDrop={(e) => {
          if (!isTabDrag(e)) return
          e.preventDefault()
          const from = Number(e.dataTransfer.getData(TAB_MIME))
          setOverId(null)
          if (Number.isFinite(from)) actions.onMove(from, null)
        }}
      >
        <IconButton icon={Plus} className="tab-new" label={t('Open file')} title={t('Open (Ctrl+O)')} onClick={actions.onNew} />
      </span>
      {menu && (
        <TabMenu
          menu={menu}
          tabs={tabs}
          groups={groups}
          actions={actions}
          run={run}
          onDone={() => setMenu(null)}
        />
      )}
    </div>
  )
}

function TabMenu({
  menu,
  tabs,
  groups,
  actions,
  run,
  onDone
}: {
  menu: Menu
  tabs: TabInfo[]
  groups: TabGroup[]
  actions: TabActions
  run: (fn: () => void) => () => void
  onDone: () => void
}) {
  const style = { left: Math.min(menu.x, window.innerWidth - 230), top: menu.y }
  if (menu.kind === 'group') {
    const g = groups.find((x) => x.id === menu.group)
    if (!g) return null
    return (
      <ul className="tab-menu" role="menu" aria-label={t('Tab group')} style={style}>
        <li role="none">
          <GroupName name={g.name} onRename={(n) => actions.onRenameGroup(g.id, n)} onDone={onDone} />
        </li>
        <li role="none" className="tab-menu-colours" aria-label={t('Group colour')}>
          {GROUP_COLOURS.map((c) => (
            <button key={c} role="menuitemradio" aria-checked={g.colour === c} aria-label={c} className={g.colour === c ? 'swatch on' : 'swatch'} style={{ background: c }} onClick={() => actions.onGroupColour(g.id, c)} />
          ))}
        </li>
        <li role="none">
          <button role="menuitem" onClick={run(() => actions.onUngroup(g.id))}>
            {t('Ungroup')}
          </button>
        </li>
        <li role="none">
          <button role="menuitem" onClick={run(() => actions.onCloseGroup(g.id))}>
            {t('Close group')}
          </button>
        </li>
      </ul>
    )
  }
  const tab = tabs.find((x) => x.id === menu.id)
  if (!tab) return null
  const others = groups.filter((g) => g.id !== tab.group)
  return (
    <ul className="tab-menu" role="menu" aria-label={t('Tab')} style={style}>
      <li role="none">
        <button role="menuitem" onClick={run(() => actions.onNewWindow(tab.id))} disabled={!tab.path}>
          {t('Open in new window')}
        </button>
      </li>
      <li role="separator" className="tab-menu-sep" />
      <li role="none">
        <button role="menuitem" onClick={run(() => actions.onAddToGroup(tab.id, null))}>
          {t('Add to new group')}
        </button>
      </li>
      {others.map((g) => (
        <li role="none" key={g.id}>
          <button role="menuitem" onClick={run(() => actions.onAddToGroup(tab.id, g.id))}>
            <span className="swatch dot" style={{ background: g.colour }} aria-hidden /> {t('Add to {name}', { name: g.name })}
          </button>
        </li>
      ))}
      {tab.group !== undefined && (
        <li role="none">
          <button role="menuitem" onClick={run(() => actions.onRemoveFromGroup(tab.id))}>
            {t('Remove from group')}
          </button>
        </li>
      )}
      <li role="separator" className="tab-menu-sep" />
      <li role="none">
        <button role="menuitem" onClick={run(() => actions.onClose(tab.id))}>
          {t('Close')}
        </button>
      </li>
      <li role="none">
        <button role="menuitem" onClick={run(() => actions.onCloseMany(tab.id, 'others'))} disabled={tabs.length < 2}>
          {t('Close other tabs')}
        </button>
      </li>
      <li role="none">
        <button role="menuitem" onClick={run(() => actions.onCloseMany(tab.id, 'right'))} disabled={tabs[tabs.length - 1]?.id === tab.id}>
          {t('Close tabs to the right')}
        </button>
      </li>
      <li role="none">
        <button role="menuitem" onClick={run(() => actions.onCloseMany(tab.id, 'all'))}>
          {t('Close all tabs')}
        </button>
      </li>
    </ul>
  )
}

function GroupName({ name, onRename, onDone }: { name: string; onRename: (n: string) => void; onDone: () => void }) {
  const [draft, setDraft] = useState(name)
  return (
    <input
      className="tab-menu-input"
      aria-label={t('Group name')}
      value={draft}
      autoFocus
      maxLength={40}
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          if (draft.trim()) onRename(draft.trim())
          onDone()
        }
      }}
      onBlur={() => draft.trim() && draft.trim() !== name && onRename(draft.trim())}
    />
  )
}
