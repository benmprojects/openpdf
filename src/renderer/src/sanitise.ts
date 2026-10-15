/**
 * "Remove hidden information": find and strip what a PDF carries that is not visible on its pages (metadata, attached
 * files, scripts, comments, bookmarks, thumbnails), so the file can be shared without it. Objects nothing refers to
 * afterwards are dropped, so the data does not stay in the file.
 */
import { PDFArray, PDFDict, PDFDocument, PDFName } from 'pdf-lib'
import { pruneUnreachable } from './redact'

export interface SanitiseOptions {
  metadata: boolean
  attachments: boolean
  javascript: boolean
  comments: boolean
  bookmarks: boolean
  thumbnails: boolean
}

/** How much of each kind there is (metadata: 1 or 0). */
export type HiddenInfo = Record<keyof SanitiseOptions, number>

const N = PDFName.of

const isJs = (d: PDFDict | undefined): boolean => !!d && d.lookup(N('S')) === N('JavaScript')

/** Annotations of every page, with the array they are in. */
function* annotations(doc: PDFDocument): Generator<{ annots: PDFArray; index: number; dict: PDFDict; subtype: string }> {
  for (const page of doc.getPages()) {
    const annots = page.node.lookupMaybe(N('Annots'), PDFArray)
    if (!annots) continue
    for (let i = annots.size() - 1; i >= 0; i--) {
      const dict = annots.lookupMaybe(i, PDFDict)
      if (dict) yield { annots, index: i, dict, subtype: (dict.lookup(N('Subtype')) as PDFName | undefined)?.decodeText?.() ?? '' }
    }
  }
}

function jsActions(owner: PDFDict | undefined): string[] {
  // Keys under which a dictionary can hold a script: /A and the entries of /AA.
  if (!owner) return []
  const keys: string[] = []
  if (isJs(owner.lookupMaybe(N('A'), PDFDict))) keys.push('A')
  const aa = owner.lookupMaybe(N('AA'), PDFDict)
  if (aa) for (const k of aa.keys()) if (isJs(aa.lookupMaybe(k, PDFDict))) keys.push(`AA/${k.decodeText()}`)
  return keys
}

/** Every field dictionary of the form, parents included (scripts often sit on a parent rather than its widgets). */
function fieldDicts(doc: PDFDocument): PDFDict[] {
  const out: PDFDict[] = []
  const seen = new Set<PDFDict>()
  const walk = (arr: PDFArray | undefined) => {
    if (!arr) return
    for (let i = 0; i < arr.size(); i++) {
      const f = arr.lookupMaybe(i, PDFDict)
      if (!f || seen.has(f)) continue
      seen.add(f)
      out.push(f)
      walk(f.lookupMaybe(N('Kids'), PDFArray))
    }
  }
  walk(doc.catalog.lookupMaybe(N('AcroForm'), PDFDict)?.lookupMaybe(N('Fields'), PDFArray))
  return out
}

const namesTree = (doc: PDFDocument, key: string): PDFDict | undefined => doc.catalog.lookupMaybe(N('Names'), PDFDict)?.lookupMaybe(N(key), PDFDict)

function namesCount(tree: PDFDict | undefined): number {
  if (!tree) return 0
  const names = tree.lookupMaybe(N('Names'), PDFArray)
  let n = names ? names.size() / 2 : 0
  const kids = tree.lookupMaybe(N('Kids'), PDFArray)
  if (kids) for (let i = 0; i < kids.size(); i++) n += namesCount(kids.lookupMaybe(i, PDFDict))
  return n
}

/** What the document carries. */
export async function scanHidden(bytes: Uint8Array): Promise<HiddenInfo> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false })
  const info = doc.context.lookupMaybe(doc.context.trailerInfo.Info, PDFDict)
  const meta = (doc.catalog.has(N('Metadata')) ? 1 : 0) + (info && info.keys().length ? 1 : 0)
  let attachments = namesCount(namesTree(doc, 'EmbeddedFiles'))
  let javascript = namesCount(namesTree(doc, 'JavaScript')) + jsActions(doc.catalog).length
  if (isJs(doc.catalog.lookupMaybe(N('OpenAction'), PDFDict))) javascript++
  let comments = 0
  for (const a of annotations(doc)) {
    if (a.subtype === 'FileAttachment') attachments++
    else if (a.subtype !== 'Link' && a.subtype !== 'Widget' && a.subtype !== 'Popup') comments++
    javascript += jsActions(a.dict).length
  }
  for (const f of fieldDicts(doc)) javascript += jsActions(f).length
  let thumbnails = 0
  for (const page of doc.getPages()) {
    if (page.node.has(N('Thumb'))) thumbnails++
    javascript += jsActions(page.node).length
  }
  return { metadata: meta ? 1 : 0, attachments, javascript, comments, bookmarks: doc.catalog.has(N('Outlines')) ? 1 : 0, thumbnails }
}

/** Removes the chosen kinds. Returns the new file and how much of each was removed. */
export async function sanitise(bytes: Uint8Array, o: SanitiseOptions): Promise<{ bytes: Uint8Array; removed: HiddenInfo }> {
  const before = await scanHidden(bytes)
  const doc = await PDFDocument.load(bytes, { updateMetadata: false })
  const cat = doc.catalog
  const names = cat.lookupMaybe(N('Names'), PDFDict)

  if (o.metadata) {
    cat.delete(N('Metadata'))
    cat.delete(N('PieceInfo'))
    const info = doc.context.lookupMaybe(doc.context.trailerInfo.Info, PDFDict)
    if (info) for (const k of info.keys()) info.delete(k)
    for (const page of doc.getPages()) {
      page.node.delete(N('Metadata'))
      page.node.delete(N('PieceInfo'))
      page.node.delete(N('LastModified'))
    }
  }
  if (o.attachments) {
    names?.delete(N('EmbeddedFiles'))
    cat.delete(N('AF'))
    for (const page of doc.getPages()) page.node.delete(N('AF'))
  }
  if (o.javascript) {
    names?.delete(N('JavaScript'))
    if (isJs(cat.lookupMaybe(N('OpenAction'), PDFDict))) cat.delete(N('OpenAction'))
    for (const owner of [cat, ...doc.getPages().map((p) => p.node), ...fieldDicts(doc)]) {
      for (const k of jsActions(owner)) {
        if (k === 'A') owner.delete(N('A'))
        else owner.lookupMaybe(N('AA'), PDFDict)?.delete(N(k.slice(3)))
      }
    }
  }
  for (const a of [...annotations(doc)]) {
    if (o.attachments && a.subtype === 'FileAttachment') a.annots.remove(a.index)
    else if (o.comments && a.subtype !== 'Link' && a.subtype !== 'Widget') a.annots.remove(a.index)
    else if (o.javascript) {
      for (const k of jsActions(a.dict)) {
        if (k === 'A') a.dict.delete(N('A'))
        else a.dict.lookupMaybe(N('AA'), PDFDict)?.delete(N(k.slice(3)))
      }
    }
  }
  // A popup whose parent annotation was removed would keep that annotation (and what it carries) alive.
  for (const page of doc.getPages()) {
    const annots = page.node.lookupMaybe(N('Annots'), PDFArray)
    if (!annots) continue
    const present = new Set<PDFDict>()
    for (let i = 0; i < annots.size(); i++) {
      const d = annots.lookupMaybe(i, PDFDict)
      if (d) present.add(d)
    }
    for (let i = annots.size() - 1; i >= 0; i--) {
      const d = annots.lookupMaybe(i, PDFDict)
      const parent = d?.lookupMaybe(N('Parent'), PDFDict)
      if (d && d.lookup(N('Subtype')) === N('Popup') && parent && !present.has(parent)) annots.remove(i)
    }
  }
  if (o.bookmarks) cat.delete(N('Outlines'))
  if (o.thumbnails) for (const page of doc.getPages()) page.node.delete(N('Thumb'))

  pruneUnreachable(doc)
  const out = await doc.save({ useObjectStreams: false })
  const after = await scanHidden(out)
  const removed = {} as HiddenInfo
  for (const k of Object.keys(before) as (keyof HiddenInfo)[]) removed[k] = Math.max(0, before[k] - after[k])
  return { bytes: out, removed }
}

