import { PDFArray, PDFDict, PDFDocument, PDFName } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import { writeOutline, type BookmarkNode } from './outlineEdit'
import {
  detectHeadings,
  linesFromObjects,
  mergeOutlineStyles,
  nestHeadings,
  outlineToCsv,
  outlineToText,
  pageBookmarks,
  parseOutline,
  readOutlineStyles,
  setAllOpen,
  type TextLine
} from './outlineTools'

const n = (title: string, page: number, children: BookmarkNode[] = [], extra: Partial<BookmarkNode> = {}): BookmarkNode => ({ title, page, children, ...extra })

const pdf = async (pages = 3, rotate = 0) => {
  const d = await PDFDocument.create()
  for (let i = 0; i < pages; i++) {
    const p = d.addPage([200, 300])
    if (rotate) p.setRotation({ type: 'degrees' as never, angle: rotate } as never)
  }
  return d.save()
}

describe('bookmark styles written and read back', () => {
  it('keeps colour, bold, italic, open state and destination', async () => {
    const tree = [n('Part A', 0, [n('Scope', 1, [], { bold: true, italic: true, color: '#ff0000' }), n('Plain', 2)], { open: true }), n('Part B', 2, [n('Hidden', 2)])]
    const out = await writeOutline(await pdf(), tree)
    const styles = await readOutlineStyles(out)
    expect(styles).toHaveLength(5)
    expect(styles[0].open).toBe(true)
    expect(styles[1]).toMatchObject({
      bold: true,
      italic: true,
      color: '#ff0000'
    })
    expect(styles[2].bold).toBeUndefined()
    expect(styles[3].open).toBeUndefined()
    // Flags and colour are in the file as /F and /C.
    const doc = await PDFDocument.load(out)
    const first = doc.catalog.lookup(PDFName.of('Outlines'), PDFDict).lookup(PDFName.of('First'), PDFDict)
    const child = first.lookup(PDFName.of('First'), PDFDict)
    expect(child.get(PDFName.of('F'))?.toString()).toBe('3')
    expect(child.lookup(PDFName.of('C'), PDFArray).size()).toBe(3)
  })
  it('writes a destination for a point in the view and keeps the file destination otherwise', async () => {
    const out = await writeOutline(await pdf(), [n('At', 1, [], { view: { x: 10, y: 50 } }), n('Kept', 1, [], { dest: { left: 5, top: 200 } })])
    const s = await readOutlineStyles(out)
    // Display y 50 from the top of a 300 pt page is 250 up from the bottom.
    expect(s[0].dest).toEqual({ left: 10, top: 250 })
    expect(s[1].dest).toEqual({ left: 5, top: 200 })
  })
  it('converts the view point on a rotated page', async () => {
    const out = await writeOutline(await pdf(1, 90), [n('At', 0, [], { view: { x: 10, y: 50 } })])
    const s = await readOutlineStyles(out)
    expect(s[0].dest).toEqual({ left: 50, top: 10 })
  })
  it('merges styles into a tree only when the sizes agree', () => {
    const tree = [n('a', 0, [n('b', 0)])]
    expect(mergeOutlineStyles(tree, [{ bold: true }, { color: '#00ff00' }])[0].children[0].color).toBe('#00ff00')
    expect(mergeOutlineStyles(tree, [{ bold: true }])).toBe(tree)
  })
  it('opens and closes everything with children', () => {
    const t = setAllOpen([n('a', 0, [n('b', 0, [n('c', 0)])])], true)
    expect(t[0].open).toBe(true)
    expect(t[0].children[0].open).toBe(true)
    expect(t[0].children[0].children[0].open).toBeUndefined()
    expect(setAllOpen(t, false)[0].open).toBe(false)
  })
})

describe('import and export', () => {
  const tree = [n('Part "A", intro', 0, [n('Scope', 1), n('Tab\there', 2)]), n('Part B', -1)]
  it('round-trips text', () => {
    const text = outlineToText(tree)
    expect(text.split('\r\n')[1]).toBe('\tScope\t2')
    const back = parseOutline(text, 5)
    expect(back.tree[0].children.map((c) => [c.title, c.page])).toEqual([
      ['Scope', 1],
      ['Tab here', 2]
    ])
    expect(back.tree[1]).toMatchObject({ title: 'Part B', page: -1 })
    expect(back.skipped).toBe(0)
  })
  it('round-trips CSV with quotes and commas', () => {
    const csv = outlineToCsv(tree)
    expect(csv.split('\r\n')[0]).toBe('Level,Title,Page')
    const back = parseOutline(csv, 5)
    expect(back.tree[0].title).toBe('Part "A", intro')
    expect(back.tree[0].children).toHaveLength(2)
    expect(back.tree[0].children[0].page).toBe(1)
  })
  it('reads a hand-typed outline indented with spaces and reports pages outside the document', () => {
    const r = parseOutline('Intro\t1\n  Background\t2\n  Far away\t99\n      Too deep\n', 3)
    expect(r.tree).toHaveLength(1)
    expect(r.tree[0].children.map((c) => c.title)).toEqual(['Background', 'Far away'])
    expect(r.tree[0].children[1].page).toBe(-1)
    expect(r.outOfRange).toBe(1)
    // A level that jumps ahead goes under the one before.
    expect(r.tree[0].children[1].children[0].title).toBe('Too deep')
  })
  it('skips CSV rows without a usable level or title', () => {
    expect(parseOutline('Level,Title,Page\nx,Bad,1\n1,,2\n1,Good,3', 5)).toMatchObject({ skipped: 2, tree: [{ title: 'Good', page: 2 }] })
  })
})

const line = (page: number, text: string, size: number, y: number, bold = false): TextLine => ({ page, text, size, bold, y })

describe('generating bookmarks', () => {
  const body = (page: number, y: number) => line(page, 'This is a long paragraph of ordinary body text that goes on and on.', 11, y)
  it('finds headings by size and nests them', () => {
    const lines = [
      line(0, 'Project Overview', 20, 40),
      body(0, 80),
      line(0, 'Background', 14, 120),
      body(0, 150),
      body(1, 40),
      line(1, 'Scope of Works', 14, 100),
      body(1, 130),
      line(2, 'Appendices', 20, 40),
      body(2, 80),
      body(2, 100)
    ]
    const tree = nestHeadings(detectHeadings(lines, 3))
    expect(tree.map((x) => x.title)).toEqual(['Project Overview', 'Appendices'])
    expect(tree[0].children.map((x) => [x.title, x.page])).toEqual([
      ['Background', 0],
      ['Scope of Works', 1]
    ])
    expect(tree[0].children[1].view?.y).toBeCloseTo(96)
  })
  it('treats short bold body-size lines as headings and ignores running heads and page numbers', () => {
    const lines: TextLine[] = []
    for (let p = 0; p < 6; p++) {
      lines.push(line(p, 'Culvert Report', 14, 10), body(p, 60), body(p, 80), line(p, `Page ${p + 1}`, 9, 290))
    }
    lines.push(line(2, 'Hydraulic design', 11, 120, true))
    const found = detectHeadings(lines, 6)
    expect(found.map((h) => h.title)).toEqual(['Hydraulic design'])
  })
  it('joins a heading that wraps onto two lines', () => {
    const found = detectHeadings([line(0, 'A very long heading that', 18, 40), line(0, 'wraps to a second line', 18, 62), body(0, 100), body(0, 120)], 1)
    expect(found).toHaveLength(1)
    expect(found[0].title).toBe('A very long heading that wraps to a second line')
  })
  it('limits the number of levels', () => {
    const lines = [line(0, 'One', 30, 10), line(0, 'Two', 24, 50), line(0, 'Three', 18, 90), line(0, 'Four', 14, 130), body(0, 160), body(0, 180), body(0, 200)]
    expect(
      detectHeadings(lines, 1, {
        maxLevels: 2,
        includeBold: false,
        minRatio: 1.15
      }).map((h) => h.level)
    ).toEqual([0, 1, 1, 1])
  })
  it('makes one bookmark per page, using page labels when there are some', () => {
    expect(pageBookmarks(3, null).map((b) => b.title)).toEqual(['Page 1', 'Page 2', 'Page 3'])
    expect(pageBookmarks(2, ['i', 'ii']).map((b) => b.title)).toEqual(['i', 'ii'])
  })
  it('builds lines from text objects, joining pieces on one baseline', () => {
    const o = (x: number, y: number, text: string, size = 12, weight = 400) => ({
      rect: { x, y, w: text.length * 6, h: size },
      text,
      size,
      weight,
      font: 'Arial',
      matrix: [1, 0, 0, 1, 0, 0],
      mode: 0
    })
    const lines = linesFromObjects(2, [o(100, 50, 'world', 12, 700), o(10, 50, 'Hello', 12, 700), o(10, 100, 'Next', 12)])
    expect(lines.map((l) => [l.text, l.bold, l.page])).toEqual([
      ['Hello world', true, 2],
      ['Next', false, 2]
    ])
  })
})
