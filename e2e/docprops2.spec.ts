import { _electron as electron, expect, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFNumber } from 'pdf-lib'

const root = resolve(__dirname, '..')

const launch = (dir: string, pdf: string) =>
  electron.launch({ args: ['.', pdf], cwd: root, env: { ...process.env, OPENPDF_E2E: '1', OPENPDF_E2E_USERDATA: join(dir, 'ud'), OPENPDF_E2E_DISCARD: '1' } })

test('initial view, custom properties, fonts and print presets are written, honoured and used', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'openpdf-e2e-'))
  const pdfPath = join(dir, 'props2.pdf')
  execFileSync('python', [join(root, 'scripts', 'make-test-pdf.py'), pdfPath])
  let app = await launch(dir, pdfPath)
  try {
    let win = await app.firstWindow()
    const problems: string[] = []
    win.on('pageerror', (e) => problems.push(e.message))
    await expect(win.locator('.page')).toHaveCount(6)
    await win.getByRole('tab', { name: 'File', exact: true }).click()
    await win.getByRole('button', { name: 'Properties' }).click()
    const dialog = win.getByRole('dialog', { name: 'Document properties' })

    // Fonts come from the file's own font dictionaries.
    await dialog.getByRole('tab', { name: 'Fonts' }).click()
    const fonts = dialog.getByRole('table', { name: 'Fonts used' })
    await expect(fonts).toBeVisible()
    await expect(fonts.getByRole('row', { name: /Helvetica.*Type 1.*No.*No/ })).toBeVisible()

    // Initial view.
    await dialog.getByRole('tab', { name: 'Initial View' }).click()
    await dialog.getByLabel('Page layout').selectOption({ label: 'Two pages, continuous' })
    await dialog.getByLabel('Navigation tab').selectOption({ label: 'Bookmarks and page' })
    await dialog.getByLabel('Magnification', { exact: true }).selectOption({ label: 'Percentage' })
    await dialog.getByLabel('Magnification percentage').fill('150')
    await dialog.getByLabel('Open to page').fill('3')
    await dialog.getByRole('checkbox', { name: /Show document title/ }).check()

    // Custom properties: add, then an empty name is refused.
    await dialog.getByRole('tab', { name: 'Custom' }).click()
    await dialog.getByRole('button', { name: 'Add property' }).click()
    await dialog.getByRole('button', { name: 'Apply' }).click()
    await expect(dialog.getByRole('alert')).toContainText('needs a name')
    await dialog.getByLabel('Property name 1').fill('Project')
    await dialog.getByLabel('Property value 1').fill('Example park')

    // Print presets.
    await dialog.getByRole('tab', { name: 'Print presets' }).click()
    await dialog.getByLabel('Preset page scaling').selectOption({ label: 'None (actual size)' })
    await dialog.getByLabel('Preset two-sided printing').selectOption({ label: 'Both sides, flip on the long edge' })
    await dialog.getByLabel('Preset copies').fill('3')
    await dialog.getByLabel('Preset page range').fill('2-4')
    await dialog.getByRole('button', { name: 'Apply' }).click()
    await expect(win.getByText('Document properties updated')).toBeVisible()
    await win.keyboard.press('Control+s')
    await expect(win.locator('.tab-dirty')).toHaveCount(0)

    // What was written.
    const doc = await PDFDocument.load(readFileSync(pdfPath))
    expect(doc.catalog.lookup(PDFName.of('PageLayout'))).toEqual(PDFName.of('TwoColumnLeft'))
    expect(doc.catalog.lookup(PDFName.of('PageMode'))).toEqual(PDFName.of('UseOutlines'))
    const open = doc.catalog.lookup(PDFName.of('OpenAction'), PDFArray)
    expect(open.get(0)).toBe(doc.getPage(2).ref)
    expect((open.lookup(4, PDFNumber) as PDFNumber).asNumber()).toBe(1.5)
    const vp = doc.catalog.lookup(PDFName.of('ViewerPreferences'), PDFDict)
    expect(vp.get(PDFName.of('DisplayDocTitle'))?.toString()).toBe('true')
    expect(vp.get(PDFName.of('PrintScaling'))).toEqual(PDFName.of('None'))
    expect(vp.get(PDFName.of('Duplex'))).toEqual(PDFName.of('DuplexFlipLongEdge'))
    expect((vp.lookup(PDFName.of('NumCopies'), PDFNumber)).asNumber()).toBe(3)
    expect(vp.lookup(PDFName.of('PrintPageRange'), PDFArray).asArray().map((n) => (n as PDFNumber).asNumber())).toEqual([2, 4])
    const info = doc.context.lookup(doc.context.trailerInfo.Info, PDFDict)
    expect((info.lookup(PDFName.of('Project')) as PDFHexString).decodeText()).toBe('Example park')

    // The saved custom property shows again in the dialog.
    await win.getByRole('button', { name: 'Properties' }).click()
    await dialog.getByRole('tab', { name: 'Custom' }).click()
    await expect(dialog.getByLabel('Property value 1')).toHaveValue('Example park')
    await dialog.getByRole('button', { name: 'Cancel' }).click()
    expect(problems).toEqual([])
    await app.close()

    // Opening the saved file again follows its initial view.
    app = await launch(dir, pdfPath)
    win = await app.firstWindow()
    await expect(win.locator('.page')).toHaveCount(6)
    await expect(win.getByRole('tab', { name: 'Bookmarks' })).toHaveAttribute('aria-selected', 'true')
    await expect(win.locator('.zoom-now')).toHaveText('150%')
    await expect(win.getByLabel('Page number')).toHaveValue('3')
    await win.getByRole('tab', { name: 'View', exact: true }).click()
    await expect(win.getByRole('button', { name: 'Two pages' })).toHaveAttribute('aria-pressed', 'true')

    // The Print dialog starts with the document's presets.
    await win.keyboard.press('Control+p')
    const print = win.getByRole('dialog', { name: 'Print' })
    await expect(print.getByLabel('Copies')).toHaveValue('3')
    await expect(print.getByLabel('Page range', { exact: true })).toHaveValue('custom')
    await expect(print.getByRole('textbox', { name: /Page range, for example/ })).toHaveValue('2-4')
    await expect(print.getByLabel('Page scaling')).toHaveValue('actual')
    await expect(print.getByText('Started with the print settings saved in this document.')).toBeVisible()
  } finally {
    await app.close().catch(() => undefined)
    rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 })
  }
})
