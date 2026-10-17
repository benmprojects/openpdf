import { describe, expect, it } from 'vitest'
import { PDFDict, PDFDocument, PDFName } from 'pdf-lib'
import { DEFAULT_VIEW_PREFS, matchPaper, openViewFrom, printDefaults, parsePrintRange, printRangeText, readViewPrefs, writeViewPrefs, type ViewPrefs } from './viewPrefs'

async function blank(pages = 4): Promise<Uint8Array> {
  const d = await PDFDocument.create()
  for (let i = 0; i < pages; i++) d.addPage([200, 300])
  return d.save()
}

const prefs = (over: Partial<ViewPrefs>): ViewPrefs => ({ ...DEFAULT_VIEW_PREFS, printRange: [], ...over })

describe('view prefs', () => {
  it('reads defaults from a plain file', async () => {
    expect(await readViewPrefs(await blank())).toEqual(DEFAULT_VIEW_PREFS)
  })

  it('writes the initial view and reads it back', async () => {
    const v = prefs({
      layout: 'TwoColumnRight',
      pageMode: 'UseOutlines',
      magnification: { kind: 'zoom', percent: 150 },
      openPage: 3,
      fitWindow: true,
      centreWindow: true,
      displayTitle: true,
      hideToolbar: true
    })
    const back = await readViewPrefs(await writeViewPrefs(await blank(), v))
    expect(back).toEqual(v)
  })

  it('keeps each fit kind', async () => {
    for (const kind of ['fit-page', 'fit-width', 'fit-visible'] as const) {
      const back = await readViewPrefs(await writeViewPrefs(await blank(), prefs({ magnification: { kind }, openPage: 2 })))
      expect(back.magnification).toEqual({ kind })
      expect(back.openPage).toBe(2)
    }
  })

  it('writes print presets', async () => {
    const v = prefs({ printScaling: 'None', duplex: 'DuplexFlipLongEdge', numCopies: 3, pickTray: true, printRange: [[1, 2], [4, 4]] })
    const out = await writeViewPrefs(await blank(), v)
    const back = await readViewPrefs(out)
    expect(back).toEqual(v)
    const doc = await PDFDocument.load(out)
    const vp = doc.catalog.lookup(PDFName.of('ViewerPreferences'), PDFDict)
    expect(vp.get(PDFName.of('PrintScaling'))).toEqual(PDFName.of('None'))
  })

  it('removes entries that go back to the default, and the dictionary when it is empty', async () => {
    const set = await writeViewPrefs(await blank(), prefs({ layout: 'OneColumn', pageMode: 'UseThumbs', hideToolbar: true, openPage: 2, numCopies: 2 }))
    const cleared = await writeViewPrefs(set, DEFAULT_VIEW_PREFS)
    const doc = await PDFDocument.load(cleared)
    for (const k of ['PageLayout', 'PageMode', 'OpenAction', 'ViewerPreferences']) expect(doc.catalog.has(PDFName.of(k))).toBe(false)
  })

  it('leaves other viewer preferences alone', async () => {
    const d = await PDFDocument.load(await blank())
    d.catalog.set(PDFName.of('ViewerPreferences'), d.context.obj({ Direction: 'R2L', HideMenubar: true }))
    const out = await writeViewPrefs(await d.save(), prefs({ hideToolbar: true }))
    const doc = await PDFDocument.load(out)
    const vp = doc.catalog.lookup(PDFName.of('ViewerPreferences'), PDFDict)
    expect(vp.get(PDFName.of('Direction'))).toEqual(PDFName.of('R2L'))
    expect((await readViewPrefs(out)).hideToolbar).toBe(true)
  })

  it('does not overwrite an open action that is a script', async () => {
    const d = await PDFDocument.load(await blank())
    d.catalog.set(PDFName.of('OpenAction'), d.context.obj({ S: 'JavaScript', JS: 'app.alert(1)' }))
    const first = await readViewPrefs(await d.save())
    expect(first.foreignOpenAction).toBe(true)
    const out = await writeViewPrefs(await d.save(), prefs({ openPage: 3, magnification: { kind: 'fit-page' } }))
    const doc = await PDFDocument.load(out)
    expect((doc.catalog.lookup(PDFName.of('OpenAction'), PDFDict)).get(PDFName.of('S'))).toEqual(PDFName.of('JavaScript'))
  })

  it('reads a GoTo action as the open page', async () => {
    const d = await PDFDocument.load(await blank())
    const ref = d.getPage(2).ref
    d.catalog.set(PDFName.of('OpenAction'), d.context.obj({ S: 'GoTo', D: [ref, PDFName.of('Fit')] }))
    const v = await readViewPrefs(await d.save())
    expect(v.openPage).toBe(3)
    expect(v.magnification).toEqual({ kind: 'fit-page' })
  })

  it('clamps the open page to the document', async () => {
    const back = await readViewPrefs(await writeViewPrefs(await blank(3), prefs({ openPage: 99, magnification: { kind: 'fit-width' } })))
    expect(back.openPage).toBe(3)
  })

  it('turns the prefs into what the viewer does', () => {
    expect(openViewFrom(DEFAULT_VIEW_PREFS)).toEqual({ hideToolbar: false, displayTitle: false })
    const o = openViewFrom(prefs({ layout: 'TwoPageRight', pageMode: 'UseThumbs', magnification: { kind: 'zoom', percent: 125 }, openPage: 4, hideWindowUI: true }))
    expect(o).toMatchObject({ twoUp: true, continuous: false, cover: true, sidebar: 'pages', zoom: 1.25, page: 3, hideToolbar: true })
    expect(openViewFrom(prefs({ pageMode: 'UseNone' })).sidebar).toBeNull()
  })

  it('turns print presets into dialog defaults', () => {
    expect(printDefaults(DEFAULT_VIEW_PREFS, 10).any).toBe(false)
    const d = printDefaults(prefs({ numCopies: 2, duplex: 'DuplexFlipShortEdge', printScaling: 'None', printRange: [[2, 4]], pickTray: true }), 10, { width: 595, height: 842 })
    expect(d).toEqual({ copies: 2, duplex: 'short', scaling: 'actual', rangeText: '2-4', paper: 'A4', any: true })
    // A range beyond the document, or a page that matches no paper, is ignored.
    expect(printDefaults(prefs({ printRange: [[2, 40]], pickTray: true }), 10, { width: 300, height: 300 })).toMatchObject({ rangeText: '', paper: null, any: false })
  })

  it('matches a page to a paper size in either orientation', () => {
    expect(matchPaper({ width: 841.9, height: 595.3 })).toBe('A4')
    expect(matchPaper({ width: 1190, height: 842 })).toBe('A3')
    expect(matchPaper({ width: 500, height: 500 })).toBeNull()
  })

  it('parses and prints page ranges', () => {
    expect(parsePrintRange('1-3, 5', 6)).toEqual([[1, 3], [5, 5]])
    expect(printRangeText([[1, 3], [5, 5]])).toBe('1-3, 5')
    expect(parsePrintRange('', 6)).toEqual([])
    expect(() => parsePrintRange('7', 6)).toThrow(/outside/)
    expect(() => parsePrintRange('3-1', 6)).toThrow()
    expect(() => parsePrintRange('a', 6)).toThrow(/not a page/)
  })
})
