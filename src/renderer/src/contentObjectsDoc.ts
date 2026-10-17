/**
 * Content pane edits on a document: listing a page's objects in drawing order, hiding and showing one (through an
 * optional content group that stays visible in the Layers pane), moving one forward or back, and deleting a form.
 * See `contentObjects.ts` for the stream work.
 */
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFRef } from 'pdf-lib'
import { parseContent } from './content'
import { listPageFonts, type PageFontInfo } from './embeddedFont'
import { HIDE_PREFIX, listObjects, moveAfter, removeObjectOps, unwrapHidden, wrapHidden, type StreamObject } from './contentObjects'
import { isFormXObject, isImageXObject, pageContent, setPageContent } from './pageContent'

function load(doc: PDFDocument, pageIndex: number) {
  const page = doc.getPage(pageIndex)
  const src = pageContent(page)
  const ops = parseContent(src)
  const objects = listObjects(ops, (n) => isImageXObject(page, n), (n) => isFormXObject(page, n))
  return { page, src, ops, objects }
}

/** A page's objects in drawing order. */
export async function listPageObjects(bytes: Uint8Array, pageIndex: number): Promise<StreamObject[]> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false })
  return load(doc, pageIndex).objects
}

function pick(objects: StreamObject[], kind: StreamObject['kind'], typeOrdinal: number): { obj: StreamObject; at: number } {
  const at = objects.findIndex((o) => o.kind === kind && o.typeOrdinal === typeOrdinal)
  if (at < 0) throw new Error('That object could not be found in the page content.')
  return { obj: objects[at], at }
}

export interface ObjectRef {
  page: number
  kind: StreamObject['kind']
  typeOrdinal: number
}

/** How many objects of each kind the page lists, for checking against PDFium's counts before editing. */
export const countKinds = (objects: StreamObject[]): Record<StreamObject['kind'], number> => ({
  text: objects.filter((o) => o.kind === 'text').length,
  image: objects.filter((o) => o.kind === 'image').length,
  path: objects.filter((o) => o.kind === 'path').length,
  form: objects.filter((o) => o.kind === 'form').length
})

/** Hides an object: it stays in the file, wrapped so that a switched-off layer ("Hidden object") covers it. */
export async function hideObject(bytes: Uint8Array, ref: ObjectRef): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false })
  const { page, src, ops, objects } = load(doc, ref.page)
  const { obj } = pick(objects, ref.kind, ref.typeOrdinal)
  if (obj.hiddenBy) return bytes
  const ctx = doc.context
  const ocg = ctx.register(ctx.obj({ Type: 'OCG', Name: 'Hidden object' }))
  // Catalog: list the group and switch it off in the default configuration.
  const catalog = doc.catalog
  let props = catalog.lookupMaybe(PDFName.of('OCProperties'), PDFDict)
  if (!props) {
    props = ctx.obj({ OCGs: [] }) as PDFDict
    catalog.set(PDFName.of('OCProperties'), props)
  }
  let list = props.lookupMaybe(PDFName.of('OCGs'), PDFArray)
  if (!list) {
    list = ctx.obj([]) as PDFArray
    props.set(PDFName.of('OCGs'), list)
  }
  list.push(ocg)
  let d = props.lookupMaybe(PDFName.of('D'), PDFDict)
  if (!d) {
    d = ctx.obj({}) as PDFDict
    props.set(PDFName.of('D'), d)
  }
  let off = d.lookupMaybe(PDFName.of('OFF'), PDFArray)
  if (!off) {
    off = ctx.obj([]) as PDFArray
    d.set(PDFName.of('OFF'), off)
  }
  off.push(ocg)
  // Page: a name for the group in its resources.
  const name = `${HIDE_PREFIX}${Math.random().toString(36).slice(2, 8)}`
  const resources = page.node.normalizedEntries().Resources
  let properties = resources.lookupMaybe(PDFName.of('Properties'), PDFDict)
  if (!properties) {
    properties = ctx.obj({}) as PDFDict
    resources.set(PDFName.of('Properties'), properties)
  }
  properties.set(PDFName.of(name), ocg)
  setPageContent(doc, page, wrapHidden(src, ops, obj, name))
  return doc.save()
}

/** Shows a hidden object again, and removes its group from the document. */
export async function showObject(bytes: Uint8Array, ref: ObjectRef): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false })
  const { page, src, ops, objects } = load(doc, ref.page)
  const { obj } = pick(objects, ref.kind, ref.typeOrdinal)
  if (!obj.hiddenBy) return bytes
  const resources = page.node.normalizedEntries().Resources
  const properties = resources.lookupMaybe(PDFName.of('Properties'), PDFDict)
  const target = properties?.get(PDFName.of(obj.hiddenBy))
  properties?.delete(PDFName.of(obj.hiddenBy))
  if (target instanceof PDFRef) {
    const props = doc.catalog.lookupMaybe(PDFName.of('OCProperties'), PDFDict)
    const drop = (arr: PDFArray | undefined) => {
      if (!arr) return
      for (let i = arr.size() - 1; i >= 0; i--) {
        const item = arr.get(i)
        if (item instanceof PDFRef && item.tag === target.tag) arr.remove(i)
      }
    }
    drop(props?.lookupMaybe(PDFName.of('OCGs'), PDFArray))
    drop(props?.lookupMaybe(PDFName.of('D'), PDFDict)?.lookupMaybe(PDFName.of('OFF'), PDFArray))
  }
  setPageContent(doc, page, unwrapHidden(src, ops, obj))
  return doc.save()
}

/** Moves an object one place later in the drawing order (in front of the next one). */
export async function bringForward(bytes: Uint8Array, ref: ObjectRef): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false })
  const { page, src, ops, objects } = load(doc, ref.page)
  const { obj, at } = pick(objects, ref.kind, ref.typeOrdinal)
  const next = objects[at + 1]
  if (!next) throw new Error('This object is already in front.')
  const r = moveAfter(src, ops, obj, next)
  if ('problem' in r) throw new Error(r.problem)
  setPageContent(doc, page, r.src)
  return doc.save()
}

/** Moves an object one place earlier in the drawing order (behind the previous one). */
export async function sendBackward(bytes: Uint8Array, ref: ObjectRef): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false })
  const { page, src, ops, objects } = load(doc, ref.page)
  const { obj, at } = pick(objects, ref.kind, ref.typeOrdinal)
  const prev = objects[at - 1]
  if (!prev) throw new Error('This object is already at the back.')
  const r = moveAfter(src, ops, prev, obj)
  if ('problem' in r) throw new Error(r.problem)
  setPageContent(doc, page, r.src)
  return doc.save()
}

/** Takes a form (a reusable group of drawing) off the page. */
export async function deleteForm(bytes: Uint8Array, ref: ObjectRef): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false })
  const { page, src, ops, objects } = load(doc, ref.page)
  const { obj } = pick(objects, 'form', ref.typeOrdinal)
  setPageContent(doc, page, removeObjectOps(src, ops, obj))
  return doc.save()
}

/** The fonts a page already uses, for the text format bar. */
export async function pageFontsOf(bytes: Uint8Array, pageIndex: number): Promise<PageFontInfo[]> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false })
  return listPageFonts(doc.getPage(pageIndex))
}
