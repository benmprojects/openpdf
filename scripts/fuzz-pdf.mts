/**
 * PDF fuzzing: damaged copies of the corpus (flipped bytes, cut or repeated spans, truncation) go through what
 * opening a file does — PDFium load, page sizes, one rendering, text, annotations with the pdf-lib extras, links,
 * bookmarks and labels — and, when pdf-lib can read the copy, an annotation save. A damaged file may be refused
 * by PDFium with an error; a hang, a non-Error throw, a WebAssembly trap (PDFium crashing), or our own code
 * throwing on a file PDFium did open, is a failure. Failing inputs
 * are written to the output folder so they can be replayed.
 * Usage: npx tsx scripts/fuzz-pdf.mts <corpus folder> [--runs N] [--seed S] [--out folder]
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { PDFiumLibrary } from '@hyzyla/pdfium'
import { annotDicts } from '../src/renderer/src/annotExtras'
import { writeAnnotations } from '../src/renderer/src/annotWrite'
import { annotsFromImported } from '../src/renderer/src/importMap'
import { readLabelRanges } from '../src/renderer/src/outlineEdit'
import { readOutline, readPageAnnots, readPageLabels, readPageLinks, readPageText } from '../src/renderer/src/pdfiumRaw'
import type { Annot } from '../src/renderer/src/annotations'

// pdf-lib warns about every damaged object it skips; the summary is what matters.
console.warn = () => {}
const args = process.argv.slice(2)
const opt = (name: string, def: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : def)
const dir = args[0]
const runs = Number(opt('--runs', '300'))
const seed = Number(opt('--seed', '1'))
const outDir = opt('--out', join(dir ?? '.', 'fuzz-failures'))
if (!dir) {
  console.error('Usage: npx tsx scripts/fuzz-pdf.mts <corpus folder> [--runs N] [--seed S] [--out folder]')
  process.exit(2)
}

function rng(s: number) {
  let a = s >>> 0
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  return { int: (n: number) => Math.floor(next() * n) }
}

function mutate(data: Uint8Array, r: ReturnType<typeof rng>): Uint8Array {
  let out = Uint8Array.from(data)
  const steps = 1 + r.int(6)
  for (let s = 0; s < steps && out.length; s++) {
    const at = r.int(out.length)
    const kind = r.int(6)
    if (kind === 0) out[at] = r.int(256)
    else if (kind === 1) out[at] ^= 1 << r.int(8)
    else if (kind === 2) out = Uint8Array.from([...out.subarray(0, at), ...out.subarray(Math.min(out.length, at + 1 + r.int(256)))])
    else if (kind === 3) {
      const len = 1 + r.int(256)
      out = Uint8Array.from([...out.subarray(0, at), ...out.subarray(at, at + len), ...out.subarray(at)])
    } else if (kind === 4) {
      // Digits are where offsets, lengths and counts live: change one.
      const i = out.findIndex((b, k) => k >= at && b >= 0x30 && b <= 0x39)
      if (i >= 0) out[i] = 0x30 + r.int(10)
    } else out = out.subarray(0, at)
  }
  return out
}

const files = readdirSync(dir)
  .filter((f) => f.toLowerCase().endsWith('.pdf') && !/pw-/.test(f))
  .map((f) => ({ name: f, data: new Uint8Array(readFileSync(join(dir, f))) }))
let lib = await PDFiumLibrary.init()

/** Thrown when PDFium itself refuses the file: the app shows "could not open", which is acceptable. */
class Refused extends Error {}

async function exercise(bytes: Uint8Array) {
  const doc = await lib.loadDocument(bytes.slice()).catch((e: unknown) => {
    throw e instanceof Error && !(e instanceof WebAssembly.RuntimeError) ? new Refused(e.message) : e
  })
  const annots: Annot[] = []
  try {
    const dicts = await annotDicts(bytes)
    let id = 1
    const n = Math.min(doc.getPageCount(), 5)
    for (let i = 0; i < n; i++) {
      const page = doc.getPage(i)
      try {
        const { originalWidth: w, originalHeight: h } = page.getOriginalSize()
        if (i === 0 && w > 0 && h > 0) await page.render({ scale: Math.min(0.3, Math.sqrt(1e6 / (w * h))), render: 'bitmap' })
        readPageText(lib, page)
        readPageLinks(lib, doc, page)
        const { annots: list, replies } = readPageAnnots(lib, page, dicts?.[i])
        annots.push(...annotsFromImported(i, list, replies, () => id++))
      } finally {
        page.close()
      }
    }
    readOutline(lib, doc)
    readPageLabels(lib, doc)
  } finally {
    doc.destroy()
  }
  await readLabelRanges(bytes).catch(() => [])
  // Saving goes through pdf-lib; a copy pdf-lib cannot read is refused, which is fine.
  await writeAnnotations(bytes, annots, [], new Set(annots.map((a) => a.id))).catch((e) => {
    if (!(e instanceof Error)) throw e
  })
}

const r = rng(seed)
mkdirSync(outDir, { recursive: true })
let refused = 0
const failures: string[] = []
const t0 = performance.now()
for (let run = 0; run < runs; run++) {
  const src = files[r.int(files.length)]
  const bad = mutate(src.data, r)
  try {
    await Promise.race([exercise(bad), new Promise<never>((_, rej) => setTimeout(() => rej(new Error('TIMEOUT')), 20_000))])
  } catch (e) {
    const trap = e instanceof WebAssembly.RuntimeError
    if (e instanceof Refused) {
      refused++
      continue
    }
    const what = trap
      ? `PDFium trap: ${(e as Error).message}`
      : e instanceof Error
        ? e.message === 'TIMEOUT'
          ? 'hang'
          : `our code threw after PDFium opened it: ${e.message.slice(0, 160)}`
        : `non-Error throw: ${String(e)}`
    const file = join(outDir, `run${run}-seed${seed}-${src.name}`)
    writeFileSync(file, bad)
    failures.push(`${src.name} run ${run}: ${what} -> ${file}`)
    // After a trap the WebAssembly memory may be corrupt: start PDFium again.
    if (trap) lib = await PDFiumLibrary.init()
  }
}
console.log(`${runs} runs over ${files.length} files in ${Math.round((performance.now() - t0) / 1000)} s: ${runs - refused - failures.length} opened, ${refused} refused cleanly, ${failures.length} failed`)
for (const f of failures) console.log('  ' + f)
process.exit(failures.length ? 1 : 0)
