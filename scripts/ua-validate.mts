/**
 * Makes a small tagged PDF, fixes it with the program's own tag edits (alternative text, heading level, title and
 * language, PDF/UA identification) and checks the result with veraPDF's PDF/UA-1 profile (https://verapdf.org, a separate
 * program, used here as a test tool only and never shipped or linked).
 *   npx tsx scripts/ua-validate.mts <output folder> [path to verapdf.bat]
 * The path can also come from the VERAPDF environment variable. Without veraPDF the file is only written. Exit code 1
 * when veraPDF reports a failure. The fixture is a toy: failures that name the fixture's own shortcuts are expected, so
 * read the report rather than the exit code alone.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { PDFDocument, PDFName } from 'pdf-lib'
import { checkAccessibility } from '../src/renderer/src/a11yCheck'
import { setDocAccess, setTagText, setTagType } from '../src/renderer/src/structTree'
import { buildTaggedPdf } from '../src/renderer/src/tagFixture'

const [out, vera = process.env.VERAPDF ?? 'verapdf'] = process.argv.slice(2)
if (!out) {
  console.error('usage: npx tsx scripts/ua-validate.mts <output folder> [verapdf.bat]')
  process.exit(2)
}
mkdirSync(out, { recursive: true })

let bytes = await buildTaggedPdf()
bytes = await setTagText(bytes, '0/2', { alt: 'A grey box standing for a chart' })
bytes = await setTagType(bytes, '0/3', 'H2')
bytes = await setDocAccess(bytes, { title: 'Test document', lang: 'en-AU' })
// PDF/UA identification and a title in the XMP packet.
const doc = await PDFDocument.load(bytes)
const xmp = `<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?><x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:pdfuaid="http://www.aiim.org/pdfua/ns/id/"><dc:title><rdf:Alt><rdf:li xml:lang="x-default">Test document</rdf:li></rdf:Alt></dc:title><pdfuaid:part>1</pdfuaid:part></rdf:Description></rdf:RDF></x:xmpmeta><?xpacket end="w"?>`
doc.catalog.set(PDFName.of('Metadata'), doc.context.register(doc.context.stream(new TextEncoder().encode(xmp), { Type: 'Metadata', Subtype: 'XML' })))
bytes = await doc.save()

const file = join(out, 'tagged-fixed.pdf')
writeFileSync(file, bytes)
const report = await checkAccessibility(bytes)
console.log(`OpenPDF check: ${report.counts.fail} failed, ${report.counts.warn} worth a look, ${report.counts.passed} passed`)
for (const i of report.issues.filter((x) => x.severity !== 'manual')) console.log(`  ${i.severity}: ${i.title}${i.detail ? ` (${i.detail})` : ''}${i.page >= 0 ? ` page ${i.page + 1}` : ''}`)

if (!existsSync(vera) && vera === 'verapdf') {
  try {
    execFileSync(vera, ['--version'], { stdio: 'ignore', shell: true })
  } catch {
    console.log('veraPDF not found (set VERAPDF or pass its path): the file was written but not validated.')
    process.exit(0)
  }
}
try {
  const text = execFileSync(vera, ['--flavour', 'ua1', '--format', 'text', file], { encoding: 'utf8', shell: true })
  console.log(text)
} catch (e) {
  console.log(String((e as { stdout?: string }).stdout ?? e))
  process.exit(1)
}
