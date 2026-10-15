/**
 * Thin helpers over PDFium's C API for features @hyzyla/pdfium does not wrap (outline, character boxes).
 * They reach into the wrapper's private fields: `module` (Emscripten module), `documentIdx` (FPDF_DOCUMENT)
 * and `pageIdx` (FPDF_PAGE). Pin the @hyzyla/pdfium version and re-check these if it is upgraded.
 */
import type { PDFiumDocument, PDFiumLibrary, PDFiumPage } from '@hyzyla/pdfium'
import { pathBounds, type AnnotKind, type Pt } from './annotations'
import type { Rect } from './textLogic'

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

// ---- Existing annotations ---------------------------------------------------------------------------

export interface ImportedAnnot {
  /** Position in the page's /Annots array. */
  index: number
  /** FPDF_ANNOT_* subtype number. */
  subtype: number
  kind: AnnotKind
  /** Display-space rectangles (points from the top-left of the page as shown). */
  rects: Rect[]
  color: string | null
  text: string
  fontSize: number
  lineWidth: number
  /** Line, arrow and ink geometry in display space. */
  points?: Pt[][]
  /** Annotation /Rect in user space: left, bottom, right, top. Used to re-find the object when saving. */
  rect: [number, number, number, number]
  /** Interior colour of a filled shape. */
  fill?: string
}

const ANNOT_KINDS: Record<number, AnnotKind> = {
  1: 'note',
  3: 'textbox',
  4: 'line',
  5: 'rectangle',
  6: 'ellipse',
  7: 'polygon',
  8: 'polyline',
  9: 'highlight',
  10: 'underline',
  11: 'squiggly',
  12: 'strikeout',
  13: 'stamp',
  14: 'caret',
  15: 'ink'
}
const FLAG_HIDDEN = 2
const FLAG_NO_VIEW = 32

function cString(m: RawModule, s: string): number {
  const ptr = m.wasmExports.malloc(s.length + 1)
  for (let i = 0; i < s.length; i++) m.HEAPU8[ptr + i] = s.charCodeAt(i) & 0x7f
  m.HEAPU8[ptr + s.length] = 0
  return ptr
}

const hex2 = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')

/** Reads the annotations we can edit (highlight, underline, strikeout, note, text box) from one page. */
export function readPageAnnots(lib: PDFiumLibrary, page: PDFiumPage): ImportedAnnot[] {
  const m = raw(lib)
  const p = pageHandle(page)
  const count = m._FPDFPage_GetAnnotCount(p)
  if (count <= 0) return []
  const { originalWidth: w, originalHeight: h } = page.getOriginalSize()
  const GRID = 8
  const sx = Math.round(w * GRID)
  const sy = Math.round(h * GRID)
  const scratch = m.wasmExports.malloc(64)
  const keyContents = cString(m, 'Contents')
  const keyDA = cString(m, 'DA')
  const keySubj = cString(m, 'Subj')
  const keyLabel = cString(m, 'OPLabel')
  const keyIT = cString(m, 'IT')
  const keyBE = cString(m, 'BE')
  const out: ImportedAnnot[] = []

  const toDisplay = (x: number, y: number): [number, number] => {
    m._FPDF_PageToDevice(p, 0, 0, sx, sy, 0, x, y, scratch + 48, scratch + 52)
    const v = new DataView(m.HEAPU8.buffer)
    return [v.getInt32(scratch + 48, true) / GRID, v.getInt32(scratch + 52, true) / GRID]
  }
  const bboxOf = (pts: [number, number][]): Rect => {
    const xs = pts.map((q) => q[0])
    const ys = pts.map((q) => q[1])
    const x = Math.min(...xs)
    const y = Math.min(...ys)
    return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y }
  }
  const readString = (annot: number, key: number) =>
    readUtf16(m, (buf, len) => m._FPDFAnnot_GetStringValue(annot, key, buf, len))

  try {
    for (let i = 0; i < count; i++) {
      const annot = m._FPDFPage_GetAnnot(p, i)
      if (!annot) continue
      try {
        const subtype = m._FPDFAnnot_GetSubtype(annot)
        let kind = ANNOT_KINDS[subtype]
        if (!kind) continue
        if (m._FPDFAnnot_GetFlags(annot) & (FLAG_HIDDEN | FLAG_NO_VIEW)) continue
        if (!m._FPDFAnnot_GetRect(annot, scratch)) continue
        const f = new DataView(m.HEAPU8.buffer)
        const left = f.getFloat32(scratch, true)
        const top = f.getFloat32(scratch + 4, true)
        const right = f.getFloat32(scratch + 8, true)
        const bottom = f.getFloat32(scratch + 12, true)
        const rect: ImportedAnnot['rect'] = [Math.min(left, right), Math.min(top, bottom), Math.max(left, right), Math.max(top, bottom)]

        // Shapes are only taken on when re-drawing them as a plain stroke is faithful: lines and arrows that
        // we or Acrobat-style tools labelled, unfilled rectangles and ellipses, ink, and our own stamps.
        let points: Pt[][] | undefined
        let label = ''
        let lineWidth = 1
        if (kind === 'line') {
          const subj = readString(annot, keySubj)
          if (subj !== 'Line' && subj !== 'Arrow') continue
          if (!m._FPDFAnnot_GetLine(annot, scratch + 16, scratch + 24)) continue
          const g = new DataView(m.HEAPU8.buffer)
          points = [[toDisplay(g.getFloat32(scratch + 16, true), g.getFloat32(scratch + 20, true)), toDisplay(g.getFloat32(scratch + 24, true), g.getFloat32(scratch + 28, true))].map(([x, y]) => ({ x, y }))]
          kind = subj === 'Arrow' ? 'arrow' : 'line'
        } else if (kind === 'rectangle' || kind === 'ellipse') {
          // Filled shapes are taken on too; the interior colour is read below.
        } else if (kind === 'polygon' || kind === 'polyline') {
          const count = m._FPDFAnnot_GetVertices(annot, 0, 0)
          if (count < 2) continue
          const buf = m.wasmExports.malloc(count * 8)
          try {
            m._FPDFAnnot_GetVertices(annot, buf, count)
            const g = new DataView(m.HEAPU8.buffer)
            const path: Pt[] = []
            for (let q = 0; q < count; q++) {
              const [x, y] = toDisplay(g.getFloat32(buf + q * 8, true), g.getFloat32(buf + q * 8 + 4, true))
              path.push({ x, y })
            }
            points = [path]
          } finally {
            m.wasmExports.free(buf)
          }
          // A polygon with a border effect is a cloud.
          if (kind === 'polygon' && m._FPDFAnnot_HasKey(annot, keyBE)) kind = 'cloud'
        } else if (kind === 'stamp') {
          label = readString(annot, keyLabel)
          if (!label) continue
        } else if (kind === 'textbox') {
          // Callouts need their leader line (/CL), which PDFium does not expose: leave them to PDFium.
          const it = readString(annot, keyIT)
          if (it === 'FreeTextCallout') continue
          if (it === 'FreeTextTypeWriter') kind = 'typewriter'
        } else if (kind === 'ink') {
          points = []
          const paths = m._FPDFAnnot_GetInkListCount(annot)
          for (let k = 0; k < paths; k++) {
            const count = m._FPDFAnnot_GetInkListPath(annot, k, 0, 0)
            if (count < 2) continue
            const buf = m.wasmExports.malloc(count * 8)
            try {
              m._FPDFAnnot_GetInkListPath(annot, k, buf, count)
              const g = new DataView(m.HEAPU8.buffer)
              const path: Pt[] = []
              for (let q = 0; q < count; q++) {
                const [x, y] = toDisplay(g.getFloat32(buf + q * 8, true), g.getFloat32(buf + q * 8 + 4, true))
                path.push({ x, y })
              }
              points.push(path)
            } finally {
              m.wasmExports.free(buf)
            }
          }
          if (!points.length) continue
        }
        if (kind === 'line' || kind === 'arrow' || kind === 'rectangle' || kind === 'ellipse' || kind === 'ink' || kind === 'stamp' || kind === 'polygon' || kind === 'polyline' || kind === 'cloud') {
          lineWidth = 2
          if (m._FPDFAnnot_GetBorder(annot, scratch + 48, scratch + 52, scratch + 56)) {
            const w = new DataView(m.HEAPU8.buffer).getFloat32(scratch + 56, true)
            if (w > 0) lineWidth = w
          }
        }

        let rects: Rect[] = []
        if (kind === 'highlight' || kind === 'underline' || kind === 'strikeout' || kind === 'squiggly') {
          const quads = m._FPDFAnnot_CountAttachmentPoints(annot)
          for (let q = 0; q < quads; q++) {
            if (!m._FPDFAnnot_GetAttachmentPoints(annot, q, scratch + 16)) continue
            const g = new DataView(m.HEAPU8.buffer)
            const pts: [number, number][] = []
            for (let k = 0; k < 4; k++) pts.push(toDisplay(g.getFloat32(scratch + 16 + k * 8, true), g.getFloat32(scratch + 20 + k * 8, true)))
            const r = bboxOf(pts)
            if (r.w > 0 && r.h > 0) rects.push(r)
          }
        }
        if (points) rects = [pathBounds(kind, lineWidth, points)]
        if (!rects.length) rects = [bboxOf([toDisplay(rect[0], rect[3]), toDisplay(rect[2], rect[1])])]
        if (kind === 'note') rects = [{ x: rects[0].x, y: rects[0].y, w: rects[0].w >= 4 ? rects[0].w : 22, h: rects[0].h >= 4 ? rects[0].h : 22 }]
        rects = rects.map((r) => (r.w > 0 && r.h > 0 ? r : { ...r, w: r.w || 22, h: r.h || 22 }))

        let color: string | null = null
        if (m._FPDFAnnot_GetColor(annot, 0, scratch + 32, scratch + 36, scratch + 40, scratch + 44)) {
          const c = new DataView(m.HEAPU8.buffer)
          color = `#${hex2(c.getUint32(scratch + 32, true))}${hex2(c.getUint32(scratch + 36, true))}${hex2(c.getUint32(scratch + 40, true))}`
        }

        let fill: string | undefined
        if ((kind === 'rectangle' || kind === 'ellipse' || kind === 'polygon' || kind === 'cloud') && m._FPDFAnnot_GetColor(annot, 1, scratch + 32, scratch + 36, scratch + 40, scratch + 44)) {
          const c = new DataView(m.HEAPU8.buffer)
          fill = `#${hex2(c.getUint32(scratch + 32, true))}${hex2(c.getUint32(scratch + 36, true))}${hex2(c.getUint32(scratch + 40, true))}`
        }

        let fontSize = 12
        if (kind === 'textbox' || kind === 'typewriter') {
          const da = readString(annot, keyDA)
          const size = /([\d.]+)\s+Tf/.exec(da)
          if (size) fontSize = Math.max(6, Math.min(72, parseFloat(size[1])))
          const rgbm = /([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+rg/.exec(da)
          const grey = /([\d.]+)\s+g\b/.exec(da)
          if (rgbm) color = `#${hex2(+rgbm[1] * 255)}${hex2(+rgbm[2] * 255)}${hex2(+rgbm[3] * 255)}`
          else if (grey) color = `#${hex2(+grey[1] * 255).repeat(3)}`
          else color = '#000000'
        }

        out.push({
          index: i,
          subtype,
          kind,
          rects,
          color,
          text: kind === 'stamp' ? label : readString(annot, keyContents),
          fontSize,
          lineWidth,
          points,
          rect,
          fill
        })
      } finally {
        m._FPDFPage_CloseAnnot(annot)
      }
    }
  } finally {
    m.wasmExports.free(scratch)
    m.wasmExports.free(keyContents)
    m.wasmExports.free(keyDA)
    m.wasmExports.free(keySubj)
    m.wasmExports.free(keyLabel)
    m.wasmExports.free(keyIT)
    m.wasmExports.free(keyBE)
  }
  return out
}

/**
 * Removes an annotation from the in-memory document so PDFium stops drawing it (the file itself is untouched).
 * `removedBefore` is how many annotations with a lower original index were already removed from this page.
 */
export function removePageAnnot(lib: PDFiumLibrary, page: PDFiumPage, originalIndex: number, subtype: number, removedBefore: number): boolean {
  const m = raw(lib)
  const p = pageHandle(page)
  const current = originalIndex - removedBefore
  const annot = m._FPDFPage_GetAnnot(p, current)
  if (!annot) return false
  const same = m._FPDFAnnot_GetSubtype(annot) === subtype
  m._FPDFPage_CloseAnnot(annot)
  return same && m._FPDFPage_RemoveAnnot(p, current) !== 0
}

/** Size in pixels of a whole page rendered at `scale`, rounded the way @hyzyla/pdfium's render() rounds it. */
export function scaledPageSize(page: PDFiumPage, scale: number): { width: number; height: number } {
  const { originalWidth, originalHeight } = page.getOriginalSize()
  return { width: Math.floor(Math.floor(originalWidth) * scale), height: Math.floor(Math.floor(originalHeight) * scale) }
}

/**
 * Renders only part of a page: the `w` by `h` pixel region at (`x`, `y`) of the page as it would be rendered whole
 * at `scale`. Used for high zoom levels, where a whole-page bitmap would be too large. Draws annotations and form
 * fields like the wrapper's render(). Returns RGBA.
 */
export function renderRegion(
  lib: PDFiumLibrary,
  doc: PDFiumDocument,
  page: PDFiumPage,
  scale: number,
  x: number,
  y: number,
  w: number,
  h: number
): Uint8Array {
  const m = raw(lib)
  const p = pageHandle(page)
  const full = scaledPageSize(page, scale)
  const form = (doc as unknown as { initializeFormFields(): number }).initializeFormFields()
  m._FORM_OnAfterLoadPage(p, form)
  const size = w * h * 4
  const ptr = m.wasmExports.malloc(size)
  if (!ptr) throw new Error('Failed to allocate memory for bitmap')
  let bitmap = 0
  try {
    bitmap = m._FPDFBitmap_CreateEx(w, h, 4 /* BGRA */, ptr, w * 4)
    m._FPDFBitmap_FillRect(bitmap, 0, 0, w, h, 0xffffffff)
    // ANNOT | LCD_TEXT | REVERSE_BYTE_ORDER (RGBA out). The page is placed so the wanted region lands on the bitmap.
    const flags = 0x01 | 0x02 | 0x10
    m._FPDF_RenderPageBitmap(bitmap, p, -x, -y, full.width, full.height, 0, flags)
    m._FPDF_FFLDraw(form, bitmap, p, -x, -y, full.width, full.height, 0, flags & ~0x01)
    return m.HEAPU8.slice(ptr, ptr + size)
  } finally {
    m._FORM_OnBeforeClosePage(p, form)
    if (bitmap) m._FPDFBitmap_Destroy(bitmap)
    m.wasmExports.free(ptr)
  }
}

export interface AttachmentInfo {
  index: number
  name: string
  /** Size in bytes, or -1 if the file data cannot be read. */
  size: number
}

/** Files embedded in the document (the EmbeddedFiles name tree). */
export function readAttachments(lib: PDFiumLibrary, doc: PDFiumDocument): AttachmentInfo[] {
  const m = raw(lib)
  const d = docHandle(doc)
  const out: AttachmentInfo[] = []
  const count = Math.min(m._FPDFDoc_GetAttachmentCount(d), 10000)
  const lenPtr = m.wasmExports.malloc(4)
  try {
    for (let i = 0; i < count; i++) {
      const att = m._FPDFDoc_GetAttachment(d, i)
      if (!att) continue
      const name = readUtf16(m, (buf, len) => m._FPDFAttachment_GetName(att, buf, len)) || `Attachment ${i + 1}`
      const ok = m._FPDFAttachment_GetFile(att, 0, 0, lenPtr)
      const size = ok ? new Uint32Array(m.HEAPU8.buffer, lenPtr, 1)[0] : -1
      out.push({ index: i, name, size })
    }
  } finally {
    m.wasmExports.free(lenPtr)
  }
  return out
}

/** The bytes of one embedded file. */
export function readAttachmentData(lib: PDFiumLibrary, doc: PDFiumDocument, index: number): Uint8Array {
  const m = raw(lib)
  const att = m._FPDFDoc_GetAttachment(docHandle(doc), index)
  if (!att) throw new Error('No such attachment')
  const lenPtr = m.wasmExports.malloc(4)
  try {
    if (!m._FPDFAttachment_GetFile(att, 0, 0, lenPtr)) throw new Error('The attachment has no readable data')
    const len = new Uint32Array(m.HEAPU8.buffer, lenPtr, 1)[0]
    if (len > 512 * 1024 * 1024) throw new Error('The attachment is too large')
    const buf = m.wasmExports.malloc(Math.max(1, len))
    try {
      m._FPDFAttachment_GetFile(att, buf, len, lenPtr)
      return m.HEAPU8.slice(buf, buf + len)
    } finally {
      m.wasmExports.free(buf)
    }
  } finally {
    m.wasmExports.free(lenPtr)
  }
}

/** Page labels (for example "iv" or "A-3"), one per page; empty strings when the document defines none. */
export function readPageLabels(lib: PDFiumLibrary, doc: PDFiumDocument): string[] {
  const m = raw(lib)
  const d = docHandle(doc)
  const n = doc.getPageCount()
  const out: string[] = []
  for (let i = 0; i < n; i++) out.push(readUtf16(m, (buf, len) => m._FPDF_GetPageLabel(d, i, buf, len)))
  return out
}
