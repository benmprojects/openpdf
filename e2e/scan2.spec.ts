import { _electron as electron, expect, test, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(__dirname, '..')

// There is no scanner in the test environment: the scanning step is replaced by picture files (a test hook), and
// everything after it (clean-up, text recognition, inserting into the document) runs for real.
const SETUP = `import sys, pymupdf
d = pymupdf.open()
d.new_page(width=300, height=300).insert_text((50, 100), "Base document", fontsize=14)
d.save(sys.argv[1])
def sheet(path, lines, turn=0):
    s = pymupdf.open()
    p = s.new_page(width=420, height=300)
    morph = (pymupdf.Point(210, 150), pymupdf.Matrix(turn)) if turn else None
    p.insert_text((40, 60), lines[0], fontsize=24, morph=morph)
    p.insert_text((40, 110), lines[1], fontsize=14, morph=morph)
    p.get_pixmap(dpi=200).save(path)
sheet(sys.argv[2], ["Delivery docket 88213", "Goods received in good order."])
sheet(sys.argv[3], ["Second sheet", "Signed by the site foreman."])
sheet(sys.argv[4], ["Skewed docket 55120", "Signed by the site foreman."], 3)`

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'openpdf-e2e-'))
  const files = { base: join(dir, 'base.pdf'), s1: join(dir, 'sheet1.png'), s2: join(dir, 'sheet2.png'), skew: join(dir, 'skew.png') }
  execFileSync('python', ['-c', SETUP, files.base, files.s1, files.s2, files.skew])
  return { dir, ...files }
}

async function launch(dir: string, base: string, scan: string[]) {
  const app = await electron.launch({ args: ['.', base], cwd: root, env: { ...process.env, OPENPDF_E2E: '1', OPENPDF_E2E_USERDATA: join(dir, 'ud'), OPENPDF_E2E_DISCARD: '1', OPENPDF_E2E_SCAN: scan.join('|') } })
  const win = await app.firstWindow()
  await expect(win.locator('.page')).toHaveCount(1)
  return { app, win }
}

async function openScan(win: Page) {
  await win.getByRole('tab', { name: 'Convert', exact: true }).click()
  await win.getByRole('button', { name: 'Scan', exact: true }).click()
  return win.getByRole('dialog', { name: 'Scan to PDF' })
}

async function find(win: Page, text: string) {
  await win.keyboard.press('Control+f')
  const box = win.getByRole('searchbox', { name: 'Find in document' })
  await box.fill(text)
  await box.press('Enter')
  await expect(win.locator('.search-status')).toHaveText(/1 of 1/)
}

test('a saved scan preset restores the settings and can be deleted', async () => {
  const f = setup()
  const { app, win } = await launch(f.dir, f.base, [f.s1])
  try {
    let d = await openScan(win)
    await d.getByRole('combobox', { name: 'Method' }).selectOption('feeder')
    await d.getByRole('combobox', { name: 'Resolution' }).selectOption('300')
    await d.getByRole('combobox', { name: 'Colour' }).selectOption('bw')
    await d.getByRole('checkbox', { name: 'Remove specks' }).check()
    await d.getByRole('button', { name: 'Save preset' }).click()
    await d.getByRole('textbox', { name: 'Preset name' }).fill('Site dockets')
    await d.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(d.getByRole('combobox', { name: 'Preset' })).toHaveValue('Site dockets')
    await d.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(d).toBeHidden()

    d = await openScan(win)
    await expect(d.getByRole('combobox', { name: 'Method' })).toHaveValue('dialog')
    await d.getByRole('combobox', { name: 'Preset' }).selectOption('Site dockets')
    await expect(d.getByRole('combobox', { name: 'Method' })).toHaveValue('feeder')
    await expect(d.getByRole('combobox', { name: 'Resolution' })).toHaveValue('300')
    await expect(d.getByRole('combobox', { name: 'Colour' })).toHaveValue('bw')
    await expect(d.getByRole('checkbox', { name: 'Remove specks' })).toBeChecked()
    // A built-in preset cannot be deleted; a saved one can.
    await d.getByRole('button', { name: 'Delete preset' }).click()
    await expect(d.getByRole('combobox', { name: 'Preset' }).locator('option', { hasText: 'Site dockets' })).toHaveCount(0)
    await d.getByRole('combobox', { name: 'Preset' }).selectOption({ index: 1 })
    await expect(d.getByRole('button', { name: 'Delete preset' })).toBeDisabled()
  } finally {
    await app.close()
    rmSync(f.dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 })
  }
})

test('a scan can be inserted into the open document after a page', async () => {
  const f = setup()
  const { app, win } = await launch(f.dir, f.base, [f.s1, f.s2])
  try {
    const problems: string[] = []
    win.on('pageerror', (e) => problems.push(e.message))
    const d = await openScan(win)
    await d.getByRole('combobox', { name: 'Method' }).selectOption('feeder')
    await d.getByRole('radio', { name: 'This document' }).check()
    await d.getByRole('combobox', { name: 'Before or after' }).selectOption('after')
    await d.getByRole('combobox', { name: 'Page to insert next to' }).selectOption('page')
    await d.getByRole('textbox', { name: 'Page number' }).fill('1')
    await d.getByRole('button', { name: 'Scan', exact: true }).click()
    await expect(win.locator('.page:visible')).toHaveCount(3, { timeout: 90000 })
    await expect(win.getByText(/Inserted 2 scanned pages after page 1/)).toBeVisible()
    await find(win, 'foreman')
    expect(problems).toEqual([])
  } finally {
    await app.close()
    rmSync(f.dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 })
  }
})

test('a crooked scan is straightened and still searchable', async () => {
  const f = setup()
  const { app, win } = await launch(f.dir, f.base, [f.skew])
  try {
    const d = await openScan(win)
    await d.getByRole('combobox', { name: 'Method' }).selectOption('flatbed')
    await d.getByRole('combobox', { name: 'Resolution' }).selectOption('200')
    await d.getByRole('checkbox', { name: 'Straighten pages' }).check()
    await d.getByRole('checkbox', { name: 'Crop to content' }).check()
    await d.getByRole('button', { name: 'Scan', exact: true }).click()
    await expect(win.getByRole('tab', { name: /^Scan \d/ })).toBeVisible({ timeout: 90000 })
    await expect(win.locator('.page:visible')).toHaveCount(1)
    await find(win, 'foreman')
  } finally {
    await app.close()
    rmSync(f.dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 })
  }
})
