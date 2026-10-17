import { describe, expect, it } from 'vitest'
import { PDFDocument, PDFName, PDFString } from 'pdf-lib'
import { bookmarkPages, copyAt, cutAt, findBrokenBookmarks, flatten, pasteAfter, removeMany } from './outlineClip'
import { readNamedDestinations, readOutlineTree } from './outlineRead'
import { writeOutline, type BookmarkNode } from './outlineEdit'

const n = (title: string, page: number, children: BookmarkNode[] = []): BookmarkNode => ({ title, page, children })
const tree = [n('A', 0, [n('A1', 1), n('A2', 3)]), n('B', 4), n('C', 4, [n('C1', 6)]), n('D', 8)]

describe('copy, cut and paste', () => {
  it('copies a bookmark with its children and does not change the tree', () => {
    const c = copyAt(tree, [0])!
    expect(c.children.map((x) => x.title)).toEqual(['A1', 'A2'])
    c.title = 'changed'
    expect(tree[0].title).toBe('A')
  })
  it('cuts and pastes after another bookmark, even as a child level', () => {
    const cut = cutAt(tree, [0, 1])!
    expect(cut.node.title).toBe('A2')
    expect(cut.tree[0].children.map((x) => x.title)).toEqual(['A1'])
    const pasted = pasteAfter(cut.tree, [3], [cut.node], 10)
    expect(pasted.tree.map((x) => x.title)).toEqual(['A', 'B', 'C', 'D', 'A2'])
    expect(pasted.path).toEqual([4])
  })
  it('pastes at the end when nothing is selected and clears pages the document does not have', () => {
    const r = pasteAfter([n('X', 0)], null, [n('far', 40, [n('near', 2)])], 5)
    expect(r.tree[1].page).toBe(-1)
    expect(r.tree[1].children[0].page).toBe(2)
  })
})

describe('bookmarkPages', () => {
  it('runs to the page before the next bookmark of the same or a higher level', () => {
    expect(bookmarkPages(tree, [0], 10)).toEqual({ first: 0, last: 3 }) // A until B starts on page 5 (index 4)
    expect(bookmarkPages(tree, [0, 0], 10)).toEqual({ first: 1, last: 2 }) // A1 until A2 (index 3)
    expect(bookmarkPages(tree, [0, 1], 10)).toEqual({ first: 3, last: 3 }) // A2 until B (index 4)
    expect(bookmarkPages(tree, [1], 10)).toEqual({ first: 4, last: 4 }) // B and C start on the same page
    expect(bookmarkPages(tree, [2], 10)).toEqual({ first: 4, last: 7 })
    expect(bookmarkPages(tree, [3], 10)).toEqual({ first: 8, last: 9 })
  })
  it('has nothing for a bookmark without a page', () => {
    expect(bookmarkPages([n('x', -1)], [0], 3)).toBeNull()
  })
})

describe('findBrokenBookmarks', () => {
  it('lists bookmarks with no destination, a missing page or an undefined name', () => {
    const t = [n('ok', 1), n('none', -1), { ...n('named ok', 2), named: 'here' }, { ...n('named bad', -1), named: 'gone' }, n('far', 12, [n('inner none', -1)])]
    const broken = findBrokenBookmarks(t, 5, new Set(['here']))
    expect(broken.map((b) => [b.title, b.reason])).toEqual([
      ['none', 'no-destination'],
      ['named bad', 'name-missing'],
      ['far', 'page-missing'],
      ['inner none', 'no-destination']
    ])
    expect(findBrokenBookmarks(t, 5, null).some((b) => b.reason === 'name-missing')).toBe(false)
  })
  it('removeMany takes out nested and later bookmarks without shifting the others', () => {
    const left = removeMany(tree, [[0, 0], [0], [2, 0]])
    expect(left.map((x) => x.title)).toEqual(['B', 'C', 'D'])
    expect(left[1].children).toEqual([])
    expect(flatten(tree).length).toBe(7)
  })
})

describe('reading and writing named destinations', () => {
  it('round-trips a bookmark to a named destination and lists the names', async () => {
    const doc = await PDFDocument.create()
    for (let i = 0; i < 3; i++) doc.addPage([200, 200])
    // A name tree with one destination on page 2.
    const dests = doc.context.obj({ Names: [PDFString.of('chapter2'), [doc.getPage(1).ref, 'XYZ', 0, 100, null]] })
    doc.catalog.set(PDFName.of('Names'), doc.context.obj({ Dests: dests }))
    const base = await doc.save()
    expect((await readNamedDestinations(base)).map((d) => [d.name, d.page])).toEqual([['chapter2', 1]])
    const out = await writeOutline(base, [{ title: 'Go to chapter', page: 1, named: 'chapter2', children: [] }, n('Plain', 2)])
    const back = await readOutlineTree(out)
    expect(back[0]).toMatchObject({ title: 'Go to chapter', named: 'chapter2', page: 1 })
    expect(back[1]).toMatchObject({ title: 'Plain', page: 2 })
    expect(back[1].named).toBeUndefined()
  })
})
