/**
 * Exporting a document to other formats: page images (PNG, JPEG, TIFF), plain text, HTML and Word. Text formats are
 * best effort: paragraphs and headings are found from the text's positions and sizes (see `textBlocks`), pictures and
 * page layout are not carried over.
 */
import UTIF from 'utif'
import type { TextBlock } from './textBlocks'

export type ImageFormat = 'png' | 'jpg' | 'tiff'

/** RGBA pixels as an image file. JPEG is drawn on white, since it cannot hold transparency. */
export async function encodePage(rgba: Uint8Array, w: number, h: number, format: ImageFormat, quality = 0.92): Promise<Uint8Array> {
  if (format === 'tiff') {
    const px = new Uint8Array(rgba.buffer.slice(rgba.byteOffset, rgba.byteOffset + rgba.byteLength) as ArrayBuffer)
    return new Uint8Array(UTIF.encodeImage(px, w, h))
  }
  const canvas = new OffscreenCanvas(w, h)
  const ctx = canvas.getContext('2d')!
  if (format === 'jpg') {
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, w, h)
    const src = new OffscreenCanvas(w, h)
    src.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(rgba.buffer as ArrayBuffer, rgba.byteOffset, rgba.byteLength), w, h), 0, 0)
    ctx.drawImage(src, 0, 0)
  } else ctx.putImageData(new ImageData(new Uint8ClampedArray(rgba.buffer as ArrayBuffer, rgba.byteOffset, rgba.byteLength), w, h), 0, 0)
  const blob = await canvas.convertToBlob(format === 'jpg' ? { type: 'image/jpeg', quality } : { type: 'image/png' })
  return new Uint8Array(await blob.arrayBuffer())
}

/** The file name of a page image: stem-page-001.png, with the number padded to the page count. */
export function pageFileName(stem: string, page: number, count: number, format: ImageFormat): string {
  const width = Math.max(3, String(count).length)
  return `${stem}-page-${String(page + 1).padStart(width, '0')}.${format === 'jpg' ? 'jpg' : format}`
}

/** A render scale for `dpi`, kept so that the bitmap stays under about 60 million pixels. */
export function scaleFor(dpi: number, widthPt: number, heightPt: number): number {
  return Math.min(dpi / 72, Math.sqrt(60_000_000 / (widthPt * heightPt)))
}

// ---- Structure ---------------------------------------------------------------------------------------

export interface ExportBlock {
  text: string
  /** 1 to 3 for a heading, 0 for a paragraph. */
  heading: 0 | 1 | 2 | 3
  /** Point size and style, for Word. */
  size: number
  bold: boolean
  italic: boolean
}

const isBold = (b: TextBlock) => b.weight >= 600 || /bold|black|heavy/i.test(b.font)

/** The size most text on the page is set in, by number of characters (rounded to half a point). */
export function bodySize(pages: TextBlock[][]): number {
  const count = new Map<number, number>()
  for (const p of pages) for (const b of p) count.set(Math.round(b.size * 2) / 2, (count.get(Math.round(b.size * 2) / 2) ?? 0) + b.text.length)
  let best = 12
  let most = -1
  for (const [size, n] of count) if (n > most) [best, most] = [size, n]
  return best
}

/** One page's blocks in reading order (top to bottom, left to right within a line), with headings found by size. */
export function structurePage(blocks: TextBlock[], body: number): ExportBlock[] {
  const sorted = [...blocks].filter((b) => b.text.trim()).sort((a, b) => (Math.abs(a.rect.y - b.rect.y) < Math.min(a.size, b.size) * 0.5 ? a.rect.x - b.rect.x : a.rect.y - b.rect.y))
  const out: ExportBlock[] = []
  let prev: TextBlock | null = null
  for (const b of sorted) {
    const ratio = b.size / (body || 12)
    const short = b.text.length <= 160
    const heading: ExportBlock['heading'] = short && ratio >= 1.8 ? 1 : short && ratio >= 1.4 ? 2 : short && ratio >= 1.2 ? 3 : 0
    const text = b.text.trim()
    // Lines of one paragraph can arrive as separate blocks: same left edge, size and weight, no gap between them.
    const last = out[out.length - 1]
    const continues = !!prev && !!last && heading === 0 && last.heading === 0 && Math.abs(prev.size - b.size) < 0.5 && Math.abs(prev.rect.x - b.rect.x) < 3 && isBold(prev) === isBold(b) && b.rect.y - (prev.rect.y + prev.rect.h) <= b.size * 0.6 && b.rect.y >= prev.rect.y
    if (continues) last.text = `${last.text} ${text}`
    else out.push({ text, heading, size: b.size, bold: isBold(b), italic: b.italic })
    prev = b
  }
  return out
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** A simple HTML document: a section per page, headings and paragraphs. */
export function toHtml(title: string, pages: ExportBlock[][]): string {
  const body = pages
    .map((blocks, i) => {
      const inner = blocks
        .map((b) => {
          const text = esc(b.text)
          if (b.heading) return `<h${b.heading}>${text}</h${b.heading}>`
          const styled = b.bold ? `<strong>${text}</strong>` : text
          return `<p>${b.italic ? `<em>${styled}</em>` : styled}</p>`
        })
        .join('\n')
      return `<section id="page-${i + 1}" aria-label="Page ${i + 1}">\n${inner}\n</section>`
    })
    .join('\n<hr>\n')
  return `<!DOCTYPE html>\n<html lang="en-AU">\n<head>\n<meta charset="utf-8">\n<title>${esc(title)}</title>\n<style>body{font-family:Arial,Helvetica,sans-serif;max-width:46em;margin:2em auto;padding:0 1em;line-height:1.5}hr{border:0;border-top:1px solid #ccc;margin:2em 0}</style>\n</head>\n<body>\n${body}\n</body>\n</html>\n`
}

/** Plain text: pages separated by a form feed, paragraphs by a blank line. */
export function toPlainText(pages: ExportBlock[][]): string {
  return pages.map((blocks) => blocks.map((b) => b.text).join('\n\n')).join('\n\f\n')
}

/** A Word document: a heading style for headings, a page break between pages. Loaded on demand, as the library is large. */
export async function toDocx(title: string, pages: ExportBlock[][]): Promise<Uint8Array> {
  const { Document, HeadingLevel, Packer, PageBreak, Paragraph, TextRun } = await import('docx')
  const levels = { 1: HeadingLevel.HEADING_1, 2: HeadingLevel.HEADING_2, 3: HeadingLevel.HEADING_3 } as const
  const children: InstanceType<typeof Paragraph>[] = []
  pages.forEach((blocks, i) => {
    if (i > 0) children.push(new Paragraph({ children: [new PageBreak()] }))
    for (const b of blocks) {
      if (b.heading) children.push(new Paragraph({ heading: levels[b.heading], children: [new TextRun({ text: b.text })] }))
      else children.push(new Paragraph({ spacing: { after: 120 }, children: [new TextRun({ text: b.text, bold: b.bold, italics: b.italic, size: Math.round(Math.max(8, Math.min(48, b.size)) * 2) })] }))
    }
  })
  const doc = new Document({ title, creator: 'OpenPDF', sections: [{ children }] })
  // A Blob works in the browser and in Node; a Buffer only in Node.
  return new Uint8Array(await (await Packer.toBlob(doc)).arrayBuffer())
}
