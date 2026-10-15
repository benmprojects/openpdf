/**
 * Dev check: write annotations into a PDF with annotWrite, render the result with PDFium and report whether
 * the annotations landed where the overlay put them. Usage: npx tsx scripts/annot-check.ts in.pdf out.pdf outPrefix
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { deflateSync } from 'node:zlib'
import { PDFiumLibrary } from '@hyzyla/pdfium'
import { writeAnnotations } from '../src/renderer/src/annotWrite'
import { stampSize, withBounds, type Annot } from '../src/renderer/src/annotations'
import { readPageAnnots, readPageText } from '../src/renderer/src/pdfiumRaw'
import { findInPage, rangeRects } from '../src/renderer/src/textLogic'

const [inPath, outPath, prefix] = process.argv.slice(2)

function png(w: number, h: number, rgba: Uint8Array): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    return c >>> 0
  })
  const crc = (b: Buffer) => {
    let c = 0xffffffff
    for (const x of b) c = crcTable[(c ^ x) & 255] ^ (c >>> 8)
    return (c ^ 0xffffffff) >>> 0
  }
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length)
    const td = Buffer.concat([Buffer.from(type), data])
    const c = Buffer.alloc(4)
    c.writeUInt32BE(crc(td))
    return Buffer.concat([len, td, c])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  const raw = Buffer.alloc((w * 4 + 1) * h)
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0
    Buffer.from(rgba.buffer, rgba.byteOffset + y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1)
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0))
  ])
}

const lib = await PDFiumLibrary.init()
const src = new Uint8Array(readFileSync(inPath))
const doc0 = await lib.loadDocument(src.slice())
const annots: Annot[] = []
let id = 1
const pageCount = doc0.getPageCount()
for (let p = 0; p < pageCount; p++) {
  const page = doc0.getPage(p)
  const pt = readPageText(lib, page)
  page.close()
  const fox = findInPage(pt, p, 'fox', true, false)
  const mk = (kind: Annot['kind'], rects: Annot['rects'], extra: Partial<Annot> = {}): Annot => ({
    id: id++, page: p, kind, color: kind === 'highlight' ? '#ffd400' : kind === 'note' ? '#ffd400' : kind === 'textbox' ? '#1f5fd1' : '#e5322d',
    rects, text: '', fontSize: 12, lineWidth: 2, ...extra
  })
  annots.push(mk('highlight', rangeRects(pt.boxes, fox[0].from, fox[0].to)))
  annots.push(mk('underline', rangeRects(pt.boxes, 4, 14)))
  annots.push(mk('strikeout', rangeRects(pt.boxes, 30, 38)))
  annots.push(mk('note', [{ x: 400, y: 100, w: 22, h: 22 }], { text: 'A sticky note' }))
  annots.push(mk('textbox', [{ x: 60, y: 300, w: 180, h: 54 }], { text: 'Hello text box, this wraps over lines. é ü 😀' }))
  annots.push(mk('rectangle', [{ x: 300, y: 380, w: 120, h: 60 }]))
  annots.push(mk('ellipse', [{ x: 300, y: 460, w: 120, h: 60 }], { lineWidth: 4 }))
  annots.push(withBounds(mk('line', [], { points: [[{ x: 60, y: 480 }, { x: 240, y: 540 }]] })))
  annots.push(withBounds(mk('arrow', [], { points: [[{ x: 60, y: 600 }, { x: 240, y: 560 }]], lineWidth: 3 })))
  annots.push(withBounds(mk('ink', [], { points: [[{ x: 60, y: 650 }, { x: 100, y: 690 }, { x: 140, y: 650 }, { x: 180, y: 690 }]], lineWidth: 3 })))
  const sz = stampSize('APPROVED')
  annots.push(mk('stamp', [{ x: 300, y: 560, w: sz.w, h: sz.h }], { text: 'APPROVED' }))
}
const out = await writeAnnotations(src, annots)
writeFileSync(outPath, out)

const doc = await lib.loadDocument(out.slice())
for (let p = 0; p < pageCount; p++) {
  const page = doc.getPage(p)
  const r = await page.render({ scale: 1, render: 'bitmap', renderFormFields: true })
  writeFileSync(`${prefix}${p}.png`, png(r.width, r.height, r.data))
  const px = (x: number, y: number) => {
    const i = (Math.round(y) * r.width + Math.round(x)) * 4
    return [r.data[i], r.data[i + 1], r.data[i + 2]]
  }
  const countIn = (rect: { x: number; y: number; w: number; h: number }, test: (c: number[]) => boolean) => {
    let hit = 0
    let total = 0
    for (let y = Math.floor(rect.y); y < rect.y + rect.h; y++)
      for (let x = Math.floor(rect.x); x < rect.x + rect.w; x++) {
        total++
        if (test(px(x, y))) hit++
      }
    return +(hit / total).toFixed(2)
  }
  const mine = annots.filter((a) => a.page === p)
  const yellow = (c: number[]) => c[0] > 230 && c[1] > 180 && c[2] < 140
  const red = (c: number[]) => c[0] > 180 && c[1] < 120 && c[2] < 120
  const blue = (c: number[]) => c[2] > 150 && c[0] < 120
  const hl = mine.find((a) => a.kind === 'highlight')!.rects[0]
  const note = mine.find((a) => a.kind === 'note')!.rects[0]
  const tb = mine.find((a) => a.kind === 'textbox')!.rects[0]
  const ul = mine.find((a) => a.kind === 'underline')!.rects[0]
  const rectA = mine.find((a) => a.kind === 'rectangle')!.rects[0]
  const ellA = mine.find((a) => a.kind === 'ellipse')!.rects[0]
  const stampA = mine.find((a) => a.kind === 'stamp')!.rects[0]
  const lineA = mine.find((a) => a.kind === 'line')!.points![0]
  const arrowA = mine.find((a) => a.kind === 'arrow')!.points![0]
  const inkA = mine.find((a) => a.kind === 'ink')!.points![0]
  const nearRed = (x: number, y: number) => countIn({ x: x - 2, y: y - 2, w: 5, h: 5 }, red) > 0.2
  console.log(
    `  shapes: rect top edge ${nearRed(rectA.x + rectA.w / 2, rectA.y + 1)}, ellipse left ${nearRed(ellA.x + 2, ellA.y + ellA.h / 2)},`,
    `line mid ${nearRed((lineA[0].x + lineA[1].x) / 2, (lineA[0].y + lineA[1].y) / 2)}, arrow mid ${nearRed((arrowA[0].x + arrowA[1].x) / 2, (arrowA[0].y + arrowA[1].y) / 2)},`,
    `ink vertex ${nearRed(inkA[1].x, inkA[1].y)}, stamp border ${nearRed(stampA.x + stampA.w / 2, stampA.y + 1)}, stamp interior red`, countIn(stampA, red)
  )
  console.log(
    `page ${p} ${r.width}x${r.height}`,
    'highlight yellow', countIn(hl, yellow),
    '| note yellow', countIn(note, yellow),
    '| textbox blue px', countIn(tb, blue),
    '| underline red', countIn({ x: ul.x, y: ul.y + ul.h * 0.88 - 1, w: ul.w, h: 3 }, red)
  )
  page.close()
}

// Round trip: read the written annotations back through the importer and compare geometry.
const back = await lib.loadDocument(out.slice())
const pg = back.getPage(0)
const got = readPageAnnots(lib, pg)
pg.close()
const want = annots.filter((a) => a.page === 0)
console.log('re-imported kinds:', got.map((g) => g.kind).join(' '))
for (const w of want) {
  const g = got.find((x) => x.kind === w.kind && Math.abs(x.rects[0].x - w.rects[0].x) < 6 && Math.abs(x.rects[0].y - w.rects[0].y) < 6)
  if (!g) {
    console.log(`  MISSING ${w.kind} at`, JSON.stringify(w.rects[0]))
    continue
  }
  const d = Math.max(...['x', 'y', 'w', 'h'].map((k) => Math.abs((g.rects[0] as never)[k] - (w.rects[0] as never)[k])))
  console.log(`  ${w.kind}: max rect deviation ${d.toFixed(2)}pt, width ${g.lineWidth}${w.kind === 'stamp' ? ', label ' + g.text : ''}`)
}
