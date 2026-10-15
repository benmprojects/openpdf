/**
 * Reads annotation entries PDFium's API does not expose (line endings, dash patterns, callout lines, measure
 * dictionaries), straight from the annotation dictionaries with pdf-lib. Used by the PDFium worker when importing
 * annotations, so more of what other tools write can be edited faithfully.
 */
import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFNumber, PDFString } from 'pdf-lib'

/** Each page's /Annots dictionaries, in /Annots order (the same order as PDFium's annotation indices). */
export async function annotDicts(bytes: Uint8Array): Promise<((PDFDict | undefined)[])[] | null> {
  try {
    const doc = await PDFDocument.load(bytes, { updateMetadata: false })
    return doc.getPages().map((p) => {
      const arr = p.node.lookupMaybe(PDFName.of('Annots'), PDFArray)
      return arr ? Array.from({ length: arr.size() }, (_, i) => arr.lookupMaybe(i, PDFDict)) : []
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

const textOf = (o: unknown) => (o instanceof PDFString || o instanceof PDFHexString ? o.decodeText() : undefined)

const ARROWS = new Set(['OpenArrow', 'ClosedArrow', 'ROpenArrow', 'RClosedArrow'])

/** Whether a line has an arrow head at its start and/or end (/LE). */
export function arrowEnds(d: PDFDict | undefined): { start: boolean; end: boolean } {
  const le = d?.lookupMaybe(PDFName.of('LE'), PDFArray)
  if (!le) return { start: false, end: false }
  const at = (i: number) => ARROWS.has(le.lookupMaybe(i, PDFName)?.decodeText() ?? '')
  return { start: at(0), end: at(1) }
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
