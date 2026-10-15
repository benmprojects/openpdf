/**
 * Writes a small PDF exercising viewer features the basic test PDF lacks: embedded files, page labels
 * (i, ii, then 1, 2, ...) and two optional content groups (layers), one of them off by default.
 * Usage: npx tsx scripts/make-feature-pdf.mts out.pdf
 */
import { writeFileSync } from 'node:fs'
import { PDFDocument, PDFName, PDFString, StandardFonts, rgb } from 'pdf-lib'

const out = process.argv[2]
if (!out) throw new Error('Usage: make-feature-pdf.mts out.pdf')

const doc = await PDFDocument.create()
const font = await doc.embedFont(StandardFonts.Helvetica)
const ctx = doc.context

// Two layers: "Notes layer" (on) and "Hidden layer" (off by default).
const ocgOn = ctx.register(ctx.obj({ Type: 'OCG', Name: PDFString.of('Notes layer') }))
const ocgOff = ctx.register(ctx.obj({ Type: 'OCG', Name: PDFString.of('Hidden layer') }))
doc.catalog.set(
  PDFName.of('OCProperties'),
  ctx.obj({ OCGs: [ocgOn, ocgOff], D: { Order: [ocgOn, ocgOff], OFF: [ocgOff] } })
)

for (let i = 0; i < 4; i++) {
  const page = doc.addPage([595, 842])
  page.drawText(i < 2 ? `Front matter ${i + 1}` : `Body page ${i - 1}`, { x: 60, y: 760, size: 24, font })
  page.drawText('Feature test page', { x: 60, y: 720, size: 12, font })
  if (i === 0) {
    // Marked content tied to each layer: a blue box on "Notes layer", a green box on "Hidden layer".
    page.node.set(PDFName.of('Resources'), page.node.Resources() ?? ctx.obj({}))
    const res = page.node.Resources()!
    res.set(PDFName.of('Properties'), ctx.obj({ L1: ocgOn, L2: ocgOff }))
    const ops = [
      '/OC /L1 BDC 0 0 1 rg 60 500 200 120 re f EMC',
      '/OC /L2 BDC 0 0.6 0 rg 320 500 200 120 re f EMC'
    ].join('\n')
    const stream = ctx.flateStream(ops)
    page.node.addContentStream(ctx.register(stream))
    page.drawText('Blue box: Notes layer. Green box: Hidden layer.', { x: 60, y: 470, size: 11, font, color: rgb(0.2, 0.2, 0.2) })
  }
}

// Page labels: i, ii for the first two pages, then 1, 2.
doc.catalog.set(
  PDFName.of('PageLabels'),
  ctx.obj({ Nums: [0, { S: 'r' }, 2, { S: 'D', St: 1 }] })
)

await doc.attach(new TextEncoder().encode('Hello from an attached text file.\n'), 'notes.txt', {
  mimeType: 'text/plain',
  description: 'A plain text attachment'
})
await doc.attach(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), 'tiny.png', { mimeType: 'image/png' })

writeFileSync(out, await doc.save())
console.log(out)
