import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNull } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import { pageContent } from './pageContent'
import { contentOfTag, findTag, flattenTags, markArtifact, moveTag, readDocAccess, readTagTree, setDocAccess, setTagText, setTagType, standardRole, validLangTag, withXmpTitle } from './structTree'
import { buildTaggedPdf } from './tagFixture'

describe('readTagTree', () => {
  it('reads types, pages and marked content', async () => {
    const t = await readTagTree(await buildTaggedPdf())
    expect(t.roots).toHaveLength(1)
    const doc = t.roots[0]
    expect(doc.type).toBe('Document')
    expect(doc.children.map((c) => c.type)).toEqual(['H1', 'P', 'Figure', 'H3', 'P'])
    expect(doc.children.map((c) => c.page)).toEqual([0, 0, 0, 1, 1])
    expect(doc.children[2].content).toEqual([{ page: 0, mcid: 2 }])
    expect(doc.children[3].id).toBe('0/3')
    expect(contentOfTag(doc)).toHaveLength(5)
    expect(t.count).toBe(6)
  })

  it('gives nothing for an untagged file', async () => {
    const d = await PDFDocument.create()
    d.addPage()
    expect((await readTagTree(await d.save())).roots).toEqual([])
  })

  it('follows the role map', () => {
    expect(standardRole('Heading', { Heading: 'H1' })).toBe('H1')
    expect(standardRole('Loop', { Loop: 'Loop2', Loop2: 'Loop' })).toBe('')
    expect(standardRole('P', {})).toBe('P')
  })
})

describe('tag edits', () => {
  it('sets and clears alternative text, title and language', async () => {
    let bytes = await buildTaggedPdf()
    bytes = await setTagText(bytes, '0/2', { alt: 'A bar chart of costs', title: 'Costs', lang: 'en-AU' })
    let fig = findTag((await readTagTree(bytes)).roots, '0/2')!
    expect([fig.alt, fig.title, fig.lang]).toEqual(['A bar chart of costs', 'Costs', 'en-AU'])
    bytes = await setTagText(bytes, '0/2', { alt: '' })
    fig = findTag((await readTagTree(bytes)).roots, '0/2')!
    expect(fig.alt).toBe('')
    expect(fig.title).toBe('Costs')
  })

  it('changes a type, and refuses a bad one', async () => {
    const bytes = await setTagType(await buildTaggedPdf(), '0/3', 'H2')
    expect(findTag((await readTagTree(bytes)).roots, '0/3')!.type).toBe('H2')
    await expect(setTagType(bytes, '0/3', 'bad type')).rejects.toThrow()
    await expect(setTagText(bytes, '9/9', { alt: 'x' })).rejects.toThrow()
  })

  it('moves an element among its siblings and stops at the ends', async () => {
    const bytes = await buildTaggedPdf()
    const r = await moveTag(bytes, '0/1', -1)
    expect(r.moved).toBe(true)
    expect(r.id).toBe('0/0')
    expect((await readTagTree(r.bytes)).roots[0].children.map((c) => c.type)).toEqual(['P', 'H1', 'Figure', 'H3', 'P'])
    expect((await moveTag(r.bytes, '0/0', -1)).moved).toBe(false)
    expect((await moveTag(r.bytes, '0/4', 1)).moved).toBe(false)
  })

  it('marks an element as an artefact: out of the tree, re-marked in the page content', async () => {
    const bytes = await buildTaggedPdf()
    const r = await markArtifact(bytes, '0/2')
    expect(r.marked).toBe(1)
    const t = await readTagTree(r.bytes)
    expect(t.roots[0].children.map((c) => c.type)).toEqual(['H1', 'P', 'H3', 'P'])
    const doc = await PDFDocument.load(r.bytes)
    const src = pageContent(doc.getPage(0))
    expect(src).toContain('/Artifact BMC 20 200 100 80 re f EMC')
    expect(src).not.toContain('/MCID 2')
    expect(src).toContain('/MCID 1')
    // The parent tree no longer points at the removed element.
    const parentTree = doc.catalog.lookupMaybe(PDFName.of('StructTreeRoot'), PDFDict)!.lookupMaybe(PDFName.of('ParentTree'), PDFDict)!
    const entries = parentTree.lookupMaybe(PDFName.of('Nums'), PDFArray)!.lookupMaybe(1, PDFArray)!
    expect(entries.size()).toBe(3)
    expect(entries.lookup(2)).toBe(PDFNull)
    expect(entries.lookup(1)).not.toBe(PDFNull)
  })
})

describe('document language and title', () => {
  it('reads and writes them', async () => {
    const before = await readDocAccess(await buildTaggedPdf())
    expect(before).toMatchObject({ title: '', lang: '', displayTitle: false, marked: true, tagged: true })
    const bytes = await setDocAccess(await buildTaggedPdf(), { title: 'Site report', lang: 'en-AU' })
    expect(await readDocAccess(bytes)).toMatchObject({ title: 'Site report', lang: 'en-AU', displayTitle: true })
    const cleared = await setDocAccess(bytes, { title: '', lang: '' })
    expect(await readDocAccess(cleared)).toMatchObject({ title: '', lang: '' })
    await expect(setDocAccess(bytes, { title: 'x', lang: 'not a tag' })).rejects.toThrow()
  })

  it('accepts language tags of the usual shapes', () => {
    for (const ok of ['en', 'en-AU', 'zh-Hant-TW', 'fil']) expect(validLangTag(ok)).toBe(true)
    for (const bad of ['', 'e', 'english language', 'en_AU']) expect(validLangTag(bad)).toBe(false)
  })

  it('replaces or adds the title in an XMP packet and keeps the rest', () => {
    const xmp = '<x:xmpmeta><rdf:RDF><rdf:Description pdfuaid:part="1"><dc:title><rdf:Alt><rdf:li xml:lang="x-default">Old</rdf:li></rdf:Alt></dc:title></rdf:Description></rdf:RDF></x:xmpmeta>'
    const next = withXmpTitle(xmp, 'New & better')
    expect(next).toContain('New &amp; better')
    expect(next).not.toContain('Old')
    expect(next).toContain('pdfuaid:part="1"')
    const added = withXmpTitle('<rdf:RDF><rdf:Description pdfaid:part="2"/></rdf:RDF>', 'Hello')
    expect(added).toContain('<dc:title>')
    expect(added).toContain('xmlns:dc=')
    expect(added).toContain('</rdf:Description>')
  })
})

describe('helpers', () => {
  it('lists every node', async () => {
    const t = await readTagTree(await buildTaggedPdf())
    expect(flattenTags(t.roots)).toHaveLength(6)
  })
})
