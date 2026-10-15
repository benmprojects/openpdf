import { Bookmark, Download, Eye, EyeOff, File as FileIcon, Layers, LayoutGrid, MessageSquare, Paperclip, type LucideIcon } from 'lucide-react'
import type { Layer } from './layers'
import { getPageClip, onPageClip } from './pageClipboard'
import { useEffect, useRef, useState } from 'react'
import type { AttachmentInfo, OutlineNode, PageSize, PdfClient } from './pdfClient'

const THUMB_WIDTH = 132

export type SidebarTab = 'pages' | 'bookmarks' | 'comments' | 'attachments' | 'layers'

/** A page edit requested from the thumbnail pane. `move.before` is an index in the current order (page count = end). */
export type PageOp =
  | { kind: 'rotate'; delta: 90 | -90 | 180 }
  | { kind: 'delete' }
  | { kind: 'move'; before: number }
  | { kind: 'insert'; at: number }
  | { kind: 'extract' }
  | { kind: 'split' }
  | { kind: 'copy' }
  | { kind: 'paste'; at: number }
  | { kind: 'duplicate' }
  | { kind: 'replace' }

interface Props {
  client: PdfClient
  pages: PageSize[]
  outline: OutlineNode[] | null
  tab: SidebarTab
  onTab: (t: SidebarTab) => void
  currentPage: number
  onGoTo: (page: number) => void
  onPageOp: (op: PageOp, pages: number[]) => void
  busy: boolean
  width: number
  /** Reports the selected thumbnails (0-based, sorted) whenever they change. */
  onSelectionChange?: (pages: number[]) => void
  /** Page labels (one per page), or null when the document has none. */
  labels: string[] | null
  attachments: AttachmentInfo[]
  onSaveAttachment: (a: AttachmentInfo) => void
  layers: Layer[]
  isLayerVisible: (key: string) => boolean
  onToggleLayer: (key: string) => void
  /** The Comments tab, rendered by the document view. */
  comments: React.ReactNode
}

const TABS: [SidebarTab, string, LucideIcon][] = [
  ['pages', 'Pages', LayoutGrid],
  ['bookmarks', 'Bookmarks', Bookmark],
  ['comments', 'Comments', MessageSquare],
  ['attachments', 'Attachments', Paperclip],
  ['layers', 'Layers', Layers]
]

export function Sidebar(props: Props) {
  const { client, pages, outline, tab, onTab, currentPage, onGoTo, onPageOp, busy, width, onSelectionChange, labels } = props
  return (
    <aside className="sidebar" style={{ width }}>
      <div className="sidebar-tabs" role="tablist" aria-label="Side pane">
        {TABS.map(([k, label, Icon]) => (
          <button key={k} role="tab" aria-selected={tab === k} aria-label={label} title={label} onClick={() => onTab(k)}>
            <Icon size={15} strokeWidth={1.8} aria-hidden />
            {tab === k && <span>{label}</span>}
          </button>
        ))}
      </div>
      {tab === 'pages' ? (
        <Thumbnails
          client={client}
          pages={pages}
          currentPage={currentPage}
          onGoTo={onGoTo}
          onPageOp={onPageOp}
          busy={busy}
          onSelectionChange={onSelectionChange}
          labels={labels}
        />
      ) : tab === 'bookmarks' ? (
        <Bookmarks outline={outline} onGoTo={onGoTo} />
      ) : tab === 'comments' ? (
        props.comments
      ) : tab === 'attachments' ? (
        <Attachments list={props.attachments} onSave={props.onSaveAttachment} />
      ) : (
        <LayerList layers={props.layers} isVisible={props.isLayerVisible} onToggle={props.onToggleLayer} />
      )}
    </aside>
  )
}

function formatSize(n: number): string {
  if (n < 0) return 'size unknown'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

function Attachments({ list, onSave }: { list: AttachmentInfo[]; onSave: (a: AttachmentInfo) => void }) {
  if (!list.length) return <div className="side-empty">This document has no attached files.</div>
  return (
    <ul className="side-list" aria-label="Attached files">
      {list.map((a) => (
        <li key={`${a.page ?? 'doc'}-${a.index}`}>
          <FileIcon className="side-list-icon" size={18} strokeWidth={1.6} aria-hidden />
          <span className="side-list-text">
            <span className="side-list-name" title={a.name}>
              {a.name}
            </span>
            <span className="muted small">
              {formatSize(a.size)}
              {a.page !== undefined ? ` · on page ${a.page + 1}` : ''}
            </span>
          </span>
          <button className="icon-btn" onClick={() => onSave(a)} aria-label={`Save ${a.name}`} title="Save a copy of this file…">
            <Download size={16} strokeWidth={1.8} aria-hidden />
          </button>
        </li>
      ))}
    </ul>
  )
}

function LayerList({ layers, isVisible, onToggle }: { layers: Layer[]; isVisible: (key: string) => boolean; onToggle: (key: string) => void }) {
  if (!layers.length) return <div className="side-empty">This document has no layers.</div>
  return (
    <ul className="side-list" aria-label="Layers">
      {layers.map((l) => {
        const on = isVisible(l.key)
        return (
          <li key={l.key}>
            <button
              className="icon-btn"
              onClick={() => onToggle(l.key)}
              aria-pressed={on}
              aria-label={`${on ? 'Hide' : 'Show'} ${l.name}`}
              title={on ? 'Hide this layer (view only; the file is not changed)' : 'Show this layer'}
            >
              {on ? <Eye size={16} strokeWidth={1.8} aria-hidden /> : <EyeOff size={16} strokeWidth={1.8} aria-hidden />}
            </button>
            <span className={on ? 'side-list-name' : 'side-list-name muted'}>{l.name}</span>
          </li>
        )
      })}
    </ul>
  )
}

function Thumbnails({
  client,
  pages,
  currentPage,
  onGoTo,
  onPageOp,
  busy,
  onSelectionChange,
  labels
}: {
  client: PdfClient
  pages: PageSize[]
  currentPage: number
  onGoTo: (p: number) => void
  onPageOp: (op: PageOp, pages: number[]) => void
  busy: boolean
  onSelectionChange?: (pages: number[]) => void
  labels: string[] | null
}) {
  const list = useRef<HTMLDivElement>(null)
  const [hasClip, setHasClip] = useState(() => getPageClip() !== null)
  useEffect(() => onPageClip(() => setHasClip(getPageClip() !== null)), [])
  const [sel, setSel] = useState<number[]>([])
  const anchor = useRef(0)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const [drop, setDrop] = useState<{ index: number; side: 'before' | 'after' } | null>(null)
  const dragging = useRef<number[]>([])

  // Keep the current page's thumbnail in view as the document scrolls.
  useEffect(() => {
    const el = list.current?.querySelector<HTMLElement>(`[data-thumb="${currentPage}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [currentPage])

  // The page list changes after every edit, so a stale selection would point at the wrong pages.
  useEffect(() => setSel([]), [pages])
  useEffect(() => onSelectionChange?.(sel), [sel, onSelectionChange])
  useEffect(() => () => onSelectionChange?.([]), [onSelectionChange])

  useEffect(() => {
    if (!menu) return
    const close = () => setMenu(null)
    window.addEventListener('click', close)
    window.addEventListener('blur', close)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('blur', close)
    }
  }, [menu])

  const target = sel.length ? sel : [currentPage]
  const run = (op: PageOp, on: number[] = target) => {
    setMenu(null)
    if (!busy) onPageOp(op, on)
  }

  const click = (e: React.MouseEvent, i: number) => {
    if (e.shiftKey) {
      const [a, b] = [Math.min(anchor.current, i), Math.max(anchor.current, i)]
      setSel(Array.from({ length: b - a + 1 }, (_, k) => a + k))
    } else if (e.ctrlKey || e.metaKey) {
      anchor.current = i
      setSel((s) => (s.includes(i) ? s.filter((x) => x !== i) : [...s, i].sort((x, y) => x - y)))
    } else {
      anchor.current = i
      setSel([i])
      onGoTo(i)
    }
  }

  const slot = (e: React.DragEvent) => {
    const r = e.currentTarget.getBoundingClientRect()
    return e.clientY < r.top + r.height / 2 ? ('before' as const) : ('after' as const)
  }

  return (
    <div
      className="thumbs"
      ref={list}
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Delete' && sel.length) run({ kind: 'delete' }, sel)
        else if (e.key === 'c' && (e.ctrlKey || e.metaKey)) {
          e.preventDefault()
          run({ kind: 'copy' })
        } else if (e.key === 'v' && (e.ctrlKey || e.metaKey)) {
          e.preventDefault()
          run({ kind: 'paste', at: Math.max(...target) + 1 })
        }
        else if (e.key === 'a' && (e.ctrlKey || e.metaKey)) {
          e.preventDefault()
          setSel(pages.map((_, i) => i))
        }
      }}
    >
      {pages.map((size, i) => (
        <Thumb
          key={i}
          label={labels?.[i] || String(i + 1)}
          client={client}
          index={i}
          size={size}
          current={i === currentPage}
          selected={sel.includes(i)}
          drop={drop?.index === i ? drop.side : null}
          onClick={(e) => click(e, i)}
          onContext={(e) => {
            e.preventDefault()
            if (!sel.includes(i)) {
              setSel([i])
              anchor.current = i
            }
            setMenu({ x: e.clientX, y: e.clientY })
          }}
          onDragStart={(e) => {
            dragging.current = sel.includes(i) ? sel : [i]
            if (!sel.includes(i)) setSel([i])
            e.dataTransfer.effectAllowed = 'move'
            e.dataTransfer.setData('text/plain', 'openpdf-pages')
          }}
          onDragOver={(e) => {
            if (!dragging.current.length) return
            e.preventDefault()
            const side = slot(e)
            setDrop((d) => (d?.index === i && d.side === side ? d : { index: i, side }))
          }}
          onDrop={(e) => {
            e.preventDefault()
            const moving = dragging.current
            const before = slot(e) === 'before' ? i : i + 1
            dragging.current = []
            setDrop(null)
            // Dropping onto its own position changes nothing.
            const sorted = [...moving].sort((a, b) => a - b)
            const stays = sorted.every((p, k) => p === sorted[0] + k) && before >= sorted[0] && before <= sorted[sorted.length - 1] + 1
            if (!stays) run({ kind: 'move', before }, sorted)
          }}
          onDragEnd={() => {
            dragging.current = []
            setDrop(null)
          }}
        />
      ))}
      {menu && (
        <div
          className="ctx-menu"
          ref={(el) => {
            // Keep the menu inside the window: measure it, then pull it back if it would overflow.
            if (!el) return
            const r = el.getBoundingClientRect()
            el.style.left = `${Math.max(0, Math.min(menu.x, window.innerWidth - r.width))}px`
            el.style.top = `${Math.max(0, Math.min(menu.y, window.innerHeight - r.height))}px`
          }}
          style={{ left: menu.x, top: menu.y }} role="menu" onClick={(e) => e.stopPropagation()}>
          <button role="menuitem" onClick={() => run({ kind: 'rotate', delta: -90 })}>Rotate left</button>
          <button role="menuitem" onClick={() => run({ kind: 'rotate', delta: 90 })}>Rotate right</button>
          <button role="menuitem" onClick={() => run({ kind: 'rotate', delta: 180 })}>Rotate 180°</button>
          <hr />
          <button role="menuitem" onClick={() => run({ kind: 'delete' })} disabled={target.length >= pages.length}>
            Delete {target.length > 1 ? `${target.length} pages` : 'page'}
          </button>
          <button role="menuitem" onClick={() => run({ kind: 'extract' })}>Extract pages…</button>
          <button role="menuitem" onClick={() => run({ kind: 'copy' })}>Copy {target.length > 1 ? `${target.length} pages` : 'page'}</button>
          <button role="menuitem" onClick={() => run({ kind: 'paste', at: Math.max(...target) + 1 })} disabled={!hasClip}>
            Paste pages after
          </button>
          <button role="menuitem" onClick={() => run({ kind: 'duplicate' })}>Duplicate</button>
          <button role="menuitem" onClick={() => run({ kind: 'replace' })}>Replace with pages from file…</button>
          <hr />
          <button role="menuitem" onClick={() => run({ kind: 'insert', at: Math.min(...target) })}>Insert pages from file before…</button>
          <button role="menuitem" onClick={() => run({ kind: 'insert', at: Math.max(...target) + 1 })}>Insert pages from file after…</button>
          <button role="menuitem" onClick={() => run({ kind: 'split' })}>Split document…</button>
        </div>
      )}
    </div>
  )
}

function Thumb({
  label,
  client,
  index,
  size,
  current,
  selected,
  drop,
  onClick,
  onContext,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd
}: {
  label: string
  client: PdfClient
  index: number
  size: PageSize
  current: boolean
  selected: boolean
  drop: 'before' | 'after' | null
  onClick: (e: React.MouseEvent) => void
  onContext: (e: React.MouseEvent) => void
  onDragStart: (e: React.DragEvent) => void
  onDragOver: (e: React.DragEvent) => void
  onDrop: (e: React.DragEvent) => void
  onDragEnd: () => void
}) {
  const holder = useRef<HTMLButtonElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const [visible, setVisible] = useState(false)

  const scale = THUMB_WIDTH / size.width
  const cssH = Math.round(size.height * scale)

  useEffect(() => {
    const el = holder.current
    if (!el) return
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { rootMargin: '200px 0px' })
    io.observe(el)
    return () => io.disconnect()
  }, [])

  useEffect(() => {
    if (!visible) return
    const ctrl = new AbortController()
    client
      .render(index, scale * (window.devicePixelRatio || 1), { priority: 1, signal: ctrl.signal })
      .then((out) => {
        const cv = canvas.current
        if (ctrl.signal.aborted || !cv) return
        cv.width = out.width
        cv.height = out.height
        cv.getContext('2d')?.putImageData(new ImageData(new Uint8ClampedArray(out.data), out.width, out.height), 0, 0)
      })
      .catch(() => {})
    return () => ctrl.abort()
  }, [client, index, scale, visible])

  return (
    <button
      ref={holder}
      data-thumb={index}
      className={`thumb${current ? ' current' : ''}${selected ? ' selected' : ''}${drop ? ` drop-${drop}` : ''}`}
      draggable
      onClick={onClick}
      onContextMenu={onContext}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
      aria-label={`Page ${index + 1}`}
      aria-current={current ? 'page' : undefined}
    >
      <canvas ref={canvas} style={{ width: THUMB_WIDTH, height: cssH }} />
      <span title={label !== String(index + 1) ? `Page ${index + 1}` : undefined}>{label}</span>
    </button>
  )
}

function Bookmarks({ outline, onGoTo }: { outline: OutlineNode[] | null; onGoTo: (p: number) => void }) {
  if (outline === null) return <div className="side-empty">Loading…</div>
  if (!outline.length) return <div className="side-empty">This document has no bookmarks.</div>
  return (
    <div className="outline" role="tree">
      {outline.map((n, i) => (
        <OutlineItem key={i} node={n} depth={0} onGoTo={onGoTo} />
      ))}
    </div>
  )
}

function OutlineItem({ node, depth, onGoTo }: { node: OutlineNode; depth: number; onGoTo: (p: number) => void }) {
  const [open, setOpen] = useState(depth < 1)
  const hasKids = node.children.length > 0
  return (
    <div role="treeitem" aria-expanded={hasKids ? open : undefined}>
      <div className="outline-row" style={{ paddingLeft: 6 + depth * 14 }}>
        <button
          className="twisty"
          onClick={() => setOpen(!open)}
          disabled={!hasKids}
          aria-label={open ? 'Collapse' : 'Expand'}
        >
          {hasKids ? (open ? '▾' : '▸') : ''}
        </button>
        <button className="outline-title" disabled={node.page < 0} onClick={() => onGoTo(node.page)} title={node.title}>
          {node.title || '(untitled)'}
        </button>
      </div>
      {hasKids && open && (
        <div role="group">
          {node.children.map((c, i) => (
            <OutlineItem key={i} node={c} depth={depth + 1} onGoTo={onGoTo} />
          ))}
        </div>
      )}
    </div>
  )
}
