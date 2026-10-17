/**
 * Embedded files and portfolios. A file embedded in the document (ISO 32000 7.11.4) lives in the catalogue's
 * /Names /EmbeddedFiles name tree; a portfolio ("PDF package") is a PDF whose /Collection entry asks viewers to show
 * those files as the main content, with a cover page for viewers that do not.
 */
import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFNumber, PDFRef, PDFString, StandardFonts, rgb, type PDFObject } from 'pdf-lib'
import { pruneUnreachable } from './redact'

const N = PDFName.of

/** A small picture of a file, as 8-bit RGB (no alpha), for portfolio viewers that show thumbnails. */
export interface FileThumb {
  width: number
  height: number
  rgb: Uint8Array
}

export interface EmbedFile {
  name: string
  data: Uint8Array
  description?: string
  modified?: Date
  /** The folder it goes in inside a portfolio, as a path ("Drawings/Civil"); empty for the top level. */
  folder?: string
  thumb?: FileThumb
}

const MIME: Record<string, string> = {
  pdf: 'application/pdf',
  txt: 'text/plain',
  csv: 'text/csv',
  htm: 'text/html',
  html: 'text/html',
  xml: 'application/xml',
  json: 'application/json',
  rtf: 'application/rtf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  zip: 'application/zip',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  svg: 'image/svg+xml',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  mp4: 'video/mp4'
}

/** The media type for a file name, from its extension. */
export const mimeFor = (name: string): string => MIME[/\.([A-Za-z0-9]+)$/.exec(name)?.[1].toLowerCase() ?? ''] ?? 'application/octet-stream'

const pdfDate = (d: Date) => {
  const p = (n: number) => String(n).padStart(2, '0')
  return `D:${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`
}

const nameOf = (o: PDFObject | undefined): string => (o instanceof PDFString || o instanceof PDFHexString ? o.decodeText() : '')

/** Every (name, value) pair of the embedded-files name tree, in order. */
function pairs(node: PDFDict | undefined, out: [string, PDFObject][] = []): [string, PDFObject][] {
  if (!node) return out
  const names = node.lookupMaybe(N('Names'), PDFArray)
  if (names) for (let i = 0; i + 1 < names.size(); i += 2) out.push([nameOf(names.lookup(i)), names.get(i + 1)])
  const kids = node.lookupMaybe(N('Kids'), PDFArray)
  if (kids) for (let i = 0; i < kids.size(); i++) pairs(kids.lookupMaybe(i, PDFDict), out)
  return out
}

/** Writes the pairs back as one flat, sorted tree (name trees must be in order). */
function writeTree(doc: PDFDocument, list: [string, PDFObject][]): void {
  const ctx = doc.context
  const names = doc.catalog.lookupMaybe(N('Names'), PDFDict) ?? (() => {
    const d = ctx.obj({})
    doc.catalog.set(N('Names'), d)
    return d
  })()
  if (!list.length) {
    names.delete(N('EmbeddedFiles'))
    return
  }
  const sorted = [...list].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
  const arr = ctx.obj([])
  for (const [k, v] of sorted) {
    arr.push(PDFHexString.fromText(k))
    arr.push(v)
  }
  names.set(N('EmbeddedFiles'), ctx.obj({ Names: arr }))
}

/** A name not already used: report.pdf, then report (2).pdf. */
function uniqueName(name: string, taken: Set<string>): string {
  if (!taken.has(name)) return name
  const dot = name.lastIndexOf('.')
  const stem = dot > 0 ? name.slice(0, dot) : name
  const ext = dot > 0 ? name.slice(dot) : ''
  for (let n = 2; ; n++) {
    const candidate = `${stem} (${n})${ext}`
    if (!taken.has(candidate)) return candidate
  }
}

/** Embeds files in the document (not on a page). A name that is already used gets a number. */
export async function embedFiles(bytes: Uint8Array, files: EmbedFile[]): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false })
  const names = addFiles(doc, files)
  // In a portfolio that has folders, new files go in the folders they were given (or the top level).
  if (doc.catalog.has(N('Collection'))) {
    const state = readFolderState(doc)
    files.forEach((f, i) => {
      const folder = cleanFolderPath(f.folder ?? '')
      if (folder) addPath(state.paths, folder)
      state.assign.set(names[i], folder)
    })
    if (state.paths.size || [...state.assign.values()].some(Boolean)) writeFolderState(doc, state)
  }
  return doc.save()
}

/** Embeds the files in the name tree and returns the names they were stored under (a clash gets a number). */
function addFiles(doc: PDFDocument, files: EmbedFile[]): string[] {
  const ctx = doc.context
  const list = pairs(doc.catalog.lookupMaybe(N('Names'), PDFDict)?.lookupMaybe(N('EmbeddedFiles'), PDFDict))
  const taken = new Set(list.map(([k]) => k))
  const stored: string[] = []
  for (const f of files) {
    const name = uniqueName(f.name, taken)
    taken.add(name)
    stored.push(name)
    const stream = ctx.register(
      ctx.flateStream(f.data, {
        Type: 'EmbeddedFile',
        Subtype: mimeFor(name),
        Params: { Size: f.data.length, ...(f.modified ? { ModDate: PDFString.of(pdfDate(f.modified)) } : {}) }
      })
    )
    const spec = ctx.obj({
      Type: 'Filespec',
      F: PDFString.of(name.replace(/[^\x20-\x7e]/g, '_')),
      UF: PDFHexString.fromText(name),
      EF: { F: stream }
    })
    if (f.description) spec.set(N('Desc'), PDFHexString.fromText(f.description))
    if (f.thumb && f.thumb.rgb.length === f.thumb.width * f.thumb.height * 3) {
      const img = ctx.flateStream(f.thumb.rgb, { Type: 'XObject', Subtype: 'Image', Width: f.thumb.width, Height: f.thumb.height, ColorSpace: 'DeviceRGB', BitsPerComponent: 8 })
      spec.set(N('Thumb'), ctx.register(img))
    }
    list.push([name, ctx.register(spec)])
  }
  writeTree(doc, list)
  return stored
}

/** Takes the document-level embedded file at `index` (in name order, as the attachments list shows) out of the document. */
export async function removeEmbedded(bytes: Uint8Array, index: number, name?: string): Promise<{ bytes: Uint8Array; removed: boolean }> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false })
  const list = pairs(doc.catalog.lookupMaybe(N('Names'), PDFDict)?.lookupMaybe(N('EmbeddedFiles'), PDFDict))
  const target = list[index]
  if (!target || (name !== undefined && target[0] !== name && !specNames(doc, target[1]).includes(name))) return { bytes, removed: false }
  list.splice(index, 1)
  writeTree(doc, list)
  // The file's data is no longer referred to: drop it, or it would still be written out.
  pruneUnreachable(doc)
  return { bytes: await doc.save(), removed: true }
}

function specNames(doc: PDFDocument, ref: PDFObject): string[] {
  const spec = ref instanceof PDFRef ? doc.context.lookup(ref) : ref
  return spec instanceof PDFDict ? [nameOf(spec.lookup(N('UF'))), nameOf(spec.lookup(N('F')))].filter(Boolean) : []
}

export interface PortfolioOptions {
  title: string
  /** Text on the cover page, for viewers that do not show portfolios. */
  cover: string
  /** How a portfolio viewer first lists the files: details (the default) or tiles. */
  view?: 'D' | 'T'
}

/**
 * A new PDF package: a cover page and the files embedded, with a /Collection entry (details view; name, size, date and
 * description columns) so viewers that support portfolios show the files first.
 */
export async function createPortfolio(files: EmbedFile[], o: PortfolioOptions): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  doc.setTitle(o.title)
  doc.setCreator('OpenPDF')
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  const page = doc.addPage([595.28, 841.89])
  page.drawText(o.title, { x: 56, y: 770, size: 22, font: bold, color: rgb(0.1, 0.15, 0.3) })
  let y = 735
  for (const line of (o.cover || 'This PDF is a portfolio. Its files are attached: open it in a PDF reader that supports portfolios, or use the attachments pane.').split(/\r?\n/)) {
    page.drawText(line.replace(/[^\x20-\x7e\xa0-\xff]/g, '?'), { x: 56, y, size: 11, font, color: rgb(0.2, 0.2, 0.2) })
    y -= 16
  }
  y -= 12
  page.drawText('Files in this portfolio', { x: 56, y, size: 13, font: bold })
  y -= 20
  for (const f of files.slice(0, 40)) {
    page.drawText(`${f.name.replace(/[^\x20-\x7e\xa0-\xff]/g, '?')}  (${f.data.length < 1024 ? `${f.data.length} B` : f.data.length < 1048576 ? `${Math.round(f.data.length / 1024)} KB` : `${(f.data.length / 1048576).toFixed(1)} MB`})`, { x: 64, y, size: 10, font })
    y -= 14
    if (y < 60) break
  }
  const stored = addFiles(doc, files)
  const ctx = doc.context
  doc.catalog.set(
    N('Collection'),
    ctx.obj({
      Type: 'Collection',
      View: o.view ?? 'D',
      Schema: {
        Type: 'CollectionSchema',
        Name: { Type: 'CollectionField', Subtype: 'S', N: PDFString.of('Name'), O: 1 },
        Size: { Type: 'CollectionField', Subtype: 'N', N: PDFString.of('Size'), O: 2 },
        ModDate: { Type: 'CollectionField', Subtype: 'D', N: PDFString.of('Modified'), O: 3 },
        Desc: { Type: 'CollectionField', Subtype: 'S', N: PDFString.of('Description'), O: 4 }
      },
      Sort: { Type: 'CollectionSort', S: 'Name', A: true }
    })
  )
  const state: FolderState = { paths: new Set(), assign: new Map() }
  files.forEach((f, i) => {
    const folder = cleanFolderPath(f.folder ?? '')
    if (folder) addPath(state.paths, folder)
    state.assign.set(stored[i], folder)
  })
  if (state.paths.size) writeFolderState(doc, state)
  return doc.save()
}

/** Whether the document asks viewers to show it as a portfolio. */
export async function isPortfolio(bytes: Uint8Array): Promise<boolean> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false, ignoreEncryption: true })
  return doc.catalog.has(N('Collection'))
}


// ---- Folders --------------------------------------------------------------------------------------------------------------------
//
// A portfolio can group its files in folders (a /Folders tree of folder dictionaries under /Collection, each with an
// integer ID; a file points at its folder with /Folder). Paths here are the folder names joined with "/", the top level
// being the empty string.

interface FolderState {
  /** Every folder, as a path; the ancestors of a folder are in the set too. */
  paths: Set<string>
  /** File name (as stored in the name tree) to folder path. */
  assign: Map<string, string>
}

const MAX_FOLDER_NAME = 100

/** A folder name is a short piece of text without slashes or control characters; null when it is fine. */
export function checkFolderName(name: string): string | null {
  const t = name.trim()
  if (!t) return 'Type a name for the folder.'
  if (t.length > MAX_FOLDER_NAME) return `A folder name can be up to ${MAX_FOLDER_NAME} characters.`
  // eslint-disable-next-line no-control-regex
  if (/[/\\\u0000-\u001f]/.test(t)) return 'A folder name cannot hold a slash or a control character.'
  return null
}

/** A folder path with stray spaces, empty parts and bad characters taken out. */
export function cleanFolderPath(p: string): string {
  return p
    .split('/')
    // eslint-disable-next-line no-control-regex
    .map((x) => x.replace(/[\\\u0000-\u001f]/g, '').trim().slice(0, MAX_FOLDER_NAME))
    .filter(Boolean)
    .join('/')
}

/** Adds a path and every folder above it. */
function addPath(set: Set<string>, path: string): void {
  const parts = path.split('/')
  for (let i = 1; i <= parts.length; i++) set.add(parts.slice(0, i).join('/'))
}

function readFolderState(doc: PDFDocument): FolderState {
  const state: FolderState = { paths: new Set(), assign: new Map() }
  const byId = new Map<number, string>()
  const root = doc.catalog.lookupMaybe(N('Collection'), PDFDict)?.lookupMaybe(N('Folders'), PDFDict)
  const seen = new Set<PDFDict>()
  const walk = (f: PDFDict | undefined, parent: string, depth: number) => {
    for (let cur = f, n = 0; cur && !seen.has(cur) && n < 5000; cur = cur.lookupMaybe(N('Next'), PDFDict), n++) {
      seen.add(cur)
      const isRoot = depth === 0
      const name = nameOf(cur.lookup(N('Name')))
      const path = isRoot ? '' : parent ? `${parent}/${name}` : name
      const id = cur.lookupMaybe(N('ID'), PDFNumber)?.asNumber()
      if (id !== undefined) byId.set(id, path)
      if (!isRoot && path) state.paths.add(path)
      if (depth < 32) walk(cur.lookupMaybe(N('Child'), PDFDict), path, depth + 1)
      if (isRoot) break
    }
  }
  walk(root, '', 0)
  for (const [name, v] of pairs(doc.catalog.lookupMaybe(N('Names'), PDFDict)?.lookupMaybe(N('EmbeddedFiles'), PDFDict))) {
    const spec = v instanceof PDFRef ? doc.context.lookup(v) : v
    const id = spec instanceof PDFDict ? spec.lookupMaybe(N('Folder'), PDFNumber)?.asNumber() : undefined
    state.assign.set(name, id !== undefined ? (byId.get(id) ?? '') : '')
  }
  return state
}

function writeFolderState(doc: PDFDocument, state: FolderState): void {
  const ctx = doc.context
  const all = new Set<string>()
  for (const p of state.paths) addPath(all, p)
  for (const p of state.assign.values()) if (p) addPath(all, p)
  const col = doc.catalog.lookupMaybe(N('Collection'), PDFDict)
  const files = pairs(doc.catalog.lookupMaybe(N('Names'), PDFDict)?.lookupMaybe(N('EmbeddedFiles'), PDFDict))
  const setFolder = (v: PDFObject, id: number | null) => {
    const spec = v instanceof PDFRef ? ctx.lookup(v) : v
    if (!(spec instanceof PDFDict)) return
    if (id === null) spec.delete(N('Folder'))
    else spec.set(N('Folder'), ctx.obj(id))
  }
  if (!all.size) {
    col?.delete(N('Folders'))
    for (const [, v] of files) setFolder(v, null)
    return
  }
  const sorted = [...all].sort((a, b) => a.localeCompare(b))
  const ids = new Map<string, number>([['', 0]])
  sorted.forEach((p, i) => ids.set(p, i + 1))
  const refs = new Map<string, PDFRef>()
  const dicts = new Map<string, PDFDict>()
  for (const p of ['', ...sorted]) {
    const d = ctx.obj({ Type: 'Folder', ID: ids.get(p)!, Name: PDFHexString.fromText(p === '' ? 'Root' : p.slice(p.lastIndexOf('/') + 1)) })
    dicts.set(p, d)
    refs.set(p, ctx.register(d))
  }
  const parentOf = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '')
  const siblings = new Map<string, string[]>()
  for (const p of sorted) siblings.set(parentOf(p), [...(siblings.get(parentOf(p)) ?? []), p])
  for (const [parent, list] of siblings) {
    dicts.get(parent)!.set(N('Child'), refs.get(list[0])!)
    list.forEach((p, i) => {
      dicts.get(p)!.set(N('Parent'), refs.get(parent)!)
      if (i + 1 < list.length) dicts.get(p)!.set(N('Next'), refs.get(list[i + 1])!)
    })
  }
  col?.set(N('Folders'), refs.get('')!)
  for (const [name, v] of files) setFolder(v, ids.get(state.assign.get(name) ?? '') ?? 0)
}

export interface PortfolioInfo {
  isPortfolio: boolean
  /** How a portfolio viewer first lists the files. */
  view: 'D' | 'T' | 'H'
  /** Every folder, as a path, in order. */
  folders: string[]
  /** File name to the folder it is in ('' for the top level). */
  assign: Record<string, string>
}

/** The portfolio details: whether it is one, its first view, its folders and where each file is. */
export async function readPortfolio(bytes: Uint8Array): Promise<PortfolioInfo> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false, ignoreEncryption: true })
  const col = doc.catalog.lookupMaybe(N('Collection'), PDFDict)
  if (!col) return { isPortfolio: false, view: 'D', folders: [], assign: {} }
  const state = readFolderState(doc)
  const view = (col.lookup(N('View')) as PDFName | undefined)?.decodeText()
  return { isPortfolio: true, view: view === 'T' || view === 'H' ? view : 'D', folders: [...state.paths].sort((a, b) => a.localeCompare(b)), assign: Object.fromEntries(state.assign) }
}

async function editFolders(bytes: Uint8Array, change: (s: FolderState) => string | null): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false })
  if (!doc.catalog.has(N('Collection'))) throw new Error('This document is not a portfolio.')
  const state = readFolderState(doc)
  const problem = change(state)
  if (problem) throw new Error(problem)
  writeFolderState(doc, state)
  return doc.save()
}

/** Adds a folder (a path; the folders above it are added as needed). */
export function addFolder(bytes: Uint8Array, path: string): Promise<Uint8Array> {
  const clean = cleanFolderPath(path)
  const bad = clean.split('/').map(checkFolderName).find(Boolean)
  return editFolders(bytes, (s) => {
    if (!clean) return 'Type a name for the folder.'
    if (bad) return bad
    if (s.paths.has(clean)) return 'There is a folder with that name already.'
    addPath(s.paths, clean)
    return null
  })
}

/** Puts a file in a folder (the top level for an empty path), making the folder if it is new. */
export function moveToFolder(bytes: Uint8Array, name: string, path: string): Promise<Uint8Array> {
  const clean = cleanFolderPath(path)
  return editFolders(bytes, (s) => {
    if (!s.assign.has(name)) return 'That file is not in the portfolio.'
    if (clean) addPath(s.paths, clean)
    s.assign.set(name, clean)
    return null
  })
}

/** Removes a folder; what was in it (files and folders) moves up to the folder above. */
export function removeFolder(bytes: Uint8Array, path: string): Promise<Uint8Array> {
  return editFolders(bytes, (s) => {
    if (!s.paths.has(path)) return 'That folder is not in the portfolio.'
    const parent = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ''
    const lift = (p: string) => (p === path ? parent : p.startsWith(`${path}/`) ? (parent ? `${parent}/` : '') + p.slice(path.length + 1) : p)
    s.paths = new Set([...s.paths].filter((p) => p !== path).map(lift))
    for (const [k, v] of s.assign) s.assign.set(k, lift(v))
    return null
  })
}

/** Renames a folder (its last name), keeping what is in it. */
export function renameFolder(bytes: Uint8Array, path: string, newName: string): Promise<Uint8Array> {
  return editFolders(bytes, (s) => {
    if (!s.paths.has(path)) return 'That folder is not in the portfolio.'
    const bad = checkFolderName(newName)
    if (bad) return bad
    const parent = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ''
    const target = (parent ? `${parent}/` : '') + newName.trim()
    if (target !== path && s.paths.has(target)) return 'There is a folder with that name already.'
    const move = (p: string) => (p === path ? target : p.startsWith(`${path}/`) ? target + p.slice(path.length) : p)
    s.paths = new Set([...s.paths].map(move))
    for (const [k, v] of s.assign) s.assign.set(k, move(v))
    return null
  })
}
