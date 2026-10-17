import { PDFDict, PDFDocument, PDFName, PDFString } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import { checkLinkAction, draftFromLink, findUrls, isWebLink, linkActionObject, linkActionOf, newLinkDraft, targetFromDraft, webAddress } from './linkLogic'

describe('web addresses in text', () => {
  it('finds addresses and leaves out the punctuation after them', () => {
    const text = 'See https://example.com/specs/a.pdf, or (www.example.org/page). Also http://example.net/x?y=1; done.'
    const found = findUrls(text)
    expect(found.map((f) => f.url)).toEqual(['https://example.com/specs/a.pdf', 'https://www.example.org/page', 'http://example.net/x?y=1'])
    expect(found.map((f) => text.slice(f.from, f.end))).toEqual(['https://example.com/specs/a.pdf', 'www.example.org/page', 'http://example.net/x?y=1'])
  })

  it('keeps a closing bracket that belongs to the address', () => {
    expect(webAddress('https://example.com/wiki/Page_(disambiguation)')).toBe('https://example.com/wiki/Page_(disambiguation)')
    expect(webAddress('https://example.com/a)')).toBe('https://example.com/a')
  })

  it('refuses things that are not web addresses', () => {
    expect(webAddress('ftp://example.com/a')).toBeNull()
    expect(webAddress('javascript:alert(1)')).toBeNull()
    expect(webAddress('https://localhost/a')).toBeNull()
    expect(webAddress('https://user:pw@example.com/')).toBeNull()
    expect(webAddress('www.')).toBeNull()
    expect(findUrls('no links here, only version 1.2.3')).toEqual([])
  })

  it('accepts a mail address that is already a link', () => {
    expect(webAddress('mailto:office@example.com')).toBe('mailto:office@example.com')
  })

  it('knows which links are web links', () => {
    expect(isWebLink({ linkUri: 'https://example.com' })).toBe(true)
    expect(isWebLink({ linkUri: 'mailto:a@b.co' })).toBe(true)
    expect(isWebLink({ linkUri: undefined })).toBe(false)
  })
})

describe('link actions', () => {
  it('checks them before they are written', () => {
    expect(checkLinkAction({ kind: 'file', path: 'plan.pdf' })).toBeNull()
    expect(checkLinkAction({ kind: 'file', path: 'tool.exe' })).not.toBeNull()
    expect(checkLinkAction({ kind: 'js', code: '' })).not.toBeNull()
    expect(checkLinkAction({ kind: 'js', code: 'app.alert(1)' })).toBeNull()
    expect(checkLinkAction({ kind: 'named', name: '' })).not.toBeNull()
    expect(checkLinkAction({ kind: 'named', name: 'Chapter1' })).toBeNull()
  })

  it('writes actions that read back the same', async () => {
    const doc = await PDFDocument.create()
    for (const a of [
      { kind: 'file', path: 'C:\\Projects\\plan.dwg' },
      { kind: 'js', code: 'console.println("x");' },
      { kind: 'named', name: 'Chapter1' }
    ] as const) {
      const d = doc.context.obj(linkActionObject(a) as never) as unknown as unknown as PDFDict
      const back = linkActionOf(d)
      expect(back).toEqual(a.kind === 'file' ? { kind: 'file', path: 'C:/Projects/plan.dwg' } : a)
    }
    const launch = doc.context.obj(linkActionObject({ kind: 'file', path: 'a.pdf' }) as never) as unknown as unknown as PDFDict
    expect(launch.lookup(PDFName.of('S'))).toBe(PDFName.of('Launch'))
  })

  it('reads a file given as a specification dictionary, and ignores other actions', async () => {
    const doc = await PDFDocument.create()
    const spec = doc.context.obj({ S: 'Launch', F: { Type: 'Filespec', F: PDFString.of('x.pdf') } }) as unknown as PDFDict
    expect(linkActionOf(spec)).toEqual({ kind: 'file', path: 'x.pdf' })
    expect(linkActionOf(doc.context.obj({ S: 'URI' }) as PDFDict)).toBeUndefined()
    expect(linkActionOf(undefined)).toBeUndefined()
  })
})

describe('the link dialog draft', () => {
  const rect = { x: 1, y: 2, w: 30, h: 10 }
  it('starts on a web address and suggests the next page', () => {
    const d = newLinkDraft(0, rect, 5)
    expect(d.to).toBe('uri')
    expect(d.page1).toBe('2')
    expect(newLinkDraft(4, rect, 5).page1).toBe('5')
  })

  it('turns each kind of target into what the annotation stores', () => {
    const base = newLinkDraft(0, rect, 5)
    expect(targetFromDraft({ ...base, to: 'page', page1: '3' }, 5)).toEqual({ ok: true, target: { linkPage: 2 } })
    expect(targetFromDraft({ ...base, to: 'page', page1: '9' }, 5).ok).toBe(false)
    expect(targetFromDraft({ ...base, to: 'uri', uri: ' https://example.com/a ' }, 5)).toEqual({ ok: true, target: { linkUri: 'https://example.com/a' } })
    expect(targetFromDraft({ ...base, to: 'uri', uri: 'example' }, 5).ok).toBe(false)
    expect(targetFromDraft({ ...base, to: 'file', file: 'plan.pdf' }, 5)).toEqual({ ok: true, target: { linkAction: { kind: 'file', path: 'plan.pdf' } } })
    expect(targetFromDraft({ ...base, to: 'file', file: 'run.exe' }, 5).ok).toBe(false)
    expect(targetFromDraft({ ...base, to: 'js', code: 'x()' }, 5)).toEqual({ ok: true, target: { linkAction: { kind: 'js', code: 'x()' } } })
    expect(targetFromDraft({ ...base, to: 'named', named: 'Top' }, 5)).toEqual({ ok: true, target: { linkAction: { kind: 'named', name: 'Top' } } })
    expect(targetFromDraft({ ...base, to: 'named', named: ' ' }, 5).ok).toBe(false)
  })

  it('reads an existing link back into the dialog', () => {
    const a = { id: 7, page: 1, rects: [rect] }
    expect(draftFromLink({ ...a, linkUri: 'https://example.com' }).to).toBe('uri')
    expect(draftFromLink({ ...a, linkPage: 3 })).toMatchObject({ to: 'page', page1: '4' })
    expect(draftFromLink({ ...a, linkAction: { kind: 'file', path: 'a.pdf' } })).toMatchObject({ to: 'file', file: 'a.pdf', id: 7 })
    expect(draftFromLink({ ...a, linkPage: 2, linkAction: { kind: 'named', name: 'N' } })).toMatchObject({ to: 'named', named: 'N' })
    expect(draftFromLink({ ...a, linkAction: { kind: 'js', code: 'q' } }).code).toBe('q')
  })
})
