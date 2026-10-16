import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(__dirname, '..')

const firstLines = (path: string): string[] =>
  JSON.parse(execFileSync('python', ['-c', 'import sys, json, pymupdf\nprint(json.dumps([p.get_text().strip().splitlines()[0] if p.get_text().strip() else "" for p in pymupdf.open(sys.argv[1])]))', path]).toString())

async function launch(dir: string): Promise<{ app: ElectronApplication; win: Page; pdfPath: string; outDir: string; problems: string[] }> {
  const pdfPath = join(dir, 'pages.pdf')
  const other = join(dir, 'other.pdf')
  const outDir = join(dir, 'out')
  mkdirSync(outDir)
  execFileSync('python', [join(root, 'scripts', 'make-test-pdf.py'), pdfPath])
  execFileSync('npx', ['tsx', join(root, 'scripts', 'make-feature-pdf.mts'), other], { cwd: root, shell: true })
  const app = await electron.launch({
    args: ['.', pdfPath],
    cwd: root,
    env: { ...process.env, OPENPDF_E2E: '1', OPENPDF_E2E_USERDATA: join(dir, 'ud'), OPENPDF_E2E_PICK: other, OPENPDF_E2E_DIR: outDir, OPENPDF_E2E_DISCARD: '1' }
  })
  const win = await app.firstWindow()
  const problems: string[] = []
  win.on('pageerror', (e) => problems.push(e.message))
  await expect(win.locator('.page')).toHaveCount(6)
  await win.getByRole('tab', { name: 'Organise' }).click()
  return { app, win, pdfPath, outDir, problems }
}

test('insert, delete, move and duplicate through their dialogs', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'openpdf-e2e-'))
  const { app, win, pdfPath, problems } = await launch(dir)
  try {
    const orig = firstLines(pdfPath)
    expect(orig).toHaveLength(6)
    const thumbs = win.locator('.thumb')

    // Insert two blank A4 pages after page 3 (the selected page), with a live summary.
    await thumbs.nth(2).click()
    await win.getByRole('button', { name: 'Insert', exact: true }).click()
    const ins = win.getByRole('dialog', { name: 'Insert pages' })
    await expect(ins.getByRole('alert')).toHaveText('Add at least one PDF file.') // nothing chosen yet: OK is off
    await expect(ins.getByRole('button', { name: 'Insert', exact: true })).toBeDisabled()
    await ins.getByRole('radio', { name: 'Blank pages' }).check()
    await ins.getByRole('textbox', { name: 'Number of blank pages' }).fill('2')
    await ins.getByRole('combobox', { name: 'Page size' }).selectOption('a4')
    await expect(ins.locator('.pod-summary')).toHaveText('2 pages will be inserted after page 3. The document will have 8 pages.')
    await ins.getByRole('button', { name: 'Insert', exact: true }).click()
    await expect(win.locator('.page')).toHaveCount(8)

    // Esc cancels and Enter confirms.
    await win.getByRole('button', { name: 'Insert', exact: true }).click()
    await expect(ins).toBeVisible()
    await win.keyboard.press('Escape')
    await expect(ins).toHaveCount(0)
    await expect(win.locator('.page')).toHaveCount(8)

    // Insert page 1 of another PDF before the first page, from the file list.
    await win.getByRole('button', { name: 'Insert', exact: true }).click()
    await ins.getByRole('button', { name: 'Add files…' }).click()
    await expect(ins.getByRole('list', { name: 'Files' }).getByRole('listitem')).toHaveCount(1)
    await ins.getByRole('textbox', { name: /Pages to take from/ }).fill('9999')
    await expect(ins.getByRole('alert')).toContainText('outside pages')
    await ins.getByRole('textbox', { name: /Pages to take from/ }).fill('1')
    await ins.getByRole('combobox', { name: 'Before or after' }).selectOption('before')
    await ins.getByRole('combobox', { name: 'Page to insert next to' }).selectOption('first')
    await expect(ins.locator('.pod-summary')).toHaveText('1 page will be inserted before page 1. The document will have 9 pages.')
    await ins.getByRole('button', { name: 'Insert', exact: true }).click()
    await expect(win.locator('.page')).toHaveCount(9)

    // Delete pages 1-2 (custom range); every page cannot be chosen. Enter confirms.
    await win.getByRole('button', { name: 'Delete', exact: true }).click()
    const del = win.getByRole('dialog', { name: 'Delete pages' })
    await del.getByRole('combobox', { name: 'Pages' }).selectOption('all')
    await expect(del.getByRole('alert')).toContainText('at least one page')
    await expect(del.getByRole('button', { name: 'Delete', exact: true })).toBeDisabled()
    await del.getByRole('combobox', { name: 'Pages' }).selectOption('custom')
    await del.getByRole('textbox', { name: 'Custom pages' }).fill('1-2')
    await expect(del.locator('.pod-summary')).toHaveText('2 pages will be deleted. The document will have 7 pages. You can undo this.')
    await del.getByRole('textbox', { name: 'Custom pages' }).press('Enter')
    await expect(win.locator('.page')).toHaveCount(7)

    // Left: orig 1, 2, blank, blank, 3, 4, 5. Move the first page to the end.
    await win.getByRole('button', { name: 'Move', exact: true }).click()
    const mv = win.getByRole('dialog', { name: 'Move pages' })
    await mv.getByRole('combobox', { name: 'Pages' }).selectOption('custom')
    await mv.getByRole('textbox', { name: 'Custom pages' }).fill('1')
    await mv.getByRole('combobox', { name: 'Destination' }).selectOption('end')
    await expect(mv.locator('.pod-summary')).toHaveText('1 page will be moved to the end.')
    await mv.getByRole('button', { name: 'Move', exact: true }).click()

    // Duplicate the (new) last page twice at the end of the document.
    await win.getByRole('button', { name: 'Duplicate', exact: true }).click()
    const dup = win.getByRole('dialog', { name: 'Duplicate pages' })
    await dup.getByRole('combobox', { name: 'Pages' }).selectOption('custom')
    await dup.getByRole('textbox', { name: 'Custom pages' }).fill('7')
    await dup.getByRole('textbox', { name: 'Number of copies' }).fill('2')
    await dup.getByRole('combobox', { name: 'Place the copies' }).selectOption('end')
    await expect(dup.locator('.pod-summary')).toHaveText('2 pages will be added. The document will have 9 pages.')
    await dup.getByRole('button', { name: 'Duplicate', exact: true }).click()
    await expect(win.locator('.page')).toHaveCount(9)

    await win.keyboard.press('Control+s')
    await expect(win.locator('.tab-dirty')).toHaveCount(0)
    const lines = firstLines(pdfPath)
    // Page 1 of the other PDF and original page 1 were deleted, original page 2 moved to the end, then copied twice.
    expect(lines.slice(0, 6)).toEqual([orig[2], '', '', orig[3], orig[4], orig[5]])
    expect(lines[6]).toBe(orig[1])
    expect(lines.slice(7)).toEqual([orig[1], orig[1]])
    expect(problems).toEqual([])
  } finally {
    await app.close()
    rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 })
  }
})

test('extract each page, split at chosen pages, rotate and merge into a new document', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'openpdf-e2e-'))
  const { app, win, outDir, problems } = await launch(dir)
  try {
    const thumbs = win.locator('.thumb')
    await thumbs.nth(0).click()
    await thumbs.nth(1).click({ modifiers: ['Shift'] })

    // Extract pages 1-2 to a file each, then remove them from this document.
    await win.getByRole('button', { name: 'Extract', exact: true }).click()
    const ex = win.getByRole('dialog', { name: 'Extract pages' })
    await expect(ex.getByRole('combobox', { name: 'Pages' })).toHaveValue('selected')
    await ex.getByRole('checkbox', { name: 'Extract each page to its own file' }).check()
    await ex.getByRole('textbox', { name: 'File name pattern' }).fill('{name}')
    await expect(ex.getByRole('alert')).toContainText('{n}') // two files need distinct names
    await ex.getByRole('textbox', { name: 'File name pattern' }).fill('pg-{n}')
    await ex.getByRole('checkbox', { name: 'Delete the pages from this document afterwards' }).check()
    await expect(ex.locator('.pod-summary')).toContainText('2 files will be created')
    await expect(ex.locator('.pod-summary')).toContainText('which will have 4 pages')
    await ex.getByRole('button', { name: 'Extract…' }).click()
    await expect(win.locator('.page')).toHaveCount(4)
    expect(readdirSync(outDir).sort()).toEqual(['pg-1.pdf', 'pg-2.pdf'])

    // Rotate the even pages by 180 degrees.
    await win.getByRole('button', { name: 'Rotate pages…' }).click()
    const rot = win.getByRole('dialog', { name: 'Rotate pages' })
    await rot.getByRole('combobox', { name: 'Direction' }).selectOption('180')
    await rot.getByRole('combobox', { name: 'Pages' }).selectOption('even')
    await expect(rot.locator('.pod-summary')).toHaveText('2 pages will be rotated 180°.')
    await rot.getByRole('button', { name: 'Rotate', exact: true }).click()
    await expect(win.getByText('Rotated 2 pages')).toBeVisible()

    // Split so a new file starts at page 3.
    await win.getByRole('button', { name: 'Split', exact: true }).click()
    const sp = win.getByRole('dialog', { name: 'Split document' })
    await sp.getByRole('combobox', { name: 'Split by' }).selectOption('at')
    await sp.getByRole('textbox', { name: 'Start pages' }).fill('1')
    await expect(sp.getByRole('alert')).toContainText('2 to 4')
    await sp.getByRole('textbox', { name: 'Start pages' }).fill('3')
    await sp.getByRole('textbox', { name: 'File name pattern' }).fill('part-{n}')
    await expect(sp.locator('.pod-summary')).toContainText('This will create 2 files, for example "part-1.pdf"')
    await sp.getByRole('button', { name: 'Split…' }).click()
    await expect(win.getByText(/Wrote 2 files/)).toBeVisible()
    expect(existsSync(join(outDir, 'part-1.pdf')) && existsSync(join(outDir, 'part-2.pdf'))).toBe(true)

    // Merge another PDF into a new document without this one.
    await win.getByRole('button', { name: 'Merge', exact: true }).click()
    const mg = win.getByRole('dialog', { name: 'Merge documents' })
    await expect(mg.getByRole('alert')).toContainText('Add at least one')
    await mg.getByRole('button', { name: 'Add files…' }).click()
    await expect(mg.getByRole('list', { name: 'Files' }).getByRole('listitem')).toHaveCount(1)
    await mg.getByRole('checkbox', { name: 'Start with this document' }).uncheck()
    await expect(mg.locator('.pod-summary')).toContainText('will be merged into a new document')
    await mg.getByRole('button', { name: 'Merge', exact: true }).click()
    await expect(win.getByRole('tablist', { name: 'Open documents' }).getByRole('tab', { name: /Merged/ })).toHaveCount(1)
    expect(problems).toEqual([])
  } finally {
    await app.close()
    rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 })
  }
})
