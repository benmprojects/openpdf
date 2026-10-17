import { ClipboardPaste, Download, FileText, ImagePlus, Search, SquareDashedMousePointer, Stamp, Type, Upload } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { t } from './i18n'
import { categoriesOf, CAT_MINE, expandStamp, formatNumber, searchStamps, usesNumber, type Counters, type StampDef, type StampOpts } from './stampLogic'
import { StampThumb } from './StampThumb'

/** What the palette hands back when the user picks a stamp. */
export type StampChoice = StampDef

export type NewStampKind = 'text' | 'picture' | 'pdf' | 'selection' | 'clipboard'

interface Props {
  choice: StampChoice
  dated: boolean
  stamps: StampDef[]
  recent: string[]
  counters: Counters
  author: string
  opts: StampOpts
  onOpts: (o: StampOpts) => void
  onPick: (c: StampChoice) => void
  onDated: (on: boolean) => void
  onNew: (kind: NewStampKind) => void
  onEdit: (s: StampDef) => void
  onDelete: (s: StampDef) => void
  onPages: (s: StampDef) => void
  onImport: () => void
  onExport: () => void
  onClose: () => void
}

/** The text a stamp would show if placed now (the next number is shown but not used up). */
export function previewLines(s: StampDef, author: string, counters: Counters): { title: string; detail: string } {
  const number = usesNumber(s.title, s.detail) ? formatNumber(s.numberPrefix, counters[s.id] ?? s.numberStart ?? 1, s.numberDigits) : undefined
  return expandStamp(s, { author, now: new Date(), number })
}

/** The stamp palette: search, recently used, categories with thumbnails, my own stamps, and placement options. */
export function StampPicker({ choice, dated, stamps, recent, counters, author, opts, onOpts, onPick, onDated, onNew, onEdit, onDelete, onPages, onImport, onExport, onClose }: Props) {
  const panel = useRef<HTMLDivElement>(null)
  const [query, setQuery] = useState('')
  const [menu, setMenu] = useState<{ s: StampDef; x: number; y: number } | null>(null)
  useEffect(() => {
    const away = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent) {
        if (e.key !== 'Escape') return
        if (menu) setMenu(null)
        else onClose()
      } else if (!panel.current?.contains(e.target as Node)) onClose()
      else if (menu && !(e.target as HTMLElement).closest('.stamp-menu')) setMenu(null)
    }
    // Wait a tick so the click that opened the picker does not close it.
    const timer = setTimeout(() => {
      window.addEventListener('mousedown', away)
      window.addEventListener('keydown', away)
    })
    return () => {
      clearTimeout(timer)
      window.removeEventListener('mousedown', away)
      window.removeEventListener('keydown', away)
    }
  }, [onClose, menu])

  const found = useMemo(() => searchStamps(stamps, query), [stamps, query])
  const cats = useMemo(() => categoriesOf(stamps), [stamps])
  const recents = useMemo(() => recent.map((id) => stamps.find((s) => s.id === id)).filter((s): s is StampDef => !!s), [recent, stamps])
  const searching = query.trim() !== ''

  const tile = (s: StampDef, label: string) => {
    const p = previewLines(s, author, counters)
    return (
      <button
        key={`${label}${s.id}`}
        className={choice.id === s.id ? 'stamp-tile on' : 'stamp-tile'}
        onClick={() => onPick(s)}
        onContextMenu={(e) => {
          e.preventDefault()
          const box = panel.current?.getBoundingClientRect()
          setMenu({ s, x: e.clientX - (box?.left ?? 0), y: e.clientY - (box?.top ?? 0) })
        }}
        title={s.kind === 'image' ? s.name : `${s.name}. ${t('Right-click for more')}`}
        aria-label={label}
      >
        <StampThumb def={s} title={p.title} detail={p.detail} />
        <span className="stamp-tile-name">{s.name}</span>
      </button>
    )
  }
  const ariaOf = (s: StampDef) => (s.kind === 'image' ? `Image stamp ${s.name}` : s.builtin ? s.title : `Stamp ${s.name}`)

  return (
    <div ref={panel} className="stamp-picker" role="dialog" aria-label="Stamps">
      <label className="stamp-search">
        <Search size={14} aria-hidden />
        <input type="search" aria-label={t('Search stamps')} placeholder={t('Search stamps')} value={query} onChange={(e) => setQuery(e.target.value)} />
      </label>
      <div className="stamp-scroll">
        {!searching && recents.length > 0 && (
          <section>
            <h4>{t('Recently used')}</h4>
            <div className="stamp-tiles">{recents.map((s) => tile(s, `Recently used: ${s.name}`))}</div>
          </section>
        )}
        {searching ? (
          <section>
            <h4>{t('Results')}</h4>
            {found.length ? <div className="stamp-tiles">{found.map((s) => tile(s, ariaOf(s)))}</div> : <p className="muted small">{t('No stamp matches.')}</p>}
          </section>
        ) : (
          cats.map((c) => {
            const list = stamps.filter((s) => s.category === c)
            if (!list.length && c !== CAT_MINE) return null
            return (
              <section key={c}>
                <h4>{t(c)}</h4>
                {list.length ? (
                  <div className="stamp-tiles">{list.map((s) => tile(s, ariaOf(s)))}</div>
                ) : (
                  <p className="muted small">{t('Stamps you make appear here.')}</p>
                )}
              </section>
            )
          })
        )}
      </div>
      <label className="stamp-dated">
        <input type="checkbox" checked={dated} onChange={(e) => onDated(e.target.checked)} /> Add my name, date and time
      </label>
      <h4>{t('Make a stamp')}</h4>
      <div className="stamp-make">
        <button onClick={() => onNew('text')} title={t('A text stamp that can fill in the date, time, your name and a number')}>
          <Type size={14} aria-hidden /> {t('Text stamp…')}
        </button>
        <button onClick={() => onNew('picture')} title="Add PNG or JPEG images as stamps">
          <ImagePlus size={14} aria-hidden /> <span>Add image…</span>
        </button>
        <button onClick={() => onNew('pdf')} title={t('Use a page of a PDF file as a stamp')}>
          <FileText size={14} aria-hidden /> {t('From a PDF page…')}
        </button>
        <button onClick={() => onNew('selection')} title={t('Drag a box on the page to turn that area into a stamp')}>
          <SquareDashedMousePointer size={14} aria-hidden /> {t('From an area of the page')}
        </button>
        <button onClick={() => onNew('clipboard')} title={t('Use the picture on the clipboard as a stamp')}>
          <ClipboardPaste size={14} aria-hidden /> {t('From the clipboard')}
        </button>
        <button onClick={onImport} title={t('Add the stamps in a collection file')}>
          <Download size={14} aria-hidden /> {t('Import collection…')}
        </button>
        <button onClick={onExport} title={t('Save my stamps as a collection file to share')}>
          <Upload size={14} aria-hidden /> {t('Export collection…')}
        </button>
      </div>
      <h4>{t('Placement')}</h4>
      <div className="stamp-opts">
        <label>
          <input type="checkbox" checked={opts.drag} onChange={(e) => onOpts({ ...opts, drag: e.target.checked })} /> {t('Drag a box to size it (click places at the default size)')}
        </label>
        <label>
          <input type="checkbox" checked={opts.keepAspect} onChange={(e) => onOpts({ ...opts, keepAspect: e.target.checked })} /> {t('Keep the stamp’s shape')}
        </label>
        <label className="stamp-opt-row">
          {t('Rotate')}
          <input type="number" min={0} max={359} step={15} aria-label={t('Stamp rotation in degrees')} value={opts.angle} onChange={(e) => onOpts({ ...opts, angle: ((Math.round(Number(e.target.value) || 0) % 360) + 360) % 360 })} /> °
        </label>
        <label className="stamp-opt-row">
          {t('Opacity')}
          <input type="range" min={10} max={100} step={5} aria-label={t('Stamp opacity')} value={Math.round(opts.opacity * 100)} onChange={(e) => onOpts({ ...opts, opacity: Number(e.target.value) / 100 })} />
          <span>{Math.round(opts.opacity * 100)}%</span>
        </label>
      </div>
      <p className="muted small">
        <Stamp size={12} aria-hidden /> {t('Pick a stamp, then click on the page.')}
      </p>
      {menu && (
        <div className="stamp-menu" role="menu" style={{ left: menu.x, top: menu.y }}>
          <button role="menuitem" onClick={() => { onPick(menu.s); setMenu(null) }}>
            {t('Use this stamp')}
          </button>
          <button
            role="menuitem"
            onClick={() => {
              onPages(menu.s)
              setMenu(null)
            }}
          >
            {t('Place on several pages…')}
          </button>
          {!menu.s.builtin && (
            <>
              <button
                role="menuitem"
                onClick={() => {
                  onEdit(menu.s)
                  setMenu(null)
                }}
              >
                {menu.s.kind === 'image' ? t('Rename or move…') : t('Edit…')}
              </button>
              <button
                role="menuitem"
                onClick={() => {
                  onDelete(menu.s)
                  setMenu(null)
                }}
              >
                {t('Delete')}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}
