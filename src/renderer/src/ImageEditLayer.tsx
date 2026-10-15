import { useEffect, useState } from 'react'
import { ImageIcon, Trash2 } from 'lucide-react'
import { matInverse, matMul, type Matrix6 } from './content'
import type { ImageObject, PdfClient } from './pdfClient'
import { deltaToPage, type Rotation } from './viewRotation'

interface Drag {
  kind: 'move' | 'resize'
  /** Screen position where the drag began. */
  sx: number
  sy: number
  /** Offset so far, in page points (display space of the unrotated frame). */
  dx: number
  dy: number
}

/** Edit Image tool: pick an image, drag to move, drag the corner to resize (Shift frees the aspect ratio), replace or delete. */
export function ImageEditLayer({
  client,
  page,
  zoom,
  rotation,
  onChange,
  onReplace
}: {
  client: PdfClient
  page: number
  zoom: number
  rotation: Rotation
  /** `change` is an affine matrix in page space applied after the image is placed; null deletes the image. */
  onChange: (page: number, obj: ImageObject, total: number, change: Matrix6 | null) => void
  onReplace: (page: number, obj: ImageObject, total: number) => void
}) {
  const [data, setData] = useState<{ objects: ImageObject[]; total: number; toPage: Matrix6 } | null>(null)
  const [sel, setSel] = useState<number | null>(null)
  const [drag, setDrag] = useState<Drag | null>(null)

  useEffect(() => {
    let cancelled = false
    client
      .imageObjects(page)
      .then((d) => !cancelled && setData(d))
      .catch(() => !cancelled && setData({ objects: [], total: 0, toPage: [1, 0, 0, 1, 0, 0] }))
    return () => {
      cancelled = true
    }
  }, [client, page])

  if (!data) return null
  const obj = sel === null ? undefined : data.objects.find((o) => o.ordinal === sel)

  /** A display-space affine change as a page-space one: F^-1 x change x F, with F the display-to-page matrix. */
  const toPageSpace = (display: Matrix6): Matrix6 | null => {
    const inv = matInverse(data.toPage)
    return inv ? matMul(matMul(inv, display), data.toPage) : null
  }

  const begin = (e: React.MouseEvent, o: ImageObject, kind: Drag['kind']) => {
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    setSel(o.ordinal)
    const sx = e.clientX
    const sy = e.clientY
    let moved = false
    let last = { dx: 0, dy: 0 }
    const compute = (ev: MouseEvent) => {
      const d = deltaToPage(rotation, ev.clientX - sx, ev.clientY - sy)
      let dx = d.dx / zoom
      let dy = d.dy / zoom
      if (kind === 'resize' && !ev.shiftKey) {
        // Keep the shape: follow the larger of the two scale changes.
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
      setDrag({ kind, sx, sy, ...last })
    }
    const up = (ev: MouseEvent) => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      setDrag(null)
      if (!moved) return
      last = compute(ev)
      const r = o.rect
      let display: Matrix6
      if (kind === 'move') display = [1, 0, 0, 1, last.dx, last.dy]
      else {
        const sxs = Math.max(0.05, (r.w + last.dx) / r.w)
        const sys = Math.max(0.05, (r.h + last.dy) / r.h)
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

  return (
    <div
      className="imageedit-layer"
      tabIndex={-1}
      onMouseDown={(e) => {
        e.stopPropagation()
        if (e.target === e.currentTarget) setSel(null)
      }}
      onKeyDown={(e) => {
        if (!obj) return
        if (e.key === 'Delete' || e.key === 'Backspace') {
          e.preventDefault()
          setSel(null)
          onChange(page, obj, data.total, null)
        } else if (e.key === 'Escape') setSel(null)
      }}
    >
      {data.objects.map((o) => {
        const r = shown(o)
        const on = o.ordinal === sel
        return (
          <div
            key={o.ordinal}
            role="button"
            tabIndex={0}
            aria-label={`Image ${o.ordinal + 1}`}
            aria-pressed={on}
            className={`imageedit-box${on ? ' selected' : ''}`}
            style={{ left: r.x * zoom, top: r.y * zoom, width: r.w * zoom, height: r.h * zoom }}
            onMouseDown={(e) => begin(e, o, 'move')}
            onKeyDown={(e) => e.key === 'Enter' && setSel(o.ordinal)}
          >
            {on && <div className="resize-handle" aria-label="Resize image" onMouseDown={(e) => begin(e, o, 'resize')} />}
          </div>
        )
      })}
      {obj && !drag && (
        <div className="imageedit-bar" style={{ left: obj.rect.x * zoom, top: Math.max(0, obj.rect.y * zoom - 34) }} onMouseDown={(e) => e.stopPropagation()}>
          <button type="button" onClick={() => onReplace(page, obj, data.total)} title="Replace this picture with another file">
            <ImageIcon size={14} aria-hidden /> Replace…
          </button>
          <button
            type="button"
            onClick={() => {
              setSel(null)
              onChange(page, obj, data.total, null)
            }}
            title="Delete this picture (Delete)"
          >
            <Trash2 size={14} aria-hidden /> Delete
          </button>
        </div>
      )}
    </div>
  )
}
