/**
 * How text objects group into editable blocks on real PDFs. Prints counts only, never text.
 * Usage: npx tsx scripts/block-check.mts file.pdf [...]
 */
import { readFileSync } from 'node:fs'
import { PDFiumLibrary } from '@hyzyla/pdfium'
import { readTextObjects } from '../src/renderer/src/pdfiumRaw.ts'
import { groupBlocks } from '../src/renderer/src/textBlocks.ts'

const lib = await PDFiumLibrary.init()
for (const file of process.argv.slice(2)) {
  const doc = await lib.loadDocument(new Uint8Array(readFileSync(file)))
  let objects = 0
  let blocks = 0
  let paragraphs = 0
  let lineCounts: number[] = []
  const pages = Math.min(doc.getPageCount(), 6)
  for (let i = 0; i < pages; i++) {
    const page = doc.getPage(i)
    const r = readTextObjects(lib, page)
    page.close()
    const b = groupBlocks(r.objects, r.rotation)
    objects += r.total
    blocks += b.length
    for (const x of b) {
      if (x.reflow && x.layout.leading > 0) {
        paragraphs++
        lineCounts.push(Math.round((x.rect.h / x.layout.leading) * 10) / 10)
      }
    }
  }
  lineCounts = lineCounts.sort((p, q) => q - p).slice(0, 8)
  console.log(`${file.split(/[\\/]/).pop()?.slice(0, 30).padEnd(30)} objects ${objects}, blocks ${blocks}, paragraphs ${paragraphs}, tallest (in lines) ${lineCounts.join(' ')}`)
  doc.destroy()
}
