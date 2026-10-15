/**
 * Dev check: hiding an existing annotation should stop PDFium drawing it without disturbing the rest of the page.
 * Usage: npx tsx scripts/hide-check.mts file.pdf
 */
import { readFileSync } from 'node:fs'
import { PDFiumLibrary } from '@hyzyla/pdfium'
import { readPageAnnots, removePageAnnot } from '../src/renderer/src/pdfiumRaw'

const lib = await PDFiumLibrary.init()
const doc = await lib.loadDocument(new Uint8Array(readFileSync(process.argv[2])))

const nonWhite = async () => {
  const page = doc.getPage(0)
  const r = await page.render({ scale: 1, render: 'bitmap', renderFormFields: true })
  page.close()
  let n = 0
  for (let i = 0; i < r.data.length; i += 4) if (r.data[i] < 250 || r.data[i + 1] < 250 || r.data[i + 2] < 250) n++
  return n
}

let page = doc.getPage(0)
const annots = readPageAnnots(lib, page)
page.close()
console.log('imported', annots.map((a) => `${a.index}:${a.kind}`).join(' '))
console.log('non-white pixels before', await nonWhite())

const removed: number[] = []
for (const a of annots) {
  page = doc.getPage(0)
  const ok = removePageAnnot(lib, page, a.index, a.subtype, removed.filter((i) => i < a.index).length)
  page.close()
  if (ok) removed.push(a.index)
  console.log(`hide ${a.kind} (index ${a.index}) ->`, ok, '| non-white pixels', await nonWhite())
}
page = doc.getPage(0)
console.log('annots left', readPageAnnots(lib, page).length)
page.close()
