/**
 * Batch processing: a list of steps (watermark, page numbers, optimise, OCR, clean-up, properties and so on) run in
 * order over many PDFs. The steps are plain data, so a sequence can be saved as an "action", shared as a JSON file
 * and run from the command line. Each step is the same code the interactive tools use.
 */
import type { EncryptOptions, Permissions } from '../../shared/pdfSecurity'
import { normaliseResult, type PluginOutcome } from '../../shared/plugins'
import { runPluginScript, type PluginDoc } from './pluginSandbox'
import { ocrDocument } from './ocrLayer'
import { optimise, type OptimiseOptions } from './optimise'
import { addHeaderFooter, addWatermark, type Slot } from './pageMarks'
import { rotatePages } from './pageOps'
import { flattenForm } from './forms'
import { convertToPdfA } from './pdfa'
import { readProps, writeProps } from './metadata'
import { sanitise, type SanitiseOptions } from './sanitise'
import { PDFDocument } from 'pdf-lib'

export type BatchStep =
  | { kind: 'watermark'; text: string; fontSize: number; color: string; opacity: number; angle: number; behind: boolean }
  | { kind: 'headerFooter'; slots: Partial<Record<Slot, string>>; fontSize: number; color: string; margin: number; startNumber: number }
  | { kind: 'optimise'; level: 'light' | 'standard' | 'small' }
  | { kind: 'ocr'; languages: string[]; dpi: 200 | 300 | 400; all: boolean }
  | { kind: 'sanitise'; options: SanitiseOptions }
  | { kind: 'properties'; title?: string; author?: string; subject?: string; keywords?: string }
  | { kind: 'flatten' }
  | { kind: 'pdfa' }
  | { kind: 'rotate'; degrees: 90 | 180 | 270 }
  | { kind: 'security'; userPassword: string; ownerPassword: string; keyLength: 128 | 256; permissions: Permissions }
  /** An action of an installed plugin; it returns steps from this list (those its manifest permits), which are then run. */
  | { kind: 'plugin'; plugin: string; action: string; params: Record<string, string> }

export interface BatchAction {
  name: string
  steps: BatchStep[]
}

export const STEP_LABELS: Record<BatchStep['kind'], string> = {
  watermark: 'Add a text watermark',
  headerFooter: 'Add a header or footer (page numbers, date, file name)',
  optimise: 'Optimise (reduce file size)',
  ocr: 'Recognise text (OCR)',
  sanitise: 'Remove hidden information',
  properties: 'Set document properties',
  flatten: 'Flatten form fields',
  pdfa: 'Convert to PDF/A-2b (best effort)',
  rotate: 'Rotate every page',
  security: 'Add a password and permissions (last step)',
  plugin: 'Run a plugin action'
}

const OPTIMISE: Record<'light' | 'standard' | 'small', OptimiseOptions> = {
  light: { maxDpi: null, quality: 0.85, dropThumbnails: true, objectStreams: true, recompress: true, removeUnusedResources: true, linearise: false },
  standard: { maxDpi: 150, quality: 0.75, dropThumbnails: true, objectStreams: true, recompress: true, removeUnusedResources: true, linearise: false },
  small: { maxDpi: 100, quality: 0.6, dropThumbnails: true, objectStreams: true, recompress: true, removeUnusedResources: true, linearise: false }
}

/** What the steps need from outside the renderer's pure code. */
export interface BatchEnv {
  /** Recognises text for one document (loads it into PDFium and runs OCR). */
  ocr(bytes: Uint8Array, step: Extract<BatchStep, { kind: 'ocr' }>): Promise<{ bytes: Uint8Array; words: number; pagesDone: number }>
  encrypt(bytes: Uint8Array, o: EncryptOptions): Promise<Uint8Array>
  findFont(family: string, bold: boolean, italic: boolean): Promise<Uint8Array | null>
  /** Runs a plugin action on a document and returns the steps it asks for. */
  plugin?(bytes: Uint8Array, name: string, step: Extract<BatchStep, { kind: 'plugin' }>): Promise<PluginOutcome>
}

const allPages = async (bytes: Uint8Array): Promise<number[]> => Array.from({ length: (await PDFDocument.load(bytes, { updateMetadata: false })).getPageCount() }, (_, i) => i)

/** Problems with a step list that would make a run pointless or unsafe, in plain words. */
export function checkSteps(steps: BatchStep[]): string[] {
  const out: string[] = []
  if (!steps.length) out.push('Add at least one step.')
  const sec = steps.findIndex((s) => s.kind === 'security')
  if (sec >= 0 && sec !== steps.length - 1) out.push('Adding a password must be the last step: later steps cannot read a protected file.')
  steps.forEach((s, i) => {
    if (s.kind === 'watermark' && !s.text.trim()) out.push(`Step ${i + 1}: the watermark has no text.`)
    if (s.kind === 'headerFooter' && !Object.values(s.slots).some((t) => t?.trim())) out.push(`Step ${i + 1}: the header or footer has no text.`)
    if (s.kind === 'ocr' && !s.languages.length) out.push(`Step ${i + 1}: choose a language.`)
    if (s.kind === 'security' && !s.userPassword && !s.ownerPassword) out.push(`Step ${i + 1}: enter a password.`)
    if (s.kind === 'plugin' && (!s.plugin || !s.action)) out.push(`Step ${i + 1}: choose a plugin action.`)
  })
  return out
}

/** Runs the steps over one file's bytes. `name` is the file's name (for the file-name token). */
export async function runSteps(bytes: Uint8Array, name: string, steps: BatchStep[], env: BatchEnv): Promise<{ bytes: Uint8Array; notes: string[] }> {
  let cur = bytes
  const notes: string[] = []
  for (const s of steps) {
    switch (s.kind) {
      case 'watermark':
        cur = await addWatermark(cur, { kind: 'text', text: s.text, font: 'Helvetica', fontSize: s.fontSize, color: s.color, opacity: s.opacity, angle: s.angle, scale: 0.5, behind: s.behind, pages: await allPages(cur) })
        break
      case 'headerFooter':
        cur = await addHeaderFooter(cur, { slots: s.slots, fontSize: s.fontSize, font: 'Helvetica', color: s.color, margin: s.margin, pages: await allPages(cur), startNumber: s.startNumber }, { fileName: name, labels: null })
        break
      case 'optimise': {
        const before = cur.length
        cur = (await optimise(cur, OPTIMISE[s.level])).bytes
        notes.push(`optimised ${Math.round((1 - cur.length / before) * 100)}% smaller`)
        break
      }
      case 'ocr': {
        const r = await env.ocr(cur, s)
        cur = r.bytes
        notes.push(r.pagesDone ? `recognised ${r.words} words on ${r.pagesDone} page${r.pagesDone === 1 ? '' : 's'}` : 'all pages already had text')
        break
      }
      case 'sanitise':
        cur = (await sanitise(cur, s.options)).bytes
        break
      case 'properties': {
        const props = await readProps(cur)
        for (const k of ['title', 'author', 'subject', 'keywords'] as const) if (s[k] !== undefined) props[k] = s[k]!
        cur = await writeProps(cur, { ...props, modified: new Date().toISOString() })
        break
      }
      case 'flatten': {
        const r = await flattenForm(cur)
        cur = r.bytes
        if (r.count) notes.push(`flattened ${r.count} field${r.count === 1 ? '' : 's'}`)
        break
      }
      case 'pdfa': {
        const r = await convertToPdfA(cur, async (family, bold, italic) => env.findFont(family, bold, italic))
        cur = r.bytes
        if (r.report.remaining.length > 1) notes.push('PDF/A: ' + r.report.remaining.filter((t) => !t.startsWith('Not checked')).join('; '))
        break
      }
      case 'rotate':
        cur = await rotatePages(cur, await allPages(cur), s.degrees === 270 ? -90 : s.degrees)
        break
      case 'plugin': {
        if (!env.plugin) throw new Error('Plugins are not available here.')
        const r = await env.plugin(cur, name, s)
        if (r.error) throw new Error(`Plugin ${s.plugin}: ${r.error}`)
        if (r.steps.length) cur = (await runSteps(cur, name, r.steps, env)).bytes
        notes.push(r.message || `plugin ${s.plugin}: ${r.steps.length} step${r.steps.length === 1 ? '' : 's'}`)
        if (r.dropped) notes.push(`${r.dropped} step${r.dropped === 1 ? '' : 's'} not permitted by the plugin were ignored`)
        break
      }
      case 'security':
        cur = await env.encrypt(cur, { userPassword: s.userPassword, ownerPassword: s.ownerPassword || s.userPassword, keyLength: s.keyLength, permissions: s.permissions })
        break
    }
  }
  return { bytes: cur, notes }
}

// ---- Running over many files -----------------------------------------------------------------------

export interface BatchJob {
  steps: BatchStep[]
  /** Files and folders. */
  inputs: string[]
  recursive: boolean
  /** A folder for the results, or null to put each beside its original. */
  outDir: string | null
  /** Added to each file's name: report.pdf becomes report_done.pdf. */
  suffix: string
}

export interface BatchIO {
  expand(paths: string[], recursive: boolean): Promise<string[]>
  read(path: string): Promise<{ name: string; data: Uint8Array }>
  /** Writes a result next to or in a folder, never overwriting; returns where. */
  write(source: string, outDir: string | null, suffix: string, data: Uint8Array): Promise<string>
}

export interface BatchResult {
  source: string
  ok: boolean
  output?: string
  before?: number
  after?: number
  notes: string[]
  error?: string
}

/** Runs a job. A file that fails is reported and the rest carry on. */
export async function runBatch(job: BatchJob, io: BatchIO, env: BatchEnv, onProgress?: (done: number, total: number, current: string, results: BatchResult[]) => void, cancelled: () => boolean = () => false): Promise<BatchResult[]> {
  const files = await io.expand(job.inputs, job.recursive)
  const results: BatchResult[] = []
  for (const [i, path] of files.entries()) {
    if (cancelled()) break
    onProgress?.(i, files.length, path, results)
    try {
      const { name, data } = await io.read(path)
      const r = await runSteps(data, name, job.steps, env)
      const output = await io.write(path, job.outDir, job.suffix, r.bytes)
      results.push({ source: path, ok: true, output, before: data.length, after: r.bytes.length, notes: r.notes })
    } catch (e) {
      results.push({ source: path, ok: false, notes: [], error: e instanceof Error ? e.message : String(e) })
    }
  }
  onProgress?.(files.length, files.length, '', results)
  return results
}

/** The standard environment in the app: OCR through a private PDFium worker, encryption and fonts through the main process. */
export async function appEnv(): Promise<BatchEnv> {
  const { PdfClient } = await import('./pdfClient')
  const { encodeRotatedPng } = await import('./print')
  return {
    async ocr(bytes, step) {
      const client = new PdfClient()
      try {
        const pages = await client.load(bytes)
        const r = await ocrDocument(
          bytes,
          { languages: step.languages, dpi: step.dpi, scope: step.all ? 'all' : 'blank' },
          {
            client,
            pages,
            recognise: (png, langs) => window.openpdf.ocrRecognise(png, langs),
            findFont: async (family) => (await window.openpdf.findFont(family, false, false).catch(() => null))?.data ?? null,
            toPng: (w, h, rgba) => encodeRotatedPng(w, h, rgba, 0)
          }
        )
        return { bytes: r.bytes, words: r.words, pagesDone: r.pagesDone }
      } finally {
        client.dispose()
      }
    },
    async plugin(bytes, name, step) {
      const installed = (await window.openpdf.pluginsList()).find((p) => p.manifest.id === step.plugin)
      const action = installed?.manifest.actions.find((a) => a.id === step.action)
      if (!installed || !action) return { steps: [], message: '', dropped: 0, error: `The plugin ${step.plugin} (${step.action}) is not installed.` }
      const client = new PdfClient()
      try {
        const sizes = await client.load(bytes)
        const doc = await describeDocument(client, sizes, name, await readProps(bytes))
        return normaliseResult(await runPluginScript(installed.scripts[action.id], doc, step.params), installed.manifest.permits)
      } finally {
        client.dispose()
      }
    },
    encrypt: (bytes, o) => window.openpdf.encryptPdf(bytes, o),
    findFont: async (family, bold, italic) => (await window.openpdf.findFont(family, bold, italic).catch(() => null))?.data ?? null
  }
}

/** The document as a plugin script sees it. */
export async function describeDocument(client: { pageText(page: number): Promise<{ text: string }> }, sizes: { width: number; height: number }[], fileName: string, props: { title: string; author: string; subject: string; keywords: string }): Promise<PluginDoc> {
  const pages: PluginDoc['pages'] = []
  for (let i = 0; i < sizes.length; i++) pages.push({ index: i, width: sizes[i].width, height: sizes[i].height, text: (await client.pageText(i)).text.replace(/\r\n?/g, '\n') })
  return { fileName, pageCount: sizes.length, info: { title: props.title, author: props.author, subject: props.subject, keywords: props.keywords }, pages }
}
