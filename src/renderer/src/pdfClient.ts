import type { WorkerRequest, WorkerResponse } from './pdf.worker'
import type { OutlineNode, PageText } from './pdfiumRaw'

export type { OutlineNode, PageText }

export interface PageSize {
  width: number
  height: number
}
export interface RenderedPage {
  width: number
  height: number
  data: Uint8Array
}

export interface RenderOptions {
  /** Lower runs first. Page views use 0, thumbnails 1. */
  priority?: number
  /** Aborting drops the request if it has not started, and rejects either way. */
  signal?: AbortSignal
}

type Distribute<T> = T extends unknown ? Omit<T, 'id'> : never

interface QueuedRender {
  page: number
  scale: number
  priority: number
  seq: number
  signal?: AbortSignal
  resolve: (r: RenderedPage) => void
  reject: (e: Error) => void
}

const MAX_IN_FLIGHT = 2

/** Talks to the PDFium worker. One client per open document. */
export class PdfClient {
  private worker = new Worker(new URL('./pdf.worker.ts', import.meta.url), { type: 'module' })
  private nextId = 1
  private pending = new Map<number, { resolve: (r: WorkerResponse) => void; reject: (e: Error) => void }>()
  private queue: QueuedRender[] = []
  private inFlight = 0
  private seq = 0
  private textCache = new Map<number, Promise<PageText>>()

  constructor() {
    this.worker.onmessage = (ev: MessageEvent<WorkerResponse>) => {
      const p = this.pending.get(ev.data.id)
      if (!p) return
      this.pending.delete(ev.data.id)
      if (ev.data.ok) p.resolve(ev.data)
      else p.reject(new Error(ev.data.error))
    }
  }

  private call(req: Distribute<WorkerRequest>, transfer: Transferable[] = []): Promise<WorkerResponse> {
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.worker.postMessage({ ...req, id }, transfer)
    })
  }

  async load(data: Uint8Array, password?: string): Promise<PageSize[]> {
    const copy = data.slice()
    const res = await this.call({ type: 'load', data: copy, password }, [copy.buffer])
    if (res.ok && res.type === 'load') return res.pages
    throw new Error('Unexpected response')
  }

  /**
   * Renders a page to RGBA. Requests wait in a client-side queue so that pages scrolled past can be
   * aborted before the worker spends time on them; newest request of the same priority runs first.
   */
  render(page: number, scale: number, opts: RenderOptions = {}): Promise<RenderedPage> {
    return new Promise((resolve, reject) => {
      if (opts.signal?.aborted) return reject(new DOMException('Aborted', 'AbortError'))
      this.queue.push({ page, scale, priority: opts.priority ?? 0, seq: this.seq++, signal: opts.signal, resolve, reject })
      this.pump()
    })
  }

  private pump(): void {
    while (this.inFlight < MAX_IN_FLIGHT && this.queue.length) {
      this.queue = this.queue.filter((q) => {
        if (!q.signal?.aborted) return true
        q.reject(new DOMException('Aborted', 'AbortError'))
        return false
      })
      if (!this.queue.length) return
      let bestIdx = 0
      for (let i = 1; i < this.queue.length; i++) {
        const a = this.queue[i]
        const b = this.queue[bestIdx]
        if (a.priority < b.priority || (a.priority === b.priority && a.seq > b.seq)) bestIdx = i
      }
      const job = this.queue.splice(bestIdx, 1)[0]
      this.inFlight++
      this.call({ type: 'render', page: job.page, scale: job.scale })
        .then((res) => {
          if (job.signal?.aborted) job.reject(new DOMException('Aborted', 'AbortError'))
          else if (res.ok && res.type === 'render') job.resolve(res)
          else job.reject(new Error('Unexpected response'))
        })
        .catch(job.reject)
        .finally(() => {
          this.inFlight--
          this.pump()
        })
    }
  }

  async outline(): Promise<OutlineNode[]> {
    const res = await this.call({ type: 'outline' })
    if (res.ok && res.type === 'outline') return res.outline
    throw new Error('Unexpected response')
  }

  /** Text and character boxes for a page. Cached; the cache lives as long as the client. */
  pageText(page: number): Promise<PageText> {
    let p = this.textCache.get(page)
    if (!p) {
      p = this.call({ type: 'text', page }).then((res) => {
        if (res.ok && res.type === 'text') return { text: res.text, boxes: res.boxes, charOf: res.charOf }
        throw new Error('Unexpected response')
      })
      p.catch(() => this.textCache.delete(page))
      this.textCache.set(page, p)
    }
    return p
  }

  dispose(): void {
    this.worker.terminate()
    const closed = new Error('Closed')
    this.pending.forEach((p) => p.reject(closed))
    this.pending.clear()
    this.queue.forEach((q) => q.reject(closed))
    this.queue = []
  }
}
