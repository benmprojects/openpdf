// Pixel helpers for stamps made from a rendered PDF page or a snapshot. Pure, so they are unit tested.

/**
 * Turns white into transparency, keeping the ink colour ("colour to alpha"): a pixel's opacity is how far its darkest
 * channel is from white, and its colour is what, laid over white at that opacity, gives the original pixel.
 */
export function whiteToAlpha(rgba: Uint8Array | Uint8ClampedArray): Uint8Array {
  const out = new Uint8Array(rgba.length)
  for (let i = 0; i + 3 < rgba.length; i += 4) {
    const a0 = rgba[i + 3]
    const m = Math.min(rgba[i], rgba[i + 1], rgba[i + 2])
    const alpha = 255 - m
    if (alpha <= 0 || a0 === 0) continue // stays fully transparent
    for (let c = 0; c < 3; c++) out[i + c] = Math.max(0, Math.min(255, Math.round(((rgba[i + c] - m) * 255) / alpha)))
    out[i + 3] = Math.round((alpha * a0) / 255)
  }
  return out
}

/** Crops to the area with visible pixels, leaving `pad` pixels around it. Returns the input when nothing is visible. */
export function trimTransparent(rgba: Uint8Array, w: number, h: number, pad = 2): { data: Uint8Array; w: number; h: number } {
  let x0 = w
  let y0 = h
  let x1 = -1
  let y1 = -1
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (rgba[(y * w + x) * 4 + 3] > 8) {
        if (x < x0) x0 = x
        if (x > x1) x1 = x
        if (y < y0) y0 = y
        if (y > y1) y1 = y
      }
    }
  }
  if (x1 < 0) return { data: rgba, w, h }
  x0 = Math.max(0, x0 - pad)
  y0 = Math.max(0, y0 - pad)
  x1 = Math.min(w - 1, x1 + pad)
  y1 = Math.min(h - 1, y1 + pad)
  const nw = x1 - x0 + 1
  const nh = y1 - y0 + 1
  if (nw === w && nh === h) return { data: rgba, w, h }
  const out = new Uint8Array(nw * nh * 4)
  for (let y = 0; y < nh; y++) out.set(rgba.subarray(((y + y0) * w + x0) * 4, ((y + y0) * w + x0 + nw) * 4), y * nw * 4)
  return { data: out, w: nw, h: nh }
}

/** The bytes of a `data:` URL; null if it is not base64. */
export function dataUrlBytes(url: string): Uint8Array | null {
  const m = /^data:[^;,]+;base64,(.*)$/s.exec(url)
  if (!m) return null
  const bin = atob(m[1])
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}
