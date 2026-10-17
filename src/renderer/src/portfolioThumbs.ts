/** Pictures of the first page of the PDFs in a portfolio, drawn with a private PDFium worker that is stopped again afterwards. */
import { PdfClient } from './pdfClient'
import type { FileThumb } from './portfolio'

/** RGBA to RGB, laid over white (the page is drawn on white, so this only matters for transparent pixels). */
export function rgbaToRgb(rgba: Uint8Array | Uint8ClampedArray, width: number, height: number): Uint8Array {
  const out = new Uint8Array(width * height * 3)
  for (let i = 0, o = 0; i < width * height * 4; i += 4, o += 3) {
    const a = rgba[i + 3] / 255
    out[o] = Math.round(rgba[i] * a + 255 * (1 - a))
    out[o + 1] = Math.round(rgba[i + 1] * a + 255 * (1 - a))
    out[o + 2] = Math.round(rgba[i + 2] * a + 255 * (1 - a))
  }
  return out
}

export interface FirstPage {
  width: number
  height: number
  /** How many pages the file has. */
  pages: number
  rgba: Uint8Array
}

/** The first page of a PDF at the given pixel width, or null when the file cannot be read as one. */
export async function renderFirstPage(data: Uint8Array, width: number): Promise<FirstPage | null> {
  const client = new PdfClient()
  try {
    const pages = await client.load(data)
    if (!pages.length) return null
    const out = await client.render(0, width / pages[0].width)
    return { width: out.width, height: out.height, pages: pages.length, rgba: out.data }
  } catch {
    return null
  } finally {
    client.dispose()
  }
}

/** A thumbnail for a portfolio entry (null for a file that is not a readable PDF). */
export async function thumbnailOf(name: string, data: Uint8Array, width = 96): Promise<FileThumb | null> {
  if (!/\.pdf$/i.test(name)) return null
  const page = await renderFirstPage(data, width)
  return page ? { width: page.width, height: page.height, rgb: rgbaToRgb(page.rgba, page.width, page.height) } : null
}

/** A thumbnail as a data address for an image element. */
export function thumbToDataUrl(thumb: FileThumb): string {
  const cv = document.createElement('canvas')
  cv.width = thumb.width
  cv.height = thumb.height
  const rgba = new Uint8ClampedArray(thumb.width * thumb.height * 4)
  for (let i = 0, o = 0; i < thumb.rgb.length; i += 3, o += 4) {
    rgba[o] = thumb.rgb[i]
    rgba[o + 1] = thumb.rgb[i + 1]
    rgba[o + 2] = thumb.rgb[i + 2]
    rgba[o + 3] = 255
  }
  cv.getContext('2d')?.putImageData(new ImageData(rgba, thumb.width, thumb.height), 0, 0)
  return cv.toDataURL('image/png')
}

/** Thumbnails are drawn one at a time (each needs its own PDFium worker), and kept for the session. */
let queue: Promise<unknown> = Promise.resolve()
const cache = new Map<string, Promise<string | null>>()

/** A data address for the first page of an embedded PDF, drawn in turn with the others; null when it cannot be drawn. */
export function thumbnailUrl(key: string, name: string, getData: () => Promise<Uint8Array>, width = 120): Promise<string | null> {
  let p = cache.get(key)
  if (!p) {
    p = new Promise<string | null>((resolve) => {
      queue = queue.then(async () => {
        try {
          const th = await thumbnailOf(name, await getData(), width)
          resolve(th ? thumbToDataUrl(th) : null)
        } catch {
          resolve(null)
        }
      })
    })
    cache.set(key, p)
  }
  return p
}
