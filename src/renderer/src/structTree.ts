/**
 * The structure tree of a tagged PDF (ISO 32000 14.7 and 14.8): reading it for the Tags pane, and the edits that do not
 * touch the page layout: alternative text, element type, reading order (the order of siblings), marking an element as an
 * artefact, and the document language and title. Elements are named by their position, as a path of indices among the
 * element children at each level ("0/2/1"), so the same path means the same element until the tree is edited.
 */
import { PDFArray, PDFBool, PDFDict, PDFDocument, PDFHexString, PDFName, PDFNull, PDFNumber, PDFRawStream, PDFRef, PDFString, decodePDFRawStream, type PDFObject } from 'pdf-lib'
import { parseContent, type Op, type Tok } from './content'
import { pageContent, setPageContent } from './pageContent'

const N = PDFName.of

/** The standard structure types of ISO 32000-1 14.8.4, which a reader that finds no role mapping can interpret. */
export const STANDARD_TYPES = [
  'Document', 'Part', 'Art', 'Sect', 'Div', 'BlockQuote', 'Caption', 'TOC', 'TOCI', 'Index', 'NonStruct', 'Private',
  'P', 'H', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'L', 'LI', 'Lbl', 'LBody',
  'Table', 'TR', 'TH', 'TD', 'THead', 'TBody', 'TFoot',
  'Span', 'Quote', 'Note', 'Reference', 'BibEntry', 'Code', 'Link', 'Annot', 'Ruby', 'RB', 'RT', 'RP', 'Warichu', 'WT', 'WP',
  'Figure', 'Formula', 'Form'
] as const

export const isStandardType = (t: string): boolean => (STANDARD_TYPES as readonly string[]).includes(t)

const MAX_NODES = 50000
const MAX_DEPTH = 64

export interface ContentRef {
  /** 0-based page, or -1 when the page cannot be told. */
  page: number
  mcid: number
}

export interface TagNode {
  /** Position in the tree: indices among the element children, joined with "/". */
  id: string
  /** The element's own type (/S). */
  type: string
  /** What the type means to a reader (through the role map), when it is not a standard type itself. */
  role: string
  title: string
  alt: string
  actualText: string
  lang: string
  /** The page the element is on (its own, or the first found below it); -1 when unknown. */
  page: number
  /** Marked content of this element itself (not of its children). */
  content: ContentRef[]
  /** Annotations (links, form fields) that this element stands for. */
  annots: { page: number; index: number }[]
  children: TagNode[]
}

export interface TagTree {
  roots: TagNode[]
  /** Elements read. */
  count: number
  /** Reading stopped at a limit (a very large or malformed tree). */
  truncated: boolean
  roleMap: Record<string, string>
}

const text = (o: PDFObject | undefined): string => (o instanceof PDFString || o instanceof PDFHexString ? o.decodeText() : '')
const nameText = (o: PDFObject | undefined): string => (o instanceof PDFName ? o.decodeText() : '')

/** The /K entries of an element or of the root, each as it is stored (a reference when indirect) and as it resolves. */
function kids(dict: PDFDict): { raw: PDFObject; value: PDFObject | undefined }[] {
  const k = dict.get(N('K'))
  if (k === undefined) return []
  const ctx = dict.context
  const v = k instanceof PDFRef ? ctx.lookup(k) : k
  if (v instanceof PDFArray) return Array.from({ length: v.size() }, (_, i) => ({ raw: v.get(i), value: v.lookup(i) }))
  return [{ raw: k, value: v }]
}

/** Whether a /K entry is a structure element (as opposed to a content item). */
const isElement = (v: PDFObject | undefined): v is PDFDict => v instanceof PDFDict && v.has(N('S'))

function pageIndexer(doc: PDFDocument): (ref: PDFObject | undefined) => number {
  const map = new Map<string, number>()
  doc.getPages().forEach((p, i) => map.set(p.ref.toString(), i))
  return (ref) => (ref instanceof PDFRef ? (map.get(ref.toString()) ?? -1) : -1)
}

function readRoleMap(root: PDFDict): Record<string, string> {
  const out: Record<string, string> = {}
  const rm = root.lookupMaybe(N('RoleMap'), PDFDict)
  if (rm) for (const k of rm.keys()) out[k.decodeText()] = nameText(rm.lookup(k))
  return out
}

/** Follows the role map from a type to a standard one, or '' when there is none (or the mapping loops). */
export function standardRole(type: string, roleMap: Record<string, string>): string {
  let t = type
  for (let i = 0; i < 12; i++) {
    if (isStandardType(t)) return t
    const next = roleMap[t]
    if (!next || next === t) return ''
    t = next
  }
  return ''
}

/** Reads the structure tree; an untagged document gives no roots. */
export function readTagTreeFrom(doc: PDFDocument): TagTree {
  const root = doc.catalog.lookupMaybe(N('StructTreeRoot'), PDFDict)
  const tree: TagTree = { roots: [], count: 0, truncated: false, roleMap: {} }
  if (!root) return tree
  const pageOf = pageIndexer(doc)
  tree.roleMap = readRoleMap(root)
  const seen = new Set<PDFDict>()
  const annotIndex = new Map<string, { page: number; index: number }>()
  const annotOf = (ref: PDFObject | undefined): { page: number; index: number } | null => {
    if (!(ref instanceof PDFRef)) return null
    if (!annotIndex.size) {
      doc.getPages().forEach((p, pi) => {
        const arr = p.node.lookupMaybe(N('Annots'), PDFArray)
        if (arr) for (let i = 0; i < arr.size(); i++) {
          const r = arr.get(i)
          if (r instanceof PDFRef) annotIndex.set(r.toString(), { page: pi, index: i })
        }
      })
    }
    return annotIndex.get(ref.toString()) ?? null
  }

  const read = (dict: PDFDict, id: string, inheritedPage: number, depth: number): TagNode => {
    tree.count++
    const type = nameText(dict.lookup(N('S')))
    const ownPage = pageOf(dict.get(N('Pg')))
    const here = ownPage >= 0 ? ownPage : inheritedPage
    const node: TagNode = {
      id,
      type,
      role: isStandardType(type) ? '' : standardRole(type, tree.roleMap),
      title: text(dict.lookup(N('T'))),
      alt: text(dict.lookup(N('Alt'))),
      actualText: text(dict.lookup(N('ActualText'))),
      lang: text(dict.lookup(N('Lang'))),
      page: here,
      content: [],
      annots: [],
      children: []
    }
    let n = 0
    for (const { value } of kids(dict)) {
      if (value instanceof PDFNumber) node.content.push({ page: here, mcid: value.asNumber() })
      else if (isElement(value)) {
        if (seen.has(value) || tree.count >= MAX_NODES || depth >= MAX_DEPTH) {
          tree.truncated = true
          n++
          continue
        }
        seen.add(value)
        node.children.push(read(value, id ? `${id}/${n}` : String(n), here, depth + 1))
        n++
      } else if (value instanceof PDFDict) {
        const type2 = nameText(value.lookup(N('Type')))
        if (type2 === 'MCR' || value.has(N('MCID'))) {
          const pg = pageOf(value.get(N('Pg')))
          if (!value.has(N('Stm'))) node.content.push({ page: pg >= 0 ? pg : here, mcid: value.lookupMaybe(N('MCID'), PDFNumber)?.asNumber() ?? -1 })
        } else if (type2 === 'OBJR') {
          const pg = pageOf(value.get(N('Pg')))
          const a = annotOf(value.get(N('Obj')))
          if (a) node.annots.push(a)
          else if (pg >= 0) node.annots.push({ page: pg, index: -1 })
          if (node.page < 0 && pg >= 0) node.page = pg
        }
      }
    }
    if (node.page < 0) {
      node.page = node.content.find((c) => c.page >= 0)?.page ?? node.children.find((c) => c.page >= 0)?.page ?? node.annots[0]?.page ?? -1
    }
    return node
  }

  let n = 0
  for (const { value } of kids(root)) {
    if (isElement(value) && !seen.has(value)) {
      seen.add(value)
      tree.roots.push(read(value, String(n), -1, 0))
      n++
    } else if (isElement(value)) n++
  }
  return tree
}

export async function readTagTree(bytes: Uint8Array): Promise<TagTree> {
  return readTagTreeFrom(await PDFDocument.load(bytes, { updateMetadata: false }))
}

/** A one-line description of an element for lists: the type, its title or alternative text. */
export function describeTag(n: TagNode): string {
  const label = n.title || n.alt || n.actualText
  return label ? `${n.type}: ${label}` : n.type
}

/** Every node, depth first. */
export function flattenTags(roots: TagNode[]): TagNode[] {
  const out: TagNode[] = []
  const walk = (n: TagNode) => {
    out.push(n)
    n.children.forEach(walk)
  }
  roots.forEach(walk)
  return out
}

/** The node with this id. */
export function findTag(roots: TagNode[], id: string): TagNode | undefined {
  return flattenTags(roots).find((n) => n.id === id)
}

/** Every content item of the node and of everything below it. */
export function contentOfTag(n: TagNode): ContentRef[] {
  return [...n.content, ...n.children.flatMap(contentOfTag)]
}

// ---- Editing ---------------------------------------------------------------------------------------------------------

interface Located {
  dict: PDFDict
  /** The element or root that holds it, and its /K array when the entries are listed in one. */
  parent: PDFDict
  /** Position among the parent's /K entries. */
  slot: number
  /** Position among the parent's element children. */
  index: number
}

function locate(doc: PDFDocument, id: string): Located | null {
  const root = doc.catalog.lookupMaybe(N('StructTreeRoot'), PDFDict)
  if (!root || id === '') return null
  let parent: PDFDict = root
  let found: Located | null = null
  for (const part of id.split('/')) {
    const want = Number(part)
    if (!Number.isInteger(want) || want < 0) return null
    const list = kids(parent)
    let n = 0
    let hit = -1
    for (let i = 0; i < list.length; i++) {
      if (isElement(list[i].value)) {
        if (n === want) {
          hit = i
          break
        }
        n++
      }
    }
    if (hit < 0) return null
    const dict = list[hit].value as PDFDict
    found = { dict, parent, slot: hit, index: want }
    parent = dict
  }
  return found
}

const setText = (dict: PDFDict, key: string, value: string) => {
  if (value) dict.set(N(key), PDFHexString.fromText(value))
  else dict.delete(N(key))
}

export interface TagTextEdit {
  alt?: string
  title?: string
  actualText?: string
  lang?: string
}

/** Sets or clears (with an empty string) the alternative text, title, replacement text or language of an element. */
export async function setTagText(bytes: Uint8Array, id: string, edit: TagTextEdit): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false })
  const at = locate(doc, id)
  if (!at) throw new Error('That element is no longer in the structure tree.')
  if (edit.alt !== undefined) setText(at.dict, 'Alt', edit.alt)
  if (edit.title !== undefined) setText(at.dict, 'T', edit.title)
  if (edit.actualText !== undefined) setText(at.dict, 'ActualText', edit.actualText)
  if (edit.lang !== undefined) setText(at.dict, 'Lang', edit.lang.trim())
  return doc.save()
}

/** A structure type: a PDF name, without the slash. */
export const validTagType = (t: string): boolean => /^[A-Za-z][A-Za-z0-9_.-]{0,40}$/.test(t)

/** Changes the type of an element. */
export async function setTagType(bytes: Uint8Array, id: string, type: string): Promise<Uint8Array> {
  if (!validTagType(type)) throw new Error('A tag type starts with a letter and has only letters, digits, dots, dashes and underscores.')
  const doc = await PDFDocument.load(bytes, { updateMetadata: false })
  const at = locate(doc, id)
  if (!at) throw new Error('That element is no longer in the structure tree.')
  at.dict.set(N('S'), N(type))
  return doc.save()
}

/**
 * Moves an element one place earlier (-1) or later (+1) among its siblings, which changes the reading order. The new id
 * is returned so the pane can keep it selected; `moved` is false at either end of the list.
 */
export async function moveTag(bytes: Uint8Array, id: string, delta: -1 | 1): Promise<{ bytes: Uint8Array; id: string; moved: boolean }> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false })
  const at = locate(doc, id)
  if (!at) throw new Error('That element is no longer in the structure tree.')
  const list = kids(at.parent)
  const elements = list.map((e, i) => ({ e, i })).filter((x) => isElement(x.e.value))
  const to = at.index + delta
  if (to < 0 || to >= elements.length) return { bytes, id, moved: false }
  const k = at.parent.lookup(N('K'))
  if (!(k instanceof PDFArray)) return { bytes, id, moved: false }
  const a = elements[at.index].i
  const b = elements[to].i
  const ra = k.get(a)
  const rb = k.get(b)
  k.set(a, rb)
  k.set(b, ra)
  const parts = id.split('/')
  parts[parts.length - 1] = String(to)
  return { bytes: await doc.save(), id: parts.join('/'), moved: true }
}

// ---- Artefacts --------------------------------------------------------------------------------------------------------

/** The number-tree entry for a key (ISO 32000 7.9.7), searched through /Kids by limits. */
function numberTreeFind(node: PDFDict | undefined, key: number, depth = 0): PDFObject | undefined {
  if (!node || depth > 24) return undefined
  const nums = node.lookupMaybe(N('Nums'), PDFArray)
  if (nums) {
    for (let i = 0; i + 1 < nums.size(); i += 2) if (nums.lookupMaybe(i, PDFNumber)?.asNumber() === key) return nums.lookup(i + 1)
  }
  const ks = node.lookupMaybe(N('Kids'), PDFArray)
  if (ks) {
    for (let i = 0; i < ks.size(); i++) {
      const kid = ks.lookupMaybe(i, PDFDict)
      const hit = numberTreeFind(kid, key, depth + 1)
      if (hit) return hit
    }
  }
  return undefined
}

/**
 * The operations of a page's content that open marked content for the given MCIDs, as [start, end) ranges. Properties
 * given by name are looked up in the page resources.
 */
function mcidOps(ops: Op[], wanted: Set<number>, properties: (name: string) => PDFDict | undefined): Op[] {
  const out: Op[] = []
  for (const o of ops) {
    if (o.op !== 'BDC' || o.operands.length < 2) continue
    const prop = o.operands[1]
    let mcid: number | undefined
    if (prop.t === 'dict') mcid = dictNumber(prop.v, 'MCID')
    else if (prop.t === 'name') mcid = properties(prop.v)?.lookupMaybe(N('MCID'), PDFNumber)?.asNumber()
    if (mcid !== undefined && wanted.has(mcid)) out.push(o)
  }
  return out
}

function dictNumber(items: Tok[], key: string): number | undefined {
  for (let i = 0; i + 1 < items.length; i++) {
    const k = items[i]
    const v = items[i + 1]
    if (k.t === 'name' && k.v === key && v.t === 'num') return v.v
  }
  return undefined
}

export interface ArtefactResult {
  bytes: Uint8Array
  /** Pieces of page content now marked as artefacts. */
  marked: number
  /** Content in forms drawn by the page, which is left as it was. */
  skipped: number
}

/**
 * Marks an element (and everything in it) as an artefact: it is taken out of the structure tree and its marked content on
 * the pages is re-marked as /Artifact, so readers skip it (page numbers, decoration, repeated headers).
 */
export async function markArtifact(bytes: Uint8Array, id: string): Promise<ArtefactResult> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false })
  const at = locate(doc, id)
  if (!at) throw new Error('That element is no longer in the structure tree.')
  const tree = readTagTreeFrom(doc)
  const node = findTag(tree.roots, id)
  if (!node) throw new Error('That element is no longer in the structure tree.')
  const items = contentOfTag(node)
  // Content drawn through a form (/Stm) cannot be re-marked here.
  let skipped = 0
  const walkSkipped = (d: PDFDict, depth: number) => {
    if (depth > MAX_DEPTH) return
    for (const { value } of kids(d)) {
      if (value instanceof PDFDict && value.has(N('Stm'))) skipped++
      else if (isElement(value)) walkSkipped(value, depth + 1)
    }
  }
  walkSkipped(at.dict, 0)

  // Take the element out of the tree.
  const k = at.parent.lookup(N('K'))
  if (k instanceof PDFArray) k.remove(at.slot)
  else at.parent.delete(N('K'))

  // Re-mark the content, page by page.
  const byPage = new Map<number, Set<number>>()
  for (const c of items) if (c.page >= 0 && c.mcid >= 0) byPage.set(c.page, (byPage.get(c.page) ?? new Set()).add(c.mcid))
  const pages = doc.getPages()
  let marked = 0
  const parentTree = doc.catalog.lookupMaybe(N('StructTreeRoot'), PDFDict)?.lookupMaybe(N('ParentTree'), PDFDict)
  for (const [pi, wanted] of byPage) {
    const page = pages[pi]
    const src = pageContent(page)
    const res = page.node.lookupMaybe(N('Resources'), PDFDict)
    const props = res?.lookupMaybe(N('Properties'), PDFDict)
    const ops = mcidOps(parseContent(src), wanted, (name) => props?.lookupMaybe(N(name), PDFDict))
    if (ops.length) {
      let out = ''
      let last = 0
      for (const o of ops) {
        out += src.slice(last, o.start) + '/Artifact BMC'
        last = o.end
        marked++
      }
      out += src.slice(last)
      setPageContent(doc, page, out)
    }
    // The parent tree must not keep pointing at elements that are no longer there.
    const key = page.node.lookupMaybe(N('StructParents'), PDFNumber)?.asNumber()
    if (key !== undefined && parentTree) {
      const arr = numberTreeFind(parentTree, key)
      if (arr instanceof PDFArray) for (const m of wanted) if (m < arr.size()) arr.set(m, PDFNull)
    }
  }
  return { bytes: await doc.save(), marked, skipped }
}

// ---- Document language and title -----------------------------------------------------------------------------------------

export interface DocAccess {
  title: string
  lang: string
  /** The window title bar shows the title instead of the file name. */
  displayTitle: boolean
  marked: boolean
  tagged: boolean
}

export async function readDocAccess(bytes: Uint8Array): Promise<DocAccess> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false })
  const info = doc.context.lookupMaybe(doc.context.trailerInfo.Info, PDFDict)
  const vp = doc.catalog.lookupMaybe(N('ViewerPreferences'), PDFDict)?.lookup(N('DisplayDocTitle'))
  const mark = doc.catalog.lookupMaybe(N('MarkInfo'), PDFDict)?.lookup(N('Marked'))
  return {
    title: text(info?.lookup(N('Title'))),
    lang: text(doc.catalog.lookup(N('Lang'))),
    displayTitle: vp instanceof PDFBool && vp.asBoolean(),
    marked: mark instanceof PDFBool && mark.asBoolean(),
    tagged: doc.catalog.has(N('StructTreeRoot'))
  }
}

/** A language tag in the form of BCP 47 (RFC 5646) as far as it can be tested without the registry: en, en-AU, zh-Hant-TW. */
export const validLangTag = (s: string): boolean => /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(s)

const escXml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** The XMP packet with its dc:title replaced (or added when there is a description to put it in); other properties stay. */
export function withXmpTitle(xmp: string, title: string): string {
  const alt = `<dc:title><rdf:Alt><rdf:li xml:lang="x-default">${escXml(title)}</rdf:li></rdf:Alt></dc:title>`
  if (/<dc:title[\s>][\s\S]*?<\/dc:title>/.test(xmp)) return xmp.replace(/<dc:title[\s>][\s\S]*?<\/dc:title>/, alt)
  const open = /<rdf:Description\b[^>]*?(\/?)>/.exec(xmp)
  if (!open) return xmp
  const ns = xmp.includes('xmlns:dc=') ? '' : ' xmlns:dc="http://purl.org/dc/elements/1.1/"'
  if (open[1] === '/') return xmp.replace(open[0], open[0].replace(/\/>$/, `${ns}>${alt}</rdf:Description>`))
  return xmp.replace(open[0], open[0].replace(/>$/, `${ns}>`) + alt)
}

/**
 * Sets the document title and language. The title goes in the Info dictionary and in the XMP packet when there is one,
 * and the window title bar is told to show it (PDF/UA needs that). An empty language removes the entry.
 */
export async function setDocAccess(bytes: Uint8Array, v: { title: string; lang: string }): Promise<Uint8Array> {
  const lang = v.lang.trim()
  if (lang && !validLangTag(lang)) throw new Error('A language is written like en-AU or fr.')
  const doc = await PDFDocument.load(bytes, { updateMetadata: false })
  const ctx = doc.context
  let info = ctx.lookupMaybe(ctx.trailerInfo.Info, PDFDict)
  if (!info) {
    const ref = ctx.register(ctx.obj({}))
    ctx.trailerInfo.Info = ref
    info = ctx.lookupMaybe(ref, PDFDict)!
  }
  if (v.title) info.set(N('Title'), PDFHexString.fromText(v.title))
  else info.delete(N('Title'))
  setText(doc.catalog, 'Lang', lang)
  if (v.title) {
    const vp = doc.catalog.lookupMaybe(N('ViewerPreferences'), PDFDict) ?? (() => {
      const d = ctx.obj({})
      doc.catalog.set(N('ViewerPreferences'), d)
      return d
    })()
    vp.set(N('DisplayDocTitle'), ctx.obj(true))
  }
  const meta = doc.catalog.lookup(N('Metadata'))
  if (v.title && meta instanceof PDFRawStream) {
    const xmp = new TextDecoder('utf-8').decode(decodePDFRawStream(meta).decode())
    const next = withXmpTitle(xmp, v.title)
    if (next !== xmp) {
      const stream = ctx.stream(new TextEncoder().encode(next), { Type: 'Metadata', Subtype: 'XML' })
      doc.catalog.set(N('Metadata'), ctx.register(stream))
    }
  }
  return doc.save()
}
