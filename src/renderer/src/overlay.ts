/**
 * Overlay pages: lays pages of another PDF over (or under) pages of this one, as form XObjects (pdf-lib embedPage).
 * With a tint the overlay's dark linework takes one colour and its paper stays clear, so two revisions of a drawing,
 * one tinted, read as a comparison. The overlay goes in its own content stream tagged /OPMarks /Overlay.
 */
import { PDFDocument, type PDFRef } from 'pdf-lib'
import { frameFor } from './annotWrite'
import { addMarkStream, frameOf } from './pageMarks'

export type OverlayFit = 'fit' | 'actual' | 'fill'
export type OverlayAlign = 'tl' | 'tc' | 'tr' | 'ml' | 'mc' | 'mr' | 'bl' | 'bc' | 'br'

export interface OverlaySpec {
  /** Pages of this document to overlay (zero-based). */
  pages: number[]
  /** Pages of the other document to use (zero-based). */
  sourcePages: number[]
  /** `sequence`: the first page overlaid gets the first source page, the next the next, starting again when they run out. `first`: every page gets the first source page. */
  pairing: 'sequence' | 'first'
  behind: boolean
  /** fit: inside the page, keeping proportions. fill: covers the page. actual: 100%. */
  fit: OverlayFit
  align: OverlayAlign
  /** Shift to the right and down, in points, after aligning. */
  offsetX: number
  offsetY: number
  /** 0 to 1. */
  opacity: number
  /** A colour (#rrggbb) for the overlay's dark linework, or null to leave its colours. */
  tint: string | null
}

const n = (v: number) => (Math.round(v * 1000) / 1000).toString()
const rgb = (hex: string) => {
  const v = parseInt(hex.replace('#', ''), 16)
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255].map(n).join(' ')
}

type M = [number, number, number, number, number, number]
const invert = ([a, b, c, d, e, f]: M): M => {
  const det = a * d - b * c
  return [d / det, -b / det, -c / det, a / det, (c * f - d * e) / det, (b * e - a * f) / det]
}

/** Scale and top-left position of an overlay of `dw` by `dh` on a page of `w` by `h` (all displayed, points). */
export function overlayPlacement(w: number, h: number, dw: number, dh: number, spec: Pick<OverlaySpec, 'fit' | 'align' | 'offsetX' | 'offsetY'>): { s: number; tx: number; ty: number } {
  const s = spec.fit === 'actual' ? 1 : spec.fit === 'fill' ? Math.max(w / dw, h / dh) : Math.min(w / dw, h / dh)
  const horizontal = spec.align.endsWith('l') ? 0 : spec.align.endsWith('r') ? 1 : 0.5
  const vertical = spec.align.startsWith('t') ? 0 : spec.align.startsWith('b') ? 1 : 0.5
  return { s, tx: (w - dw * s) * horizontal + spec.offsetX, ty: (h - dh * s) * vertical + spec.offsetY }
}

/** Which source page each overlaid page gets. */
export function pairPages(pages: number[], sourcePages: number[], pairing: OverlaySpec['pairing']): [number, number][] {
  const ordered = [...new Set(pages)].sort((a, b) => a - b)
  if (!sourcePages.length) return []
  return ordered.map((p, i) => [p, pairing === 'first' ? sourcePages[0] : sourcePages[i % sourcePages.length]])
}

/** Page count of a PDF. */
export async function overlayPageCount(bytes: Uint8Array): Promise<number> {
  return (await PDFDocument.load(bytes, { updateMetadata: false })).getPageCount()
}

export async function overlayPages(bytes: Uint8Array, other: Uint8Array, spec: OverlaySpec): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false })
  const src = await PDFDocument.load(other, { updateMetadata: false })
  const pairs = pairPages(spec.pages.filter((p) => p >= 0 && p < doc.getPageCount()), spec.sourcePages.filter((p) => p >= 0 && p < src.getPageCount()), spec.pairing)
  if (!pairs.length) throw new Error('There are no pages to overlay.')
  const opacity = Math.min(1, Math.max(0, spec.opacity))

  // Each source page is embedded once however many pages use it.
  const used = [...new Set(pairs.map((p) => p[1]))]
  const boxes = used.map((i) => {
    const cb = src.getPage(i).getCropBox()
    return { left: cb.x, bottom: cb.y, right: cb.x + cb.width, top: cb.y + cb.height }
  })
  const embedded = await doc.embedPages(
    used.map((i) => src.getPage(i)),
    boxes
  )
  const forms = new Map<number, { ref: PDFRef; dw: number; dh: number; inv: M }>()
  used.forEach((i, k) => {
    const page = src.getPage(i)
    const cb = page.getCropBox()
    const rot = ((page.getRotation().angle % 360) + 360) % 360
    const turned = rot === 90 || rot === 270
    forms.set(i, { ref: embedded[k].ref, dw: turned ? cb.height : cb.width, dh: turned ? cb.width : cb.height, inv: invert(frameFor(0, 0, cb.width, cb.height, rot).m as M) })
  })

  const gsPlain = doc.context.register(doc.context.obj({ Type: 'ExtGState', CA: opacity, ca: opacity }))
  const gsTint = doc.context.register(doc.context.obj({ Type: 'ExtGState', CA: opacity, ca: opacity, BM: 'Multiply' }))
  const gsLighten = doc.context.register(doc.context.obj({ Type: 'ExtGState', BM: 'Lighten' }))

  for (const [pi, si] of pairs) {
    const page = doc.getPage(pi)
    const { f, w, h } = frameOf(page)
    const form = forms.get(si)!
    const { s, tx, ty } = overlayPlacement(w, h, form.dw, form.dh, spec)
    const ctm = (m: M) => `${m.map(n).join(' ')} cm`
    const name = page.node.newXObject('OPOv', form.ref).decodeText().replace(/^\//, '')
    let body: string
    let gs = gsPlain
    if (spec.tint) {
      // The overlay is drawn on white inside its own group; the tint is then lightened onto it, which turns black to
      // the tint and leaves white as it is. The group is multiplied onto the page, so only the linework shows.
      const inner = `1 1 1 rg 0 0 ${n(form.dw)} ${n(form.dh)} re f q ${ctm(form.inv)} /Ov Do Q /LG gs ${rgb(spec.tint)} rg 0 0 ${n(form.dw)} ${n(form.dh)} re f`
      const group = doc.context.register(
        doc.context.flateStream(inner, {
          Type: 'XObject',
          Subtype: 'Form',
          BBox: [0, 0, form.dw, form.dh],
          Group: { S: 'Transparency', CS: 'DeviceRGB', I: true },
          Resources: { XObject: { Ov: form.ref }, ExtGState: { LG: gsLighten } }
        })
      )
      const gname = page.node.newXObject('OPOg', group).decodeText().replace(/^\//, '')
      body = `${ctm([s, 0, 0, s, tx, ty])} /${gname} Do`
      gs = gsTint
    } else {
      // Form space is the source page's user space, moved to its origin; turn that into the displayed page, then place it.
      const [a, b, c, d, e, g] = form.inv
      body = `${ctm([s * a, s * b, s * c, s * d, s * e + tx, s * g + ty])} /${name} Do`
    }
    const gsName = page.node.newExtGState('OPGS', gs).decodeText().replace(/^\//, '')
    addMarkStream(doc, page, 'Overlay', `q ${ctm(f.m as M)} /${gsName} gs ${body} Q`, spec.behind)
  }
  return doc.save()
}
