/**
 * Writers for the Office formats: Word (flowing text with tables, pictures and columns, or an exact layout of positioned
 * text), Excel (SpreadsheetML written directly) and PowerPoint (one picture per slide). Excel and PowerPoint files are
 * written with JSZip; Word with the docx library, loaded on demand as it is large.
 */
import JSZip from 'jszip'
import type { ExportBlock } from './exportDoc'
import { exactTexts, type ExactText, type FlowItem, type PageData, type PageLayout } from './exportLayout'
import { parseCell } from './exportTables'

const PT_TO_TWIP = 20
const twip = (pt: number) => Math.max(0, Math.round(pt * PT_TO_TWIP))

/** Text safe to write inside XML: control characters that XML cannot hold are dropped. */
// eslint-disable-next-line no-control-regex
const clean = (s: string) => s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '')
export const xmlEscape = (s: string) => clean(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

// ---- Word ----------------------------------------------------------------------------------------------

export interface DocImage {
  data: Uint8Array
  type: 'png' | 'jpg'
}

/** A Word typeface for a PDF font name where it is a common one; undefined leaves Word's default. */
export function familyOf(font?: string): string | undefined {
  const f = (font ?? '').toLowerCase().replace(/[^a-z]/g, '')
  const known: [string, string][] = [
    ['timesnewroman', 'Times New Roman'],
    ['times', 'Times New Roman'],
    ['courier', 'Courier New'],
    ['consolas', 'Consolas'],
    ['arial', 'Arial'],
    ['helvetica', 'Arial'],
    ['calibri', 'Calibri'],
    ['cambria', 'Cambria'],
    ['verdana', 'Verdana'],
    ['tahoma', 'Tahoma'],
    ['georgia', 'Georgia'],
    ['segoeui', 'Segoe UI']
  ]
  return known.find(([k]) => f.includes(k))?.[1]
}

const colourOf = (c?: string) => (c && /^#[0-9a-f]{6}$/i.test(c) && c.toLowerCase() !== '#000000' ? c.slice(1).toUpperCase() : undefined)

type Docx = typeof import('docx')

function runOf(d: Docx, b: Pick<ExportBlock, 'text' | 'size' | 'bold' | 'italic' | 'color' | 'font'>, sized = true) {
  const f = familyOf(b.font)
  return new d.TextRun({ text: b.text, bold: b.bold || undefined, italics: b.italic || undefined, size: sized ? Math.round(Math.max(8, Math.min(72, b.size)) * 2) : undefined, color: colourOf(b.color), font: f ? { name: f } : undefined })
}

function flowChildren(d: Docx, items: FlowItem[], colWidthPt: number, images: Map<string, DocImage>) {
  const levels = { 1: d.HeadingLevel.HEADING_1, 2: d.HeadingLevel.HEADING_2, 3: d.HeadingLevel.HEADING_3 } as const
  const out: (InstanceType<typeof d.Paragraph> | InstanceType<typeof d.Table>)[] = []
  for (const it of items) {
    if (it.kind === 'text') {
      for (const b of it.blocks) {
        if (b.heading) out.push(new d.Paragraph({ heading: levels[b.heading], children: [runOf(d, { ...b, bold: false, italic: false }, false)] }))
        else out.push(new d.Paragraph({ spacing: { after: 120 }, children: [runOf(d, b)] }))
      }
    } else if (it.kind === 'image') {
      const img = images.get(it.image.key)
      if (!img) continue
      const scale = Math.min(1, colWidthPt / Math.max(1, it.image.rect.w))
      out.push(new d.Paragraph({ spacing: { after: 120 }, children: [new d.ImageRun({ type: img.type, data: img.data, transformation: { width: Math.max(1, Math.round(it.image.rect.w * scale * 96 / 72)), height: Math.max(1, Math.round(it.image.rect.h * scale * 96 / 72)) }, altText: { name: 'Picture', description: 'Picture from the PDF', title: 'Picture' } })] }))
    } else {
      const t = it.table
      const total = t.colWidths.reduce((a, b) => a + b, 0) || 1
      const fit = Math.min(1, colWidthPt / total)
      const widths = t.colWidths.map((w) => Math.max(200, twip(w * fit)))
      const line = { style: d.BorderStyle.SINGLE, size: 4, color: '999999' }
      out.push(
        new d.Table({
          width: { size: widths.reduce((a, b) => a + b, 0), type: d.WidthType.DXA },
          columnWidths: widths,
          borders: { top: line, bottom: line, left: line, right: line, insideHorizontal: line, insideVertical: line },
          rows: t.rows.map((r) => new d.TableRow({ children: r.map((txt, i) => new d.TableCell({ width: { size: widths[i], type: d.WidthType.DXA }, children: [new d.Paragraph({ children: [new d.TextRun({ text: txt, size: 20 })] })] })) }))
        })
      )
      out.push(new d.Paragraph({ spacing: { after: 120 }, children: [] }))
    }
  }
  return out
}

/** Word, flowing: headings, paragraphs, real tables, pictures in reading order, and section columns where pages have them. */
export async function toWordFlow(title: string, pages: PageLayout[], images: Map<string, DocImage>): Promise<Uint8Array> {
  const d = await import('docx')
  const sections: import('docx').ISectionOptions[] = []
  pages.forEach((p, pi) => {
    const m = p.margin
    const bands = p.bands.length ? p.bands : [{ columns: 1, items: [[] as FlowItem[]] }]
    bands.forEach((band, bi) => {
      const space = 18
      const usable = p.width - m.left - m.right
      const colW = band.columns > 1 ? (usable - space * (band.columns - 1)) / band.columns : usable
      const children: (InstanceType<typeof d.Paragraph> | InstanceType<typeof d.Table>)[] = []
      band.items.forEach((col, ci) => {
        children.push(...flowChildren(d, col, colW, images))
        if (ci < band.items.length - 1) children.push(new d.Paragraph({ children: [new d.TextRun({ children: [new d.ColumnBreak()] })] }))
      })
      if (!children.length || children[children.length - 1] instanceof d.Table) children.push(new d.Paragraph({ children: [] }))
      sections.push({
        properties: {
          type: pi === 0 && bi === 0 ? undefined : bi === 0 ? d.SectionType.NEXT_PAGE : d.SectionType.CONTINUOUS,
          page: { size: { width: twip(p.width), height: twip(p.height) }, margin: { top: twip(m.top), bottom: twip(m.bottom), left: twip(m.left), right: twip(m.right) } },
          column: band.columns > 1 ? { count: band.columns, space: twip(space) } : undefined
        },
        children
      })
    })
  })
  const doc = new d.Document({ title, creator: 'OpenPDF', sections })
  return new Uint8Array(await (await d.Packer.toBlob(doc)).arrayBuffer())
}

/**
 * Word, exact: every page is a section of its own size; each block of text is a paragraph in a frame fixed to its place
 * on the page, and pictures float at theirs. Tables are not rebuilt; the text stays where it is.
 */
export async function toWordExact(title: string, pages: PageData[], images: Map<string, DocImage>): Promise<Uint8Array> {
  const d = await import('docx')
  const sections: import('docx').ISectionOptions[] = pages.map((p, pi) => {
    const anchor = new d.Paragraph({
      spacing: { before: 0, after: 0, line: 20, lineRule: d.LineRuleType.EXACT },
      children: p.images.flatMap((im) => {
        const img = images.get(im.key)
        if (!img) return []
        return [
          new d.ImageRun({
            type: img.type,
            data: img.data,
            transformation: { width: Math.max(1, Math.round(im.rect.w * 96 / 72)), height: Math.max(1, Math.round(im.rect.h * 96 / 72)) },
            floating: {
              horizontalPosition: { relative: d.HorizontalPositionRelativeFrom.PAGE, offset: Math.round(im.rect.x * 12700) },
              verticalPosition: { relative: d.VerticalPositionRelativeFrom.PAGE, offset: Math.round(im.rect.y * 12700) },
              behindDocument: true,
              allowOverlap: true,
              wrap: { type: d.TextWrappingType.NONE }
            },
            altText: { name: 'Picture', description: 'Picture from the PDF', title: 'Picture' }
          })
        ]
      })
    })
    const frames = exactTexts(p.visible).map((t: ExactText) => {
      const f = familyOf(t.font)
      const width = Math.min(p.width - t.rect.x, t.rect.w * 1.15 + 8)
      return new d.Paragraph({
        frame: { type: 'absolute', position: { x: twip(t.rect.x), y: twip(t.rect.y - t.size * 0.1) }, width: twip(Math.max(10, width)), anchor: { horizontal: d.FrameAnchorType.PAGE, vertical: d.FrameAnchorType.PAGE } },
        spacing: { before: 0, after: 0, line: Math.round(t.leading * 20), lineRule: d.LineRuleType.EXACT },
        children: [new d.TextRun({ text: t.text, bold: t.bold || undefined, italics: t.italic || undefined, size: Math.round(Math.max(2, Math.min(200, t.size)) * 2), color: colourOf(t.color), font: f ? { name: f } : undefined })]
      })
    })
    return {
      properties: {
        type: pi === 0 ? undefined : d.SectionType.NEXT_PAGE,
        page: { size: { width: twip(p.width), height: twip(p.height) }, margin: { top: 0, bottom: 0, left: 0, right: 0 } }
      },
      children: [anchor, ...frames]
    }
  })
  const doc = new d.Document({ title, creator: 'OpenPDF', sections })
  return new Uint8Array(await (await d.Packer.toBlob(doc)).arrayBuffer())
}

// ---- Excel ---------------------------------------------------------------------------------------------

export interface XlsxSheet {
  name: string
  /** Cell text, row by row; numbers, percentages, currency and dates are written as values. */
  rows: string[][]
  /** Rows (0-based) drawn in bold. */
  boldRows?: number[]
}

/** Several tables as the rows of one sheet, a blank row between them; a header row (text above numbers) is bold. */
export function sheetFromTables(name: string, tables: string[][][]): XlsxSheet {
  const rows: string[][] = []
  const boldRows: number[] = []
  tables.forEach((t, i) => {
    if (i > 0) rows.push([])
    const isNum = (c: string) => parseCell(c).kind !== 'text'
    if (t.length > 1 && !t[0].some(isNum) && t.slice(1).some((r) => r.some(isNum))) boldRows.push(rows.length)
    rows.push(...t)
  })
  return { name, rows, boldRows }
}

/** A sheet name Excel accepts (31 characters at most, none of []:*?/\), made different from those already used. */
export function sheetName(want: string, used: string[]): string {
  const base = want.replace(/[[\]:*?/\\]/g, ' ').replace(/^'+|'+$/g, '').trim().slice(0, 31) || 'Sheet'
  let name = base
  for (let n = 2; used.some((u) => u.toLowerCase() === name.toLowerCase()); n++) name = `${base.slice(0, 31 - String(n).length - 1)} ${n}`
  return name
}

const colName = (i: number) => {
  let s = ''
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s
  return s
}

const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const PKG = 'http://schemas.openxmlformats.org/package/2006/relationships'
const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'

/** An .xlsx workbook, one worksheet per entry. */
export async function toXlsx(sheets: XlsxSheet[]): Promise<Uint8Array> {
  const formats: string[] = [] // number format codes; style index = position + 2 (0 plain, 1 bold)
  const styleOf = (code: string) => {
    let i = formats.indexOf(code)
    if (i < 0) i = formats.push(code) - 1
    return i + 2
  }
  const sheetXml = sheets.map((s) => {
    const bold = new Set(s.boldRows ?? [])
    const widths: number[] = []
    const rowsXml = s.rows
      .map((r, ri) => {
        const cells = r
          .map((raw, ci) => {
            if (!raw.trim()) return ''
            const ref = `${colName(ci)}${ri + 1}`
            const v = parseCell(raw)
            widths[ci] = Math.max(widths[ci] ?? 0, Math.min(60, raw.trim().length + 2))
            if (v.kind === 'text') return `<c r="${ref}" t="inlineStr"${bold.has(ri) ? ' s="1"' : ''}><is><t xml:space="preserve">${xmlEscape(v.text)}</t></is></c>`
            return `<c r="${ref}" s="${styleOf(v.format)}"><v>${v.value}</v></c>`
          })
          .join('')
        return cells ? `<row r="${ri + 1}">${cells}</row>` : ''
      })
      .join('')
    const cols = widths.length ? `<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${Math.max(8, w)}" customWidth="1"/>`).join('')}</cols>` : ''
    return `${XML}<worksheet xmlns="${NS}" xmlns:r="${REL}">${cols}<sheetData>${rowsXml}</sheetData></worksheet>`
  })
  const numFmts = formats.map((f, i) => `<numFmt numFmtId="${164 + i}" formatCode="${xmlEscape(f)}"/>`).join('')
  const xfs = ['<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>', '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>', ...formats.map((_, i) => `<xf numFmtId="${164 + i}" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>`)]
  const styles = `${XML}<styleSheet xmlns="${NS}">${formats.length ? `<numFmts count="${formats.length}">${numFmts}</numFmts>` : ''}<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="${xfs.length}">${xfs.join('')}</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`
  const zip = new JSZip()
  zip.file('[Content_Types].xml', `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`)
  zip.file('_rels/.rels', `${XML}<Relationships xmlns="${PKG}"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`)
  zip.file('xl/workbook.xml', `${XML}<workbook xmlns="${NS}" xmlns:r="${REL}"><sheets>${sheets.map((s, i) => `<sheet name="${xmlEscape(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`)
  zip.file('xl/_rels/workbook.xml.rels', `${XML}<Relationships xmlns="${PKG}">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="${REL}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="${REL}/styles" Target="styles.xml"/></Relationships>`)
  zip.file('xl/styles.xml', styles)
  sheetXml.forEach((x, i) => zip.file(`xl/worksheets/sheet${i + 1}.xml`, x))
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })
}

// ---- PowerPoint ----------------------------------------------------------------------------------------

export interface Slide {
  image: Uint8Array
  ext: 'png' | 'jpeg'
  widthPt: number
  heightPt: number
  /** Speaker notes, one paragraph per entry (empty for none). */
  notes: string[]
  description: string
}

const A = 'http://schemas.openxmlformats.org/drawingml/2006/main'
const P = 'http://schemas.openxmlformats.org/presentationml/2006/main'

const THEME = `${XML}<a:theme xmlns:a="${A}" name="OpenPDF"><a:themeElements><a:clrScheme name="OpenPDF"><a:dk1><a:srgbClr val="000000"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="333333"/></a:dk2><a:lt2><a:srgbClr val="EEEEEE"/></a:lt2><a:accent1><a:srgbClr val="2F5597"/></a:accent1><a:accent2><a:srgbClr val="C55A11"/></a:accent2><a:accent3><a:srgbClr val="548235"/></a:accent3><a:accent4><a:srgbClr val="BF9000"/></a:accent4><a:accent5><a:srgbClr val="7030A0"/></a:accent5><a:accent6><a:srgbClr val="2E75B6"/></a:accent6><a:hlink><a:srgbClr val="0563C1"/></a:hlink><a:folHlink><a:srgbClr val="954F72"/></a:folHlink></a:clrScheme><a:fontScheme name="OpenPDF"><a:majorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme><a:fmtScheme name="OpenPDF"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst><a:lnStyleLst><a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="12700"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="19050"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>`

const GROUP = '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>'
const CLRMAP = '<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>'
const NSALL = `xmlns:a="${A}" xmlns:r="${REL}" xmlns:p="${P}"`
const rels = (items: [string, string, string][]) => `${XML}<Relationships xmlns="${PKG}">${items.map(([id, type, target]) => `<Relationship Id="${id}" Type="${REL}/${type}" Target="${target}"/>`).join('')}</Relationships>`

/** A .pptx presentation with one slide per page, the page as a picture sized to fit, and optionally its text in the notes. */
export async function toPptx(title: string, slides: Slide[]): Promise<Uint8Array> {
  if (!slides.length) throw new Error('There are no pages to export.')
  // The slide takes the shape of the first page; its longer side is 13.333 inches (the widescreen width).
  const LONG = 12192000
  const first = slides[0]
  const cx = first.widthPt >= first.heightPt ? LONG : Math.round((LONG * first.widthPt) / first.heightPt)
  const cy = first.widthPt >= first.heightPt ? Math.round((LONG * first.heightPt) / first.widthPt) : LONG
  const hasNotes = slides.some((s) => s.notes.length)
  const zip = new JSZip()
  const types = [
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
    '<Default Extension="xml" ContentType="application/xml"/>',
    '<Default Extension="png" ContentType="image/png"/>',
    '<Default Extension="jpeg" ContentType="image/jpeg"/>',
    '<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>',
    '<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>',
    '<Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>',
    '<Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>',
    '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>',
    '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>',
    ...slides.map((_, i) => `<Override PartName="/ppt/slides/slide${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`)
  ]
  if (hasNotes) {
    types.push('<Override PartName="/ppt/notesMasters/notesMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.notesMaster+xml"/>', '<Override PartName="/ppt/theme/theme2.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>')
    slides.forEach((s, i) => s.notes.length && types.push(`<Override PartName="/ppt/notesSlides/notesSlide${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml"/>`))
  }
  zip.file('[Content_Types].xml', `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">${types.join('')}</Types>`)
  zip.file('_rels/.rels', `${XML}<Relationships xmlns="${PKG}"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="ppt/presentation.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="${REL}/extended-properties" Target="docProps/app.xml"/></Relationships>`)
  const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z')
  zip.file('docProps/core.xml', `${XML}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${xmlEscape(title)}</dc:title><dc:creator>OpenPDF</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created></cp:coreProperties>`)
  zip.file('docProps/app.xml', `${XML}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>OpenPDF</Application><Slides>${slides.length}</Slides></Properties>`)

  const slideIds = slides.map((_, i) => `<p:sldId id="${256 + i}" r:id="rId${i + (hasNotes ? 4 : 3)}"/>`).join('')
  zip.file('ppt/presentation.xml', `${XML}<p:presentation ${NSALL} saveSubsetFonts="1"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>${hasNotes ? '<p:notesMasterIdLst><p:notesMasterId r:id="rId3"/></p:notesMasterIdLst>' : ''}<p:sldIdLst>${slideIds}</p:sldIdLst><p:sldSz cx="${cx}" cy="${cy}"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`)
  zip.file(
    'ppt/_rels/presentation.xml.rels',
    rels([['rId1', 'slideMaster', 'slideMasters/slideMaster1.xml'], ['rId2', 'theme', 'theme/theme1.xml'], ...(hasNotes ? ([['rId3', 'notesMaster', 'notesMasters/notesMaster1.xml']] as [string, string, string][]) : []), ...slides.map((_, i) => [`rId${i + (hasNotes ? 4 : 3)}`, 'slide', `slides/slide${i + 1}.xml`] as [string, string, string])])
  )
  zip.file('ppt/theme/theme1.xml', THEME)
  zip.file('ppt/slideMasters/slideMaster1.xml', `${XML}<p:sldMaster ${NSALL}><p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg><p:spTree>${GROUP}</p:spTree></p:cSld>${CLRMAP}<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst></p:sldMaster>`)
  zip.file('ppt/slideMasters/_rels/slideMaster1.xml.rels', rels([['rId1', 'slideLayout', '../slideLayouts/slideLayout1.xml'], ['rId2', 'theme', '../theme/theme1.xml']]))
  zip.file('ppt/slideLayouts/slideLayout1.xml', `${XML}<p:sldLayout ${NSALL} type="blank" preserve="1"><p:cSld name="Blank"><p:spTree>${GROUP}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`)
  zip.file('ppt/slideLayouts/_rels/slideLayout1.xml.rels', rels([['rId1', 'slideMaster', '../slideMasters/slideMaster1.xml']]))

  if (hasNotes) {
    zip.file('ppt/theme/theme2.xml', THEME)
    const ph = (id: number, name: string, type: string, idx: string, x: number, y: number, w: number, h: number) => `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${name}"/><p:cNvSpPr><a:spLocks noGrp="1"${type === 'sldImg' ? ' noRot="1" noChangeAspect="1"' : ''}/></p:cNvSpPr><p:nvPr><p:ph type="${type}"${idx}/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${w}" cy="${h}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>${type === 'sldImg' ? '' : '<p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr lang="en-AU"/></a:p></p:txBody>'}</p:sp>`
    zip.file('ppt/notesMasters/notesMaster1.xml', `${XML}<p:notesMaster ${NSALL}><p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg><p:spTree>${GROUP}${ph(2, 'Slide Image Placeholder 1', 'sldImg', ' idx="2"', 685800, 1143000, 5486400, 3086100)}${ph(3, 'Notes Placeholder 2', 'body', ' sz="quarter" idx="3"', 685800, 4400550, 5486400, 3600450)}</p:spTree></p:cSld>${CLRMAP}</p:notesMaster>`)
    zip.file('ppt/notesMasters/_rels/notesMaster1.xml.rels', rels([['rId1', 'theme', '../theme/theme2.xml']]))
  }

  slides.forEach((s, i) => {
    const n = i + 1
    // The picture is as large as fits the slide, centred.
    const k = Math.min(cx / s.widthPt, cy / s.heightPt)
    const w = Math.round(s.widthPt * k)
    const h = Math.round(s.heightPt * k)
    const x = Math.round((cx - w) / 2)
    const y = Math.round((cy - h) / 2)
    zip.file(`ppt/media/image${n}.${s.ext}`, s.image)
    zip.file(
      `ppt/slides/slide${n}.xml`,
      `${XML}<p:sld ${NSALL}><p:cSld><p:spTree>${GROUP}<p:pic><p:nvPicPr><p:cNvPr id="2" name="Page ${n}" descr="${xmlEscape(s.description)}"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="rId2"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${w}" cy="${h}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`
    )
    const slideRels: [string, string, string][] = [['rId1', 'slideLayout', '../slideLayouts/slideLayout1.xml'], ['rId2', 'image', `../media/image${n}.${s.ext}`]]
    if (s.notes.length) {
      slideRels.push(['rId3', 'notesSlide', `../notesSlides/notesSlide${n}.xml`])
      const paras = s.notes.map((l) => `<a:p><a:r><a:rPr lang="en-AU"/><a:t>${xmlEscape(l)}</a:t></a:r></a:p>`).join('')
      zip.file(
        `ppt/notesSlides/notesSlide${n}.xml`,
        `${XML}<p:notes ${NSALL}><p:cSld><p:spTree>${GROUP}<p:sp><p:nvSpPr><p:cNvPr id="2" name="Slide Image Placeholder 1"/><p:cNvSpPr><a:spLocks noGrp="1" noRot="1" noChangeAspect="1"/></p:cNvSpPr><p:nvPr><p:ph type="sldImg"/></p:nvPr></p:nvSpPr><p:spPr/></p:sp><p:sp><p:nvSpPr><p:cNvPr id="3" name="Notes Placeholder 2"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/>${paras}</p:txBody></p:sp></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:notes>`
      )
      zip.file(`ppt/notesSlides/_rels/notesSlide${n}.xml.rels`, rels([['rId1', 'notesMaster', '../notesMasters/notesMaster1.xml'], ['rId2', 'slide', `../slides/slide${n}.xml`]]))
    }
    zip.file(`ppt/slides/_rels/slide${n}.xml.rels`, rels(slideRels))
  })
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })
}
