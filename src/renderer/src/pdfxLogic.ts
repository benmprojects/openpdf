import { PDFName, PDFNumber, PDFRawStream, type PDFObject } from 'pdf-lib'
import { PDFArray } from 'pdf-lib'

/** Whether a colour space object is an ICC based RGB space (three components). */
export function iccIsRgb(cs: PDFObject | undefined): boolean {
  if (!(cs instanceof PDFArray) || cs.lookup(0) !== PDFName.of('ICCBased')) return false
  const st = cs.lookup(1)
  return st instanceof PDFRawStream && st.dict.lookupMaybe(PDFName.of('N'), PDFNumber)?.asNumber() === 3
}
