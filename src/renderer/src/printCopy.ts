import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber } from 'pdf-lib'

/** What a printout contains. */
export type PrintWhat = 'comments' | 'document' | 'markup'

const FLAG_HIDDEN = 2
const FLAG_PRINT = 4

/**
 * A copy of the document as it should print:
 * - `comments` (document and comments): everything, except annotations whose Print flag is off or that are Hidden;
 * - `document`: no comments or markup, only form fields (so filled-in values print) and links;
 * - `markup` (comments only): the page content is taken away and only the comments are left, on blank pages.
 * Annotations that do not print are left out of all three, as other viewers do. The input is not changed.
 */
export async function printCopy(bytes: Uint8Array, what: PrintWhat): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false })
  const ctx = doc.context
  for (const page of doc.getPages()) {
    const annots = page.node.lookupMaybe(PDFName.of('Annots'), PDFArray)
    if (annots) {
      const kept = annots.asArray().filter((ref) => {
        const a = ctx.lookupMaybe(ref, PDFDict)
        if (!a) return false
        const subtype = a.lookupMaybe(PDFName.of('Subtype'), PDFName)?.decodeText()
        const f = a.lookupMaybe(PDFName.of('F'), PDFNumber)?.asNumber()
        // By the standard an annotation without the Print flag does not print. Form fields and links with no flags
        // at all are left alone, because plenty of form files omit them and still expect the fields to print.
        const flags = f ?? (subtype === 'Widget' || subtype === 'Link' ? FLAG_PRINT : 0)
        if (flags & FLAG_HIDDEN || !(flags & FLAG_PRINT)) return false
        if (what === 'document') return subtype === 'Widget' || subtype === 'Link'
        if (what === 'markup') return subtype !== 'Widget' && subtype !== 'Link' && subtype !== 'Popup'
        return true
      })
      if (kept.length !== annots.size()) {
        if (kept.length) page.node.set(PDFName.of('Annots'), ctx.obj(kept))
        else page.node.delete(PDFName.of('Annots'))
      }
    }
    if (what === 'markup') page.node.set(PDFName.of('Contents'), ctx.register(ctx.stream('')))
  }
  return doc.save({ useObjectStreams: false })
}
