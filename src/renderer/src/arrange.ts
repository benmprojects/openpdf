/** Arranging several annotations: align, distribute and stacking order. Pure functions over the annotation list. */
import { translated, type Annot } from './annotations'
import type { Rect } from './textLogic'

export type AlignMode = 'left' | 'centre' | 'right' | 'top' | 'middle' | 'bottom'
export type StackMode = 'front' | 'forward' | 'backward' | 'back'

/** The box that holds all of an annotation's rectangles. */
export function boundsOf(a: Annot): Rect {
  const rs = a.rects
  const x0 = Math.min(...rs.map((r) => r.x))
  const y0 = Math.min(...rs.map((r) => r.y))
  const x1 = Math.max(...rs.map((r) => r.x + r.w))
  const y1 = Math.max(...rs.map((r) => r.y + r.h))
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}

/** Selected annotations grouped by page (alignment only makes sense within a page). */
function byPage(list: Annot[], ids: ReadonlySet<number>): Map<number, Annot[]> {
  const groups = new Map<number, Annot[]>()
  for (const a of list) if (ids.has(a.id) && a.rects.length) groups.set(a.page, [...(groups.get(a.page) ?? []), a])
  return groups
}

/** Moves the selected annotations so their edges or centres line up with the selection's outer box, page by page. */
export function alignAnnots(list: Annot[], ids: ReadonlySet<number>, mode: AlignMode): Annot[] {
  const shift = new Map<number, { dx: number; dy: number }>()
  for (const group of byPage(list, ids).values()) {
    if (group.length < 2) continue
    const bs = group.map((a) => ({ a, b: boundsOf(a) }))
    const left = Math.min(...bs.map(({ b }) => b.x))
    const right = Math.max(...bs.map(({ b }) => b.x + b.w))
    const top = Math.min(...bs.map(({ b }) => b.y))
    const bottom = Math.max(...bs.map(({ b }) => b.y + b.h))
    for (const { a, b } of bs) {
      let dx = 0
      let dy = 0
      if (mode === 'left') dx = left - b.x
      else if (mode === 'right') dx = right - (b.x + b.w)
      else if (mode === 'centre') dx = (left + right) / 2 - (b.x + b.w / 2)
      else if (mode === 'top') dy = top - b.y
      else if (mode === 'bottom') dy = bottom - (b.y + b.h)
      else dy = (top + bottom) / 2 - (b.y + b.h / 2)
      shift.set(a.id, { dx, dy })
    }
  }
  return list.map((a) => {
    const s = shift.get(a.id)
    return s && (s.dx || s.dy) ? translated(a, s.dx, s.dy) : a
  })
}

/** Spreads three or more selected annotations so the gaps between them are equal; the outermost two stay put. */
export function distributeAnnots(list: Annot[], ids: ReadonlySet<number>, axis: 'horizontal' | 'vertical'): Annot[] {
  const shift = new Map<number, number>()
  for (const group of byPage(list, ids).values()) {
    if (group.length < 3) continue
    const h = axis === 'horizontal'
    const bs = group.map((a) => ({ a, b: boundsOf(a) })).sort((p, q) => (h ? p.b.x - q.b.x : p.b.y - q.b.y))
    const start = h ? bs[0].b.x : bs[0].b.y
    const last = bs[bs.length - 1].b
    const end = h ? last.x + last.w : last.y + last.h
    const total = bs.reduce((n, { b }) => n + (h ? b.w : b.h), 0)
    const gap = (end - start - total) / (bs.length - 1)
    let at = start
    for (const { a, b } of bs) {
      shift.set(a.id, at - (h ? b.x : b.y))
      at += (h ? b.w : b.h) + gap
    }
  }
  return list.map((a) => {
    const d = shift.get(a.id)
    return d ? (axis === 'horizontal' ? translated(a, d, 0) : translated(a, 0, d)) : a
  })
}

/**
 * Stacking order: later in the list is drawn on top. `front` and `back` move the selection to the end or start;
 * `forward` and `backward` move each selected annotation one place past its neighbour (selected ones keep their order).
 */
export function restack(list: Annot[], ids: ReadonlySet<number>, mode: StackMode): Annot[] {
  const picked = list.filter((a) => ids.has(a.id))
  if (!picked.length) return list
  if (mode === 'front') return [...list.filter((a) => !ids.has(a.id)), ...picked]
  if (mode === 'back') return [...picked, ...list.filter((a) => !ids.has(a.id))]
  const out = [...list]
  if (mode === 'forward') {
    for (let i = out.length - 2; i >= 0; i--) if (ids.has(out[i].id) && !ids.has(out[i + 1].id)) [out[i], out[i + 1]] = [out[i + 1], out[i]]
  } else {
    for (let i = 1; i < out.length; i++) if (ids.has(out[i].id) && !ids.has(out[i - 1].id)) [out[i], out[i - 1]] = [out[i - 1], out[i]]
  }
  return out
}
