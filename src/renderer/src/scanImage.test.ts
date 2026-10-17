import { describe, expect, it } from 'vitest'
import { autoCrop, contentBox, deskew, despeckle, estimateSkew, rotateImage, type Bitmap } from './scanImage'

function blank(width: number, height: number): Bitmap {
  return { width, height, data: new Uint8ClampedArray(width * height * 4).fill(255) }
}

function fill(img: Bitmap, x: number, y: number, w: number, h: number, v = 0) {
  for (let yy = y; yy < y + h; yy++) {
    for (let xx = x; xx < x + w; xx++) {
      const o = (yy * img.width + xx) * 4
      img.data[o] = img.data[o + 1] = img.data[o + 2] = v
    }
  }
}

/** A page of text-like lines: rows of short bars (words) with gaps. */
function textPage(width = 600, height = 800): Bitmap {
  const img = blank(width, height)
  let seed = 7
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)
  for (let y = 100; y < height - 100; y += 28) {
    let x = 80
    while (x < width - 80) {
      const w = 10 + Math.floor(rnd() * 40)
      fill(img, x, y, Math.min(w, width - 80 - x), 8)
      x += w + 8
    }
  }
  return img
}

const dark = (img: Bitmap, x: number, y: number) => img.data[(y * img.width + x) * 4] < 128

describe('estimateSkew', () => {
  it('finds a known turn', () => {
    const page = textPage()
    for (const a of [3, -2.4, 6.5]) {
      expect(Math.abs(estimateSkew(rotateImage(page, a)) - a)).toBeLessThan(0.5)
    }
  })

  it('says 0 for a level page', () => {
    expect(estimateSkew(textPage())).toBe(0)
  })

  it('says 0 for a blank page and for a page with almost nothing on it', () => {
    expect(estimateSkew(blank(600, 800))).toBe(0)
    const few = blank(600, 800)
    fill(few, 300, 400, 5, 5)
    expect(estimateSkew(few)).toBe(0)
  })

  it('is level again after deskew', () => {
    const turned = rotateImage(textPage(), 3)
    expect(Math.abs(estimateSkew(deskew(turned)))).toBeLessThan(0.3)
  })

  it('is fast enough for an A4 page at 300 dpi', () => {
    const big = blank(2480, 3508)
    for (let y = 300; y < 3200; y += 90) fill(big, 250, y, 1900, 26)
    const start = Date.now()
    estimateSkew(big)
    expect(Date.now() - start).toBeLessThan(5000)
  })
})

describe('rotateImage', () => {
  it('keeps the size and fills the corners white', () => {
    const img = blank(100, 60)
    fill(img, 0, 0, 100, 60)
    const out = rotateImage(img, 10)
    expect([out.width, out.height]).toEqual([100, 60])
    expect(out.data[0]).toBe(255)
    expect(dark(out, 50, 30)).toBe(true)
  })
})

describe('despeckle', () => {
  it('removes specks and keeps a larger blob', () => {
    const img = blank(100, 100)
    fill(img, 10, 10, 2, 2)
    fill(img, 30, 70, 1, 1)
    fill(img, 50, 50, 20, 20)
    const out = despeckle(img, 4)
    expect(dark(out, 10, 10)).toBe(false)
    expect(dark(out, 30, 70)).toBe(false)
    expect(dark(out, 60, 60)).toBe(true)
    expect(dark(out, 50, 50)).toBe(true)
  })

  it('returns the same bitmap when there is nothing to remove', () => {
    const img = blank(50, 50)
    fill(img, 10, 10, 10, 10)
    expect(despeckle(img)).toBe(img)
  })
})

describe('autoCrop', () => {
  it('crops to the content with a margin', () => {
    const img = blank(400, 400)
    fill(img, 100, 150, 100, 50)
    const box = contentBox(img, 10)!
    expect(box).toEqual({ x: 90, y: 140, width: 120, height: 70 })
    const out = autoCrop(img, 10)
    expect([out.width, out.height]).toEqual([120, 70])
    expect(dark(out, 10, 10)).toBe(true)
  })

  it('leaves a blank page alone', () => {
    const img = blank(300, 300)
    expect(autoCrop(img)).toBe(img)
  })

  it('leaves a page alone when the content fills it', () => {
    const img = blank(300, 300)
    fill(img, 5, 5, 290, 290)
    expect(autoCrop(img)).toBe(img)
  })

  it('ignores a stray pixel', () => {
    const img = blank(400, 400)
    fill(img, 100, 100, 50, 50)
    fill(img, 390, 390, 1, 1)
    const box = contentBox(img, 0)!
    expect(box).toEqual({ x: 100, y: 100, width: 50, height: 50 })
  })
})
