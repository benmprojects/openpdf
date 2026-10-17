import { PDFDocument } from 'pdf-lib'
import { blankPageSize, type PaperKind } from './pageDialogLogic'

/** A new PDF of `count` blank pages, each `width` x `height` points. */
export async function newBlankDocument(size: { width: number; height: number }, count: number): Promise<Uint8Array> {
  if (!Number.isInteger(count) || count < 1 || count > 500) throw new Error('Choose from 1 to 500 pages.')
  if (!(size.width >= 10 && size.height >= 10)) throw new Error('That page size is too small.')
  const doc = await PDFDocument.create()
  for (let i = 0; i < count; i++) doc.addPage([size.width, size.height])
  doc.setCreator('OpenPDF')
  doc.setProducer('OpenPDF')
  return doc.save()
}

/** The page size a new document dialog's choices stand for (points), or why it is not usable. */
export function newDocumentSize(kind: Exclude<PaperKind, 'same'>, orientation: 'portrait' | 'landscape', custom: { w: number; h: number }): { width: number; height: number; error: string | null } {
  return blankPageSize(kind, orientation, undefined, custom)
}
