/**
 * Dev check for the comment finishing work: writes line end styles, cloud borders, blend modes and flags with
 * annotWrite, re-imports them with the importer (with the pdf-lib dictionaries, as the worker does) and renders them
 * with PDFium. Usage: npx tsx scripts/comment-check.mts in.pdf out.pdf
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { PDFiumLibrary } from '@hyzyla/pdfium'
import { annotDicts } from '../src/renderer/src/annotExtras'
import { writeAnnotations } from '../src/renderer/src/annotWrite'
import { withBounds, type Annot } from '../src/renderer/src/annotations'
import { readPageAnnots } from '../src/renderer/src/pdfiumRaw'

const [inPath, outPath] = process.argv.slice(2)
const lib = await PDFiumLibrary.init()
const src = new Uint8Array(readFileSync(inPath))
let id = 1
const mk = (kind: Annot['kind'], extra: Partial<Annot>): Annot =>
  withBounds({ id: id++, page: 0, kind, color: '#e5322d', rects: [{ x: 0, y: 0, w: 10, h: 10 }], text: '', fontSize: 12, lineWidth: 2, ...extra })
const annots: Annot[] = [
  mk('line', { points: [[{ x: 60, y: 120 }, { x: 260, y: 120 }]], lineStart: 'Circle', lineEnd: 'Diamond' }),
  mk('line', { points: [[{ x: 60, y: 160 }, { x: 260, y: 160 }]], lineStart: 'Square', lineEnd: 'Slash' }),
  mk('arrow', { points: [[{ x: 60, y: 200 }, { x: 260, y: 200 }]], lineEnd: 'ClosedArrow', lineWidth: 3 }),
  mk('polyline', { points: [[{ x: 60, y: 240 }, { x: 160, y: 280 }, { x: 260, y: 240 }]], lineStart: 'Butt', lineEnd: 'OpenArrow' }),
  mk('cloud', { points: [[{ x: 300, y: 100 }, { x: 460, y: 100 }, { x: 460, y: 200 }, { x: 300, y: 200 }]], cloud: 2 }),
  mk('rectangle', { rects: [{ x: 300, y: 240, w: 160, h: 100 }], cloud: 1, fill: '#fff4c2' }),
  mk('polygon', { points: [[{ x: 60, y: 330 }, { x: 200, y: 330 }, { x: 130, y: 420 }]], cloud: 1 }),
  mk('highlight', { rects: [{ x: 300, y: 380, w: 150, h: 14 }], color: '#ffd400', blend: 'Normal' }),
  mk('rectangle', { rects: [{ x: 60, y: 450, w: 120, h: 50 }], fill: '#6ec1ff', blend: 'Multiply', flags: 4 | 128 }),
  mk('rectangle', { rects: [{ x: 220, y: 450, w: 120, h: 50 }], flags: 0 })
]
const out = await writeAnnotations(src, annots)
writeFileSync(outPath, out)

const doc = await lib.loadDocument(out.slice())
const page = doc.getPage(0)
const r = await page.render({ scale: 1, render: 'bitmap', renderFormFields: true })
const px = (x: number, y: number) => {
  const i = (Math.round(y) * r.width + Math.round(x)) * 4
  return [r.data[i], r.data[i + 1], r.data[i + 2]]
}
const redNear = (x: number, y: number, rad = 5) => {
  let hit = 0
  for (let yy = y - rad; yy <= y + rad; yy++) for (let xx = x - rad; xx <= x + rad; xx++) if (px(xx, yy)[0] > 150 && px(xx, yy)[1] < 120) hit++
  return hit
}
console.log('circle start has ink above the line:', redNear(60, 120 - 5, 2) > 0, '| square start:', redNear(60, 160 - 5, 2) > 0)
console.log('closed arrow head is filled:', redNear(250, 200, 3) > 20)
console.log('cloud scallop reaches outside the straight edge of a plain polygon: top edge y~100 hit', redNear(380, 100, 6) > 0)
page.close()

const dicts = await annotDicts(out)
const back = await lib.loadDocument(out.slice())
const pg = back.getPage(0)
const got = readPageAnnots(lib, pg, dicts?.[0]).annots
pg.close()
let bad = 0
const check = (label: string, ok: boolean) => {
  if (!ok) bad++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}`)
}
const by = (i: number) => got[i]
check('re-imported ten annotations', got.length === 10)
check('line 1 ends circle/diamond', by(0).lineStart === 'Circle' && by(0).lineEnd === 'Diamond' && by(0).kind === 'line')
check('line 2 ends square/slash', by(1).lineStart === 'Square' && by(1).lineEnd === 'Slash')
check('arrow closed arrow', by(2).kind === 'arrow' && by(2).lineEnd === 'ClosedArrow')
check('polyline butt/open arrow', by(3).kind === 'polyline' && by(3).lineStart === 'Butt' && by(3).lineEnd === 'OpenArrow')
check('cloud intensity 2', by(4).kind === 'cloud' && by(4).cloud === 2)
check('cloudy rectangle intensity 1', by(5).kind === 'rectangle' && by(5).cloud === 1)
check('cloudy polygon reads back as a cloud', by(6).kind === 'cloud' && by(6).cloud === 1)
check('highlight blend Normal', by(7).blend === 'Normal')
check('rectangle blend multiply, locked and printable', by(8).blend === 'Multiply' && (by(8).flags & 128) !== 0 && (by(8).flags & 4) !== 0)
check('rectangle with flags 0', by(9).flags === 0)
if (bad) process.exitCode = 1
