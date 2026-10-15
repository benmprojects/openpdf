/**
 * For real PDFs: how often does the content stream's own idea of where a text operator starts (showOrigins) agree with
 * PDFium's text object position? Prints counts only. Usage: npx tsx scripts/origin-check.mts file.pdf [...]
 */
import { readFileSync } from 'node:fs'
import { PDFArray, PDFDocument, PDFName, PDFRawStream, decodePDFRawStream } from 'pdf-lib'
import { PDFiumLibrary } from '@hyzyla/pdfium'
import { bytesToString, isShow, parseContent, showBytes, showOrigins } from '../src/renderer/src/content.ts'
import { readTextObjects } from '../src/renderer/src/pdfiumRaw.ts'

const lib = await PDFiumLibrary.init()
for (const file of process.argv.slice(2)) {
  const buf = new Uint8Array(readFileSync(file))
  const pl = await PDFDocument.load(buf, { updateMetadata: false, ignoreEncryption: true })
  const doc = await lib.loadDocument(buf)
  let match = 0, unknown = 0, off = 0, misaligned = 0
  const pages = Math.min(doc.getPageCount(), 8)
  for (let i = 0; i < pages; i++) {
    const c = pl.getPage(i).node.lookup(PDFName.of('Contents'))
    const streams = c instanceof PDFArray ? Array.from({ length: c.size() }, (_, k) => c.lookup(k)) : [c]
    let src = ''
    for (const st of streams) if (st instanceof PDFRawStream) src += bytesToString(decodePDFRawStream(st).decode()) + '\n'
    const ops = parseContent(src)
    const all = ops.filter(isShow)
    const origins = showOrigins(ops)
    const keep = all.map((o, k) => (showBytes(o).length > 0 ? k : -1)).filter((k) => k >= 0)
    const page = doc.getPage(i)
    const { objects, total } = readTextObjects(lib, page)
    page.close()
    if (total !== keep.length) { misaligned++; continue }
    objects.forEach((o) => {
      const org = origins[keep[o.ordinal]]
      if (!org) unknown++
      else if (Math.hypot(org.x - o.matrix[4], org.y - o.matrix[5]) <= 1) match++
      else off++
    })
  }
  console.log(`${file.split(/[\\/]/).pop()?.slice(0, 30).padEnd(30)} verified ${match}, unknown ${unknown}, MISMATCH ${off}, misaligned pages ${misaligned}`)
  doc.destroy()
}
