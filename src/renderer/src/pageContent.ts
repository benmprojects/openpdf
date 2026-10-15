import { PDFArray, PDFDict, PDFName, PDFRawStream, PDFStream, decodePDFRawStream, type PDFPage } from 'pdf-lib'
import { bytesToString } from './content'

/** The decoded content of a page as one string (its content streams joined by newlines). */
export function pageContent(page: PDFPage): string {
  const c = page.node.lookup(PDFName.of('Contents'))
  const parts: unknown[] = c instanceof PDFArray ? Array.from({ length: c.size() }, (_, i) => c.lookup(i)) : [c]
  let src = ''
  for (const st of parts) {
    if (st instanceof PDFRawStream) src += bytesToString(decodePDFRawStream(st).decode()) + '\n'
    else if (st instanceof PDFStream) src += bytesToString((st as unknown as { getContents(): Uint8Array }).getContents()) + '\n'
  }
  return src
}

/** The page's /XObject resources, looking up through the page tree for inherited resources. */
export function xobjectDict(page: PDFPage): PDFDict | undefined {
  let node: PDFDict | undefined = page.node
  for (let i = 0; node && i < 32; i++) {
    const res = node.lookupMaybe(PDFName.of('Resources'), PDFDict)
    if (res) return res.lookupMaybe(PDFName.of('XObject'), PDFDict)
    node = node.lookupMaybe(PDFName.of('Parent'), PDFDict)
  }
  return undefined
}

/** Whether the named XObject of a page is an image (rather than a form). */
export function isImageXObject(page: PDFPage, name: string): boolean {
  const x = xobjectDict(page)?.lookup(PDFName.of(name))
  return x instanceof PDFStream && x.dict.lookup(PDFName.of('Subtype')) === PDFName.of('Image')
}
