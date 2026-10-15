/**
 * Text recognition with Tesseract (WebAssembly, through tesseract.js) in the main process, where it can use worker
 * threads. English is bundled; other languages are downloaded once, on request, into the user's data folder.
 */
import { app, net } from 'electron'
import { copyFile, mkdir, readdir, rename, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { createWorker, OEM, type Worker } from 'tesseract.js'

export interface OcrWord {
  text: string
  /** Pixel box in the image that was recognised. */
  x0: number
  y0: number
  x1: number
  y1: number
  /** 0 to 100. */
  confidence: number
}

export interface OcrLine {
  words: OcrWord[]
  /** The line's baseline in pixels: left end to right end. */
  baseline: { x0: number; y0: number; x1: number; y1: number }
}

export interface OcrResult {
  lines: OcrLine[]
  /** Mean confidence of the page, 0 to 100. */
  confidence: number
}

/** Languages offered, as Tesseract's codes. English is bundled; the others are fetched when first used. */
export const OCR_LANGUAGES: [string, string][] = [
  ['eng', 'English'],
  ['afr', 'Afrikaans'],
  ['ara', 'Arabic'],
  ['bul', 'Bulgarian'],
  ['chi_sim', 'Chinese (Simplified)'],
  ['chi_tra', 'Chinese (Traditional)'],
  ['ces', 'Czech'],
  ['dan', 'Danish'],
  ['nld', 'Dutch'],
  ['fin', 'Finnish'],
  ['fra', 'French'],
  ['deu', 'German'],
  ['ell', 'Greek'],
  ['heb', 'Hebrew'],
  ['hin', 'Hindi'],
  ['hun', 'Hungarian'],
  ['ind', 'Indonesian'],
  ['ita', 'Italian'],
  ['jpn', 'Japanese'],
  ['kor', 'Korean'],
  ['nor', 'Norwegian'],
  ['pol', 'Polish'],
  ['por', 'Portuguese'],
  ['ron', 'Romanian'],
  ['rus', 'Russian'],
  ['spa', 'Spanish'],
  ['swe', 'Swedish'],
  ['tha', 'Thai'],
  ['tur', 'Turkish'],
  ['ukr', 'Ukrainian'],
  ['vie', 'Vietnamese']
]

const KNOWN = new Set(OCR_LANGUAGES.map(([c]) => c))
const DATA_VERSION = '4.0.0_best_int'

const dataDir = () => join(app.getPath('userData'), 'tessdata')

/** Languages whose data is already on this computer (English is always available). */
export async function installedLanguages(): Promise<string[]> {
  const have = new Set(['eng'])
  try {
    for (const f of await readdir(dataDir())) {
      const m = /^([a-z_]+)\.traineddata\.gz$/.exec(f)
      if (m && KNOWN.has(m[1])) have.add(m[1])
    }
  } catch {
    // no folder yet
  }
  return [...have]
}

/** Makes sure a language's data file is in the data folder: copies English from the app, downloads the rest. */
async function ensureLanguage(lang: string): Promise<void> {
  if (!KNOWN.has(lang)) throw new Error('That language is not supported.')
  const dir = dataDir()
  const file = join(dir, `${lang}.traineddata.gz`)
  if (existsSync(file)) return
  await mkdir(dir, { recursive: true })
  if (lang === 'eng') {
    const pkg = createRequire(__filename).resolve('@tesseract.js-data/eng/package.json')
    await copyFile(join(dirname(pkg), DATA_VERSION, 'eng.traineddata.gz'), file)
    return
  }
  const url = `https://cdn.jsdelivr.net/npm/@tesseract.js-data/${lang}/${DATA_VERSION}/${lang}.traineddata.gz`
  let res: Response
  try {
    res = await net.fetch(url, { signal: AbortSignal.timeout(120000) })
  } catch (e) {
    throw new Error(`The ${lang} language data could not be downloaded. Check the internet connection and try again.`, { cause: e })
  }
  if (!res.ok) throw new Error(`The ${lang} language data could not be downloaded (the server answered ${res.status}).`)
  const data = new Uint8Array(await res.arrayBuffer())
  // A gzip file starts 1f 8b: do not keep an error page as language data.
  if (data[0] !== 0x1f || data[1] !== 0x8b) throw new Error('The downloaded language data was not valid.')
  await writeFile(`${file}.tmp`, data)
  await rename(`${file}.tmp`, file)
}

let current: { key: string; worker: Promise<Worker> } | null = null
let idle: ReturnType<typeof setTimeout> | null = null

async function workerFor(langs: string[]): Promise<Worker> {
  const key = langs.join('+')
  if (idle) clearTimeout(idle)
  if (!current || current.key !== key) {
    if (current) void current.worker.then((w) => w.terminate()).catch(() => undefined)
    for (const l of langs) await ensureLanguage(l)
    current = { key, worker: createWorker(langs, OEM.LSTM_ONLY, { langPath: dataDir(), gzip: true, cacheMethod: 'none' }) }
  }
  const w = await current.worker
  // A worker left idle is stopped so it does not hold memory.
  idle = setTimeout(() => {
    const c = current
    current = null
    void c?.worker.then((x) => x.terminate()).catch(() => undefined)
  }, 90000)
  return w
}

// One page at a time: the worker is single-threaded.
let queue: Promise<unknown> = Promise.resolve()

/** Recognises the text in a PNG or JPEG of a page. */
export function recognise(image: Uint8Array, langs: string[]): Promise<OcrResult> {
  const wanted = [...new Set(langs.filter((l) => KNOWN.has(l)))].slice(0, 3)
  if (!wanted.length) wanted.push('eng')
  const run = async (): Promise<OcrResult> => {
    const worker = await workerFor(wanted)
    const { data } = await worker.recognize(Buffer.from(image), {}, { blocks: true, text: false })
    const lines: OcrLine[] = []
    for (const block of data.blocks ?? []) {
      for (const para of block.paragraphs) {
        for (const line of para.lines) {
          const words = line.words
            .filter((w) => w.text.trim())
            .map((w) => ({ text: w.text, x0: w.bbox.x0, y0: w.bbox.y0, x1: w.bbox.x1, y1: w.bbox.y1, confidence: w.confidence }))
          if (words.length) lines.push({ words, baseline: { ...line.baseline } })
        }
      }
    }
    return { lines, confidence: data.confidence ?? 0 }
  }
  const next = queue.then(run, run)
  queue = next.catch(() => undefined)
  return next
}

/** Stops the worker (when the app quits). */
export async function stopOcr(): Promise<void> {
  if (idle) clearTimeout(idle)
  const c = current
  current = null
  await c?.worker.then((w) => w.terminate()).catch(() => undefined)
}
