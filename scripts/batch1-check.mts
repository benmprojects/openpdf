/**
 * Dev check: write the markup features of the finishing batch (checked flag, subject, layer, note icons, angle
 * measurement, linked correction) with annotWrite, read them back through PDFium and compare. Usage:
 * npx tsx scripts/batch1-check.mts
 */
import { PDFiumLibrary } from '@hyzyla/pdfium'
import { PDFDocument, PDFName } from 'pdf-lib'
import { writeAnnotations } from '../src/renderer/src/annotWrite'
import { annotsFromImported } from '../src/renderer/src/importMap'
import { isChecked, NOTE_ICONS, withBounds, type Annot } from '../src/renderer/src/annotations'
import { annotDicts } from '../src/renderer/src/annotExtras'
import { readPageAnnots } from '../src/renderer/src/pdfiumRaw'

const base = await PDFDocument.create()
base.addPage([595, 842])
const ocg = base.context.register(base.context.obj({ Type: 'OCG', Name: 'Services' } as never))
base.catalog.set(PDFName.of('OCProperties'), base.context.obj({ OCGs: [ocg], D: { Order: [ocg] } } as never))
const src = await base.save()
const layer = `${ocg.objectNumber} ${ocg.generationNumber}`

let id = 1
const mk = (kind: Annot['kind'], extra: Partial<Annot>): Annot =>
  withBounds({ id: id++, page: 0, kind, color: '#e5322d', rects: [], text: '', fontSize: 12, lineWidth: 2, ...extra })

const annots: Annot[] = [
  ...NOTE_ICONS.map((icon, i) => mk('note', { rects: [{ x: 40 + i * 40, y: 40, w: 22, h: 22 }], text: icon, icon })),
  mk('rectangle', {
    rects: [{ x: 50, y: 120, w: 100, h: 60 }],
    subject: 'Pit lid',
    layer,
    replies: [
      { id: 100, author: 'Checker', text: '', date: '2026-10-16T01:00:00.000Z', mark: 'Marked' },
      { id: 101, author: 'Checker', text: 'Agreed', date: '2026-10-16T01:30:00.000Z' }
    ]
  }),
  mk('polyline', {
    points: [[{ x: 200, y: 300 }, { x: 200, y: 200 }, { x: 300, y: 200 }]],
    lineWidth: 1,
    measure: { kind: 'angle', factor: 1, unit: '°', label: '90.0°', name: 'Return' }
  })
]

const out = await writeAnnotations(src, annots)
const lib = await PDFiumLibrary.init()
const doc = await lib.loadDocument(out.slice())
const page = doc.getPage(0)
const dicts = await annotDicts(out)
const read = readPageAnnots(lib, page, dicts?.[0])
page.close()
const back = annotsFromImported(0, read.annots, read.replies, () => id++)

let failed = 0
const check = (what: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${ok ? '' : ` ${detail}`}`)
  if (!ok) failed++
}
const notes = back.filter((a) => a.kind === 'note')
check('six notes read back', notes.length === 6, String(notes.length))
check('note icons read back', notes.map((a) => a.icon).join() === NOTE_ICONS.join(), notes.map((a) => a.icon).join())
const rect = back.find((a) => a.kind === 'rectangle')
check('subject read back', rect?.subject === 'Pit lid', String(rect?.subject))
check('layer read back', rect?.layer === layer, String(rect?.layer))
check('checked flag read back', !!rect && isChecked(rect), JSON.stringify(rect?.replies))
check('plain reply kept apart from the flag', rect?.replies?.filter((r) => !r.mark && !r.state).length === 1)
const angle = back.find((a) => a.measure?.kind === 'angle')
check('angle read back as a measurement', !!angle && angle.kind === 'polyline' && angle.points?.[0].length === 3, JSON.stringify(angle?.measure))
check('angle label and name read back', angle?.measure?.label === '90.0°' && angle?.measure?.name === 'Return')
doc.destroy()
lib.destroy()
if (failed) {
  console.error(`${failed} check(s) failed`)
  process.exit(1)
}
console.log('all checks passed')
