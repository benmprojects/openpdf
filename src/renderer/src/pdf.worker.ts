import { PDFiumLibrary, type PDFiumDocument } from '@hyzyla/pdfium'
import wasmUrl from '@hyzyla/pdfium/pdfium.wasm?url'
import {
  readOutline,
  readPageAnnots,
  readPageText,
  removePageAnnot,
  renderRegion,
  type ImportedAnnot,
  type OutlineNode,
  type PageText
} from './pdfiumRaw'

export type WorkerRequest =
  | { id: number; type: 'load'; data: Uint8Array; password?: string }
  | { id: number; type: 'render'; page: number; scale: number }
  | { id: number; type: 'renderRegion'; page: number; scale: number; x: number; y: number; w: number; h: number }
  | { id: number; type: 'outline' }
  | { id: number; type: 'text'; page: number }
  | { id: number; type: 'annots' }
  | { id: number; type: 'hideAnnot'; page: number; index: number; subtype: number }
  | { id: number; type: 'close' }

export type WorkerResponse =
  | { id: number; ok: true; type: 'load'; pages: { width: number; height: number }[] }
  | { id: number; ok: true; type: 'render'; width: number; height: number; data: Uint8Array }
  | { id: number; ok: true; type: 'outline'; outline: OutlineNode[] }
  | ({ id: number; ok: true; type: 'text' } & PageText)
  | { id: number; ok: true; type: 'annots'; pages: { page: number; annots: ImportedAnnot[] }[] }
  | { id: number; ok: true; type: 'hideAnnot'; hidden: boolean }
  | { id: number; ok: true; type: 'close' }
  | { id: number; ok: false; error: string }

let library: PDFiumLibrary | null = null
let doc: PDFiumDocument | null = null
/** Per page, the original indices of annotations hidden from rendering. */
let hidden = new Map<number, number[]>()

async function getLibrary(): Promise<PDFiumLibrary> {
  library ??= await PDFiumLibrary.init({ wasmUrl })
  return library
}

function closeDoc(): void {
  doc?.destroy()
  doc = null
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
      const out = await page.render({ scale: msg.scale, render: 'bitmap', renderFormFields: true })
      page.close()
      reply({ id: msg.id, ok: true, type: 'render', width: out.width, height: out.height, data: out.data }, [
        out.data.buffer as ArrayBuffer
      ])
    } else if (msg.type === 'renderRegion') {
      if (!doc || !library) throw new Error('No document loaded')
      const page = doc.getPage(msg.page)
      const data = renderRegion(library, doc, page, msg.scale, msg.x, msg.y, msg.w, msg.h)
      page.close()
      reply({ id: msg.id, ok: true, type: 'render', width: msg.w, height: msg.h, data }, [data.buffer as ArrayBuffer])
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
      const pages: { page: number; annots: ImportedAnnot[] }[] = []
      for (let i = 0; i < doc.getPageCount(); i++) {
        const page = doc.getPage(i)
        const annots = readPageAnnots(library, page)
        page.close()
        if (annots.length) pages.push({ page: i, annots })
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
    } else {
      closeDoc()
      reply({ id: msg.id, ok: true, type: 'close' })
    }
  } catch (e) {
    reply({ id: msg.id, ok: false, error: e instanceof Error ? e.message : String(e) })
  }
}
