/**
 * For real PDFs: do PDFium's painted path objects line up, in order and by position, with the painted paths found in
 * the content stream? Prints counts only. Usage: npx tsx scripts/path-check.mts file.pdf [...]
 */
import { readFileSync } from 'node:fs'
import { PDFDocument } from 'pdf-lib'
import { PDFiumLibrary } from '@hyzyla/pdfium'
import { parseContent, pathDraws } from '../src/renderer/src/content.ts'
import { pageContent } from '../src/renderer/src/pageContent.ts'
import { readPathObjects } from '../src/renderer/src/pdfiumRaw.ts'

const lib = await PDFiumLibrary.init()
for (const file of process.argv.slice(2)) {
  const buf = new Uint8Array(readFileSync(file))
  const pl = await PDFDocument.load(buf, { updateMetadata: false, ignoreEncryption: true })
  const doc = await lib.loadDocument(buf)
  let match = 0
  let off = 0
  let misaligned = 0
  let clipping = 0
  const pages = Math.min(doc.getPageCount(), 6)
  let streamCount = 0
  let pdfiumCount = 0
  for (let i = 0; i < pages; i++) {
    const draws = pathDraws(parseContent(pageContent(pl.getPage(i))))
    const p = doc.getPage(i)
    const { objects, total } = readPathObjects(lib, p)
    p.close()
    streamCount += draws.length
    pdfiumCount += total
    if (total !== draws.length) {
      misaligned++
      continue
    }
    for (const o of objects) {
      const d = draws[o.ordinal]
      if (d.clips) clipping++
      const [l, b, r, t] = o.pageBounds
      const near = (a: number, c: number, tol: number) => Math.abs(a - c) <= tol
      const ok = near((l + r) / 2, (d.bbox.x0 + d.bbox.x1) / 2, 3) && near((b + t) / 2, (d.bbox.y0 + d.bbox.y1) / 2, 3)
      if (ok) match++
      else off++
    }
  }
  console.log(`${file.split(/[\\/]/).pop()?.slice(0, 30).padEnd(30)} paths verified ${match}, MISMATCH ${off}, misaligned pages ${misaligned} (of ${pages}), with clip ${clipping}; stream ${streamCount} vs PDFium ${pdfiumCount}`)
  doc.destroy()
}
