/** Pages from places other than a PDF file: a picture on the clipboard, or a scanner. Each becomes a small PDF to insert. */
import { imagesToPdf } from './createPdf'
import { addTextLayer, type OcrInput } from './ocrLayer'
import type { ScanRequest } from './ScanDialog'
import { processScan } from './scanProcess'

export interface PageSource {
  data: Uint8Array
  /** Number of pages in `data`. */
  count: number
  /** For the dialog's summary, for example "picture from the clipboard". */
  label: string
}

/** The picture on the clipboard as a one-page PDF, or null when there is none. */
export async function clipboardPicturePages(): Promise<PageSource | null> {
  const png = await window.openpdf.clipboardImage()
  if (!png) return null
  return {
    data: await imagesToPdf([{ name: 'Clipboard.png', data: png }], 'image'),
    count: 1,
    label: 'picture from the clipboard'
  }
}

/** Scans with the chosen scanner and makes a page of each sheet, with a text layer when asked. Null when nothing was scanned. */
export async function scannedPages(r: ScanRequest, progress?: (text: string) => void): Promise<PageSource | null> {
  progress?.('Scanning…')
  const scanned = await window.openpdf.scan(r)
  if (!scanned.length) return null
  // The scanner's own window does not say what resolution was used, so 200 dpi is assumed for the page size.
  const dpi = r.source === 'dialog' ? 200 : r.dpi
  const sheets: Uint8Array[] = []
  for (let i = 0; i < scanned.length; i++) {
    if (r.deskew || r.despeckle || r.autoCrop) progress?.(`Cleaning up sheet ${i + 1} of ${scanned.length}…`)
    sheets.push(await processScan(scanned[i], r, dpi))
  }
  let data = await imagesToPdf(
    sheets.map((s, i) => ({ name: `scan${i + 1}.png`, data: s })),
    'image',
    dpi
  )
  if (r.ocr) {
    const inputs: OcrInput[] = []
    for (let i = 0; i < sheets.length; i++) {
      progress?.(`Recognising text on sheet ${i + 1} of ${sheets.length}…`)
      inputs.push({
        page: i,
        scale: dpi / 72,
        lines: (await window.openpdf.ocrRecognise(sheets[i], r.ocrLanguages?.length ? r.ocrLanguages : ['eng'])).lines
      })
    }
    data = (await addTextLayer(data, inputs)).bytes
  }
  return {
    data,
    count: sheets.length,
    label: `${sheets.length} scanned sheet${sheets.length === 1 ? '' : 's'}`
  }
}
