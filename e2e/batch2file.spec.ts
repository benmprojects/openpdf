import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(__dirname, '..')

async function launch(dir: string): Promise<{ app: ElectronApplication; win: Page; pdfPath: string; problems: string[] }> {
  const pdfPath = join(dir, 'pages.pdf')
  execFileSync('python', [join(root, 'scripts', 'make-test-pdf.py'), pdfPath])
  const app = await electron.launch({ args: ['.', pdfPath], cwd: root, env: { ...process.env, OPENPDF_E2E: '1', OPENPDF_E2E_USERDATA: join(dir, 'ud'), OPENPDF_E2E_DISCARD: '1' } })
  const win = await app.firstWindow()
  const problems: string[] = []
  win.on('pageerror', (e) => problems.push(e.message))
  await expect(win.locator('.page')).toHaveCount(6)
  return { app, win, pdfPath, problems }
}

const cleanup = async (app: ElectronApplication, dir: string) => {
  await app.close()
  rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 })
}

test('New blank document: page size, orientation and number of pages', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'openpdf-e2e-'))
  const { app, win, problems } = await launch(dir)
  try {
    await win.getByRole('tab', { name: 'File', exact: true }).click()
    await win.getByRole('button', { name: 'New', exact: true }).click()
    const dlg = win.getByRole('dialog', { name: 'New document' })
    await dlg.getByRole('textbox', { name: 'Number of pages in the new document' }).fill('0')
    await expect(dlg.getByRole('alert')).toHaveText('Enter a number of pages from 1 to 500.')
    await dlg.getByRole('textbox', { name: 'Number of pages in the new document' }).fill('3')
    await dlg.getByRole('combobox', { name: 'Page size' }).selectOption('a3')
    await dlg.getByRole('combobox', { name: 'Orientation' }).selectOption('landscape')
    await expect(dlg.locator('.pod-summary')).toContainText('3 pages, each 420 x 297 mm')
    await dlg.getByRole('button', { name: 'Create', exact: true }).click()
    // A second document opens, unsaved, with three blank landscape pages.
    const docTabs = win.getByRole('tablist', { name: 'Open documents' }).getByRole('tab')
    await expect(docTabs).toHaveCount(2)
    await expect(docTabs.filter({ hasText: 'Untitled.pdf' })).toHaveAttribute('aria-selected', 'true')
    await expect(docTabs.filter({ hasText: 'Untitled.pdf' }).locator('.tab-dirty')).toHaveCount(1)
    await expect(win.locator('.docview:visible .page')).toHaveCount(3)
    const box = await win.locator('.docview:visible .page').first().boundingBox()
    expect(box!.width).toBeGreaterThan(box!.height) // landscape
    expect(problems).toEqual([])
  } finally {
    await cleanup(app, dir)
  }
})

test('Revert to saved asks first, then reloads the file and drops the changes', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'openpdf-e2e-'))
  const { app, win, pdfPath, problems } = await launch(dir)
  try {
    const before = readFileSync(pdfPath)
    // Delete page 1 (an unsaved change).
    await win.getByRole('tab', { name: 'Organise' }).click()
    await win.locator('.thumb').first().click()
    await win.getByRole('button', { name: 'Delete', exact: true }).click()
    await win.getByRole('dialog', { name: 'Delete pages' }).getByRole('button', { name: 'Delete', exact: true }).click()
    await expect(win.locator('.page')).toHaveCount(5)
    await expect(win.locator('.tab-dirty')).toHaveCount(1)

    await win.getByRole('tab', { name: 'File', exact: true }).click()
    await win.getByRole('button', { name: 'Revert to saved' }).click()
    const dlg = win.getByRole('dialog', { name: 'Revert to saved' })
    await expect(dlg).toContainText('Go back to the saved version of pages.pdf?')
    await expect(dlg).toContainText('Every change since the last save will be lost.')
    // Cancel: nothing changes.
    await dlg.getByRole('button', { name: 'Cancel' }).click()
    await expect(win.locator('.page')).toHaveCount(5)
    await expect(win.locator('.tab-dirty')).toHaveCount(1)
    // Revert: six pages again, nothing unsaved, and the file on disk was not touched.
    await win.getByRole('button', { name: 'Revert to saved' }).click()
    await dlg.getByRole('button', { name: 'Revert', exact: true }).click()
    await expect(win.locator('.page')).toHaveCount(6)
    await expect(win.locator('.tab-dirty')).toHaveCount(0)
    await expect(win.getByText('Went back to the saved version of pages.pdf')).toBeVisible()
    expect(readFileSync(pdfPath).equals(before)).toBe(true)
    expect(problems).toEqual([])
  } finally {
    await cleanup(app, dir)
  }
})

test('Rename: checks the name, never overwrites, and follows the file', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'openpdf-e2e-'))
  const { app, win, pdfPath, problems } = await launch(dir)
  const taken = join(dir, 'taken.pdf')
  writeFileSync(taken, 'not really a pdf')
  try {
    await win.getByRole('tab', { name: 'File', exact: true }).click()
    await win.getByRole('button', { name: 'Rename…' }).click()
    const dlg = win.getByRole('dialog', { name: 'Rename file' })
    const input = dlg.getByRole('textbox', { name: 'New file name' })
    await expect(input).toHaveValue('pages')
    await expect(dlg.getByRole('alert')).toHaveText('That is the name it already has.')
    await input.fill('a/b')
    await expect(dlg.getByRole('alert')).toContainText('cannot contain')
    await expect(dlg.getByRole('button', { name: 'Rename', exact: true })).toBeDisabled()
    // Another file of that name: refused, both files untouched.
    await input.fill('taken')
    await dlg.getByRole('button', { name: 'Rename', exact: true }).click()
    await expect(win.getByText(/There is already a file called taken\.pdf/)).toBeVisible()
    expect(existsSync(pdfPath)).toBe(true)
    expect(readFileSync(taken, 'utf8')).toBe('not really a pdf')
    // A free name: the file is renamed in its folder and the tab follows.
    await win.getByRole('button', { name: 'Rename…' }).click()
    await input.fill('renamed copy')
    await expect(dlg.locator('.pod-summary')).toContainText('renamed copy.pdf')
    await dlg.getByRole('button', { name: 'Rename', exact: true }).click()
    await expect(win.getByText('Renamed the file to renamed copy.pdf')).toBeVisible()
    expect(existsSync(pdfPath)).toBe(false)
    expect(existsSync(join(dir, 'renamed copy.pdf'))).toBe(true)
    await expect(win.getByRole('tab', { name: /renamed copy\.pdf/ })).toBeVisible()
    // And it still saves to the new place.
    await win.keyboard.press('Control+s')
    expect(existsSync(pdfPath)).toBe(false)
    expect(problems).toEqual([])
  } finally {
    await cleanup(app, dir)
  }
})

test('Move to the Recycle Bin asks first, never deletes for good, and keeps the document open', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'openpdf-e2e-'))
  const { app, win, pdfPath, problems } = await launch(dir)
  try {
    await win.getByRole('tab', { name: 'File', exact: true }).click()
    await win.getByRole('button', { name: 'Move to Recycle Bin…' }).click()
    const dlg = win.getByRole('dialog', { name: 'Move to Recycle Bin' })
    await expect(dlg).toContainText('Move pages.pdf to the Recycle Bin?')
    await expect(dlg).toContainText('not deleted for good')
    // Cancelling (the focused answer) leaves the file where it is.
    await expect(dlg.getByRole('button', { name: 'Cancel' })).toBeFocused()
    await dlg.getByRole('button', { name: 'Cancel' }).click()
    expect(existsSync(pdfPath)).toBe(true)
    await expect(win.locator('.tab-dirty')).toHaveCount(0)
    // Confirming moves it to the bin: gone from the folder, document still open and counted as unsaved.
    await win.getByRole('button', { name: 'Move to Recycle Bin…' }).click()
    await dlg.getByRole('button', { name: 'Move to Recycle Bin', exact: true }).click()
    await expect(win.getByText(/Moved pages\.pdf to the Recycle Bin/)).toBeVisible()
    expect(existsSync(pdfPath)).toBe(false)
    await expect(win.locator('.page')).toHaveCount(6)
    await expect(win.locator('.tab-dirty')).toHaveCount(1)
    await expect(win.getByRole('button', { name: 'Revert to saved' })).toBeDisabled()
    await expect(win.getByRole('button', { name: 'Rename…' })).toBeDisabled()
    expect(problems).toEqual([])
  } finally {
    await cleanup(app, dir)
  }
})
