import { PDFArray, PDFDict, PDFDocument, PDFName } from 'pdf-lib'

/**
 * A copy of the document without its comments and markup (every annotation except form fields and links),
 * for "Document" printing. Form fields stay so filled-in values still print. The input is not changed.
 */
export async function stripComments(bytes: Uint8Array): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false })
  const keep = new Set(['Widget', 'Link'])
  for (const page of doc.getPages()) {
    const annots = page.node.lookupMaybe(PDFName.of('Annots'), PDFArray)
    if (!annots) continue
    const kept = annots.asArray().filter((ref) => {
      const a = doc.context.lookupMaybe(ref, PDFDict)
      const subtype = a?.lookup(PDFName.of('Subtype'))
      return subtype instanceof PDFName && keep.has(subtype.decodeText())
    })
    if (kept.length === annots.size()) continue
    if (kept.length) page.node.set(PDFName.of('Annots'), doc.context.obj(kept))
    else page.node.delete(PDFName.of('Annots'))
  }
  return doc.save({ useObjectStreams: false })
}
