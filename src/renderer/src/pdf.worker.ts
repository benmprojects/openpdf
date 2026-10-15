import { PDFiumLibrary, type PDFiumDocument } from '@hyzyla/pdfium'
import wasmUrl from '@hyzyla/pdfium/pdfium.wasm?url'
import { annotDicts } from './annotExtras'
import {
  readAttachmentData,
  readAttachments,
  readOutline,
  readPageLabels,
  readPageLinks,
  readPageAnnots,
  readPageText,
  readTextObjects,
  readImageObjects,
  readPathObjects,
  removePageAnnot,
  setPageAnnotRect,
  renderRegion,
  type AttachmentInfo,
  type ImportedAnnot,
  type ImportedReply,
  type PageLink,
  type OutlineNode,
  type PageText,
  type TextObject,
  type ImageObject
} from './pdfiumRaw'

export type WorkerRequest =
  | { id: number; type: 'load'; data: Uint8Array; password?: string }
  | { id: number; type: 'render'; page: number; scale: number; forms?: boolean }
  | { id: number; type: 'renderRegion'; page: number; scale: number; x: number; y: number; w: number; h: number; forms?: boolean }
  | { id: number; type: 'outline' }
  | { id: number; type: 'text'; page: number }
  | { id: number; type: 'annots' }
  | { id: number; type: 'hideAnnot'; page: number; index: number; subtype: number }
  | { id: number; type: 'setAnnotRect'; page: number; index: number; subtype: number; rect: { x: number; y: number; w: number; h: number } }
  | { id: number; type: 'attachments' }
  | { id: number; type: 'attachmentData'; index: number; page?: number }
  | { id: number; type: 'labels' }
  | { id: number; type: 'links'; page: number }
  | { id: number; type: 'textObjects'; page: number }
  | { id: number; type: 'imageObjects'; page: number }
  | { id: number; type: 'pathObjects'; page: number }
  | { id: number; type: 'close' }

export type WorkerResponse =
  | { id: number; ok: true; type: 'load'; pages: { width: number; height: number }[] }
  | { id: number; ok: true; type: 'render'; width: number; height: number; data: Uint8Array }
  | { id: number; ok: true; type: 'outline'; outline: OutlineNode[] }
  | ({ id: number; ok: true; type: 'text' } & PageText)
  | { id: number; ok: true; type: 'annots'; pages: { page: number; annots: ImportedAnnot[]; replies: ImportedReply[] }[] }
  | { id: number; ok: true; type: 'hideAnnot'; hidden: boolean }
  | { id: number; ok: true; type: 'setAnnotRect'; done: boolean }
  | { id: number; ok: true; type: 'attachments'; attachments: AttachmentInfo[] }
  | { id: number; ok: true; type: 'attachmentData'; data: Uint8Array }
  | { id: number; ok: true; type: 'labels'; labels: string[] }
  | { id: number; ok: true; type: 'links'; links: PageLink[] }
  | { id: number; ok: true; type: 'textObjects'; objects: TextObject[]; total: number; rotation: number }
  | { id: number; ok: true; type: 'imageObjects'; objects: ImageObject[]; total: number; toPage: [number, number, number, number, number, number] }
  | { id: number; ok: true; type: 'pathObjects'; objects: ImageObject[]; total: number; toPage: [number, number, number, number, number, number] }
  | { id: number; ok: true; type: 'close' }
  | { id: number; ok: false; error: string }

let library: PDFiumLibrary | null = null
let doc: PDFiumDocument | null = null
/** The loaded bytes (unless password protected), for reading annotation details with pdf-lib. */
let docBytes: Uint8Array | null = null
/** Per page, the original indices of annotations hidden from rendering. */
let hidden = new Map<number, number[]>()

async function getLibrary(): Promise<PDFiumLibrary> {
  library ??= await PDFiumLibrary.init({ wasmUrl })
  return library
}

function closeDoc(): void {
  doc?.destroy()
  doc = null
  docBytes = null
  hidden = new Map()
}

function reply(res: WorkerResponse, transfer: Transferable[] = []): void {
  ;(self as unknown as Worker).postMessage(res, transfer)
}

self.onmessage = async (ev: MessageEvent<WorkerRequest>) => {
  const msg = ev.data
  try {
    if (msg.type === 'load') {
      closeDoc()
      const lib = await getLibrary()
      doc = await lib.loadDocument(msg.data, msg.password)
      docBytes = msg.password ? null : msg.data
      const pages: { width: number; height: number }[] = []
      for (let i = 0; i < doc.getPageCount(); i++) {
        const page = doc.getPage(i)
        const { originalWidth, originalHeight } = page.getOriginalSize()
        pages.push({ width: originalWidth, height: originalHeight })
        page.close()
      }
      reply({ id: msg.id, ok: true, type: 'load', pages })
    } else if (msg.type === 'render') {
      if (!doc) throw new Error('No document loaded')
      const page = doc.getPage(msg.page)
      const out = await page.render({ scale: msg.scale, render: 'bitmap', renderFormFields: msg.forms !== false })
      page.close()
      reply({ id: msg.id, ok: true, type: 'render', width: out.width, height: out.height, data: out.data }, [
        out.data.buffer as ArrayBuffer
      ])
    } else if (msg.type === 'renderRegion') {
      if (!doc || !library) throw new Error('No document loaded')
      const page = doc.getPage(msg.page)
      const data = renderRegion(library, doc, page, msg.scale, msg.x, msg.y, msg.w, msg.h, msg.forms !== false)
      page.close()
      reply({ id: msg.id, ok: true, type: 'render', width: msg.w, height: msg.h, data }, [data.buffer as ArrayBuffer])
    } else if (msg.type === 'attachments') {
      if (!doc || !library) throw new Error('No document loaded')
      reply({ id: msg.id, ok: true, type: 'attachments', attachments: readAttachments(library, doc) })
    } else if (msg.type === 'attachmentData') {
      if (!doc || !library) throw new Error('No document loaded')
      const data = readAttachmentData(library, doc, msg.index, msg.page)
      reply({ id: msg.id, ok: true, type: 'attachmentData', data }, [data.buffer as ArrayBuffer])
    } else if (msg.type === 'links') {
      if (!doc || !library) throw new Error('No document loaded')
      const page = doc.getPage(msg.page)
      const links = readPageLinks(library, doc, page)
      page.close()
      reply({ id: msg.id, ok: true, type: 'links', links })
    } else if (msg.type === 'textObjects') {
      if (!doc || !library) throw new Error('No document loaded')
      const page = doc.getPage(msg.page)
      const { objects, total, rotation } = readTextObjects(library, page)
      page.close()
      reply({ id: msg.id, ok: true, type: 'textObjects', objects, total, rotation })
    } else if (msg.type === 'imageObjects') {
      if (!doc || !library) throw new Error('No document loaded')
      const page = doc.getPage(msg.page)
      const r = readImageObjects(library, page)
      page.close()
      reply({ id: msg.id, ok: true, type: 'imageObjects', ...r })
    } else if (msg.type === 'pathObjects') {
      if (!doc || !library) throw new Error('No document loaded')
      const page = doc.getPage(msg.page)
      const r = readPathObjects(library, page)
      page.close()
      reply({ id: msg.id, ok: true, type: 'pathObjects', ...r })
    } else if (msg.type === 'labels') {
      if (!doc || !library) throw new Error('No document loaded')
      reply({ id: msg.id, ok: true, type: 'labels', labels: readPageLabels(library, doc) })
    } else if (msg.type === 'outline') {
      if (!doc || !library) throw new Error('No document loaded')
      reply({ id: msg.id, ok: true, type: 'outline', outline: readOutline(library, doc) })
    } else if (msg.type === 'text') {
      if (!doc || !library) throw new Error('No document loaded')
      const page = doc.getPage(msg.page)
      const t = readPageText(library, page)
      page.close()
      reply({ id: msg.id, ok: true, type: 'text', ...t }, [t.boxes.buffer as ArrayBuffer, t.charOf.buffer as ArrayBuffer])
    } else if (msg.type === 'annots') {
      if (!doc || !library) throw new Error('No document loaded')
      const pages: { page: number; annots: ImportedAnnot[]; replies: ImportedReply[] }[] = []
      const dicts = docBytes ? await annotDicts(docBytes) : null
      for (let i = 0; i < doc.getPageCount(); i++) {
        const page = doc.getPage(i)
        const { annots, replies } = readPageAnnots(library, page, dicts?.[i])
        page.close()
        if (annots.length || replies.length) pages.push({ page: i, annots, replies })
      }
      reply({ id: msg.id, ok: true, type: 'annots', pages })
    } else if (msg.type === 'hideAnnot') {
      if (!doc || !library) throw new Error('No document loaded')
      const gone = hidden.get(msg.page) ?? []
      if (gone.includes(msg.index)) {
        reply({ id: msg.id, ok: true, type: 'hideAnnot', hidden: true })
      } else {
        const page = doc.getPage(msg.page)
        const ok = removePageAnnot(library, page, msg.index, msg.subtype, gone.filter((i) => i < msg.index).length)
        page.close()
        if (ok) hidden.set(msg.page, [...gone, msg.index])
        reply({ id: msg.id, ok: true, type: 'hideAnnot', hidden: ok })
      }
    } else if (msg.type === 'setAnnotRect') {
      if (!doc || !library) throw new Error('No document loaded')
      const gone = hidden.get(msg.page) ?? []
      const page = doc.getPage(msg.page)
      const done = setPageAnnotRect(library, page, msg.index - gone.filter((i) => i < msg.index).length, msg.subtype, msg.rect)
      page.close()
      reply({ id: msg.id, ok: true, type: 'setAnnotRect', done })
    } else {
      closeDoc()
      reply({ id: msg.id, ok: true, type: 'close' })
    }
  } catch (e) {
    reply({ id: msg.id, ok: false, error: e instanceof Error ? e.message : String(e) })
  }
}
