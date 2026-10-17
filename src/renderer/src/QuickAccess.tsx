import { useEffect, useState } from 'react'
import { ArrowLeftRight, ChevronDown, Expand, Hand, MousePointer2, Printer, Redo2, RotateCcw, RotateCw, Save, SaveAll, Search, SlidersHorizontal, StickyNote, Type, Undo2, X, ZoomIn, ZoomOut, FolderOpen, Presentation, BookOpen, type LucideIcon } from 'lucide-react'
import { IconButton } from './Ribbon'
import { QUICK_ACCESS_MAX, moveItem, toggleQuickAccess } from '../../shared/prefs'
import { msg, t } from './i18n'

/** Every command that can sit on the quick-access toolbar: a stable id (saved in Settings), its name and its icon. */
export const QUICK_COMMANDS: { id: string; label: string; icon: LucideIcon }[] = [
  { id: 'open', label: msg('Open'), icon: FolderOpen },
  { id: 'save', label: msg('Save'), icon: Save },
  { id: 'saveas', label: msg('Save as'), icon: SaveAll },
  { id: 'print', label: msg('Print'), icon: Printer },
  { id: 'undo', label: msg('Undo'), icon: Undo2 },
  { id: 'redo', label: msg('Redo'), icon: Redo2 },
  { id: 'find', label: msg('Find'), icon: Search },
  { id: 'select', label: msg('Select tool'), icon: MousePointer2 },
  { id: 'hand', label: msg('Hand tool'), icon: Hand },
  { id: 'note', label: msg('Note'), icon: StickyNote },
  { id: 'textbox', label: msg('Text box'), icon: Type },
  { id: 'zoomin', label: msg('Zoom in'), icon: ZoomIn },
  { id: 'zoomout', label: msg('Zoom out'), icon: ZoomOut },
  { id: 'fitwidth', label: msg('Fit width'), icon: ArrowLeftRight },
  { id: 'fitpage', label: msg('Fit page'), icon: Expand },
  { id: 'rotateleft', label: msg('Rotate view left'), icon: RotateCcw },
  { id: 'rotateright', label: msg('Rotate view right'), icon: RotateCw },
  { id: 'present', label: msg('Present'), icon: Presentation },
  { id: 'properties', label: msg('Properties'), icon: SlidersHorizontal },
  { id: 'reading', label: msg('Reading mode'), icon: BookOpen },
  { id: 'close', label: msg('Close'), icon: X }
]

export interface QuickState {
  run: () => void
  disabled?: boolean
  pressed?: boolean
}

/**
 * The quick-access toolbar: the chosen commands as icon buttons on the ribbon's tab row, and a menu to choose and order them
 * and to open the ribbon customisation. The commands themselves live in the document view (`state`).
 */
export function QuickAccess({ ids, state, onChange, onCustomiseRibbon }: { ids: string[]; state: Record<string, QuickState>; onChange: (ids: string[]) => void; onCustomiseRibbon: () => void }) {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !(e.target as HTMLElement).closest('.qat-menu, .qat-more')) setOpen(false)
    }
    window.addEventListener('mousedown', close)
    window.addEventListener('keydown', close)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('keydown', close)
    }
  }, [open])
  const known = ids.filter((id) => QUICK_COMMANDS.some((c) => c.id === id))
  return (
    <div className="qat" role="toolbar" aria-label={t('Quick access')}>
      {known.map((id) => {
        const c = QUICK_COMMANDS.find((x) => x.id === id)!
        const s = state[id]
        // The name says where the button is, so it is not mistaken for the ribbon button of the same name.
        return <IconButton key={id} icon={c.icon} label={t('{name} (quick access)', { name: t(c.label) })} onClick={s?.run} disabled={!s || s.disabled} pressed={s?.pressed} />
      })}
      <span className="qat-more">
        <IconButton icon={ChevronDown} label={t('Customise quick access')} title={t('Choose the commands on the quick-access toolbar')} onClick={() => setOpen((o) => !o)} pressed={open} />
      </span>
      {open && (
        <div className="qat-menu" role="dialog" aria-label={t('Customise quick access')}>
          <p className="muted small">{t('Tick the commands to show. Use the arrows to change their order.')}</p>
          <ul>
            {QUICK_COMMANDS.map((c) => {
              const at = known.indexOf(c.id)
              return (
                <li key={c.id}>
                  <label>
                    <input type="checkbox" checked={at >= 0} disabled={at < 0 && known.length >= QUICK_ACCESS_MAX} onChange={() => onChange(toggleQuickAccess(known, c.id))} />
                    <c.icon size={14} strokeWidth={1.8} aria-hidden /> {t(c.label)}
                  </label>
                  {at >= 0 && (
                    <span className="qat-order">
                      <button type="button" aria-label={t('Move {name} earlier', { name: t(c.label) })} disabled={at === 0} onClick={() => onChange(moveItem(known, at, -1))}>
                        ←
                      </button>
                      <button type="button" aria-label={t('Move {name} later', { name: t(c.label) })} disabled={at === known.length - 1} onClick={() => onChange(moveItem(known, at, 1))}>
                        →
                      </button>
                    </span>
                  )}
                </li>
              )
            })}
          </ul>
          <div className="qat-foot">
            <button type="button" onClick={() => (setOpen(false), onCustomiseRibbon())}>
              {t('Customise the ribbon…')}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
