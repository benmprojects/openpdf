// @vitest-environment node
import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import { layoutPage, type PageData } from './exportLayout'
import { familyOf, sheetFromTables, sheetName, toPptx, toWordExact, toWordFlow, toXlsx, xmlEscape } from './exportOffice'
import { plainBlock } from './exportRun'
import type { Rule } from './exportTables'

/** Every XML part of a package must be well formed: parsed here with the DOM-free check below. */
async function parts(bytes: Uint8Array) {
  const zip = await JSZip.loadAsync(bytes)
  const out: Record<string, string> = {}
  for (const name of Object.keys(zip.files)) if (!zip.files[name].dir && /\.(xml|rels)$/.test(name)) out[name] = await zip.files[name].async('string')
  return { zip, xml: out }
}

/** A small well-formedness check: tags nest and attributes are quoted. */
function wellFormed(xml: string): string | null {
  const stack: string[] = []
  const re = /<\?[^?]*\?>|<!--[\s\S]*?-->|<(\/?)([A-Za-z_][\w:.-]*)((?:\s+[\w:.-]+="[^"<]*")*)\s*(\/?)>|([^<]+)/g
  let m: RegExpExecArray | null
  let pos = 0
  while ((m = re.exec(xml))) {
    if (m.index !== pos) return `unexpected text at ${pos}`
    pos = re.lastIndex
    if (m[5] !== undefined) {
      if (/&(?!amp;|lt;|gt;|quot;|apos;|#\d+;)/.test(m[5])) return 'bare ampersand'
      continue
    }
    if (!m[2]) continue
    if (m[4]) continue
    if (m[1]) {
      if (stack.pop() !== m[2]) return `mismatched </${m[2]}>`
    } else stack.push(m[2])
  }
  if (pos !== xml.length) return 'trailing junk'
  return stack.length ? `unclosed <${stack[stack.length - 1]}>` : null
}

const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 31, 21, 196, 137, 0, 0, 0, 13, 73, 68, 65, 84, 120, 156, 99, 248, 255, 255, 63, 0, 5, 254, 2, 254, 167, 53, 129, 132, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130])

describe('Excel', () => {
  it('writes numbers, amounts, percentages and dates as values with Australian formats, and text as text', async () => {
    const sheet = sheetFromTables('Page 1', [[['Item', 'Cost', 'Done', 'Date'], ['Pit & lid', '$1,234.50', '12.5%', '31/12/2026'], ['Pipe', '42', '(3)', 'n/a']]])
    expect(sheet.boldRows).toEqual([0])
    const { zip, xml } = await parts(await toXlsx([sheet]))
    for (const [name, x] of Object.entries(xml)) expect(wellFormed(x), name).toBeNull()
    expect(Object.keys(zip.files)).toContain('xl/worksheets/sheet1.xml')
    const s = xml['xl/worksheets/sheet1.xml']
    expect(s).toContain('<c r="A2" t="inlineStr"><is><t xml:space="preserve">Pit &amp; lid</t></is></c>')
    const styles = xml['xl/styles.xml']
    const formatId = (code: string) => 164 + [...styles.matchAll(/<numFmt numFmtId="(\d+)" formatCode="([^"]*)"/g)].findIndex((m) => m[2].replace(/&quot;/g, '"') === code)
    expect(styles).toContain('formatCode="&quot;$&quot;#,##0.00"')
    expect(styles).toContain('formatCode="dd/mm/yyyy"')
    // Cells carry values: 1234.5 as a number, 0.125 for 12.5 %, the date as a serial number, -3 for (3).
    const xfs = [...styles.match(/<cellXfs[\s\S]*<\/cellXfs>/)![0].matchAll(/<xf numFmtId="(\d+)"/g)].map((m) => Number(m[1]))
    const cell = (ref: string) => {
      const m = new RegExp(`<c r="${ref}" s="(\\d+)"><v>([^<]*)</v>`).exec(s)!
      return { numFmtId: xfs[Number(m[1])], v: Number(m[2]) }
    }
    expect(cell('B2')).toEqual({ numFmtId: formatId('"$"#,##0.00'), v: 1234.5 })
    expect(cell('C2')).toEqual({ numFmtId: formatId('0.0%'), v: 0.125 })
    expect(cell('D2')).toEqual({ numFmtId: formatId('dd/mm/yyyy'), v: 46387 })
    expect(cell('B3').v).toBe(42)
    expect(cell('C3').v).toBe(-3)
    expect(s).toContain('<t xml:space="preserve">n/a</t>')
    // The header row is bold.
    expect(s).toMatch(/<c r="A1" t="inlineStr" s="1">/)
  })

  it('names sheets within Excel rules and keeps them different', () => {
    expect(sheetName('Page: 1/2?', [])).toBe('Page  1 2')
    expect(sheetName('x'.repeat(40), []).length).toBe(31)
    expect(sheetName('Sheet', ['sheet'])).toBe('Sheet 2')
    expect(xmlEscape('a<b>&"c"\u0001')).toBe('a&lt;b&gt;&amp;&quot;c&quot;')
  })
})

describe('PowerPoint', () => {
  it('writes one slide per page, sized to the first page, with a picture and the notes', async () => {
    const bytes = await toPptx('Plan & sections', [
      { image: png, ext: 'png', widthPt: 595.28, heightPt: 841.89, notes: ['First <line>', 'Second'], description: 'Page 1' },
      { image: png, ext: 'png', widthPt: 841.89, heightPt: 595.28, notes: [], description: 'Page 2' }
    ])
    const { zip, xml } = await parts(bytes)
    for (const [name, x] of Object.entries(xml)) expect(wellFormed(x), name).toBeNull()
    const names = Object.keys(zip.files)
    for (const n of ['ppt/slides/slide1.xml', 'ppt/slides/slide2.xml', 'ppt/media/image1.png', 'ppt/notesSlides/notesSlide1.xml', 'ppt/slideMasters/slideMaster1.xml', 'ppt/theme/theme1.xml']) expect(names).toContain(n)
    expect(names).not.toContain('ppt/notesSlides/notesSlide2.xml')
    const pres = xml['ppt/presentation.xml']
    const [, cx, cy] = /<p:sldSz cx="(\d+)" cy="(\d+)"/.exec(pres)!.map(Number)
    expect(cy).toBe(12192000)
    expect(cx / cy).toBeCloseTo(595.28 / 841.89, 3)
    // Every relationship target exists, and the content types cover every part.
    for (const [name, x] of Object.entries(xml).filter(([n]) => n.endsWith('.rels'))) {
      const dir = name.replace(/_rels\/[^/]*$/, '')
      for (const t of x.matchAll(/Target="([^"]+)"/g)) {
        const path = (t[1].startsWith('/') ? t[1].slice(1) : new URL(t[1], `http://x/${dir}`).pathname.slice(1)) as string
        expect(names, `${name} -> ${t[1]}`).toContain(path)
      }
    }
    const types = xml['[Content_Types].xml']
    for (const n of names.filter((n) => n.endsWith('.xml') && !n.startsWith('[') && !n.includes('_rels'))) expect(types, n).toContain(`PartName="/${n}"`)
    expect(xml['ppt/notesSlides/notesSlide1.xml']).toContain('First &lt;line&gt;')
    // The second (landscape) page's picture is shrunk to fit the portrait slide and centred.
    const ext = /<a:off x="(\d+)" y="(\d+)"\/><a:ext cx="(\d+)" cy="(\d+)"\/>/.exec(xml['ppt/slides/slide2.xml'].split('<p:pic>')[1])!.map(Number)
    expect(ext[3]).toBeLessThanOrEqual(cx)
    expect(ext[3] / ext[4]).toBeCloseTo(841.89 / 595.28, 2)
    expect(ext[1] * 2 + ext[3]).toBeCloseTo(cx, -1)
  })

  it('refuses an empty list of pages', async () => {
    await expect(toPptx('x', [])).rejects.toThrow()
  })
})

const page = (over: Partial<PageData> = {}): PageData => ({ width: 595, height: 842, blocks: [], visible: [], rules: [], images: [], ...over })

describe('Word', () => {
  const header = plainBlock('Quantities', { x: 50, y: 60, w: 200, h: 24 }, 24)
  const cells = [
    ['Item', 'Cost'],
    ['Pit', '$10.00'],
    ['Pipe', '$25.00']
  ]
  const rules: Rule[] = []
  for (const y of [120, 140, 160, 180]) rules.push({ x0: 50, x1: 250, y0: y, y1: y, horizontal: true })
  for (const x of [50, 150, 250]) rules.push({ x0: x, x1: x, y0: 120, y1: 180, horizontal: false })
  const tableBlocks = cells.flatMap((r, ri) => r.map((c, ci) => plainBlock(c, { x: 55 + ci * 100, y: 125 + ri * 20, w: 40, h: 10 }, 10)))

  it('writes a real table, a heading and a picture from a page with a ruled grid', async () => {
    const data = page({ blocks: [header, ...tableBlocks], visible: [header, ...tableBlocks], rules, images: [{ rect: { x: 50, y: 220, w: 200, h: 100 }, key: '0:0' }] })
    const layout = layoutPage(data, 10, { tables: true, columns: true })
    expect(layout.bands[0].items[0].map((i) => i.kind)).toEqual(['text', 'table', 'image'])
    const { zip, xml } = await parts(await toWordFlow('Test', [layout], new Map([['0:0', { data: png, type: 'png' as const }]])))
    for (const [name, x] of Object.entries(xml)) expect(wellFormed(x), name).toBeNull()
    const doc = xml['word/document.xml']
    expect(doc).toContain('<w:tbl>')
    expect((doc.match(/<w:tr[ >]/g) ?? []).length).toBe(3)
    expect(doc).toContain('$25.00')
    expect(doc).toContain('Heading1')
    expect(doc).toContain('<w:drawing>')
    expect(Object.keys(zip.files).some((n) => n.startsWith('word/media/'))).toBe(true)
    expect(doc).toContain('<w:pgSz w:w="11900" w:h="16840"')
  })

  it('turns text columns beside each other into a two-column section with a column break', async () => {
    const left = Array.from({ length: 4 }, (_, i) => plainBlock(`Left paragraph ${i}`, { x: 50, y: 100 + i * 40, w: 220, h: 12 }, 12))
    const right = Array.from({ length: 4 }, (_, i) => plainBlock(`Right paragraph ${i}`, { x: 320, y: 100 + i * 40, w: 220, h: 12 }, 12))
    const title = plainBlock('A wide heading across the whole page for the document', { x: 50, y: 40, w: 490, h: 20 }, 20)
    const layout = layoutPage(page({ blocks: [title, ...left, ...right], visible: [] }), 12, { tables: true, columns: true })
    expect(layout.bands.map((b) => b.columns)).toEqual([1, 2])
    expect(layout.bands[1].items[0][0]).toMatchObject({ kind: 'text' })
    const { xml } = await parts(await toWordFlow('Test', [layout], new Map()))
    const doc = xml['word/document.xml']
    expect(doc).toMatch(/<w:cols w:space="\d+" w:num="2"|<w:cols[^>]*w:num="2"/)
    expect(doc).toContain('w:type="column"')
    expect(doc.indexOf('Left paragraph 3')).toBeLessThan(doc.indexOf('Right paragraph 0'))
    // With columns switched off the page is one flow.
    expect(layoutPage(page({ blocks: [title, ...left, ...right] }), 12, { tables: true, columns: false }).bands.map((b) => b.columns)).toEqual([1])
  })

  it('exact layout fixes each block in a frame at its place and floats pictures behind', async () => {
    const a = plainBlock('Top left', { x: 72, y: 100, w: 80, h: 12 }, 12)
    const bold = { ...plainBlock('Bold note', { x: 300, y: 400, w: 90, h: 12 }, 12), weight: 700, color: '#ff0000' }
    const { xml } = await parts(await toWordExact('Test', [page({ blocks: [a, bold], visible: [a, bold], images: [{ rect: { x: 10, y: 20, w: 100, h: 50 }, key: '0:0' }] })], new Map([['0:0', { data: png, type: 'png' as const }]])))
    for (const [name, x] of Object.entries(xml)) expect(wellFormed(x), name).toBeNull()
    const doc = xml['word/document.xml']
    expect(doc).toContain('w:framePr')
    expect(doc).toContain('w:x="1440"') // 72 pt
    expect(doc).toContain('w:y="1976"') // 100 pt less a tenth of the size (1.2 pt)
    expect(doc).toContain('w:val="FF0000"')
    expect(doc).toContain('<wp:anchor')
    expect(doc).toContain('behindDoc="1"')
    expect(doc).toContain('Bold note')
  })

  it('names common fonts for Word', () => {
    expect(familyOf('TimesNewRomanPS-BoldMT')).toBe('Times New Roman')
    expect(familyOf('ABCDEF+Helvetica-Bold'.replace(/^[A-Z]{6}\+/, ''))).toBe('Arial')
    expect(familyOf('SomethingOdd')).toBeUndefined()
  })
})
