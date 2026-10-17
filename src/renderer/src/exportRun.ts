/**
 * Runs the Word, Excel and PowerPoint exports: reads each page through PDFium (text, ruling lines, pictures), lays it
 * out with the pure logic in exportLayout / exportTables, and writes the file with exportOffice.
 */
import { bodySize, encodePage } from './exportDoc'
import { layoutPage, type PageData, type PageImage } from './exportLayout'
import { sheetFromTables, sheetName, toPptx, toWordExact, toWordFlow, toXlsx, type DocImage, type XlsxSheet } from './exportOffice'
import { detectTables, rulesFromSegments } from './exportTables'
import type { PdfClient } from './pdfClient'
import type { TextObject } from './pdfiumRaw'
import { groupBlocks, type TextBlock } from './textBlocks'

export type ExportClient = Pick<PdfClient, 'textObjects' | 'pathGeometry' | 'imageObjects' | 'render' | 'pageText'>

export interface ExportEnv {
  client: ExportClient
  sizes: { width: number; height: number }[]
  stem: string
  progress: (text: string) => void
}

export interface WordOptions {
  /** Flowing text with tables, pictures and columns, or each block of text fixed where it is on the page. */
  mode: 'flow' | 'exact'
  pictures: boolean
  tables: boolean
  columns: boolean
}

export interface ExcelOptions {
  /** One sheet for every table on all the pages, or one sheet per page that has tables. */
  oneSheet: boolean
}

export interface PowerPointOptions {
  dpi: number
  format: 'png' | 'jpg'
  /** The page's text in the speaker notes. */
  notes: boolean
}

const MAX_IMAGES_PER_PAGE = 30

/** Block of one line from text objects that are not drawn (the recognised text under a scan). */
function hiddenLines(objects: TextObject[]): TextBlock[] {
  const objs = objects.filter((o) => o.text.trim()).sort((a, b) => a.rect.y + a.rect.h / 2 - (b.rect.y + b.rect.h / 2))
  const rows: TextObject[][] = []
  for (const o of objs) {
    const row = rows[rows.length - 1]
    if (row && Math.abs(o.rect.y + o.rect.h / 2 - (row[0].rect.y + row[0].rect.h / 2)) <= Math.min(o.rect.h, row[0].rect.h) * 0.5) row.push(o)
    else rows.push([o])
  }
  return rows.map((r) => {
    r.sort((a, b) => a.rect.x - b.rect.x)
    const x0 = Math.min(...r.map((o) => o.rect.x))
    const y0 = Math.min(...r.map((o) => o.rect.y))
    const x1 = Math.max(...r.map((o) => o.rect.x + o.rect.w))
    const y1 = Math.max(...r.map((o) => o.rect.y + o.rect.h))
    return plainBlock(r.map((o) => o.text.trim()).join(' '), { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }, Math.max(6, y1 - y0))
  })
}

/** A block of ordinary text at a place. */
export function plainBlock(text: string, rect: { x: number; y: number; w: number; h: number }, size: number): TextBlock {
  return {
    ordinals: [],
    text,
    rect,
    font: 'Helvetica',
    flags: 0,
    weight: 400,
    italic: false,
    size,
    color: '#000000',
    matrix: [1, 0, 0, 1, rect.x, rect.y],
    origins: [],
    reflow: false,
    layout: { firstX: rect.x, restX: rect.x, baselineY: rect.y, leading: 0, width: rect.w }
  }
}

/** Reads the pages' content. Pictures are cut out of the rendered page (so they show as drawn, masks and crops applied). */
export async function gatherPages(env: ExportEnv, only: number[], what: { pictures: boolean; rules: boolean }): Promise<{ pages: PageData[]; images: Map<string, DocImage> }> {
  const out: PageData[] = []
  const allImages = new Map<string, DocImage>()
  for (const p of only) {
    env.progress(`Reading page ${p + 1} of ${env.sizes.length}…`)
    const size = env.sizes[p]
    const t = await env.client.textObjects(p)
    const visible = groupBlocks(t.objects.filter((o) => o.mode === 0), t.rotation)
    const hidden = t.objects.filter((o) => o.mode !== 0)
    let blocks = visible
    const hiddenOnly = !visible.length && hidden.some((o) => o.text.trim())
    if (hiddenOnly) blocks = hiddenLines(hidden)
    if (!blocks.length) {
      // No text objects: fall back to the page's plain text, one line per block, stacked down the page.
      const lines = (await env.client.pageText(p)).text.replace(/\r\n?/g, '\n').split(/\n+/).map((l) => l.trim()).filter(Boolean)
      blocks = lines.map((l, i) => plainBlock(l, { x: 36, y: 36 + i * 16, w: Math.max(50, size.width - 72), h: 12 }, 12))
    }
    const rules = what.rules ? rulesFromSegments((await env.client.pathGeometry(p)).segs) : []
    const images: PageImage[] = []
    if (what.pictures) {
      const found = (await env.client.imageObjects(p)).objects.filter((o) => o.rect.w >= 12 && o.rect.h >= 12).slice(0, MAX_IMAGES_PER_PAGE)
      for (let k = 0; k < found.length; k++) {
        const r = found[k].rect
        const x = Math.max(0, r.x)
        const y = Math.max(0, r.y)
        const w = Math.min(size.width - x, r.w - (x - r.x))
        const h = Math.min(size.height - y, r.h - (y - r.y))
        if (w < 4 || h < 4) continue
        const scale = Math.min(2, 1600 / Math.max(w, h))
        const px = { x: Math.floor(x * scale), y: Math.floor(y * scale), w: Math.max(1, Math.ceil(w * scale)), h: Math.max(1, Math.ceil(h * scale)) }
        const rendered = await env.client.render(p, scale, { region: px, priority: 2 })
        const type: DocImage['type'] = rendered.width * rendered.height > 200_000 ? 'jpg' : 'png'
        const key = `${p}:${k}`
        allImages.set(key, { data: await encodePage(rendered.data, rendered.width, rendered.height, type, 0.85), type })
        images.push({ rect: { x, y, w, h }, key, backdrop: w * h > 0.85 * size.width * size.height && (visible.length > 0 || hidden.length > 0) })
      }
    }
    out.push({ width: size.width, height: size.height, blocks, visible: hiddenOnly ? [] : blocks, rules, images })
  }
  return { pages: out, images: allImages }
}

export async function exportWord(env: ExportEnv, only: number[], o: WordOptions): Promise<Uint8Array> {
  const { pages, images } = await gatherPages(env, only, { pictures: o.pictures, rules: o.mode === 'flow' && o.tables })
  env.progress('Writing the Word file…')
  if (o.mode === 'exact') return toWordExact(env.stem, pages, images)
  const body = bodySize(pages.map((p) => p.blocks))
  return toWordFlow(env.stem, pages.map((p) => layoutPage(p, body, { tables: o.tables, columns: o.columns })), images)
}

/** Table cells of every page that has tables, as rows of text. */
export async function tablesOf(env: ExportEnv, only: number[]): Promise<{ page: number; tables: string[][][] }[]> {
  const { pages } = await gatherPages(env, only, { pictures: false, rules: true })
  return pages.map((p, i) => ({ page: only[i], tables: detectTables(p.blocks.filter((b) => b.text.trim()).map((b) => ({ ...b.rect, text: b.text, size: b.size })), p.rules).tables.map((t) => t.rows) })).filter((p) => p.tables.length)
}

export function excelSheets(found: { page: number; tables: string[][][] }[], stem: string, oneSheet: boolean): XlsxSheet[] {
  if (!oneSheet) {
    const names: string[] = []
    return found.map((f) => {
      const s = sheetFromTables(sheetName(`Page ${f.page + 1}`, names), f.tables)
      names.push(s.name)
      return s
    })
  }
  const rows: string[][] = []
  const boldRows: number[] = []
  for (const f of found) {
    if (rows.length) rows.push([])
    boldRows.push(rows.length)
    rows.push([`Page ${f.page + 1}`])
    const s = sheetFromTables('', f.tables)
    boldRows.push(...(s.boldRows ?? []).map((r) => r + rows.length))
    rows.push(...s.rows)
  }
  return [{ name: sheetName(stem, []), rows, boldRows }]
}

export async function exportExcel(env: ExportEnv, only: number[], o: ExcelOptions): Promise<Uint8Array> {
  const found = await tablesOf(env, only)
  if (!found.length) throw new Error('No tables were found on these pages. Tables are found from ruled grids and from text lined up in rows and columns.')
  env.progress('Writing the Excel file…')
  return toXlsx(excelSheets(found, env.stem, o.oneSheet))
}

export async function exportPowerPoint(env: ExportEnv, only: number[], o: PowerPointOptions): Promise<Uint8Array> {
  const slides = []
  for (const p of only) {
    env.progress(`Rendering page ${p + 1} of ${env.sizes.length}…`)
    const size = env.sizes[p]
    const scale = Math.min(o.dpi / 72, Math.sqrt(30_000_000 / (size.width * size.height)))
    const r = await env.client.render(p, scale)
    const notes = o.notes ? (await env.client.pageText(p)).text.replace(/\r\n?/g, '\n').split(/\n/).map((l) => l.trim()).filter(Boolean) : []
    slides.push({ image: await encodePage(r.data, r.width, r.height, o.format), ext: o.format === 'jpg' ? ('jpeg' as const) : ('png' as const), widthPt: size.width, heightPt: size.height, notes, description: `Page ${p + 1} of ${env.stem}` })
  }
  env.progress('Writing the PowerPoint file…')
  return toPptx(env.stem, slides)
}
