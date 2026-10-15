/**
 * How many fields form detection would suggest on real PDFs, by kind of evidence. Counts only, no text.
 * Usage: npx tsx scripts/detect-check.mts file.pdf [...]
 */
import { readFileSync } from 'node:fs'
import { PDFiumLibrary } from '@hyzyla/pdfium'
import { detectInDocument } from '../src/renderer/src/formDetect.ts'
import { readPageText } from '../src/renderer/src/pdfiumRaw.ts'

const lib = await PDFiumLibrary.init()
for (const file of process.argv.slice(2)) {
  const bytes = new Uint8Array(readFileSync(file))
  const doc = await lib.loadDocument(bytes)
  const pages = doc.getPageCount()
  const found = await detectInDocument(bytes, async (i) => {
    const page = doc.getPage(i)
    const t = readPageText(lib, page)
    page.close()
    return t
  }, [])
  const by: Record<string, number> = {}
  for (const d of found) by[d.source] = (by[d.source] ?? 0) + 1
  console.log(`${file.split(/[\\/]/).pop()?.slice(0, 30).padEnd(30)} pages ${pages}: ${found.length} suggested ${JSON.stringify(by)}`)
  doc.destroy()
}
