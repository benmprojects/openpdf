/** Applies the scan clean-up steps to a PNG: decodes it, runs the pure image functions, and encodes a PNG again. */
import { encodeRotatedPng } from './print'
import { autoCrop, deskew, despeckle, type Bitmap } from './scanImage'

export interface ScanSteps {
  deskew?: boolean
  despeckle?: boolean
  autoCrop?: boolean
}

/** The picture with the chosen steps applied, in the order straighten, remove specks, crop. Unchanged when no step is chosen. */
export async function processScan(png: Uint8Array, steps: ScanSteps, dpi: number): Promise<Uint8Array> {
  if (!steps.deskew && !steps.despeckle && !steps.autoCrop) return png
  const bitmap = await createImageBitmap(new Blob([png as BlobPart], { type: 'image/png' }))
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(bitmap, 0, 0)
  bitmap.close()
  const raw = ctx.getImageData(0, 0, canvas.width, canvas.height)
  let img: Bitmap = { width: raw.width, height: raw.height, data: raw.data }
  if (steps.deskew) img = deskew(img)
  if (steps.despeckle) img = despeckle(img, Math.max(2, Math.round(6 * (dpi / 300) ** 2)))
  if (steps.autoCrop) img = autoCrop(img)
  if (img.data === raw.data) return png
  return encodeRotatedPng(img.width, img.height, new Uint8Array(img.data.buffer, img.data.byteOffset, img.data.byteLength), 0)
}
