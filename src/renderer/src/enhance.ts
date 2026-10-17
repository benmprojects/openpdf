/** Clean-up steps for a rendered page (RGBA pixels): straighten, remove specks, crop to the content. Pure; see scanImage.ts. */
import { autoCrop, deskew, despeckle, type Bitmap } from './scanImage'

export interface EnhanceSteps {
  deskew?: boolean
  despeckle?: boolean
  autoCrop?: boolean
}

/** The pixels after the chosen steps (in the order straighten, remove specks, crop), possibly of another size. */
export function enhanceRgba(rgba: Uint8Array, width: number, height: number, dpi: number, steps: EnhanceSteps): { data: Uint8Array; width: number; height: number } {
  let img: Bitmap = { width, height, data: new Uint8ClampedArray(rgba.buffer as ArrayBuffer, rgba.byteOffset, rgba.byteLength) }
  if (steps.deskew) img = deskew(img)
  if (steps.despeckle) img = despeckle(img, Math.max(2, Math.round(6 * (dpi / 300) ** 2)))
  if (steps.autoCrop) img = autoCrop(img)
  return { data: new Uint8Array(img.data.buffer as ArrayBuffer, img.data.byteOffset, img.data.byteLength), width: img.width, height: img.height }
}
