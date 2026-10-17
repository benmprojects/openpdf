/** Drawing one sheet of a tiled printout: the part of the page the tile covers, with cut marks and a label. */
import type { Tile, TileOptions } from '../../shared/tiling'
import type { PdfClient } from './pdfClient'

export interface SheetGeometry {
  /** PDFium render scale (pixels per page point). */
  scale: number
  /** The region of the page, in pixels at that scale, that this sheet shows. */
  x: number
  y: number
  w: number
  h: number
  /** How much of the region the page itself fills, in pixels (the rest is past the page edge). */
  pageW: number
  pageH: number
}

/** Pixel geometry of one tile sheet. `area` is the printable area in points; `dpi` the print resolution. */
export function sheetGeometry(page: { w: number; h: number }, tile: Tile, area: { w: number; h: number }, scalePct: number, dpi: number): SheetGeometry {
  const scale = (dpi / 72) * (scalePct / 100)
  const x = Math.round(tile.x * scale)
  const y = Math.round(tile.y * scale)
  const w = Math.max(1, Math.round((area.w * dpi) / 72))
  const h = Math.max(1, Math.round((area.h * dpi) / 72))
  return { scale, x, y, w, h, pageW: Math.max(0, Math.min(w, Math.round(page.w * scale) - x)), pageH: Math.max(0, Math.min(h, Math.round(page.h * scale) - y)) }
}

/** The PNG of one sheet. */
export async function renderTileSheet(
  client: PdfClient,
  pageIndex: number,
  page: { w: number; h: number },
  tile: Tile,
  area: { w: number; h: number },
  opts: TileOptions,
  dpi: number,
  label: string
): Promise<Uint8Array> {
  const g = sheetGeometry(page, tile, area, opts.scalePct, dpi)
  const out = await client.render(pageIndex, g.scale, { region: { x: g.x, y: g.y, w: g.w, h: g.h } })
  const canvas = new OffscreenCanvas(g.w, g.h)
  const ctx = canvas.getContext('2d')!
  ctx.putImageData(new ImageData(new Uint8ClampedArray(out.data.buffer as ArrayBuffer, out.data.byteOffset, out.data.byteLength), out.width, out.height), 0, 0)
  const pt = dpi / 72
  if (opts.marks && g.pageW > 0 && g.pageH > 0) {
    // L-shaped marks inside each corner of the part of the page on this sheet: cut along them to trim to the tile.
    const len = (dpi / 25.4) * 5
    ctx.strokeStyle = '#000'
    ctx.lineWidth = Math.max(2, pt * 0.6)
    const x0 = 0
    const y0 = 0
    const x1 = g.pageW
    const y1 = g.pageH
    ctx.beginPath()
    for (const [cx, cy, sx, sy] of [
      [x0, y0, 1, 1],
      [x1, y0, -1, 1],
      [x0, y1, 1, -1],
      [x1, y1, -1, -1]
    ] as const) {
      ctx.moveTo(cx + sx * len, cy)
      ctx.lineTo(cx, cy)
      ctx.lineTo(cx, cy + sy * len)
    }
    ctx.stroke()
  }
  if (opts.labels) {
    const size = 8 * pt
    ctx.font = `${size}px sans-serif`
    const pad = 3 * pt
    const width = ctx.measureText(label).width
    const lx = Math.min(g.w - width - 2 * pad, (dpi / 25.4) * 6)
    const ly = g.h - (dpi / 25.4) * 6
    ctx.fillStyle = 'rgba(255,255,255,0.92)'
    ctx.fillRect(lx, ly - size - pad, width + 2 * pad, size + 2 * pad)
    ctx.fillStyle = '#000'
    ctx.fillText(label, lx + pad, ly)
  }
  const blob = await canvas.convertToBlob({ type: 'image/png' })
  canvas.width = 0
  return new Uint8Array(await blob.arrayBuffer())
}
