/**
 * Writes the scales a person set into the PDF as viewport measure dictionaries (ISO 32000-2 12.9), one per page,
 * so other viewers read the same scale. Any viewport on the page that already has a /Measure is replaced.
 */
import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFString } from 'pdf-lib'
import type { Scale } from './measure'
import { pdfUnit } from './measureScale'

/** A /NumberFormat for `unit`: `c` converts from the previous entry, precision from the scale. */
function numberFormat(unit: string, c: number, scale: Scale, last: boolean) {
  const p = scale.precision
  const fraction = p && 'fraction' in p ? p.fraction : 0
  const d = fraction || 10 ** (p && 'decimals' in p ? p.decimals : 2)
  return {
    Type: 'NumberFormat',
    U: PDFHexString.fromText(unit),
    C: c,
    // Rounding only applies to the last entry of a chain of units.
    ...(last ? { D: d, ...(fraction ? { FD: true } : {}) } : {}),
    RT: PDFString.of(''),
    SS: PDFString.of('')
  }
}

/**
 * `scales[i]` is the scale for page i, or null to leave that page alone. Returns the bytes unchanged when no
 * page has one.
 */
export async function writePageScales(bytes: Uint8Array, scales: (Scale | null | undefined)[]): Promise<Uint8Array> {
  if (!scales.some(Boolean)) return bytes
  const doc = await PDFDocument.load(bytes, { updateMetadata: false })
  const ctx = doc.context
  doc.getPages().forEach((page, i) => {
    const s = scales[i]
    if (!s) return
    const cb = page.getCropBox()
    const unit = pdfUnit(s.unit)
    const text = s.label ?? `1 pt = ${s.factor} ${s.unit}`
    const x = s.unit === 'ft-in' ? [numberFormat('ft', s.factor, s, false), numberFormat('in', 12, s, true)] : [numberFormat(unit, s.factor, s, true)]
    const measure = ctx.obj({
      Type: 'Measure',
      Subtype: 'RL',
      R: PDFHexString.fromText(text),
      X: x,
      D: [numberFormat(unit, 1, s, true)],
      A: [numberFormat(`${unit}²`, 1, s, true)]
    } as never)
    const viewport = ctx.obj({
      Type: 'Viewport',
      BBox: [cb.x, cb.y, cb.x + cb.width, cb.y + cb.height],
      Name: PDFHexString.fromText(text),
      Measure: measure
    } as never)
    const kept = ctx.obj([]) as PDFArray
    const old = page.node.lookupMaybe(PDFName.of('VP'), PDFArray)
    if (old) {
      for (let k = 0; k < old.size(); k++) {
        const v = old.lookupMaybe(k, PDFDict)
        if (v && !v.has(PDFName.of('Measure'))) kept.push(old.get(k))
      }
    }
    kept.push(viewport)
    page.node.set(PDFName.of('VP'), kept)
  })
  return doc.save({ useObjectStreams: false })
}
