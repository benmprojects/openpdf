/**
 * Thin helpers over PDFium's C API for features @hyzyla/pdfium does not wrap (outline, character boxes).
 * They reach into the wrapper's private fields: `module` (Emscripten module), `documentIdx` (FPDF_DOCUMENT)
 * and `pageIdx` (FPDF_PAGE). Pin the @hyzyla/pdfium version and re-check these if it is upgraded.
 */
import type { PDFiumDocument, PDFiumLibrary, PDFiumPage } from '@hyzyla/pdfium'

export interface OutlineNode {
  title: string
  /** Zero-based page index, or -1 when the bookmark has no page destination. */
  page: number
  children: OutlineNode[]
}

export interface PageText {
  /** All characters of the page, in reading order, as one string. */
  text: string
  /** Per character: left, top, right, bottom in points, origin top-left of the rendered page. */
  boxes: Float32Array
  /** For each UTF-16 unit of `text`, the index of the character it came from. */
  charOf: Int32Array
}

type RawModule = {
  HEAPU8: Uint8Array
  wasmExports: { malloc(n: number): number; free(p: number): void }
  [fn: `_${string}`]: (...args: number[]) => number
}

const raw = (lib: PDFiumLibrary) => (lib as unknown as { module: RawModule }).module
const docHandle = (doc: PDFiumDocument) => (doc as unknown as { documentIdx: number }).documentIdx
const pageHandle = (page: PDFiumPage) => (page as unknown as { pageIdx: number }).pageIdx

const MAX_OUTLINE_NODES = 20000
const MAX_OUTLINE_DEPTH = 32

function readUtf16(m: RawModule, size: (buf: number, len: number) => number): string {
  const bytes = size(0, 0)
  if (bytes <= 2) return ''
  const buf = m.wasmExports.malloc(bytes)
  try {
    size(buf, bytes)
    return new TextDecoder('utf-16le').decode(m.HEAPU8.slice(buf, buf + bytes - 2))
  } finally {
    m.wasmExports.free(buf)
  }
}

export function readOutline(lib: PDFiumLibrary, doc: PDFiumDocument): OutlineNode[] {
  const m = raw(lib)
  const d = docHandle(doc)
  const seen = new Set<number>()
  let budget = MAX_OUTLINE_NODES

  const walk = (first: number, depth: number): OutlineNode[] => {
    const nodes: OutlineNode[] = []
    for (let bm = first; bm && budget > 0; bm = m._FPDFBookmark_GetNextSibling(d, bm)) {
      if (seen.has(bm)) break // malformed file with a cyclic sibling chain
      seen.add(bm)
      budget--
      const title = readUtf16(m, (buf, len) => m._FPDFBookmark_GetTitle(bm, buf, len))
      let dest = m._FPDFBookmark_GetDest(d, bm)
      if (!dest) {
        const action = m._FPDFBookmark_GetAction(bm)
        if (action) dest = m._FPDFAction_GetDest(d, action)
      }
      const page = dest ? m._FPDFDest_GetDestPageIndex(d, dest) : -1
      const child = depth < MAX_OUTLINE_DEPTH ? m._FPDFBookmark_GetFirstChild(d, bm) : 0
      nodes.push({ title, page, children: child ? walk(child, depth + 1) : [] })
    }
    return nodes
  }

  return walk(m._FPDFBookmark_GetFirstChild(d, 0), 0)
}

export function readPageText(lib: PDFiumLibrary, page: PDFiumPage): PageText {
  const m = raw(lib)
  const p = pageHandle(page)
  const { originalWidth: w, originalHeight: h } = page.getOriginalSize()
  // PageToDevice returns integers, so map the page onto an 8x grid and divide back to keep 1/8 pt precision.
  const GRID = 8
  const sx = Math.round(w * GRID)
  const sy = Math.round(h * GRID)

  const tp = m._FPDFText_LoadPage(p)
  if (!tp) return { text: '', boxes: new Float32Array(0), charOf: new Int32Array(0) }
  const scratch = m.wasmExports.malloc(64)
  try {
    const n = m._FPDFText_CountChars(tp)
    const boxes = new Float32Array(n * 4)
    const parts: string[] = []
    const charOf: number[] = []
    const dv = () => new DataView(m.HEAPU8.buffer)

    for (let i = 0; i < n; i++) {
      const cp = m._FPDFText_GetUnicode(tp, i)
      const ch = cp > 0 && cp <= 0x10ffff && !(cp >= 0xd800 && cp <= 0xdfff) ? String.fromCodePoint(cp) : ' '
      parts.push(ch)
      for (let u = 0; u < ch.length; u++) charOf.push(i)

      // The loose box spans the full font height, so highlights on a line are uniform; fall back to the tight glyph box.
      let left: number, right: number, bottom: number, top: number
      if (m._FPDFText_GetLooseCharBox(tp, i, scratch)) {
        const f = new DataView(m.HEAPU8.buffer)
        left = f.getFloat32(scratch, true)
        top = f.getFloat32(scratch + 4, true)
        right = f.getFloat32(scratch + 8, true)
        bottom = f.getFloat32(scratch + 12, true)
      } else if (m._FPDFText_GetCharBox(tp, i, scratch, scratch + 8, scratch + 16, scratch + 24)) {
        const v = new DataView(m.HEAPU8.buffer)
        left = v.getFloat64(scratch, true)
        right = v.getFloat64(scratch + 8, true)
        bottom = v.getFloat64(scratch + 16, true)
        top = v.getFloat64(scratch + 24, true)
      } else continue
      m._FPDF_PageToDevice(p, 0, 0, sx, sy, 0, left, top, scratch + 32, scratch + 36)
      m._FPDF_PageToDevice(p, 0, 0, sx, sy, 0, right, bottom, scratch + 40, scratch + 44)
      const v2 = dv()
      const x1 = v2.getInt32(scratch + 32, true) / GRID
      const y1 = v2.getInt32(scratch + 36, true) / GRID
      const x2 = v2.getInt32(scratch + 40, true) / GRID
      const y2 = v2.getInt32(scratch + 44, true) / GRID
      boxes[i * 4] = Math.min(x1, x2)
      boxes[i * 4 + 1] = Math.min(y1, y2)
      boxes[i * 4 + 2] = Math.max(x1, x2)
      boxes[i * 4 + 3] = Math.max(y1, y2)
    }
    return { text: parts.join(''), boxes, charOf: Int32Array.from(charOf) }
  } finally {
    m.wasmExports.free(scratch)
    m._FPDFText_ClosePage(tp)
  }
}
