/**
 * Checks that PDFium's text objects line up, in order, with the text-showing operators of a page's content stream
 * (the assumption behind editing text: object k of PDFium is the k-th show operator). Prints counts only, never text.
 * Usage: npx tsx scripts/textobj-check.mts file.pdf [more.pdf ...]
 */
import { readFileSync } from 'node:fs'
import { PDFArray, PDFDocument, PDFName, PDFRawStream, decodePDFRawStream } from 'pdf-lib'
import { PDFiumLibrary } from '@hyzyla/pdfium'
import { bytesToString, isShow, parseContent, showBytes } from '../src/renderer/src/content.ts'

type Raw = { HEAPU8: Uint8Array; wasmExports: { malloc(n: number): number; free(p: number): void }; [k: `_${string}`]: (...a: number[]) => number }

const lib = await PDFiumLibrary.init()
const m = (lib as unknown as { module: Raw }).module

for (const file of process.argv.slice(2)) {
  const buf = new Uint8Array(readFileSync(file))
  const pl = await PDFDocument.load(buf, { updateMetadata: false, ignoreEncryption: true })
  const doc = await lib.loadDocument(buf)
  const pages = Math.min(doc.getPageCount(), 6)
  let ok = 0
  let countOff = 0
  let lenOff = 0
  let objs = 0
  let empties = 0
  let formObjs = 0
  for (let i = 0; i < pages; i++) {
    // Page content as one string.
    const page = pl.getPage(i)
    const c = page.node.lookup(PDFName.of('Contents'))
    const streams = c instanceof PDFArray ? Array.from({ length: c.size() }, (_, k) => c.lookup(k)) : [c]
    let src = ''
    for (const st of streams) if (st instanceof PDFRawStream) src += bytesToString(decodePDFRawStream(st).decode()) + '\n'
    const shows = parseContent(src).filter(isShow)
    const nonEmpty = shows.filter((o) => showBytes(o).length > 0)
    empties += shows.length - nonEmpty.length

    const p = doc.getPage(i)
    const pidx = (p as unknown as { pageIdx: number }).pageIdx
    const tp = m._FPDFText_LoadPage(pidx)
    const n = m._FPDFPage_CountObjects(pidx)
    const texts: number[] = []
    for (let k = 0; k < n; k++) {
      const o = m._FPDFPage_GetObject(pidx, k)
      const t = m._FPDFPageObj_GetType(o)
      if (t === 5) formObjs++
      if (t !== 1) continue
      const need = m._FPDFTextObj_GetText(o, tp, 0, 0)
      texts.push(Math.max(0, need / 2 - 1))
    }
    m._FPDFText_ClosePage(tp)
    objs += texts.length
    if (texts.length !== nonEmpty.length) {
      countOff++
      continue
    }
    // Same count: are the lengths compatible (characters = bytes for simple fonts, bytes / 2 for two-byte fonts)?
    const lenOk = texts.every((len, k) => {
      const b = showBytes(nonEmpty[k]).length
      return len === b || len * 2 === b || len === 0
    })
    if (!lenOk && process.env.SHOW_PAIRS) console.log('  pairs (pdfium chars, stream bytes):', texts.map((len, k) => [len, showBytes(nonEmpty[k]).length]).filter(([a, b]) => a !== b && a * 2 !== b).slice(0, 12).map((x) => x.join('/')).join(' '))
    if (lenOk) ok++
    else lenOff++
  }
  console.log(`${file.split(/[\\/]/).pop()?.slice(0, 28).padEnd(28)} pages ${pages}: aligned ${ok}, count differs ${countOff}, lengths differ ${lenOff}; text objects ${objs}, empty shows ${empties}, form objects ${formObjs}`)
  doc.destroy()
}
