/**
 * Thin helpers over PDFium's C API for features @hyzyla/pdfium does not wrap (outline, character boxes).
 * They reach into the wrapper's private fields: `module` (Emscripten module), `documentIdx` (FPDF_DOCUMENT)
 * and `pageIdx` (FPDF_PAGE). Pin the @hyzyla/pdfium version and re-check these if it is upgraded.
 */
import type { PDFiumDocument, PDFiumLibrary, PDFiumPage } from '@hyzyla/pdfium'
import type { PDFDict } from 'pdf-lib'
import { arrowEnds, dashStyle, measureOf, nameOf, numbers, linkTargetOf } from './annotExtras'
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
  /** Second line of one of our dated stamps. */
  stampInfo?: string
  dash?: 'dashed' | 'dotted'
  measure?: { kind: 'distance' | 'perimeter' | 'area'; factor: number; unit: string; ratio?: string; label: string }
  opacity?: number
  fontFamily?: 'Helvetica' | 'Times' | 'Courier'
  author?: string
  /** PDF date strings. */
  created?: string
  modified?: string
  /** Link target (kind 'link'). */
  linkUri?: string
  linkPage?: number
}

/** A reply or review-state change: a Text annotation with /IRT pointing at another annotation on the page. */
export interface ImportedReply {
  index: number
  /** Index of the annotation replied to. */
  parent: number
  author: string
  text: string
  /** PDF date string (/M, else /CreationDate). */
  date: string
  state?: string
  rect: [number, number, number, number]
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

/** Reads the annotations we can edit from one page, and the replies attached to annotations on it. */
export function readPageAnnots(
  lib: PDFiumLibrary,
  page: PDFiumPage,
  /** The page's annotation dictionaries from pdf-lib, by index, for what PDFium cannot read; absent if unavailable. */
  dicts?: (PDFDict | undefined)[]
): { annots: ImportedAnnot[]; replies: ImportedReply[] } {
  const m = raw(lib)
  const p = pageHandle(page)
  const count = m._FPDFPage_GetAnnotCount(p)
  if (count <= 0) return { annots: [], replies: [] }
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
  const keyMeasure = cString(m, 'Measure')
  const keyInfo = cString(m, 'OPInfo')
  const keyT = cString(m, 'T')
  const keyM = cString(m, 'M')
  const keyCreated = cString(m, 'CreationDate')
  const keyIRT = cString(m, 'IRT')
  const keyRT = cString(m, 'RT')
  const keyState = cString(m, 'State')
  const keyStateModel = cString(m, 'StateModel')
  const keyCA = cString(m, 'CA')
  const replies: ImportedReply[] = []
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
        // Replies (and review-state changes) are Text annotations pointing at another one; read them whatever
        // their flags, and keep them out of the drawable list. Grouped pairs (/RT /Group) are not replies.
        if (subtype === 1) {
          const linked = m._FPDFAnnot_GetLinkedAnnot(annot, keyIRT)
          if (linked) {
            const parent = m._FPDFPage_GetAnnotIndex(p, linked)
            m._FPDFPage_CloseAnnot(linked)
            if (parent >= 0 && readString(annot, keyRT) !== 'Group') {
              const g = new DataView(m.HEAPU8.buffer)
              const ok = m._FPDFAnnot_GetRect(annot, scratch)
              const r: [number, number, number, number] = ok
                ? [g.getFloat32(scratch, true), g.getFloat32(scratch + 12, true), g.getFloat32(scratch + 8, true), g.getFloat32(scratch + 4, true)]
                : [0, 0, 0, 0]
              const model = readString(annot, keyStateModel)
              replies.push({
                index: i,
                parent,
                author: readString(annot, keyT),
                text: readString(annot, keyContents),
                date: readString(annot, keyM) || readString(annot, keyCreated),
                state: model === 'Review' || (!model && readString(annot, keyState)) ? readString(annot, keyState) || undefined : undefined,
                rect: [Math.min(r[0], r[2]), Math.min(r[1], r[3]), Math.max(r[0], r[2]), Math.max(r[1], r[3])]
              })
              continue
            }
          }
        }
        const dict = dicts?.[i]
        // Anything we cannot draw ourselves is still selectable, movable and commentable as a "foreign" annotation:
        // it keeps its own appearance. Popups, links and form fields are not comments.
        // Links are taken on when they go to a web address or a page here; others (files, scripts) are left alone.
        const link = subtype === 2 ? linkTargetOf(dict) : undefined
        let kind = link ? 'link' : (ANNOT_KINDS[subtype] ?? (subtype === 2 || subtype === 16 || subtype === 20 ? undefined : 'foreign'))
        if (!kind) continue
        if (m._FPDFAnnot_GetFlags(annot) & (FLAG_HIDDEN | FLAG_NO_VIEW)) continue
        // Measurements: editable when their /Measure can be read (pdf-lib); otherwise left to PDFium.
        let measure: ImportedAnnot['measure']
        if (m._FPDFAnnot_HasKey(annot, keyMeasure)) {
          const ms = measureOf(dict)
          const it = nameOf(dict, 'IT')
          const mk = it === 'LineDimension' ? 'distance' : it === 'PolyLineDimension' ? 'perimeter' : it === 'PolygonDimension' ? 'area' : null
          if (!ms || !mk) kind = 'foreign'
          else measure = { kind: mk, ...ms, label: readString(annot, keyContents) }
        }
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
        let calloutBox: Rect | null = null
        if (kind === 'line') {
          const subj = readString(annot, keySubj)
          if (!m._FPDFAnnot_GetLine(annot, scratch + 16, scratch + 24)) continue
          const g = new DataView(m.HEAPU8.buffer)
          points = [[toDisplay(g.getFloat32(scratch + 16, true), g.getFloat32(scratch + 20, true)), toDisplay(g.getFloat32(scratch + 24, true), g.getFloat32(scratch + 28, true))].map(([x, y]) => ({ x, y }))]
          // An arrow by our own label, or by its line endings (/LE) whoever wrote it. A start-only arrow is turned round.
          const ends = arrowEnds(dict)
          if (!measure && !ends.end && ends.start) points = [[points[0][1], points[0][0]]]
          kind = measure ? 'line' : subj === 'Arrow' || ends.end || ends.start ? 'arrow' : 'line'
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
          // Other tools' stamps keep their own picture.
          if (!label) kind = 'foreign'
        } else if (kind === 'textbox') {
          const it = readString(annot, keyIT)
          if (it === 'FreeTextCallout') {
            // The leader line (/CL) and the box inset (/RD) come from the dictionary; without them, keep it as is.
            const cl = numbers(dict, 'CL')
            if (!cl || cl.length < 4) kind = 'foreign'
            else {
              const rd = numbers(dict, 'RD') ?? [0, 0, 0, 0]
              const [x0, y0, x1, y1] = rect
              const box = [x0 + rd[0], y0 + rd[1], x1 - rd[2], y1 - rd[3]]
              calloutBox = bboxOf([toDisplay(box[0], box[3]), toDisplay(box[2], box[1])])
              const [tx, ty] = toDisplay(cl[0], cl[1])
              points = [[{ x: tx, y: ty }]]
              kind = 'callout'
            }
          }
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
        if (kind === 'callout') lineWidth = 1
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
        if (points && kind !== 'callout') rects = [pathBounds(kind, lineWidth, points)]
        if (calloutBox) rects = [calloutBox]
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

        let opacity: number | undefined
        if (m._FPDFAnnot_GetNumberValue(annot, keyCA, scratch + 60)) {
          const v = new DataView(m.HEAPU8.buffer).getFloat32(scratch + 60, true)
          if (v > 0 && v < 1) opacity = Math.max(0.1, v)
        }

        let fontSize = 12
        let fontFamily: 'Helvetica' | 'Times' | 'Courier' | undefined
        if (kind === 'textbox' || kind === 'typewriter' || kind === 'callout') {
          const da = readString(annot, keyDA)
          const face = /\/(\S+)\s+[\d.]+\s+Tf/.exec(da)?.[1] ?? ''
          fontFamily = /^(TiRo|Times|TimesNewRoman)/i.test(face) ? 'Times' : /^(Cour|Courier)/i.test(face) ? 'Courier' : undefined
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
          fill,
          stampInfo: kind === 'stamp' ? readString(annot, keyInfo) || undefined : undefined,
          opacity,
          fontFamily,
          dash: kind === 'foreign' ? undefined : dashStyle(dict, lineWidth),
          measure,
          author: readString(annot, keyT) || undefined,
          created: readString(annot, keyCreated) || undefined,
          modified: readString(annot, keyM) || undefined,
          linkUri: link?.uri,
          linkPage: link?.page
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
    m.wasmExports.free(keyMeasure)
    m.wasmExports.free(keyInfo)
    for (const k of [keyT, keyM, keyCreated, keyIRT, keyRT, keyState, keyStateModel, keyCA]) m.wasmExports.free(k)
  }
  return { annots: out, replies }
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
  /** Position in the document's embedded files, or in the page's /Annots for a file attached to a comment. */
  index: number
  name: string
  /** Size in bytes, or -1 if the file data cannot be read. */
  size: number
  /** Set for a file attached to a comment (FileAttachment annotation) on this zero-based page. */
  page?: number
}

/** Files embedded in the document (the EmbeddedFiles name tree), then files attached to comments, page by page. */
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
    for (let pg = 0; pg < doc.getPageCount(); pg++) {
      const page = doc.getPage(pg)
      const p = pageHandle(page)
      const n = Math.min(m._FPDFPage_GetAnnotCount(p), 5000)
      for (let i = 0; i < n; i++) {
        const annot = m._FPDFPage_GetAnnot(p, i)
        if (!annot) continue
        try {
          if (m._FPDFAnnot_GetSubtype(annot) !== 17) continue
          const att = m._FPDFAnnot_GetFileAttachment(annot)
          if (!att) continue
          const name = readUtf16(m, (buf, len) => m._FPDFAttachment_GetName(att, buf, len)) || `Attachment on page ${pg + 1}`
          const ok = m._FPDFAttachment_GetFile(att, 0, 0, lenPtr)
          out.push({ index: i, page: pg, name, size: ok ? new Uint32Array(m.HEAPU8.buffer, lenPtr, 1)[0] : -1 })
        } finally {
          m._FPDFPage_CloseAnnot(annot)
        }
      }
      page.close()
    }
  } finally {
    m.wasmExports.free(lenPtr)
  }
  return out
}

/** The bytes of one embedded file, or of the file attached to a comment when `page` is given. */
export function readAttachmentData(lib: PDFiumLibrary, doc: PDFiumDocument, index: number, page?: number): Uint8Array {
  const m = raw(lib)
  let annot = 0
  let pg: PDFiumPage | null = null
  if (page !== undefined) {
    pg = doc.getPage(page)
    annot = m._FPDFPage_GetAnnot(pageHandle(pg), index)
  }
  try {
    const att = annot ? m._FPDFAnnot_GetFileAttachment(annot) : m._FPDFDoc_GetAttachment(docHandle(doc), index)
    return readAttachmentBytes(m, att)
  } finally {
    if (annot) m._FPDFPage_CloseAnnot(annot)
    pg?.close()
  }
}

function readAttachmentBytes(m: RawModule, att: number): Uint8Array {
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

/**
 * Moves or resizes an annotation in the in-memory document: its appearance is scaled into the new rectangle.
 * `rect` is in display space (points from the top left of the page as shown). Returns false if not found.
 */
export function setPageAnnotRect(lib: PDFiumLibrary, page: PDFiumPage, currentIndex: number, subtype: number, rect: Rect): boolean {
  const m = raw(lib)
  const p = pageHandle(page)
  const annot = m._FPDFPage_GetAnnot(p, currentIndex)
  if (!annot) return false
  try {
    if (m._FPDFAnnot_GetSubtype(annot) !== subtype) return false
    const { originalWidth: w, originalHeight: h } = page.getOriginalSize()
    const GRID = 8
    const buf = m.wasmExports.malloc(16)
    try {
      const toUser = (x: number, y: number) => {
        m._FPDF_DeviceToPage(p, 0, 0, Math.round(w * GRID), Math.round(h * GRID), 0, Math.round(x * GRID), Math.round(y * GRID), buf, buf + 8)
        const v = new DataView(m.HEAPU8.buffer)
        return [v.getFloat64(buf, true), v.getFloat64(buf + 8, true)]
      }
      const [ax, ay] = toUser(rect.x, rect.y)
      const [bx, by] = toUser(rect.x + rect.w, rect.y + rect.h)
      const v = new DataView(m.HEAPU8.buffer)
      v.setFloat32(buf, Math.min(ax, bx), true) // left
      v.setFloat32(buf + 4, Math.max(ay, by), true) // top
      v.setFloat32(buf + 8, Math.max(ax, bx), true) // right
      v.setFloat32(buf + 12, Math.min(ay, by), true) // bottom
      return m._FPDFAnnot_SetRect(annot, buf) !== 0
    } finally {
      m.wasmExports.free(buf)
    }
  } finally {
    m._FPDFPage_CloseAnnot(annot)
  }
}

export interface PageLink {
  /** Display-space rectangles (one per line for web links found in the text). */
  rects: Rect[]
  /** Zero-based target page, for links within the document. */
  page?: number
  /** Web address or mailto: link. */
  uri?: string
}

export interface TextObject {
  /** Position among the page's text objects: the k-th one is the k-th text-showing operator of the content stream. */
  ordinal: number
  /** Display-space box (points from the top-left of the page as shown). */
  rect: Rect
  text: string
  /** Base font name without a subset prefix, and the font descriptor's flags, weight, italic angle and embedding. */
  font: string
  flags: number
  weight: number
  italic: boolean
  embedded: boolean
  size: number
  /** Fill colour, #rrggbb. */
  color: string
  /** Text rendering mode (0 fill, 3 invisible, ...). */
  mode: number
  /** The object's matrix in page space: a, b, c, d, e, f. */
  matrix: [number, number, number, number, number, number]
}

/** Text objects drawn directly by the page (not inside form XObjects), in content-stream order. */
export function readTextObjects(lib: PDFiumLibrary, page: PDFiumPage): { objects: TextObject[]; total: number } {
  const m = raw(lib)
  const p = pageHandle(page)
  const { originalWidth: w, originalHeight: h } = page.getOriginalSize()
  const GRID = 8
  const sx = Math.round(w * GRID)
  const sy = Math.round(h * GRID)
  const scratch = m.wasmExports.malloc(96)
  const tp = m._FPDFText_LoadPage(p)
  const objects: TextObject[] = []
  try {
    const n = m._FPDFPage_CountObjects(p)
    let ordinal = 0
    for (let i = 0; i < n; i++) {
      const obj = m._FPDFPage_GetObject(p, i)
      if (m._FPDFPageObj_GetType(obj) !== 1) continue
      const k = ordinal++
      if (!m._FPDFPageObj_GetBounds(obj, scratch, scratch + 4, scratch + 8, scratch + 12)) continue
      const f = new DataView(m.HEAPU8.buffer)
      const l = f.getFloat32(scratch, true)
      const b = f.getFloat32(scratch + 4, true)
      const r = f.getFloat32(scratch + 8, true)
      const t = f.getFloat32(scratch + 12, true)
      m._FPDF_PageToDevice(p, 0, 0, sx, sy, 0, l, t, scratch + 32, scratch + 36)
      m._FPDF_PageToDevice(p, 0, 0, sx, sy, 0, r, b, scratch + 40, scratch + 44)
      const v = new DataView(m.HEAPU8.buffer)
      const x1 = v.getInt32(scratch + 32, true) / GRID
      const y1 = v.getInt32(scratch + 36, true) / GRID
      const x2 = v.getInt32(scratch + 40, true) / GRID
      const y2 = v.getInt32(scratch + 44, true) / GRID
      const text = readUtf16(m, (buf, len) => m._FPDFTextObj_GetText(obj, tp, buf, len))
      const font = m._FPDFTextObj_GetFont(obj)
      let name = ''
      const need = m._FPDFFont_GetBaseFontName(font, 0, 0)
      if (need > 1) {
        const buf = m.wasmExports.malloc(need)
        try {
          m._FPDFFont_GetBaseFontName(font, buf, need)
          name = new TextDecoder().decode(m.HEAPU8.slice(buf, buf + need - 1))
        } finally {
          m.wasmExports.free(buf)
        }
      }
      let size = 12
      if (m._FPDFTextObj_GetFontSize(obj, scratch + 48)) size = new DataView(m.HEAPU8.buffer).getFloat32(scratch + 48, true)
      let color = '#000000'
      if (m._FPDFPageObj_GetFillColor(obj, scratch + 52, scratch + 56, scratch + 60, scratch + 64)) {
        const c = new DataView(m.HEAPU8.buffer)
        const hex = (o: number) => Math.min(255, c.getUint32(scratch + o, true)).toString(16).padStart(2, '0')
        color = `#${hex(52)}${hex(56)}${hex(60)}`
      }
      const matrix: TextObject['matrix'] = [1, 0, 0, 1, 0, 0]
      if (m._FPDFPageObj_GetMatrix(obj, scratch + 68)) {
        const mm = new DataView(m.HEAPU8.buffer)
        for (let q = 0; q < 6; q++) matrix[q] = mm.getFloat32(scratch + 68 + q * 4, true)
      }
      const flags = m._FPDFFont_GetFlags(font)
      const angle = m._FPDFFont_GetItalicAngle(font, scratch + 92) ? new DataView(m.HEAPU8.buffer).getInt32(scratch + 92, true) : 0
      objects.push({
        ordinal: k,
        rect: { x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1) },
        text,
        font: name.replace(/^[A-Z]{6}\+/, ''),
        flags,
        weight: m._FPDFFont_GetWeight(font),
        italic: angle !== 0 || (flags & 64) !== 0,
        embedded: m._FPDFFont_GetIsEmbedded(font) === 1,
        size,
        color,
        mode: m._FPDFTextObj_GetTextRenderMode(obj),
        matrix
      })
    }
    return { objects, total: ordinal }
  } finally {
    m.wasmExports.free(scratch)
    m._FPDFText_ClosePage(tp)
  }
}

export interface ImageObject {
  /** Position among the page's image objects: the k-th one is the k-th image-drawing operation of the content stream. */
  ordinal: number
  /** Display-space box (points from the top-left of the page as shown). */
  rect: Rect
  /** The transform that maps the image's unit square to the page. */
  matrix: [number, number, number, number, number, number]
}

/**
 * Image objects the page draws directly (not inside form XObjects), in content-stream order, and the matrix that
 * maps display space (the page as shown, y down) to page space, so display-space edits can become page-space ones.
 */
export function readImageObjects(
  lib: PDFiumLibrary,
  page: PDFiumPage
): { objects: ImageObject[]; total: number; toPage: [number, number, number, number, number, number] } {
  const m = raw(lib)
  const p = pageHandle(page)
  const { originalWidth: w, originalHeight: h } = page.getOriginalSize()
  const GRID = 8
  const sx = Math.round(w * GRID)
  const sy = Math.round(h * GRID)
  const scratch = m.wasmExports.malloc(96)
  const objects: ImageObject[] = []
  try {
    // Display (points) to page space, from three sample points.
    const sample = (x: number, y: number): [number, number] => {
      m._FPDF_DeviceToPage(p, 0, 0, sx, sy, 0, Math.round(x * GRID), Math.round(y * GRID), scratch + 64, scratch + 72)
      const d = new DataView(m.HEAPU8.buffer)
      return [d.getFloat64(scratch + 64, true), d.getFloat64(scratch + 72, true)]
    }
    const o = sample(0, 0)
    const ex = sample(100, 0)
    const ey = sample(0, 100)
    const toPage: [number, number, number, number, number, number] = [(ex[0] - o[0]) / 100, (ex[1] - o[1]) / 100, (ey[0] - o[0]) / 100, (ey[1] - o[1]) / 100, o[0], o[1]]

    const n = m._FPDFPage_CountObjects(p)
    let ordinal = 0
    for (let i = 0; i < n; i++) {
      const obj = m._FPDFPage_GetObject(p, i)
      if (m._FPDFPageObj_GetType(obj) !== 3) continue
      const k = ordinal++
      if (!m._FPDFPageObj_GetBounds(obj, scratch, scratch + 4, scratch + 8, scratch + 12)) continue
      const f = new DataView(m.HEAPU8.buffer)
      const l = f.getFloat32(scratch, true)
      const b = f.getFloat32(scratch + 4, true)
      const r = f.getFloat32(scratch + 8, true)
      const t = f.getFloat32(scratch + 12, true)
      m._FPDF_PageToDevice(p, 0, 0, sx, sy, 0, l, t, scratch + 32, scratch + 36)
      m._FPDF_PageToDevice(p, 0, 0, sx, sy, 0, r, b, scratch + 40, scratch + 44)
      const v = new DataView(m.HEAPU8.buffer)
      const x1 = v.getInt32(scratch + 32, true) / GRID
      const y1 = v.getInt32(scratch + 36, true) / GRID
      const x2 = v.getInt32(scratch + 40, true) / GRID
      const y2 = v.getInt32(scratch + 44, true) / GRID
      const matrix: ImageObject['matrix'] = [1, 0, 0, 1, 0, 0]
      if (m._FPDFPageObj_GetMatrix(obj, scratch + 16)) {
        const mm = new DataView(m.HEAPU8.buffer)
        for (let q = 0; q < 6; q++) matrix[q] = mm.getFloat32(scratch + 16 + q * 4, true)
      }
      objects.push({ ordinal: k, rect: { x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1) }, matrix })
    }
    return { objects, total: ordinal, toPage }
  } finally {
    m.wasmExports.free(scratch)
  }
}

/**
 * Links on a page: link annotations (go to a page, or open a web address) and web addresses written in the text,
 * which PDFium finds itself.
 */
export function readPageLinks(lib: PDFiumLibrary, doc: PDFiumDocument, page: PDFiumPage): PageLink[] {
  const m = raw(lib)
  const p = pageHandle(page)
  const d = docHandle(doc)
  const { originalWidth: w, originalHeight: h } = page.getOriginalSize()
  const GRID = 8
  const scratch = m.wasmExports.malloc(64)
  const out: PageLink[] = []
  const toDisplay = (x: number, y: number): [number, number] => {
    m._FPDF_PageToDevice(p, 0, 0, Math.round(w * GRID), Math.round(h * GRID), 0, x, y, scratch + 48, scratch + 52)
    const v = new DataView(m.HEAPU8.buffer)
    return [v.getInt32(scratch + 48, true) / GRID, v.getInt32(scratch + 52, true) / GRID]
  }
  const rectAt = (ptr: number): Rect => {
    const v = new DataView(m.HEAPU8.buffer)
    const [l, t, r, b] = [v.getFloat32(ptr, true), v.getFloat32(ptr + 4, true), v.getFloat32(ptr + 8, true), v.getFloat32(ptr + 12, true)]
    const [x0, y0] = toDisplay(l, t)
    const [x1, y1] = toDisplay(r, b)
    return { x: Math.min(x0, x1), y: Math.min(y0, y1), w: Math.abs(x1 - x0), h: Math.abs(y1 - y0) }
  }
  const ascii = (fill: (buf: number, len: number) => number) => {
    const len = fill(0, 0)
    if (len <= 1) return ''
    const buf = m.wasmExports.malloc(len)
    try {
      fill(buf, len)
      return new TextDecoder('latin1').decode(m.HEAPU8.slice(buf, buf + len - 1))
    } finally {
      m.wasmExports.free(buf)
    }
  }
  try {
    // Link annotations.
    new DataView(m.HEAPU8.buffer).setInt32(scratch, 0, true)
    for (let guard = 0; guard < 5000 && m._FPDFLink_Enumerate(p, scratch, scratch + 4); guard++) {
      const link = new DataView(m.HEAPU8.buffer).getUint32(scratch + 4, true)
      if (!link || !m._FPDFLink_GetAnnotRect(link, scratch + 8)) continue
      const rect = rectAt(scratch + 8)
      let dest = m._FPDFLink_GetDest(d, link)
      const action = m._FPDFLink_GetAction(link)
      let uri: string | undefined
      if (!dest && action) {
        const type = m._FPDFAction_GetType(action)
        if (type === 1) dest = m._FPDFAction_GetDest(d, action)
        else if (type === 3) uri = ascii((buf, len) => m._FPDFAction_GetURIPath(d, action, buf, len)) || undefined
      }
      const target = dest ? m._FPDFDest_GetDestPageIndex(d, dest) : -1
      if (target >= 0) out.push({ rects: [rect], page: target })
      else if (uri) out.push({ rects: [rect], uri })
    }
    // Web addresses in the text.
    const text = m._FPDFText_LoadPage(p)
    if (text) {
      const web = m._FPDFLink_LoadWebLinks(text)
      try {
        const n = Math.min(m._FPDFLink_CountWebLinks(web), 2000)
        for (let i = 0; i < n; i++) {
          const url = readUtf16(m, (buf, len) => m._FPDFLink_GetURL(web, i, buf, len / 2) * 2)
          const rects: Rect[] = []
          const count = m._FPDFLink_CountRects(web, i)
          for (let k = 0; k < count; k++) {
            if (!m._FPDFLink_GetRect(web, i, k, scratch + 16, scratch + 24, scratch + 32, scratch + 40)) continue
            const v = new DataView(m.HEAPU8.buffer)
            const [l, t, r, b] = [v.getFloat64(scratch + 16, true), v.getFloat64(scratch + 24, true), v.getFloat64(scratch + 32, true), v.getFloat64(scratch + 40, true)]
            const [x0, y0] = toDisplay(l, t)
            const [x1, y1] = toDisplay(r, b)
            rects.push({ x: Math.min(x0, x1), y: Math.min(y0, y1), w: Math.abs(x1 - x0), h: Math.abs(y1 - y0) })
          }
          if (url && rects.length && !out.some((o) => o.uri === url && o.rects.some((q) => rects.some((r) => Math.abs(q.x - r.x) < 2 && Math.abs(q.y - r.y) < 2)))) {
            out.push({ rects, uri: url })
          }
        }
      } finally {
        m._FPDFLink_CloseWebLinks(web)
        m._FPDFText_ClosePage(text)
      }
    }
  } finally {
    m.wasmExports.free(scratch)
  }
  return out
}
