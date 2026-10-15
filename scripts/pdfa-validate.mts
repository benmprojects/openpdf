/**
 * Converts every PDF in a folder to PDF/A-2b with the program's own converter and checks each result with veraPDF
 * (https://verapdf.org, a separate program: GPL/MPL, used here as a test tool only and never shipped or linked).
 *   npx tsx scripts/pdfa-validate.mts <folder of PDFs> <output folder> [path to verapdf.bat]
 * Without veraPDF the files are only converted. Exit code 1 when any converted file fails validation.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { convertToPdfA } from '../src/renderer/src/pdfa'

const [dir, out, vera = process.env.VERAPDF ?? 'verapdf'] = process.argv.slice(2)
if (!dir || !out) {
  console.error('usage: npx tsx scripts/pdfa-validate.mts <folder> <output folder> [verapdf.bat]')
  process.exit(2)
}
mkdirSync(out, { recursive: true })

const cache = new Map<string, Uint8Array | null>()
const font = (family: string, bold: boolean, italic: boolean): Uint8Array | null => {
  const base = family === 'Times New Roman' ? 'times' : family === 'Courier New' ? 'cour' : 'arial'
  const style = bold && italic ? 'bi' : bold ? 'bd' : italic ? 'i' : ''
  const file = `C:/Windows/Fonts/${base === 'times' ? 'times' : base === 'cour' ? 'cour' : 'arial'}${style}.ttf`
  if (!cache.has(file)) cache.set(file, existsSync(file) ? new Uint8Array(readFileSync(file)) : null)
  return cache.get(file) ?? null
}

// Files that cannot be opened, or are encrypted, are not converted here (the program opens those with a password first).
const SKIP = /encrypted|truncated|no-eof|no-xref|bad-startxref|junk/
const made: string[] = []
for (const f of readdirSync(dir).filter((x) => x.toLowerCase().endsWith('.pdf') && !SKIP.test(x))) {
  try {
    const r = await convertToPdfA(new Uint8Array(readFileSync(`${dir}/${f}`)), async (family, bold, italic) => font(family, bold, italic))
    writeFileSync(`${out}/${f}`, r.bytes)
    made.push(f)
    const left = r.report.remaining.filter((x) => !x.startsWith('Not checked'))
    console.log(`converted ${f}${left.length ? `  (left: ${left.join('; ')})` : ''}`)
  } catch (e) {
    console.log(`ERROR   ${f}: ${String(e).slice(0, 120)}`)
  }
}

if (!existsSync(vera)) {
  console.log('veraPDF not found: files converted but not validated.')
  process.exit(0)
}
let failed = 0
for (const f of made) {
  let text: string
  try {
    text = execFileSync(vera, ['--flavour', '2b', '--format', 'text', `${out}/${f}`], { encoding: 'utf8', shell: true }).trim()
  } catch (e) {
    text = String((e as { stdout?: string }).stdout ?? '').trim() || 'FAIL (validator error)'
  }
  const ok = text.startsWith('PASS')
  if (!ok) failed++
  console.log(`${ok ? 'PASS' : 'FAIL'}    ${f}`)
}
console.log(`${made.length - failed} of ${made.length} validate as PDF/A-2b`)
process.exit(failed ? 1 : 0)
