import { sheetGrid } from '../../shared/printLayout'
import { clampPercent, paperPoints, shouldRotate, type PrintRunOptions } from '../../shared/printPlan'
import { PdfClient } from './pdfClient'
import { renderTileSheet } from './tilePrint'
import { tileLabel, tileSheets, type TileOptions } from '../../shared/tiling'

export interface PrintOptions extends Omit<PrintRunOptions, 'count'> {
  /** 0-based page indices, in print order. */
  pages: number[]
  /** Turn landscape pages a quarter turn so they fill portrait paper (one page per sheet on portrait paper only). */
  autoRotate: boolean
  /** Tile large pages over several sheets (one page per sheet layout only). */
  tile?: TileOptions
}

/** Printable area of a sheet in tiled printing, in points: the paper less the edge a printer cannot reach. */
export function tileArea(paper: PrintRunOptions['paper'], landscape: boolean): { w: number; h: number } {
  const p = paperPoints(paper, landscape)
  return { w: p.w - 36, h: p.h - 36 }
}

/** Print resolution. Capped by pixel count so very large pages stay within memory. */
const DPI = 300
const MAX_PIXELS = 40_000_000

/**
 * Prints `bytes` (pending annotations should already be written into them, so the printout matches a save).
 * Pages are rendered by PDFium in a separate worker one at a time, encoded to PNG and spooled to a temporary
 * folder by the main process, so only one page bitmap is held in memory however long the document is.
 * Resolves to the main process's result: printed, cancelled, or (in the test hook) the PDF it wrote instead.
 */
export async function printDocument(
  bytes: Uint8Array,
  password: string | undefined,
  opts: PrintOptions,
  onProgress: (done: number, total: number) => void,
  signal?: AbortSignal
): Promise<{ ok: boolean; error?: string; pdfPath?: string }> {
  const client = new PdfClient()
  const job = await window.openpdf.printBegin()
  try {
    const sizes = await client.load(bytes, password)
    if (opts.tile) {
      const tile = opts.tile
      const area = tileArea(opts.paper, opts.landscape)
      const pageSizes = opts.pages.map((p) => ({ w: sizes[p].width, h: sizes[p].height }))
      const sheets = tileSheets(pageSizes, area, tile)
      let done = 0
      for (const [k, s] of sheets.entries()) {
        if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
        const label = tileLabel(opts.pages[s.page], s.tile, s.grid)
        const png = await renderTileSheet(client, opts.pages[s.page], pageSizes[s.page], s.tile, area, tile, DPI, label)
        await window.openpdf.printPage(job, k, png, area.w, area.h)
        if (k === sheets.length - 1 || sheets[k + 1].page !== s.page) onProgress(++done, opts.pages.length)
      }
      const { pages: _p, autoRotate: _a, tile: _t, ...runTiled } = opts
      void _p
      void _a
      void _t
      return await window.openpdf.printRun(job, { ...runTiled, layout: { kind: 'single' }, scaling: { kind: 'fit' }, centre: true, count: sheets.length })
    }
    for (let n = 0; n < opts.pages.length; n++) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
      const size = sizes[opts.pages[n]]
      // Pages printed several to a sheet come out smaller, so they need fewer pixels.
      const { cols } = sheetGrid(opts.layout)
      // Pages enlarged on paper are rendered finer so they stay sharp.
      const zoomed = opts.layout.kind === 'single' && opts.scaling.kind === 'custom' ? Math.max(1, clampPercent(opts.scaling.percent) / 100) : 1
      const scale = Math.min((DPI / 72 / cols) * zoomed,Math.sqrt(MAX_PIXELS / (size.width * size.height)))
      const out = await client.render(opts.pages[n], scale)
      const turn = shouldRotate(opts.autoRotate, opts.layout, opts.landscape) && size.width > size.height
      const png = await encodePng(out.width, out.height, out.data, turn)
      await window.openpdf.printPage(job, n, png, turn ? size.height : size.width, turn ? size.width : size.height)
      onProgress(n + 1, opts.pages.length)
    }
    const { pages, autoRotate: _rotate, tile: _tile, ...run } = opts
    void _tile
    void _rotate
    return await window.openpdf.printRun(job, { ...run, count: pages.length })
  } catch (e) {
    await window.openpdf.printCancel(job)
    if (e instanceof DOMException && e.name === 'AbortError') return { ok: false }
    throw e
  } finally {
    client.dispose()
  }
}

/** PNG of an RGBA bitmap turned by a multiple of 90 degrees clockwise. */
export async function encodeRotatedPng(w: number, h: number, rgba: Uint8Array, degrees: 0 | 90 | 180 | 270): Promise<Uint8Array> {
  const src = new OffscreenCanvas(w, h)
  src.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(rgba.buffer as ArrayBuffer, rgba.byteOffset, rgba.byteLength), w, h), 0, 0)
  const turned = degrees === 90 || degrees === 270
  const out = degrees ? new OffscreenCanvas(turned ? h : w, turned ? w : h) : src
  if (degrees) {
    const ctx = out.getContext('2d')!
    ctx.translate(out.width / 2, out.height / 2)
    ctx.rotate((degrees * Math.PI) / 180)
    ctx.drawImage(src, -w / 2, -h / 2)
  }
  const blob = await out.convertToBlob({ type: 'image/png' })
  return new Uint8Array(await blob.arrayBuffer())
}

async function encodePng(w: number, h: number, rgba: Uint8Array, turn: boolean): Promise<Uint8Array> {
  const src = new OffscreenCanvas(w, h)
  src.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(rgba.buffer as ArrayBuffer, rgba.byteOffset, rgba.byteLength), w, h), 0, 0)
  let canvas = src
  if (turn) {
    // A quarter turn clockwise: the top of the page ends up on the right-hand edge of the paper.
    canvas = new OffscreenCanvas(h, w)
    const ctx = canvas.getContext('2d')!
    ctx.translate(h, 0)
    ctx.rotate(Math.PI / 2)
    ctx.drawImage(src, 0, 0)
    src.width = 0
  }
  const blob = await canvas.convertToBlob({ type: 'image/png' })
  canvas.width = 0
  return new Uint8Array(await blob.arrayBuffer())
}
