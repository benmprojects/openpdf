/**
 * Clean-up for scanned pictures: straightening, speck removal and cropping to the content. Pure functions on RGBA
 * bitmaps (no DOM), so they can be tested in Node. The estimates run on a small greyscale copy to stay fast on an
 * A4 page at 300 dpi.
 */

export interface Bitmap {
  width: number
  height: number
  /** RGBA, 4 bytes per pixel. */
  data: Uint8ClampedArray
}

const grey = (d: Uint8ClampedArray, i: number) => (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000

/** Greyscale values 0-255 for every pixel. */
function toGrey(img: Bitmap): Uint8Array {
  const n = img.width * img.height
  const g = new Uint8Array(n)
  for (let i = 0, p = 0; i < n; i++, p += 4) g[i] = grey(img.data, p)
  return g
}

/** Otsu's threshold: pixels below it are ink, at or above it are paper. */
export function otsu(g: Uint8Array): number {
  const hist = new Float64Array(256)
  for (let i = 0; i < g.length; i++) hist[g[i]]++
  const total = g.length
  let sum = 0
  for (let i = 0; i < 256; i++) sum += i * hist[i]
  let wB = 0
  let sumB = 0
  let best = -1
  let threshold = 128
  for (let t = 0; t < 256; t++) {
    wB += hist[t]
    if (!wB) continue
    const wF = total - wB
    if (!wF) break
    sumB += t * hist[t]
    const mB = sumB / wB
    const mF = (sum - sumB) / wF
    const between = wB * wF * (mB - mF) * (mB - mF)
    if (between > best) {
      best = between
      threshold = t + 1
    }
  }
  return threshold
}

/** Greyscale copy reduced by whole-pixel averaging until its longer side is at most `max`. */
function downsample(img: Bitmap, max: number): { g: Uint8Array; w: number; h: number } {
  const f = Math.max(1, Math.floor(Math.max(img.width, img.height) / max))
  const w = Math.floor(img.width / f)
  const h = Math.floor(img.height / f)
  const g = new Uint8Array(w * h)
  const d = img.data
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0
      for (let yy = 0; yy < f; yy++) {
        let p = ((y * f + yy) * img.width + x * f) * 4
        for (let xx = 0; xx < f; xx++, p += 4) s += grey(d, p)
      }
      g[y * w + x] = s / (f * f)
    }
  }
  return { g, w, h }
}

const RANGE = 10

/**
 * How far the content is turned, in degrees, clockwise positive (a page scanned crooked so that its lines run down
 * to the right gives a positive number). Searches -10 to +10 degrees for the turn that makes the rows of ink
 * sharpest. Returns 0 when there is too little content or no clear best angle.
 */
export function estimateSkew(img: Bitmap): number {
  if (img.width < 16 || img.height < 16) return 0
  const { g, w, h } = downsample(img, 800)
  const t = otsu(g)
  const dark: number[] = []
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (g[y * w + x] < t) dark.push(x, y)
  const count = dark.length / 2
  if (count < Math.max(200, w * h * 0.0015)) return 0
  // Sub-sample very dense pages; the profile only needs a representative set of points.
  const stride = Math.max(1, Math.floor(count / 60000))
  const xs: number[] = []
  const ys: number[] = []
  for (let i = 0; i < count; i += stride) {
    xs.push(dark[i * 2])
    ys.push(dark[i * 2 + 1])
  }
  const margin = Math.ceil(w * Math.sin((RANGE + 1) * (Math.PI / 180))) + 2
  const bins = new Float64Array(h + margin * 2 + 2)
  const score = (deg: number): number => {
    bins.fill(0)
    const r = (deg * Math.PI) / 180
    const s = Math.sin(r)
    const c = Math.cos(r)
    for (let i = 0; i < xs.length; i++) bins[Math.round(xs[i] * s + ys[i] * c) + margin]++
    let q = 0
    for (let i = 0; i < bins.length; i++) q += bins[i] * bins[i]
    return q
  }
  let best = 0
  let bestScore = -1
  let worst = Infinity
  for (let a = -RANGE; a <= RANGE; a += 1) {
    const v = score(a)
    if (v > bestScore) {
      bestScore = v
      best = a
    }
    if (v < worst) worst = v
  }
  // No clear peak: a page of dots, a photograph or a blank page scores about the same at every angle.
  if (!(bestScore > worst * 1.08)) return 0
  if (Math.abs(best) >= RANGE) return 0
  let fine = best
  let fineScore = bestScore
  for (let a = best - 1; a <= best + 1.0001; a += 0.1) {
    const v = score(a)
    if (v > fineScore) {
      fineScore = v
      fine = a
    }
  }
  const skew = -Math.round(fine * 10) / 10
  return Math.abs(skew) < 0.15 ? 0 : skew
}

/** The bitmap turned clockwise by `degrees` about its centre, same size, bilinear sampling, white where nothing was. */
export function rotateImage(img: Bitmap, degrees: number): Bitmap {
  const { width: w, height: h } = img
  const out = new Uint8ClampedArray(w * h * 4)
  const r = (degrees * Math.PI) / 180
  const c = Math.cos(r)
  const s = Math.sin(r)
  const cx = (w - 1) / 2
  const cy = (h - 1) / 2
  const d = img.data
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = x - cx
      const dy = y - cy
      const sx = dx * c + dy * s + cx
      const sy = -dx * s + dy * c + cy
      const o = (y * w + x) * 4
      if (sx < -0.5 || sy < -0.5 || sx > w - 0.5 || sy > h - 0.5) {
        out[o] = out[o + 1] = out[o + 2] = out[o + 3] = 255
        continue
      }
      const x0 = Math.max(0, Math.min(w - 1, Math.floor(sx)))
      const y0 = Math.max(0, Math.min(h - 1, Math.floor(sy)))
      const x1 = Math.min(w - 1, x0 + 1)
      const y1 = Math.min(h - 1, y0 + 1)
      const fx = Math.min(1, Math.max(0, sx - x0))
      const fy = Math.min(1, Math.max(0, sy - y0))
      const p00 = (y0 * w + x0) * 4
      const p10 = (y0 * w + x1) * 4
      const p01 = (y1 * w + x0) * 4
      const p11 = (y1 * w + x1) * 4
      for (let k = 0; k < 3; k++) {
        const top = d[p00 + k] * (1 - fx) + d[p10 + k] * fx
        const bottom = d[p01 + k] * (1 - fx) + d[p11 + k] * fx
        out[o + k] = top * (1 - fy) + bottom * fy
      }
      out[o + 3] = 255
    }
  }
  return { width: w, height: h, data: out }
}

/** Straightens a crooked page. Returns the same bitmap when it is already level or the angle cannot be told. */
export function deskew(img: Bitmap): Bitmap {
  const skew = estimateSkew(img)
  return skew === 0 ? img : rotateImage(img, -skew)
}

/**
 * Removes isolated dark specks of at most `maxArea` pixels (8-connected, after thresholding) by painting them and their
 * edge white. Larger marks, such as letters, are not touched. Returns the same bitmap when there is nothing to remove.
 */
export function despeckle(img: Bitmap, maxArea = 4): Bitmap {
  const { width: w, height: h } = img
  const g = toGrey(img)
  const t = otsu(g)
  const n = w * h
  const seen = new Uint8Array(n)
  const stack = new Int32Array(n)
  const members = new Int32Array(maxArea + 1)
  let out: Uint8ClampedArray | null = null
  for (let start = 0; start < n; start++) {
    if (seen[start] || g[start] >= t) continue
    // Flood the 8-connected mark from here; only the first maxArea + 1 pixels need remembering.
    let size = 0
    let top = 0
    stack[top++] = start
    seen[start] = 1
    while (top > 0) {
      const p = stack[--top]
      if (size <= maxArea) members[size] = p
      size++
      const px = p % w
      const py = (p - px) / w
      for (let yy = Math.max(0, py - 1); yy <= Math.min(h - 1, py + 1); yy++) {
        for (let xx = Math.max(0, px - 1); xx <= Math.min(w - 1, px + 1); xx++) {
          const q = yy * w + xx
          if (seen[q] || g[q] >= t) continue
          seen[q] = 1
          stack[top++] = q
        }
      }
    }
    if (size > maxArea) continue
    if (!out) out = new Uint8ClampedArray(img.data)
    for (let i = 0; i < size; i++) {
      const p = members[i]
      const px = p % w
      const py = (p - px) / w
      for (let yy = Math.max(0, py - 1); yy <= Math.min(h - 1, py + 1); yy++) {
        for (let xx = Math.max(0, px - 1); xx <= Math.min(w - 1, px + 1); xx++) {
          const o = (yy * w + xx) * 4
          out[o] = out[o + 1] = out[o + 2] = 255
        }
      }
    }
  }
  return out ? { width: w, height: h, data: out } : img
}

export interface Box {
  x: number
  y: number
  width: number
  height: number
}

/**
 * The rectangle around everything that is not background, plus a margin; null when the page is blank or the
 * rectangle would be almost the whole page.
 */
export function contentBox(img: Bitmap, margin?: number): Box | null {
  const { width: w, height: h } = img
  const g = toGrey(img)
  // Background: the common paper tone, taken as the 85th percentile of brightness.
  const hist = new Float64Array(256)
  for (let i = 0; i < g.length; i++) hist[g[i]]++
  let acc = 0
  let bg = 255
  for (let v = 0; v < 256; v++) {
    acc += hist[v]
    if (acc >= g.length * 0.85) {
      bg = v
      break
    }
  }
  const limit = bg - 48
  if (limit < 8) return null
  const rows = new Int32Array(h)
  const cols = new Int32Array(w)
  let total = 0
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (g[y * w + x] < limit) {
        rows[y]++
        cols[x]++
        total++
      }
    }
  }
  if (total < Math.max(20, w * h * 0.0003)) return null
  // A line of one or two stray pixels is not content.
  const need = 3
  let top = 0
  while (top < h && rows[top] < need) top++
  let bottom = h - 1
  while (bottom >= 0 && rows[bottom] < need) bottom--
  let left = 0
  while (left < w && cols[left] < need) left++
  let right = w - 1
  while (right >= 0 && cols[right] < need) right--
  if (top > bottom || left > right) return null
  const m = margin ?? Math.round(Math.min(w, h) * 0.02)
  const x0 = Math.max(0, left - m)
  const y0 = Math.max(0, top - m)
  const x1 = Math.min(w - 1, right + m)
  const y1 = Math.min(h - 1, bottom + m)
  const box = { x: x0, y: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 }
  if ((box.width * box.height) / (w * h) > 0.95) return null
  return box
}

/** The bitmap cut down to its content (with a margin), or unchanged when it is blank or the content fills the page. */
export function autoCrop(img: Bitmap, margin?: number): Bitmap {
  const box = contentBox(img, margin)
  if (!box) return img
  const out = new Uint8ClampedArray(box.width * box.height * 4)
  for (let y = 0; y < box.height; y++) {
    const from = ((box.y + y) * img.width + box.x) * 4
    out.set(img.data.subarray(from, from + box.width * 4), y * box.width * 4)
  }
  return { width: box.width, height: box.height, data: out }
}
