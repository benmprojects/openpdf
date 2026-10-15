/**
 * Page content streams (ISO 32000 7.8.2 and 8): a tokenizer and operation parser, enough to find, remove and add
 * text-showing and drawing operators without disturbing the rest of the stream. Streams are handled as Latin-1
 * strings (one character per byte), and every operation keeps its source range, so unchanged operations are
 * copied byte for byte.
 */

export type Tok =
  | { t: 'num'; v: number }
  | { t: 'name'; v: string }
  /** A literal or hex string, as its raw bytes (one character per byte). */
  | { t: 'str'; v: string }
  | { t: 'arr'; v: Tok[] }
  | { t: 'dict'; v: Tok[] }
  | { t: 'other'; v: string }

export interface Op {
  op: string
  operands: Tok[]
  /** Source range [start, end) of the operation, operands included (and the image data of an inline image). */
  start: number
  end: number
}

const WS = new Set([0, 9, 10, 12, 13, 32])
const DELIM = new Set(['(', ')', '<', '>', '[', ']', '{', '}', '/', '%'])

const isWs = (c: string) => WS.has(c.charCodeAt(0))

export function bytesToString(b: Uint8Array): string {
  let s = ''
  for (let i = 0; i < b.length; i += 8192) s += String.fromCharCode(...b.subarray(i, i + 8192))
  return s
}

export function stringToBytes(s: string): Uint8Array {
  const b = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 255
  return b
}

class Lexer {
  pos = 0
  constructor(readonly s: string) {}

  skipSpace(): void {
    const s = this.s
    while (this.pos < s.length) {
      const c = s[this.pos]
      if (isWs(c)) this.pos++
      else if (c === '%') while (this.pos < s.length && s[this.pos] !== '\n' && s[this.pos] !== '\r') this.pos++
      else break
    }
  }

  /** The next token, or an operator keyword as `{ t: 'other' }`; null at the end. */
  next(): Tok | null {
    this.skipSpace()
    const s = this.s
    if (this.pos >= s.length) return null
    const c = s[this.pos]
    if (c === '(') return { t: 'str', v: this.literal() }
    if (c === '<') {
      if (s[this.pos + 1] === '<') {
        this.pos += 2
        const items: Tok[] = []
        for (;;) {
          this.skipSpace()
          if (this.pos >= s.length) break
          if (s[this.pos] === '>' && s[this.pos + 1] === '>') {
            this.pos += 2
            break
          }
          const t = this.next()
          if (!t) break
          items.push(t)
        }
        return { t: 'dict', v: items }
      }
      return { t: 'str', v: this.hex() }
    }
    if (c === '[') {
      this.pos++
      const items: Tok[] = []
      for (;;) {
        this.skipSpace()
        if (this.pos >= s.length) break
        if (s[this.pos] === ']') {
          this.pos++
          break
        }
        const t = this.next()
        if (!t) break
        items.push(t)
      }
      return { t: 'arr', v: items }
    }
    if (c === '/') {
      this.pos++
      const start = this.pos
      while (this.pos < s.length && !isWs(s[this.pos]) && !DELIM.has(s[this.pos])) this.pos++
      return { t: 'name', v: s.slice(start, this.pos).replace(/#([0-9A-Fa-f]{2})/g, (_, h: string) => String.fromCharCode(parseInt(h, 16))) }
    }
    if (c === ')' || c === ']' || c === '>' || c === '{' || c === '}') {
      this.pos++
      return { t: 'other', v: c }
    }
    const start = this.pos
    while (this.pos < s.length && !isWs(s[this.pos]) && !DELIM.has(s[this.pos])) this.pos++
    const word = s.slice(start, this.pos)
    if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(word)) return { t: 'num', v: parseFloat(word) }
    return { t: 'other', v: word }
  }

  private literal(): string {
    const s = this.s
    this.pos++ // (
    let depth = 1
    let out = ''
    while (this.pos < s.length) {
      const c = s[this.pos++]
      if (c === '\\') {
        const e = s[this.pos++]
        if (e === 'n') out += '\n'
        else if (e === 'r') out += '\r'
        else if (e === 't') out += '\t'
        else if (e === 'b') out += '\b'
        else if (e === 'f') out += '\f'
        else if (e >= '0' && e <= '7') {
          let oct = e
          while (oct.length < 3 && s[this.pos] >= '0' && s[this.pos] <= '7') oct += s[this.pos++]
          out += String.fromCharCode(parseInt(oct, 8) & 255)
        } else if (e === '\r') {
          if (s[this.pos] === '\n') this.pos++
        } else if (e === '\n') {
          /* line continuation */
        } else if (e !== undefined) out += e
      } else if (c === '(') {
        depth++
        out += c
      } else if (c === ')') {
        if (--depth === 0) return out
        out += c
      } else out += c
    }
    return out
  }

  private hex(): string {
    const s = this.s
    this.pos++ // <
    let h = ''
    while (this.pos < s.length && s[this.pos] !== '>') {
      if (/[0-9A-Fa-f]/.test(s[this.pos])) h += s[this.pos]
      this.pos++
    }
    this.pos++
    if (h.length % 2) h += '0'
    let out = ''
    for (let i = 0; i < h.length; i += 2) out += String.fromCharCode(parseInt(h.slice(i, i + 2), 16))
    return out
  }
}

/** Splits a content stream into operations. Unknown tokens are kept as operations of their own. */
export function parseContent(src: string): Op[] {
  const lx = new Lexer(src)
  const ops: Op[] = []
  let operands: Tok[] = []
  let start = -1
  for (;;) {
    lx.skipSpace()
    const at = lx.pos
    const t = lx.next()
    if (!t) break
    if (start < 0) start = at
    if (t.t !== 'other') {
      operands.push(t)
      continue
    }
    const op = t.v
    if (op === 'BI') {
      // Inline image: key/value pairs up to ID, then raw data up to a whitespace-delimited EI.
      const dict: Tok[] = []
      for (;;) {
        const k = lx.next()
        if (!k || (k.t === 'other' && k.v === 'ID')) break
        dict.push(k)
      }
      let p = lx.pos
      if (p < src.length && isWs(src[p])) p++
      let end = src.length
      for (let i = p; i < src.length - 1; i++) {
        if (src[i] === 'E' && src[i + 1] === 'I' && (i === p || isWs(src[i - 1])) && (i + 2 >= src.length || isWs(src[i + 2]))) {
          end = i + 2
          break
        }
      }
      lx.pos = end
      ops.push({ op: 'BI', operands: [{ t: 'dict', v: dict }], start, end })
    } else {
      ops.push({ op, operands, start, end: lx.pos })
    }
    operands = []
    start = -1
  }
  return ops
}

/** Operators that show text (ISO 32000 9.4.3): each makes one text object in PDFium. */
export const SHOW_OPS = new Set(['Tj', 'TJ', "'", '"'])

export const isShow = (o: Op) => SHOW_OPS.has(o.op)

/** The string bytes a show operation draws, joined (TJ adjustments dropped). */
export function showBytes(o: Op): string {
  if (o.op === 'TJ') {
    const a = o.operands[0]
    return a && a.t === 'arr' ? a.v.map((x) => (x.t === 'str' ? x.v : '')).join('') : ''
  }
  const last = o.operands[o.operands.length - 1]
  return last && last.t === 'str' ? last.v : ''
}

/** A string as a PDF hex string literal, for bytes (one character per byte). */
export function hexString(bytes: string): string {
  let h = '<'
  for (let i = 0; i < bytes.length; i++) h += bytes.charCodeAt(i).toString(16).padStart(2, '0')
  return h + '>'
}

/** Formats a number for a content stream: no exponent, trimmed zeros. */
export function num(n: number): string {
  if (!Number.isFinite(n)) return '0'
  const s = n.toFixed(4)
  return s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s
}

/** Source with the given operations removed (their text and the whitespace before them); everything else is untouched. */
export function removeOps(src: string, ops: Op[], drop: Set<number>): string {
  let out = ''
  let at = 0
  ops.forEach((o, i) => {
    if (!drop.has(i)) return
    // Also drop the whitespace before the operation, so removing it leaves no double space behind.
    let cut = o.start
    while (cut > at && isWs(src[cut - 1])) cut--
    out += src.slice(at, cut)
    at = o.end
  })
  return out + src.slice(at)
}

type Matrix = [number, number, number, number, number, number]

/** `m` then `n`, for row vectors (the PDF convention): the matrix that applies m first. */
function mul(m: Matrix, n: Matrix): Matrix {
  return [m[0] * n[0] + m[1] * n[2], m[0] * n[1] + m[1] * n[3], m[2] * n[0] + m[3] * n[2], m[2] * n[1] + m[3] * n[3], m[4] * n[0] + m[5] * n[2] + n[4], m[4] * n[1] + m[5] * n[3] + n[5]]
}

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0]
const nums = (o: Op): number[] => o.operands.filter((t): t is { t: 'num'; v: number } => t.t === 'num').map((t) => t.v)

/**
 * Where each text-showing operation starts, in page space (the origin of its first glyph), or null when it runs on
 * from a previous one (whose width is not known here). Follows q, Q, cm, BT, Tm, Td, TD, T*, TL, ' and ".
 */
export function showOrigins(ops: Op[]): ({ x: number; y: number } | null)[] {
  let ctm: Matrix = IDENTITY
  const stack: Matrix[] = []
  let tlm: Matrix = IDENTITY
  let leading = 0
  let known = false
  const out: ({ x: number; y: number } | null)[] = []
  const origin = (): { x: number; y: number } => {
    const p = mul(tlm, ctm)
    return { x: p[4], y: p[5] }
  }
  const move = (tx: number, ty: number) => {
    tlm = mul([1, 0, 0, 1, tx, ty], tlm)
    known = true
  }
  for (const o of ops) {
    const n = nums(o)
    switch (o.op) {
      case 'q':
        stack.push(ctm)
        break
      case 'Q':
        ctm = stack.pop() ?? ctm
        break
      case 'cm':
        if (n.length === 6) ctm = mul(n as Matrix, ctm)
        break
      case 'BT':
        tlm = IDENTITY
        known = true
        break
      case 'Tm':
        if (n.length === 6) {
          tlm = n as Matrix
          known = true
        }
        break
      case 'Td':
        if (n.length === 2) move(n[0], n[1])
        break
      case 'TD':
        if (n.length === 2) {
          leading = -n[1]
          move(n[0], n[1])
        }
        break
      case 'TL':
        if (n.length === 1) leading = n[0]
        break
      case 'T*':
        move(0, -leading)
        break
      case "'":
      case '"':
        move(0, -leading)
        out.push(origin())
        known = false
        break
      case 'Tj':
      case 'TJ':
        out.push(known ? origin() : null)
        known = false
        break
    }
  }
  return out
}

export type Matrix6 = Matrix

export const matMul = mul

/** The inverse of an affine matrix, or null when it is singular. */
export function matInverse(m: Matrix): Matrix | null {
  const det = m[0] * m[3] - m[1] * m[2]
  if (Math.abs(det) < 1e-12) return null
  const a = m[3] / det
  const b = -m[1] / det
  const c = -m[2] / det
  const d = m[0] / det
  return [a, b, c, d, -(m[4] * a + m[5] * c), -(m[4] * b + m[5] * d)]
}

export interface ImageDraw {
  /** Index of the operation in the parsed list: a `Do` of an image, or a `BI` inline image. */
  index: number
  /** The transform in force: maps the image's unit square to the page. */
  ctm: Matrix
  /** The XObject's resource name, or undefined for an inline image. */
  name?: string
}

/** Every image the content draws, in order, with the transform it is drawn under. `isImage` says whether an XObject name is an image. */
export function imageDraws(ops: Op[], isImage: (name: string) => boolean): ImageDraw[] {
  let ctm: Matrix = IDENTITY
  const stack: Matrix[] = []
  const out: ImageDraw[] = []
  ops.forEach((o, index) => {
    if (o.op === 'q') stack.push(ctm)
    else if (o.op === 'Q') ctm = stack.pop() ?? ctm
    else if (o.op === 'cm') {
      const n = nums(o)
      if (n.length === 6) ctm = mul(n as Matrix, ctm)
    } else if (o.op === 'BI') out.push({ index, ctm })
    else if (o.op === 'Do') {
      const name = o.operands[0]
      if (name && name.t === 'name' && isImage(name.v)) out.push({ index, ctm, name: name.v })
    }
  })
  return out
}

/** Formats a matrix as a `cm` operation. */
export function cmOp(m: Matrix): string {
  return `${m.map(num).join(' ')} cm`
}
