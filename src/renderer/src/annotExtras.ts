/**
 * Reads annotation entries PDFium's API does not expose (line endings, dash patterns, callout lines, measure
 * dictionaries), straight from the annotation dictionaries with pdf-lib. Used by the PDFium worker when importing
 * annotations, so more of what other tools write can be edited faithfully.
 */
import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFNumber, PDFRef, PDFString } from 'pdf-lib'
import { BLEND_MODES, isNoteIcon, type BlendMode, type NoteIcon } from './annotations'
import { isLineEnd, type LineEnd } from './lineEnds'

const textOf = (o: unknown) => (o instanceof PDFString || o instanceof PDFHexString ? o.decodeText() : undefined)

export interface LinkTarget {
  uri?: string
  page?: number
}

/** Targets of the Link annotations seen by annotDicts, resolved against the document's pages. */
const linkTargets = new WeakMap<PDFDict, LinkTarget>()

/** Where a Link annotation goes, when it is a web address or a page of this document; undefined for anything else. */
export function linkTargetOf(d: PDFDict | undefined): LinkTarget | undefined {
  return d ? linkTargets.get(d) : undefined
}

function resolveLink(doc: PDFDocument, d: PDFDict, pageIndex: Map<string, number>): LinkTarget | undefined {
  const a = d.lookupMaybe(PDFName.of('A'), PDFDict)
  const s = a && nameOf(a, 'S')
  if (a && s === 'URI') {
    const uri = textOf(a.lookup(PDFName.of('URI')))
    return uri ? { uri } : undefined
  }
  if (a && s !== 'GoTo') return undefined
  let dest = a ? a.lookup(PDFName.of('D')) : d.lookup(PDFName.of('Dest'))
  // Named destinations: the old /Dests dictionary, or the /Names /Dests name tree (first level of names only).
  const name = dest instanceof PDFName ? dest.decodeText() : textOf(dest)
  if (name !== undefined) {
    const dests = doc.catalog.lookupMaybe(PDFName.of('Dests'), PDFDict)
    dest = dests?.lookup(PDFName.of(name))
    if (!dest) {
      const tree = doc.catalog.lookupMaybe(PDFName.of('Names'), PDFDict)?.lookupMaybe(PDFName.of('Dests'), PDFDict)
      const find = (node: PDFDict | undefined, depth: number): unknown => {
        if (!node || depth > 10) return undefined
        const names = node.lookupMaybe(PDFName.of('Names'), PDFArray)
        for (let i = 0; names && i + 1 < names.size(); i += 2) if (textOf(names.lookup(i)) === name) return names.lookup(i + 1)
        const kids = node.lookupMaybe(PDFName.of('Kids'), PDFArray)
        for (let i = 0; kids && i < kids.size(); i++) {
          const hit = find(kids.lookupMaybe(i, PDFDict), depth + 1)
          if (hit) return hit
        }
        return undefined
      }
      dest = find(tree, 0) as typeof dest
    }
    if (dest instanceof PDFDict) dest = dest.lookup(PDFName.of('D'))
  }
  if (!(dest instanceof PDFArray) || !dest.size()) return undefined
  const ref = dest.get(0)
  if (ref instanceof PDFRef) {
    const page = pageIndex.get(ref.toString())
    return page === undefined ? undefined : { page }
  }
  return undefined
}

/** Each page's /Annots dictionaries, in /Annots order (the same order as PDFium's annotation indices). */
export async function annotDicts(bytes: Uint8Array): Promise<((PDFDict | undefined)[])[] | null> {
  try {
    const doc = await PDFDocument.load(bytes, { updateMetadata: false })
    const pages = doc.getPages()
    const pageIndex = new Map(pages.map((p, i) => [p.ref.toString(), i]))
    return pages.map((p) => {
      const arr = p.node.lookupMaybe(PDFName.of('Annots'), PDFArray)
      if (!arr) return []
      return Array.from({ length: arr.size() }, (_, i) => {
        const d = arr.lookupMaybe(i, PDFDict)
        if (d && nameOf(d, 'Subtype') === 'Link') {
          const t = resolveLink(doc, d, pageIndex)
          if (t) linkTargets.set(d, t)
        }
        return d
      })
    })
  } catch {
    return null // encrypted or damaged: import without the extras
  }
}

export function numbers(d: PDFDict | undefined, key: string): number[] | null {
  const arr = d?.lookupMaybe(PDFName.of(key), PDFArray)
  if (!arr) return null
  const out: number[] = []
  for (let i = 0; i < arr.size(); i++) {
    const v = arr.lookupMaybe(i, PDFNumber)
    if (!v) return null
    out.push(v.asNumber())
  }
  return out
}

export function nameOf(d: PDFDict | undefined, key: string): string | undefined {
  return d?.lookupMaybe(PDFName.of(key), PDFName)?.decodeText()
}


/** The icon of a note (/Name), when it is one we offer. */
export function noteIconOf(d: PDFDict | undefined): NoteIcon | undefined {
  const n = nameOf(d, 'Name')
  return isNoteIcon(n) ? n : undefined
}

/** The "num gen" key of a layer (optional content group) reference, as `readLayers` gives it. */
export const layerKey = (r: PDFRef) => `${r.objectNumber} ${r.generationNumber}`

/** The layer an annotation belongs to: its /OC group, or the first group of its membership dictionary. */
export function layerKeyOf(d: PDFDict | undefined): string | undefined {
  const oc = d?.get(PDFName.of('OC'))
  if (!(oc instanceof PDFRef)) return undefined
  const target = d!.context.lookupMaybe(oc, PDFDict)
  if (!target) return undefined
  if (nameOf(target, 'Type') !== 'OCMD') return layerKey(oc)
  const groups = target.get(PDFName.of('OCGs'))
  if (groups instanceof PDFRef) return layerKey(groups)
  const arr = target.lookupMaybe(PDFName.of('OCGs'), PDFArray)
  const first = arr && arr.size() ? arr.get(0) : undefined
  return first instanceof PDFRef ? layerKey(first) : undefined
}

const ARROWS = new Set(['OpenArrow', 'ClosedArrow', 'ROpenArrow', 'RClosedArrow'])

/** Whether a line has an arrow head at its start and/or end (/LE). */
export function arrowEnds(d: PDFDict | undefined): { start: boolean; end: boolean } {
  const le = d?.lookupMaybe(PDFName.of('LE'), PDFArray)
  if (!le) return { start: false, end: false }
  const at = (i: number) => ARROWS.has(le.lookupMaybe(i, PDFName)?.decodeText() ?? '')
  return { start: at(0), end: at(1) }
}

/** The two /LE styles of a line or polyline, with a single name taken as the end style (as a callout's /LE is). */
export function lineEndStyles(d: PDFDict | undefined): { start: LineEnd; end: LineEnd } {
  const le = d?.lookup(PDFName.of('LE'))
  const pick = (o: unknown): LineEnd => {
    const v = o instanceof PDFName ? o.decodeText() : undefined
    return isLineEnd(v) ? v : 'None'
  }
  if (le instanceof PDFArray) return { start: pick(le.lookup(0)), end: pick(le.lookup(1)) }
  return { start: 'None', end: pick(le) }
}

/** The border effect (/BE): the cloud intensity 1 or 2 when it is a cloud, else null (no effect, or the plain style). */
export function cloudIntensityOf(d: PDFDict | undefined): number | null {
  const be = d?.lookupMaybe(PDFName.of('BE'), PDFDict)
  if (!be || nameOf(be, 'S') !== 'C') return null
  const i = be.lookupMaybe(PDFName.of('I'), PDFNumber)?.asNumber() ?? 0
  return i >= 2 ? 2 : i >= 1 ? 1 : null
}

/** The blend mode named in /BM, when it is one we offer. */
export function blendModeOf(d: PDFDict | undefined): BlendMode | undefined {
  const v = nameOf(d, 'BM')
  return v && (BLEND_MODES as string[]).includes(v) ? (v as BlendMode) : undefined
}

/** The line style from /BS (or the dash array of /Border): dotted when the dashes are no longer than the line is wide. */
export function dashStyle(d: PDFDict | undefined, lineWidth: number): 'dashed' | 'dotted' | undefined {
  const bs = d?.lookupMaybe(PDFName.of('BS'), PDFDict)
  let dash = bs && nameOf(bs, 'S') === 'D' ? (numbers(bs, 'D') ?? [3]) : null
  if (!dash) {
    const border = d?.lookupMaybe(PDFName.of('Border'), PDFArray)
    const dashArr = border?.lookupMaybe(3, PDFArray)
    if (dashArr) dash = Array.from({ length: dashArr.size() }, (_, i) => dashArr.lookupMaybe(i, PDFNumber)?.asNumber() ?? 3)
  }
  if (!dash || !dash.length) return undefined
  return dash[0] <= Math.max(1, lineWidth) ? 'dotted' : 'dashed'
}

/** Scale and unit of a measurement annotation's /Measure dictionary (rectilinear only). */
export function measureOf(d: PDFDict | undefined): { factor: number; unit: string; ratio?: string } | null {
  const m = d?.lookupMaybe(PDFName.of('Measure'), PDFDict)
  if (!m || nameOf(m, 'Subtype') !== 'RL') return null
  const x = m.lookupMaybe(PDFName.of('X'), PDFArray)?.lookupMaybe(0, PDFDict)
  const c = x?.lookupMaybe(PDFName.of('C'), PDFNumber)?.asNumber()
  if (!c || !(c > 0)) return null
  return { factor: c, unit: textOf(x?.lookup(PDFName.of('U'))) ?? '', ratio: textOf(m.lookup(PDFName.of('R'))) }
}
