import { useEffect, useRef, useState } from 'react'
import type { OutlineNode, PageSize, PdfClient } from './pdfClient'

const THUMB_WIDTH = 132

export type SidebarTab = 'pages' | 'bookmarks'

interface Props {
  client: PdfClient
  pages: PageSize[]
  outline: OutlineNode[] | null
  tab: SidebarTab
  onTab: (t: SidebarTab) => void
  currentPage: number
  onGoTo: (page: number) => void
}

export function Sidebar({ client, pages, outline, tab, onTab, currentPage, onGoTo }: Props) {
  return (
    <aside className="sidebar">
      <div className="sidebar-tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'pages'} onClick={() => onTab('pages')}>
          Pages
        </button>
        <button role="tab" aria-selected={tab === 'bookmarks'} onClick={() => onTab('bookmarks')}>
          Bookmarks
        </button>
      </div>
      {tab === 'pages' ? (
        <Thumbnails client={client} pages={pages} currentPage={currentPage} onGoTo={onGoTo} />
      ) : (
        <Bookmarks outline={outline} onGoTo={onGoTo} />
      )}
    </aside>
  )
}

function Thumbnails({
  client,
  pages,
  currentPage,
  onGoTo
}: {
  client: PdfClient
  pages: PageSize[]
  currentPage: number
  onGoTo: (p: number) => void
}) {
  const list = useRef<HTMLDivElement>(null)

  // Keep the current page's thumbnail in view as the document scrolls.
  useEffect(() => {
    const el = list.current?.querySelector<HTMLElement>(`[data-thumb="${currentPage}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [currentPage])

  return (
    <div className="thumbs" ref={list}>
      {pages.map((size, i) => (
        <Thumb key={i} client={client} index={i} size={size} current={i === currentPage} onGoTo={onGoTo} />
      ))}
    </div>
  )
}

function Thumb({
  client,
  index,
  size,
  current,
  onGoTo
}: {
  client: PdfClient
  index: number
  size: PageSize
  current: boolean
  onGoTo: (p: number) => void
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
      className={current ? 'thumb current' : 'thumb'}
      onClick={() => onGoTo(index)}
      aria-label={`Page ${index + 1}`}
      aria-current={current ? 'page' : undefined}
    >
      <canvas ref={canvas} style={{ width: THUMB_WIDTH, height: cssH }} />
      <span>{index + 1}</span>
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
