/**
 * View-only page rotation. Everything on a page (canvas, annotation overlay, selection and search highlights)
 * stays in the unrotated page frame, in points from the top left. The page view rotates that whole stack with a
 * CSS transform, so only screen-to-page conversions need to know about the rotation.
 */
export type Rotation = 0 | 90 | 180 | 270

export interface Dims {
  width: number
  height: number
}

export function turn(r: Rotation, dir: 1 | -1): Rotation {
  return ((r + dir * 90 + 360) % 360) as Rotation
}

/** Page size as displayed. */
export function displayDims(size: Dims, r: Rotation): Dims {
  return r === 90 || r === 270 ? { width: size.height, height: size.width } : size
}

/** A point in the displayed (rotated) page, in points from its top left, to the same spot in the page frame. */
export function toPage(r: Rotation, u: number, v: number, size: Dims): { x: number; y: number } {
  if (r === 90) return { x: v, y: size.height - u }
  if (r === 180) return { x: size.width - u, y: size.height - v }
  if (r === 270) return { x: size.width - v, y: u }
  return { x: u, y: v }
}

/** Inverse of {@link toPage}. */
export function toDisplay(r: Rotation, x: number, y: number, size: Dims): { u: number; v: number } {
  if (r === 90) return { u: size.height - y, v: x }
  if (r === 180) return { u: size.width - x, v: size.height - y }
  if (r === 270) return { u: y, v: size.width - x }
  return { u: x, v: y }
}

/** A screen movement to the matching movement in the page frame. */
export function deltaToPage(r: Rotation, du: number, dv: number): { dx: number; dy: number } {
  if (r === 90) return { dx: dv, dy: -du }
  if (r === 180) return { dx: -du, dy: -dv }
  if (r === 270) return { dx: -dv, dy: du }
  return { dx: du, dy: dv }
}

/** CSS transform (origin 0 0) that puts the unrotated page stack, `w` by `h` CSS pixels, into the rotated box. */
export function stackTransform(r: Rotation, w: number, h: number): string | undefined {
  if (r === 90) return `translate(${h}px, 0) rotate(90deg)`
  if (r === 180) return `translate(${w}px, ${h}px) rotate(180deg)`
  if (r === 270) return `translate(0, ${w}px) rotate(270deg)`
  return undefined
}
