/**
 * For real PDFs: do PDFium's image objects line up, in order and by transform, with the image draws of the content
 * stream? Prints counts only. Usage: npx tsx scripts/image-check.mts file.pdf [...]
 */
import { readFileSync } from 'node:fs'
import { PDFDocument } from 'pdf-lib'
import { PDFiumLibrary } from '@hyzyla/pdfium'
import { imageDraws, parseContent } from '../src/renderer/src/content.ts'
import { isImageXObject, pageContent } from '../src/renderer/src/pageContent.ts'
import { readImageObjects } from '../src/renderer/src/pdfiumRaw.ts'

const lib = await PDFiumLibrary.init()
for (const file of process.argv.slice(2)) {
  const buf = new Uint8Array(readFileSync(file))
  const pl = await PDFDocument.load(buf, { updateMetadata: false, ignoreEncryption: true })
  const doc = await lib.loadDocument(buf)
  let match = 0
  let off = 0
  let misaligned = 0
  const pages = Math.min(doc.getPageCount(), 10)
  for (let i = 0; i < pages; i++) {
    const page = pl.getPage(i)
    const draws = imageDraws(parseContent(pageContent(page)), (n) => isImageXObject(page, n))
    const p = doc.getPage(i)
    const { objects, total } = readImageObjects(lib, p)
    p.close()
    if (total !== draws.length) {
      misaligned++
      continue
    }
    for (const o of objects) {
      const d = draws[o.ordinal]
      if (d.ctm.every((v, k) => Math.abs(v - o.matrix[k]) <= 0.5 + Math.abs(v) * 1e-3)) match++
      else off++
    }
  }
  console.log(`${file.split(/[\\/]/).pop()?.slice(0, 30).padEnd(30)} images verified ${match}, MISMATCH ${off}, misaligned pages ${misaligned} (of ${pages})`)
  doc.destroy()
}
