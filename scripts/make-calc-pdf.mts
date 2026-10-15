/**
 * Makes a test PDF with form scripts: two number fields, a total that is calculated and formatted as currency, a field
 * with a range check, and two buttons with JavaScript. Usage: npx tsx scripts/make-calc-pdf.mts out.pdf
 */
import { writeFileSync } from 'node:fs'
import { PDFDocument } from 'pdf-lib'
import { addFields, type FieldSpec } from '../src/renderer/src/formDesign.ts'
import { buildScripts, DEFAULT_UI } from '../src/renderer/src/scriptPresets.ts'

const out = process.argv[2]
if (!out) throw new Error('usage: make-calc-pdf.mts out.pdf')

const blank = await PDFDocument.create()
blank.addPage([595, 842])
const box = (y: number) => ({ x: 150, y, w: 120, h: 20 })
const text = (name: string, y: number, scripts?: FieldSpec['scripts']): FieldSpec => ({ type: 'text', name, page: 0, rect: box(y), scripts, align: 2, fontSize: 11 })
const number = buildScripts({ ...DEFAULT_UI, format: 'number', decimals: 2 })
const specs: FieldSpec[] = [
  text('a', 100, number),
  text('b', 140, number),
  text('total', 180, { ...buildScripts({ ...DEFAULT_UI, format: 'number', decimals: 2, currency: '$' }), ...buildScripts({ ...DEFAULT_UI, calculate: 'SUM', sources: ['a', 'b'] }) }),
  text('rate', 220, buildScripts({ ...DEFAULT_UI, validate: 'range', min: '0', max: '100' })),
  { type: 'button', name: 'setA', page: 0, rect: { x: 150, y: 260, w: 80, h: 22 }, caption: 'Set A', action: { kind: 'javascript', code: 'this.getField("a").value = 5;' } },
  { type: 'button', name: 'wipe', page: 0, rect: { x: 250, y: 260, w: 80, h: 22 }, caption: 'Wipe', action: { kind: 'javascript', code: 'this.resetForm();' } }
]
writeFileSync(out, await addFields(await blank.save(), specs))
