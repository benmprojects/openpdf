import { PDFArray, PDFDict, PDFDocument, PDFName } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import { EMPTY_DOC_ACTIONS, hasDocActions, readDocActions, writeDocActions } from './docActions'
import { readViewPrefs, writeViewPrefs } from './viewPrefs'

async function blank(): Promise<Uint8Array> {
  const d = await PDFDocument.create()
  d.addPage([200, 200])
  d.addPage([200, 200])
  return d.save()
}

describe('document actions', () => {
  it('writes and reads all six', async () => {
    const a = { open: 'console.println("open");', willClose: 'var c = 1;', willSave: 'var s = 1;', didSave: 'var d = 1;', willPrint: 'var p = 1;', didPrint: 'var q = 1;' }
    const out = await writeDocActions(await blank(), a)
    expect(await readDocActions(out)).toEqual(a)
    const doc = await PDFDocument.load(out)
    const aa = doc.catalog.lookupMaybe(PDFName.of('AA'), PDFDict)!
    expect(aa.keys().map((k) => k.decodeText()).sort()).toEqual(['DP', 'DS', 'WC', 'WP', 'WS'])
    expect(doc.catalog.lookup(PDFName.of('OpenAction'))).toBeInstanceOf(PDFDict)
  })

  it('removes an action when its script is emptied, and the /AA dictionary when none is left', async () => {
    const one = await writeDocActions(await blank(), { ...EMPTY_DOC_ACTIONS, didSave: 'x();' })
    const none = await writeDocActions(one, EMPTY_DOC_ACTIONS)
    expect(hasDocActions(await readDocActions(none))).toBe(false)
    const doc = await PDFDocument.load(none)
    expect(doc.catalog.has(PDFName.of('AA'))).toBe(false)
  })

  it('keeps a destination open action and chains the script after it', async () => {
    let b = await blank()
    b = await writeViewPrefs(b, { ...(await readViewPrefs(b)), openPage: 2, magnification: { kind: 'fit-page' } })
    const withScript = await writeDocActions(b, { ...EMPTY_DOC_ACTIONS, open: 'console.println("hi");' })
    const view = await readViewPrefs(withScript)
    expect(view.openPage).toBe(2)
    expect(view.foreignOpenAction).toBe(false)
    expect((await readDocActions(withScript)).open).toBe('console.println("hi");')
    // Changing the initial view afterwards keeps the script.
    const moved = await writeViewPrefs(withScript, { ...view, openPage: 1, magnification: { kind: 'fit-width' } })
    expect((await readDocActions(moved)).open).toBe('console.println("hi");')
    expect((await readViewPrefs(moved)).magnification).toEqual({ kind: 'fit-width' })
    // Removing the script leaves the page and magnification as they were.
    const cleared = await writeDocActions(moved, EMPTY_DOC_ACTIONS)
    expect((await readDocActions(cleared)).open).toBe('')
    expect((await readViewPrefs(cleared)).magnification).toEqual({ kind: 'fit-width' })
    const oa = (await PDFDocument.load(cleared)).catalog.lookup(PDFName.of('OpenAction'))
    expect(oa instanceof PDFArray || oa instanceof PDFDict).toBe(true)
  })

  it('replaces a script that is already the open action', async () => {
    const a = await writeDocActions(await blank(), { ...EMPTY_DOC_ACTIONS, open: 'one();' })
    const b = await writeDocActions(a, { ...EMPTY_DOC_ACTIONS, open: 'two();' })
    expect((await readDocActions(b)).open).toBe('two();')
    const c = await writeDocActions(b, EMPTY_DOC_ACTIONS)
    expect((await PDFDocument.load(c)).catalog.has(PDFName.of('OpenAction'))).toBe(false)
  })
})
