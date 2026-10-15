/**
 * Makes a test PDF with every common AcroForm field type (pdf-lib): text, multiline, checkbox, radio group, dropdown,
 * list box and a button. Usage: npx tsx scripts/make-form-pdf.mts out.pdf
 */
import { writeFileSync } from 'node:fs'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'

const out = process.argv[2]
if (!out) throw new Error('usage: make-form-pdf.mts out.pdf')

const doc = await PDFDocument.create()
const page = doc.addPage([595, 842])
const font = await doc.embedFont(StandardFonts.Helvetica)
const bold = await doc.embedFont(StandardFonts.HelveticaBold)
const form = doc.getForm()
const label = (t: string, y: number) => page.drawText(t, { x: 72, y: y + 4, size: 10, font })
page.drawText('Site induction form', { x: 72, y: 780, size: 16, font: bold })

label('Name', 730)
const name = form.createTextField('fullname')
name.setText('Jane Citizen')
name.addToPage(page, { x: 150, y: 724, width: 250, height: 20, borderColor: rgb(0, 0, 0), backgroundColor: rgb(0.93, 0.95, 1) })
name.setFontSize(11)

label('Accept', 690)
const accept = form.createCheckBox('accept')
accept.addToPage(page, { x: 150, y: 688, width: 14, height: 14, borderColor: rgb(0, 0, 0) })
accept.check()

label('Trade', 650)
const trade = form.createRadioGroup('trade')
for (const [i, opt] of ['Civil', 'Landscape', 'Parks'].entries()) {
  trade.addOptionToPage(opt, page, { x: 150 + i * 90, y: 648, width: 14, height: 14, borderColor: rgb(0, 0, 0) })
  page.drawText(opt, { x: 168 + i * 90, y: 652, size: 9, font })
}
trade.select('Parks')

label('State', 610)
const state = form.createDropdown('state')
state.addOptions(['QLD', 'NSW', 'VIC'])
state.select('QLD')
state.addToPage(page, { x: 150, y: 604, width: 150, height: 20, borderColor: rgb(0, 0, 0) })
state.setFontSize(11)

label('Tools', 560)
const tools = form.createOptionList('tools')
tools.addOptions(['Excavator', 'Roller', 'Grader', 'Truck'])
tools.select('Roller')
tools.addToPage(page, { x: 150, y: 520, width: 150, height: 60, borderColor: rgb(0, 0, 0) })
tools.setFontSize(10)

label('Notes', 480)
const notes = form.createTextField('notes')
notes.enableMultiline()
notes.setText('Line one')
notes.addToPage(page, { x: 150, y: 420, width: 300, height: 70, borderColor: rgb(0, 0, 0) })
notes.setFontSize(10)

const submit = form.createButton('submit')
submit.addToPage('Submit', page, { x: 150, y: 380, width: 80, height: 24, borderColor: rgb(0, 0, 0), backgroundColor: rgb(0.85, 0.85, 0.85) })

writeFileSync(out, await doc.save())
