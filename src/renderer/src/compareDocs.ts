/**
 * Comparing two documents. Text: the words of each are lined up with a shortest-edit-script diff (Myers' O(ND)
 * algorithm, after trimming what the two share at each end), and the differences are grouped into changes with a
 * little context and the pages they are on. Visual: two page pictures are laid over each other and the pixels that
 * differ are marked.
 */

export interface Token {
  text: string
  /** Zero-based page of the word. */
  page: number
}

export type DiffType = 'same' | 'add' | 'del'

export interface DiffOp {
  type: DiffType
  text: string
  pageA?: number
  pageB?: number
}

const key = (t: Token) => t.text

/**
 * Shortest edit script between two token lists. Returns operations in order. `maxEdits` stops a hopeless comparison
 * (two unrelated documents): the rest is then reported as one block of deletions and one of additions.
 */
export function diffTokens(a: Token[], b: Token[], maxEdits = 6000): DiffOp[] {
  // Trim the shared start and end: most comparisons are two near-identical documents.
  let start = 0
  while (start < a.length && start < b.length && key(a[start]) === key(b[start])) start++
  let endA = a.length
  let endB = b.length
  while (endA > start && endB > start && key(a[endA - 1]) === key(b[endB - 1])) {
    endA--
    endB--
  }
  const out: DiffOp[] = []
  for (let i = 0; i < start; i++) out.push({ type: 'same', text: a[i].text, pageA: a[i].page, pageB: b[i].page })
  out.push(...myers(a.slice(start, endA), b.slice(start, endB), maxEdits))
  for (let k = 0; endA + k < a.length; k++) out.push({ type: 'same', text: a[endA + k].text, pageA: a[endA + k].page, pageB: b[endB + k].page })
  return out
}

function myers(a: Token[], b: Token[], maxEdits: number): DiffOp[] {
  const n = a.length
  const m = b.length
  if (!n) return b.map((t) => ({ type: 'add', text: t.text, pageB: t.page }))
  if (!m) return a.map((t) => ({ type: 'del', text: t.text, pageA: t.page }))
  const max = Math.min(n + m, maxEdits)
  const v = new Int32Array(2 * max + 2)
  const trace: Int32Array[] = []
  let found = -1
  for (let d = 0; d <= max && found < 0; d++) {
    trace.push(v.slice())
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[max + k - 1] < v[max + k + 1]) ? v[max + k + 1] : v[max + k - 1] + 1
      let y = x - k
      while (x < n && y < m && key(a[x]) === key(b[y])) {
        x++
        y++
      }
      v[max + k] = x
      if (x >= n && y >= m) {
        found = d
        break
      }
    }
  }
  if (found < 0) {
    // Too different to line up: everything that is left is a replacement.
    return [...a.map((t): DiffOp => ({ type: 'del', text: t.text, pageA: t.page })), ...b.map((t): DiffOp => ({ type: 'add', text: t.text, pageB: t.page }))]
  }
  // Walk back through the saved states to recover the path.
  const ops: DiffOp[] = []
  let x = n
  let y = m
  for (let d = found; d > 0; d--) {
    const vd = trace[d]
    const k = x - y
    const down = k === -d || (k !== d && vd[max + k - 1] < vd[max + k + 1])
    const prevK = down ? k + 1 : k - 1
    const prevX = vd[max + prevK]
    const prevY = prevX - prevK
    while (x > prevX && y > prevY) {
      x--
      y--
      ops.push({ type: 'same', text: a[x].text, pageA: a[x].page, pageB: b[y].page })
    }
    if (down) {
      y--
      ops.push({ type: 'add', text: b[y].text, pageB: b[y].page })
    } else {
      x--
      ops.push({ type: 'del', text: a[x].text, pageA: a[x].page })
    }
  }
  while (x > 0 && y > 0) {
    x--
    y--
    ops.push({ type: 'same', text: a[x].text, pageA: a[x].page, pageB: b[y].page })
  }
  return ops.reverse()
}

/** Words of each page, in order, with their page. Punctuation stays attached to its word. */
export function tokenise(pages: string[]): Token[] {
  const out: Token[] = []
  pages.forEach((text, page) => {
    for (const w of text.split(/\s+/)) if (w) out.push({ text: w, page })
  })
  return out
}

export interface Change {
  /** What was in the first document and what is in the second (either may be empty). */
  removed: string
  added: string
  /** Words before and after, for reading the change in place. */
  before: string
  after: string
  /** Pages (zero-based) in each document, or null when that side has none (a pure addition or deletion). */
  pageA: number | null
  pageB: number | null
}

/** Groups a diff into changes: each run of non-matching words, with up to `context` matching words either side. */
export function groupChanges(ops: DiffOp[], context = 6): Change[] {
  const changes: Change[] = []
  let i = 0
  while (i < ops.length) {
    if (ops[i].type === 'same') {
      i++
      continue
    }
    const startAt = i
    const del: DiffOp[] = []
    const add: DiffOp[] = []
    while (i < ops.length && ops[i].type !== 'same') {
      if (ops[i].type === 'del') del.push(ops[i])
      else add.push(ops[i])
      i++
    }
    const before: string[] = []
    for (let k = startAt - 1; k >= 0 && before.length < context && ops[k].type === 'same'; k--) before.unshift(ops[k].text)
    const after: string[] = []
    for (let k = i; k < ops.length && after.length < context && ops[k].type === 'same'; k++) after.push(ops[k].text)
    const near = ops[startAt - 1]?.pageA ?? ops[i]?.pageA ?? null
    const nearB = ops[startAt - 1]?.pageB ?? ops[i]?.pageB ?? null
    changes.push({
      removed: del.map((o) => o.text).join(' '),
      added: add.map((o) => o.text).join(' '),
      before: before.join(' '),
      after: after.join(' '),
      pageA: del[0]?.pageA ?? near,
      pageB: add[0]?.pageB ?? nearB
    })
  }
  return changes
}

// ---- Visual -------------------------------------------------------------------------------------------

export interface VisualDiff {
  /** RGBA overlay: matching content in grey, what only the first has in red, what only the second has in blue. */
  overlay: Uint8ClampedArray<ArrayBuffer>
  width: number
  height: number
  /** Share of pixels that differ noticeably, 0 to 1. */
  changed: number
}

/** Pixels that differ by more than this (summed over R, G and B) count as changed. */
const THRESHOLD = 48

/**
 * Lays page picture `a` over `b`. Both are RGBA of the same size (the caller pads to a common size). Matching
 * pixels are drawn light grey with their darkness kept; pixels dark only in `a` are red, dark only in `b` blue.
 */
export function visualDiff(a: Uint8Array, b: Uint8Array, width: number, height: number): VisualDiff {
  const out = new Uint8ClampedArray(new ArrayBuffer(width * height * 4))
  let changed = 0
  for (let p = 0; p < width * height; p++) {
    const i = p * 4
    const la = (a[i] + a[i + 1] + a[i + 2]) / 3
    const lb = (b[i] + b[i + 1] + b[i + 2]) / 3
    const delta = Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2])
    if (delta > THRESHOLD) {
      changed++
      // Darker in a: a has ink that b lacks (red). Darker in b: blue.
      if (la < lb) {
        out[i] = 220
        out[i + 1] = 50
        out[i + 2] = 50
      } else {
        out[i] = 40
        out[i + 1] = 90
        out[i + 2] = 230
      }
    } else {
      const g = 255 - (255 - la) * 0.35
      out[i] = out[i + 1] = out[i + 2] = g
    }
    out[i + 3] = 255
  }
  return { overlay: out, width, height, changed: changed / (width * height) }
}

/** Copies an RGBA image onto a white canvas of a larger size, top-left aligned. */
export function padTo(src: Uint8Array, w: number, h: number, width: number, height: number): Uint8Array {
  if (w === width && h === height) return src
  const out = new Uint8Array(width * height * 4).fill(255)
  for (let y = 0; y < Math.min(h, height); y++) out.set(src.subarray(y * w * 4, y * w * 4 + Math.min(w, width) * 4), y * width * 4)
  return out
}
