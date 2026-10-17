import { useEffect, useRef, useState } from 'react'
import { matInverse, matMul, type Matrix6 } from './content'
import { ObjectBar, type ObjectAction } from './ObjectBar'
import type { ImageObject, PdfClient } from './pdfClient'
import { deltaToPage, type Rotation } from './viewRotation'

interface Drag {
  kind: 'move' | 'resize'
  /** Offset so far, in page points (display space of the unrotated frame). */
  dx: number
  dy: number
}

/** How far from a path's box a click still counts as on it, in points. */
const HIT_SLOP = 3

/**
 * Edit Image and Edit Shape tools. Images get a box each; paths (often tens of thousands) are found under the pointer,
 * the smallest one first. Drag to move, drag the corner to resize (images keep their shape unless Shift is held), and
 * Delete removes. Images can also be replaced.
 */
export function ObjectEditLayer({
  kind,
  client,
  page,
  zoom,
  rotation,
  onChange,
  onReplace,
  onAction
}: {
  kind: 'image' | 'path'
  client: PdfClient
  page: number
  zoom: number
  rotation: Rotation
  /** `change` is an affine matrix in page space applied after the object is placed; null deletes it. */
  onChange: (page: number, obj: ImageObject, total: number, change: Matrix6 | null) => void
  onReplace?: (page: number, obj: ImageObject, total: number) => void
  /** Crop, opacity, export and restyle requests from the tool bar. `toPage` maps display space to page space. */
  onAction?: (page: number, total: number, toPage: Matrix6, action: ObjectAction) => void
}) {
  const [data, setData] = useState<{ objects: ImageObject[]; total: number; toPage: Matrix6 } | null>(null)
  const [sel, setSel] = useState<number | null>(null)
  const [hover, setHover] = useState<number | null>(null)
  const [drag, setDrag] = useState<Drag | null>(null)
  const frame = useRef(0)
  const root = useRef<HTMLDivElement>(null)
  const isPath = kind === 'path'
  const noun = isPath ? 'Shape' : 'Image'

  useEffect(() => {
    let cancelled = false
    const load = isPath ? client.pathObjects(page) : client.imageObjects(page)
    load.then((d) => !cancelled && setData(d)).catch(() => !cancelled && setData({ objects: [], total: 0, toPage: [1, 0, 0, 1, 0, 0] }))
    return () => {
      cancelled = true
    }
  }, [client, page, isPath])

  if (!data) return null
  const byOrdinal = (n: number | null) => (n === null ? undefined : data.objects.find((o) => o.ordinal === n))
  const obj = byOrdinal(sel)
  const hovered = byOrdinal(hover)

  /** A display-space affine change as a page-space one: F^-1 x change x F, with F the display-to-page matrix. */
  const toPageSpace = (display: Matrix6): Matrix6 | null => {
    const inv = matInverse(data.toPage)
    return inv ? matMul(matMul(inv, display), data.toPage) : null
  }

  /** The smallest object whose box holds the point (display space, points). */
  const pick = (x: number, y: number): ImageObject | undefined => {
    let best: ImageObject | undefined
    let area = Infinity
    for (const o of data.objects) {
      const r = o.rect
      if (x < r.x - HIT_SLOP || x > r.x + r.w + HIT_SLOP || y < r.y - HIT_SLOP || y > r.y + r.h + HIT_SLOP) continue
      const a = Math.max(r.w, 1) * Math.max(r.h, 1)
      if (a < area) {
        area = a
        best = o
      }
    }
    return best
  }

  const begin = (e: React.MouseEvent, o: ImageObject, how: Drag['kind']) => {
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    setSel(o.ordinal)
    // Keys (Delete, Escape) go to the layer, since the mouse press above does not move focus.
    root.current?.focus({ preventScroll: true })
    const sx = e.clientX
    const sy = e.clientY
    let moved = false
    let last = { dx: 0, dy: 0 }
    const compute = (ev: MouseEvent) => {
      const d = deltaToPage(rotation, ev.clientX - sx, ev.clientY - sy)
      let dx = d.dx / zoom
      let dy = d.dy / zoom
      if (how === 'resize' && !isPath && !ev.shiftKey) {
        // Keep the picture's shape: follow the larger of the two scale changes.
        const k = Math.max((o.rect.w + dx) / o.rect.w, (o.rect.h + dy) / o.rect.h)
        dx = o.rect.w * k - o.rect.w
        dy = o.rect.h * k - o.rect.h
      }
      return { dx, dy }
    }
    const move = (ev: MouseEvent) => {
      if (!moved && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 3) return
      moved = true
      last = compute(ev)
      setDrag({ kind: how, ...last })
    }
    const up = (ev: MouseEvent) => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      setDrag(null)
      if (!moved) return
      last = compute(ev)
      const r = o.rect
      let display: Matrix6
      if (how === 'move') display = [1, 0, 0, 1, last.dx, last.dy]
      else {
        const w = Math.max(r.w, 1)
        const h = Math.max(r.h, 1)
        const sxs = Math.max(0.05, (w + last.dx) / w)
        const sys = Math.max(0.05, (h + last.dy) / h)
        display = [sxs, 0, 0, sys, r.x * (1 - sxs), r.y * (1 - sys)]
      }
      const change = toPageSpace(display)
      if (change) onChange(page, o, data.total, change)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  const shown = (o: ImageObject) => {
    const r = o.rect
    if (!drag || o.ordinal !== sel) return { x: r.x, y: r.y, w: r.w, h: r.h }
    return drag.kind === 'move' ? { x: r.x + drag.dx, y: r.y + drag.dy, w: r.w, h: r.h } : { x: r.x, y: r.y, w: Math.max(4, r.w + drag.dx), h: Math.max(4, r.h + drag.dy) }
  }

  const remove = (o: ImageObject) => {
    setSel(null)
    onChange(page, o, data.total, null)
  }

  const box = (o: ImageObject, extra: string, label?: string) => {
    const r = shown(o)
    return (
      <div
        key={`${extra}-${o.ordinal}`}
        className={`imageedit-box ${extra}`}
        aria-label={label}
        style={{ left: r.x * zoom - 1, top: r.y * zoom - 1, width: Math.max(r.w * zoom, 3) + 2, height: Math.max(r.h * zoom, 3) + 2 }}
      />
    )
  }

  return (
    <div
      ref={root}
      className={`imageedit-layer${isPath ? ' paths' : ''}`}
      tabIndex={-1}
      onMouseDown={(e) => {
        e.stopPropagation()
        if (e.target !== e.currentTarget) return
        if (isPath) {
          const hit = pick(e.nativeEvent.offsetX / zoom, e.nativeEvent.offsetY / zoom)
          if (hit) begin(e, hit, 'move')
          else setSel(null)
        } else setSel(null)
      }}
      onMouseMove={(e) => {
        if (!isPath || drag || e.target !== e.currentTarget) return
        const x = e.nativeEvent.offsetX / zoom
        const y = e.nativeEvent.offsetY / zoom
        cancelAnimationFrame(frame.current)
        frame.current = requestAnimationFrame(() => setHover(pick(x, y)?.ordinal ?? null))
      }}
      onMouseLeave={() => setHover(null)}
      onKeyDown={(e) => {
        if (!obj) return
        if (e.key === 'Delete' || e.key === 'Backspace') {
          e.preventDefault()
          remove(obj)
        } else if (e.key === 'Escape') setSel(null)
      }}
    >
      {isPath ? (
        <>
          {hovered && hovered.ordinal !== sel && !drag && box(hovered, 'hover')}
          {obj && box(obj, 'selected', `${noun} ${obj.ordinal + 1}`)}
        </>
      ) : (
        data.objects.map((o) => {
          const r = shown(o)
          const on = o.ordinal === sel
          return (
            <div
              key={o.ordinal}
              role="button"
              tabIndex={0}
              aria-label={`${noun} ${o.ordinal + 1}`}
              aria-pressed={on}
              className={`imageedit-box${on ? ' selected' : ''}`}
              style={{ left: r.x * zoom, top: r.y * zoom, width: r.w * zoom, height: r.h * zoom }}
              onMouseDown={(e) => begin(e, o, 'move')}
              onKeyDown={(e) => e.key === 'Enter' && setSel(o.ordinal)}
            >
              {on && <div className="resize-handle" aria-label={`Resize ${noun.toLowerCase()}`} onMouseDown={(e) => begin(e, o, 'resize')} />}
            </div>
          )
        })
      )}
      {isPath && obj && (
        <div
          className="resize-handle"
          aria-label="Resize shape"
          style={{ left: (shown(obj).x + shown(obj).w) * zoom - 5, top: (shown(obj).y + shown(obj).h) * zoom - 5, right: 'auto', bottom: 'auto' }}
          onMouseDown={(e) => begin(e, obj, 'resize')}
        />
      )}
      {obj && !drag && (
        <ObjectBar
          key={`${obj.ordinal}-${isPath ? 'p' : 'i'}`}
          isPath={isPath}
          obj={obj}
          left={obj.rect.x * zoom}
          top={Math.max(0, obj.rect.y * zoom - 34)}
          onDisplayChange={(m) => {
            const change = toPageSpace(m)
            if (change) onChange(page, obj, data.total, change)
          }}
          onDelete={() => remove(obj)}
          onReplace={!isPath && onReplace ? () => onReplace(page, obj, data.total) : undefined}
          onAction={(a) => onAction?.(page, data.total, data.toPage, a)}
        />
      )}
    </div>
  )
}
