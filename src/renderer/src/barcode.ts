/**
 * Barcode encoders written for OpenPDF from the public symbology specifications (ISO/IEC 18004 for QR Code, ISO/IEC 15417
 * for Code 128, ISO/IEC 16388 for Code 39, ISO/IEC 15420 for EAN-13). Each encoder returns the dark bars or modules as
 * rectangles in module units, so a caller can draw them as vector shapes at any size.
 */

export type BarcodeKind = 'qr' | 'code128' | 'code39' | 'ean13'
export type QrEcc = 'L' | 'M' | 'Q' | 'H'

export const BARCODE_KINDS: { kind: BarcodeKind; label: string }[] = [
  { kind: 'qr', label: 'QR code' },
  { kind: 'code128', label: 'Code 128' },
  { kind: 'code39', label: 'Code 39' },
  { kind: 'ean13', label: 'EAN-13' }
]

export interface BarRect {
  x: number
  y: number
  w: number
  h: number
}

export interface BarcodeShape {
  /** The symbol's size in modules, without the quiet zone. */
  width: number
  height: number
  /** Dark areas. */
  rects: BarRect[]
  /** Square symbol (QR): keeps its proportions when drawn. Bar codes stretch to the box. */
  is2d: boolean
  /** The text to print under a bar code. */
  label: string
}

/** The empty margin the specifications ask for, in modules. */
export const quietZone = (kind: BarcodeKind): number => (kind === 'qr' ? 4 : 10)

// ---- QR Code -------------------------------------------------------------------------------------------------

const ECC_INDEX: Record<QrEcc, number> = { L: 0, M: 1, Q: 2, H: 3 }
/** The two-bit code for each level in the format information. */
const ECC_FORMAT: Record<QrEcc, number> = { L: 1, M: 0, Q: 3, H: 2 }

// Error correction codewords per block, and number of blocks, by level (L M Q H) and version (index 0 unused).
const ECC_PER_BLOCK: number[][] = [
  [0, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  [0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
  [0, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  [0, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30]
]
const NUM_BLOCKS: number[][] = [
  [0, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
  [0, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
  [0, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
  [0, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81]
]

const ALNUM = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:'

/** Modules left for data and error correction in a version (everything but finder, timing, alignment and format areas). */
function rawDataModules(ver: number): number {
  let n = (16 * ver + 128) * ver + 64
  if (ver >= 2) {
    const align = Math.floor(ver / 7) + 2
    n -= (25 * align - 10) * align - 55
    if (ver >= 7) n -= 36
  }
  return n
}

/** Data codewords a version holds at an error correction level. */
export function qrDataCodewords(ver: number, ecc: QrEcc): number {
  const e = ECC_INDEX[ecc]
  return Math.floor(rawDataModules(ver) / 8) - ECC_PER_BLOCK[e][ver] * NUM_BLOCKS[e][ver]
}

function utf8(text: string): number[] {
  return Array.from(new TextEncoder().encode(text))
}

type QrMode = 'numeric' | 'alnum' | 'byte'
const modeOf = (text: string): QrMode => (/^[0-9]*$/.test(text) ? 'numeric' : [...text].every((c) => ALNUM.includes(c)) ? 'alnum' : 'byte')

const countBits = (mode: QrMode, ver: number): number => {
  const band = ver <= 9 ? 0 : ver <= 26 ? 1 : 2
  return { numeric: [10, 12, 14], alnum: [9, 11, 13], byte: [8, 16, 16] }[mode][band]
}

class Bits {
  bits: number[] = []
  put(value: number, len: number): void {
    for (let i = len - 1; i >= 0; i--) this.bits.push((value >>> i) & 1)
  }
}

function qrSegment(text: string, mode: QrMode, ver: number): Bits {
  const b = new Bits()
  b.put({ numeric: 1, alnum: 2, byte: 4 }[mode], 4)
  if (mode === 'numeric') {
    b.put(text.length, countBits(mode, ver))
    for (let i = 0; i < text.length; i += 3) {
      const chunk = text.slice(i, i + 3)
      b.put(Number(chunk), chunk.length * 3 + 1)
    }
  } else if (mode === 'alnum') {
    b.put(text.length, countBits(mode, ver))
    for (let i = 0; i < text.length; i += 2) {
      if (i + 1 < text.length) b.put(ALNUM.indexOf(text[i]) * 45 + ALNUM.indexOf(text[i + 1]), 11)
      else b.put(ALNUM.indexOf(text[i]), 6)
    }
  } else {
    const bytes = utf8(text)
    b.put(bytes.length, countBits(mode, ver))
    for (const x of bytes) b.put(x, 8)
  }
  return b
}

// Arithmetic in GF(256) with the QR polynomial 0x11D.
function gfMul(x: number, y: number): number {
  let z = 0
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d)
    z ^= ((y >>> i) & 1) * x
  }
  return z
}

function rsDivisor(degree: number): number[] {
  const result = new Array<number>(degree).fill(0)
  result[degree - 1] = 1
  let root = 1
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < result.length; j++) {
      result[j] = gfMul(result[j], root)
      if (j + 1 < result.length) result[j] ^= result[j + 1]
    }
    root = gfMul(root, 2)
  }
  return result
}

function rsRemainder(data: number[], divisor: number[]): number[] {
  const result = new Array<number>(divisor.length).fill(0)
  for (const b of data) {
    const factor = b ^ result.shift()!
    result.push(0)
    divisor.forEach((c, i) => (result[i] ^= gfMul(c, factor)))
  }
  return result
}

/** Data and error correction codewords in the order they are placed (blocks interleaved). */
function interleave(data: number[], ver: number, ecc: QrEcc): number[] {
  const e = ECC_INDEX[ecc]
  const blocks = NUM_BLOCKS[e][ver]
  const eccLen = ECC_PER_BLOCK[e][ver]
  const raw = Math.floor(rawDataModules(ver) / 8)
  const shortBlocks = blocks - (raw % blocks)
  const shortLen = Math.floor(raw / blocks)
  const divisor = rsDivisor(eccLen)
  const parts: { data: number[]; ecc: number[] }[] = []
  for (let i = 0, k = 0; i < blocks; i++) {
    const len = shortLen - eccLen + (i < shortBlocks ? 0 : 1)
    const d = data.slice(k, k + len)
    k += len
    parts.push({ data: d, ecc: rsRemainder(d, divisor) })
  }
  const out: number[] = []
  const maxData = shortLen - eccLen + 1
  for (let i = 0; i < maxData; i++) for (const p of parts) if (i < p.data.length) out.push(p.data[i])
  for (let i = 0; i < eccLen; i++) for (const p of parts) out.push(p.ecc[i])
  return out
}

function alignmentPositions(ver: number): number[] {
  if (ver === 1) return []
  const n = Math.floor(ver / 7) + 2
  const step = ver === 32 ? 26 : Math.ceil((ver * 4 + 4) / (n * 2 - 2)) * 2
  const out = [6]
  for (let pos = ver * 4 + 17 - 7; out.length < n; pos -= step) out.splice(1, 0, pos)
  return out
}

const MASKS: ((x: number, y: number) => boolean)[] = [
  (x, y) => (x + y) % 2 === 0,
  (_x, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => ((((x + y) % 2) + ((x * y) % 3)) % 2) === 0
]

function penalty(m: boolean[][]): number {
  const n = m.length
  let score = 0
  // Runs of five or more in a row or column, and the finder-like pattern 1011101 with four light modules beside it.
  const lines: boolean[][] = []
  for (let i = 0; i < n; i++) {
    lines.push(m[i])
    lines.push(m.map((row) => row[i]))
  }
  for (const line of lines) {
    let run = 1
    for (let i = 1; i <= n; i++) {
      if (i < n && line[i] === line[i - 1]) run++
      else {
        if (run >= 5) score += 3 + (run - 5)
        run = 1
      }
    }
    const s = line.map((v) => (v ? '1' : '0')).join('')
    for (let i = 0; i + 11 <= n; i++) {
      const w = s.slice(i, i + 11)
      if (w === '10111010000' || w === '00001011101') score += 40
    }
  }
  for (let y = 0; y < n - 1; y++) for (let x = 0; x < n - 1; x++) if (m[y][x] === m[y][x + 1] && m[y][x] === m[y + 1][x] && m[y][x] === m[y + 1][x + 1]) score += 3
  const dark = m.reduce((a, row) => a + row.filter(Boolean).length, 0)
  const total = n * n
  score += (Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1) * 10
  return score
}

export interface QrMatrix {
  version: number
  size: number
  mask: number
  /** `modules[y][x]` is true for a dark module. */
  modules: boolean[][]
}

/** Encodes text as a QR code: the smallest version that holds it at the level (or `mask` forced, for testing). */
export function encodeQr(text: string, ecc: QrEcc = 'M', opts: { mask?: number; minVersion?: number } = {}): QrMatrix {
  const mode = modeOf(text)
  let ver = Math.max(1, opts.minVersion ?? 1)
  let seg: Bits
  for (;; ver++) {
    if (ver > 40) throw new Error('That is too much text for a QR code. Shorten it or lower the error correction.')
    seg = qrSegment(text, mode, ver)
    if (seg.bits.length <= qrDataCodewords(ver, ecc) * 8) break
  }
  const capacity = qrDataCodewords(ver, ecc) * 8
  const bits = seg.bits.slice()
  for (let i = 0; i < 4 && bits.length < capacity; i++) bits.push(0)
  while (bits.length % 8) bits.push(0)
  for (let pad = 0xec; bits.length < capacity; pad ^= 0xec ^ 0x11) for (let i = 7; i >= 0; i--) bits.push((pad >>> i) & 1)
  const data: number[] = []
  for (let i = 0; i < bits.length; i += 8) data.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0))
  const words = interleave(data, ver, ecc)

  const size = ver * 4 + 17
  const mod: boolean[][] = Array.from({ length: size }, () => new Array<boolean>(size).fill(false))
  const fn: boolean[][] = Array.from({ length: size }, () => new Array<boolean>(size).fill(false))
  const set = (x: number, y: number, dark: boolean) => {
    mod[y][x] = dark
    fn[y][x] = true
  }
  for (let i = 0; i < size; i++) {
    set(6, i, i % 2 === 0)
    set(i, 6, i % 2 === 0)
  }
  for (const [cx, cy] of [[3, 3], [size - 4, 3], [3, size - 4]]) {
    for (let dy = -4; dy <= 4; dy++)
      for (let dx = -4; dx <= 4; dx++) {
        const x = cx + dx
        const y = cy + dy
        if (x < 0 || y < 0 || x >= size || y >= size) continue
        const d = Math.max(Math.abs(dx), Math.abs(dy))
        set(x, y, d !== 2 && d !== 4)
      }
  }
  const al = alignmentPositions(ver)
  al.forEach((ax, i) =>
    al.forEach((ay, j) => {
      if ((i === 0 && j === 0) || (i === 0 && j === al.length - 1) || (i === al.length - 1 && j === 0)) return
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(ax + dx, ay + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1)
    })
  )
  const formatBits = (mask: number) => {
    const d = (ECC_FORMAT[ecc] << 3) | mask
    let rem = d
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537)
    return ((d << 10) | rem) ^ 0x5412
  }
  const drawFormat = (mask: number) => {
    const b = formatBits(mask)
    const bit = (i: number) => ((b >>> i) & 1) !== 0
    for (let i = 0; i <= 5; i++) set(8, i, bit(i))
    set(8, 7, bit(6))
    set(8, 8, bit(7))
    set(7, 8, bit(8))
    for (let i = 9; i < 15; i++) set(14 - i, 8, bit(i))
    for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(i))
    for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(i))
    set(8, size - 8, true)
  }
  drawFormat(0)
  if (ver >= 7) {
    let rem = ver
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25)
    const b = (ver << 12) | rem
    for (let i = 0; i < 18; i++) {
      const dark = ((b >>> i) & 1) !== 0
      const a = size - 11 + (i % 3)
      const c = Math.floor(i / 3)
      set(a, c, dark)
      set(c, a, dark)
    }
  }
  // Data, zig-zagging up and down pairs of columns from the right.
  let k = 0
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5
    for (let v = 0; v < size; v++)
      for (let j = 0; j < 2; j++) {
        const x = right - j
        const up = ((right + 1) & 2) === 0
        const y = up ? size - 1 - v : v
        if (!fn[y][x] && k < words.length * 8) {
          mod[y][x] = ((words[k >>> 3] >>> (7 - (k & 7))) & 1) !== 0
          k++
        }
      }
  }
  const masked = (mask: number) => {
    const m = mod.map((row) => row.slice())
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (!fn[y][x] && MASKS[mask](x, y)) m[y][x] = !m[y][x]
    return m
  }
  const withFormat = (mask: number): boolean[][] => {
    const m = masked(mask)
    const keep = mod.map((row) => row.slice())
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) mod[y][x] = m[y][x]
    drawFormat(mask)
    const out = mod.map((row) => row.slice())
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) mod[y][x] = keep[y][x]
    return out
  }
  let best = opts.mask ?? 0
  let bestModules = withFormat(best)
  if (opts.mask === undefined) {
    let low = penalty(bestModules)
    for (let mask = 1; mask < 8; mask++) {
      const m = withFormat(mask)
      const p = penalty(m)
      if (p < low) {
        low = p
        best = mask
        bestModules = m
      }
    }
  }
  return { version: ver, size, mask: best, modules: bestModules }
}

function qrShape(text: string, ecc: QrEcc): BarcodeShape {
  const q = encodeQr(text, ecc)
  const rects: BarRect[] = []
  for (let y = 0; y < q.size; y++) {
    for (let x = 0; x < q.size; ) {
      if (!q.modules[y][x]) {
        x++
        continue
      }
      let end = x
      while (end < q.size && q.modules[y][end]) end++
      rects.push({ x, y, w: end - x, h: 1 })
      x = end
    }
  }
  return { width: q.size, height: q.size, rects, is2d: true, label: '' }
}

// ---- Bar codes -----------------------------------------------------------------------------------------------

/** Bars from a run of module widths that starts with a bar and alternates bar, space. */
function barsFromWidths(widths: number[]): { rects: BarRect[]; width: number } {
  const rects: BarRect[] = []
  let x = 0
  widths.forEach((w, i) => {
    if (i % 2 === 0) rects.push({ x, y: 0, w, h: 1 })
    x += w
  })
  return { rects, width: x }
}

/** Bars from a string of 1 (dark) and 0 (light) modules. */
function barsFromModules(bits: string): { rects: BarRect[]; width: number } {
  const rects: BarRect[] = []
  for (let i = 0; i < bits.length; ) {
    if (bits[i] !== '1') {
      i++
      continue
    }
    let end = i
    while (end < bits.length && bits[end] === '1') end++
    rects.push({ x: i, y: 0, w: end - i, h: 1 })
    i = end
  }
  return { rects, width: bits.length }
}

// Code 128: the widths of the bars and spaces of each of the 107 symbols (bar first), then the stop symbol.
const C128 =
  '212222 222122 222221 121223 121322 131222 122213 122312 132212 221213 221312 231212 112232 122132 122231 113222 123122 123221 223211 221132 221231 213212 223112 312131 311222 321122 321221 312212 322112 322211 212123 212321 232121 111323 131123 131321 112313 132113 132311 211313 231113 231311 112133 112331 132131 113123 113321 133121 313121 211331 231131 213113 213311 213131 311123 311321 331121 312113 312311 332111 314111 221411 431111 111224 111422 121124 121421 141122 141221 112214 112412 122114 122411 142112 142211 241211 221114 413111 241112 134111 111242 121142 121241 114212 124112 124211 411212 421112 421211 212141 214121 412121 111143 111341 131141 114113 114311 411113 411311 113141 114131 311141 411131 211412 211214 211232 2331112'.split(' ')

/** Bar and space widths of the 107 symbols (values 0 to 106) and the stop pattern, as digits. */
export const CODE128_PATTERNS = C128

const START_A = 103
const START_B = 104
const START_C = 105
const STOP = 106

/** The symbol values for a text: Code C for runs of digits, Code B for text, Code A for control characters. */
export function code128Values(text: string): number[] {
  if (!text) throw new Error('Type the text for the bar code.')
  const chars = [...text]
  for (const c of chars) if (c.charCodeAt(0) > 127) throw new Error('Code 128 here takes plain ASCII characters only. Use a QR code for other text.')
  const digitRun = (i: number) => {
    let n = 0
    while (i + n < chars.length && /[0-9]/.test(chars[i + n])) n++
    return n
  }
  const out: number[] = []
  let set: 'A' | 'B' | 'C' | null = null
  const wantsA = (c: string) => c.charCodeAt(0) < 32
  const wantsB = (c: string) => c.charCodeAt(0) >= 96
  let i = 0
  while (i < chars.length) {
    const run = digitRun(i)
    // Digits pair up in Code C: worth it for four or more (the whole text of two or more digits too).
    if (run >= 4 || (run >= 2 && run === chars.length && i === 0)) {
      // An odd digit left over at the end of the run is sent in Code B after the pairs.
      const n = Math.floor(run / 2) * 2
      if (set === null) out.push(START_C)
      else if (set !== 'C') out.push(99)
      set = 'C'
      for (let k = 0; k < n; k += 2) out.push(Number(chars[i + k] + chars[i + k + 1]))
      i += n
      continue
    }
    const c = chars[i]
    const cc = c.charCodeAt(0)
    if (set === null) {
      // Start in A when a control character comes before any lower-case letter, else in B.
      const first = chars.slice(i).find((x) => wantsA(x) || wantsB(x))
      set = first !== undefined && wantsA(first) ? 'A' : 'B'
      out.push(set === 'A' ? START_A : START_B)
    } else if (set === 'C' || (set === 'A' && wantsB(c)) || (set === 'B' && wantsA(c))) {
      const target = wantsA(c) ? 'A' : 'B'
      out.push(target === 'A' ? 101 : 100)
      set = target
    }
    out.push(set === 'A' ? (cc < 32 ? cc + 64 : cc - 32) : cc - 32)
    i++
  }
  const start = out[0]
  let sum = start
  for (let k = 1; k < out.length; k++) sum += out[k] * k
  out.push(sum % 103, STOP)
  return out
}

function code128Shape(text: string): BarcodeShape {
  const widths = code128Values(text)
    .map((v) => C128[v])
    .join('')
    .split('')
    .map(Number)
  const b = barsFromWidths(widths)
  return { width: b.width, height: 1, rects: b.rects, is2d: false, label: text.replace(/[^\x20-\x7e]/g, '') }
}

// Code 39: nine elements per character (bar, space, bar ...), 1 narrow or 2 wide.
const C39: Record<string, string> = {
  '0': 'nnnwwnwnn', '1': 'wnnwnnnnw', '2': 'nnwwnnnnw', '3': 'wnwwnnnnn', '4': 'nnnwwnnnw', '5': 'wnnwwnnnn', '6': 'nnwwwnnnn', '7': 'nnnwnnwnw', '8': 'wnnwnnwnn', '9': 'nnwwnnwnn',
  A: 'wnnnnwnnw', B: 'nnwnnwnnw', C: 'wnwnnwnnn', D: 'nnnnwwnnw', E: 'wnnnwwnnn', F: 'nnwnwwnnn', G: 'nnnnnwwnw', H: 'wnnnnwwnn', I: 'nnwnnwwnn', J: 'nnnnwwwnn',
  K: 'wnnnnnnww', L: 'nnwnnnnww', M: 'wnwnnnnwn', N: 'nnnnwnnww', O: 'wnnnwnnwn', P: 'nnwnwnnwn', Q: 'nnnnnnwww', R: 'wnnnnnwwn', S: 'nnwnnnwwn', T: 'nnnnwnwwn',
  U: 'wwnnnnnnw', V: 'nwwnnnnnw', W: 'wwwnnnnnn', X: 'nwnnwnnnw', Y: 'wwnnwnnnn', Z: 'nwwnwnnnn',
  '-': 'nwnnnnwnw', '.': 'wwnnnnwnn', ' ': 'nwwnnnwnn', '*': 'nwnnwnwnn', $: 'nwnwnwnnn', '/': 'nwnwnnnwn', '+': 'nwnnnwnwn', '%': 'nnnwnwnwn'
}

function code39Shape(text: string): BarcodeShape {
  const t = text.toUpperCase()
  if (!t) throw new Error('Type the text for the bar code.')
  for (const c of t) if (c === '*' || !(c in C39)) throw new Error(`Code 39 cannot show "${c}". It takes capital letters, digits and - . space $ / + %.`)
  const widths: number[] = []
  const WIDE = 3
  const chars = ['*', ...t, '*']
  chars.forEach((c, k) => {
    if (k > 0) widths.push(1)
    for (const e of C39[c]) widths.push(e === 'w' ? WIDE : 1)
  })
  const b = barsFromWidths(widths)
  return { width: b.width, height: 1, rects: b.rects, is2d: false, label: t }
}

// EAN-13
const EAN_L = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011']
const EAN_R = EAN_L.map((p) => [...p].map((c) => (c === '1' ? '0' : '1')).join(''))
const EAN_G = EAN_R.map((p) => [...p].reverse().join(''))
const EAN_PARITY = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL']

/** The check digit that follows twelve digits. */
export function ean13Check(twelve: string): number {
  let sum = 0
  for (let i = 0; i < 12; i++) sum += Number(twelve[i]) * (i % 2 === 0 ? 1 : 3)
  return (10 - (sum % 10)) % 10
}

function ean13Shape(text: string): BarcodeShape {
  const digits = text.replace(/\s/g, '')
  if (!/^\d{12,13}$/.test(digits)) throw new Error('EAN-13 needs 12 digits (the check digit is added) or 13 digits.')
  const full = digits.length === 12 ? digits + ean13Check(digits) : digits
  if (Number(full[12]) !== ean13Check(full.slice(0, 12))) throw new Error(`The check digit should be ${ean13Check(full.slice(0, 12))}.`)
  const parity = EAN_PARITY[Number(full[0])]
  let bits = '101'
  for (let i = 0; i < 6; i++) bits += (parity[i] === 'L' ? EAN_L : EAN_G)[Number(full[i + 1])]
  bits += '01010'
  for (let i = 7; i < 13; i++) bits += EAN_R[Number(full[i])]
  bits += '101'
  const b = barsFromModules(bits)
  return { width: b.width, height: 1, rects: b.rects, is2d: false, label: full }
}

/** The shapes of a symbol; throws a readable error when the text does not suit the symbology. */
export function barcodeShape(kind: BarcodeKind, text: string, ecc: QrEcc = 'M'): BarcodeShape {
  if (kind === 'qr') {
    if (!text) throw new Error('Type the text for the QR code.')
    return qrShape(text, ecc)
  }
  if (kind === 'code128') return code128Shape(text)
  if (kind === 'code39') return code39Shape(text)
  return ean13Shape(text)
}

// ---- Text templates ------------------------------------------------------------------------------------------

export interface TemplateValues {
  filename: string
  page: number
  pages: number
  date: Date
}

const two = (n: number) => String(n).padStart(2, '0')

/** DD/MM/YYYY */
export const australianDate = (d: Date): string => `${two(d.getDate())}/${two(d.getMonth() + 1)}/${d.getFullYear()}`

export const TEMPLATE_TOKENS = ['{filename}', '{page}', '{pages}', '{date}'] as const

/** Fills {filename} (without .pdf), {page}, {pages} and {date} (DD/MM/YYYY); other braces are left as typed. */
export function fillTemplate(template: string, v: TemplateValues): string {
  return template.replace(/\{(filename|page|pages|date)\}/g, (_, k: string) => (k === 'filename' ? v.filename.replace(/\.pdf$/i, '') : k === 'page' ? String(v.page) : k === 'pages' ? String(v.pages) : australianDate(v.date)))
}
