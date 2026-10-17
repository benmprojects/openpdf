import { _electron as electron, expect, test, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(__dirname, '..')

const MAKE = `
import sys, pymupdf
d = pymupdf.open()
for i, text in enumerate(["First", None, "Third", None, "Fifth"]):
    p = d.new_page(width=300, height=400)
    if text:
        p.insert_text((40, 100), text + " page of the set", fontsize=20)
d.save(sys.argv[1])
pix = pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, 80, 60), False)
pix.set_rect(pix.irect, (200, 30, 30))
pix.save(sys.argv[2])
pix.save(sys.argv[3])
`

/** First word of each page's text, or "-" for a page without text. */
const firstWords = (path: string): string[] =>
  JSON.parse(execFileSync('python', ['-c', 'import sys, json, pymupdf\nprint(json.dumps([(p.get_text().split() or ["-"])[0] for p in pymupdf.open(sys.argv[1])]))', path]).toString())

async function save(win: Page) {
  await win.keyboard.press('Control+s')
  await expect(win.locator('.tab-dirty')).toHaveCount(0)
}

test('delete blank pages from a previewed list, swap two pages, insert from the clipboard picture and a scanner', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'openpdf-e2e-'))
  const pdfPath = join(dir, 'blank.pdf')
  const clip = join(dir, 'clip.png')
  const sheet = join(dir, 'sheet.png')
  execFileSync('python', ['-c', MAKE, pdfPath, clip, sheet])
  const app = await electron.launch({
    args: ['.', pdfPath],
    cwd: root,
    env: { ...process.env, OPENPDF_E2E: '1', OPENPDF_E2E_USERDATA: join(dir, 'ud'), OPENPDF_E2E_DISCARD: '1', OPENPDF_E2E_CLIPIMG: clip, OPENPDF_E2E_SCAN: sheet }
  })
  try {
    const win = await app.firstWindow()
    const problems: string[] = []
    win.on('pageerror', (e) => problems.push(e.message))
    await expect(win.locator('.page')).toHaveCount(5)
    await win.getByRole('tab', { name: 'Organise' }).click()

    // Delete blank pages: pages 2 and 4 are listed; keep page 4 by unticking it.
    await win.getByRole('button', { name: 'Delete blank' }).click()
    const del = win.getByRole('dialog', { name: 'Delete blank pages' })
    await expect(del.getByRole('checkbox', { name: 'Delete page 2' })).toBeVisible({ timeout: 30_000 })
    await expect(del.getByRole('checkbox', { name: 'Delete page 4' })).toBeVisible()
    await expect(del.getByRole('checkbox')).toHaveCount(2)
    await expect(del.locator('.pod-summary')).toContainText('2 pages will be deleted: 2, 4')
    await del.getByRole('checkbox', { name: 'Delete page 4' }).uncheck()
    await expect(del.locator('.pod-summary')).toContainText('1 page will be deleted: 2')
    await del.getByRole('button', { name: 'Delete', exact: true }).click()
    await expect(win.locator('.page')).toHaveCount(4)
    await save(win)
    expect(firstWords(pdfPath)).toEqual(['First', 'Third', '-', 'Fifth'])

    // Swap pages 1 and 4.
    await win.getByRole('button', { name: 'Swap', exact: true }).click()
    const swap = win.getByRole('dialog', { name: 'Swap pages' })
    await swap.getByRole('textbox', { name: 'First page to swap' }).fill('1')
    await swap.getByRole('textbox', { name: 'Second page to swap' }).fill('4')
    await swap.getByRole('button', { name: 'Swap', exact: true }).click()
    await save(win)
    expect(firstWords(pdfPath)).toEqual(['Fifth', 'Third', '-', 'First'])

    // Insert the picture on the clipboard after page 1.
    await win.locator('.thumb').first().click()
    await win.getByRole('button', { name: 'Insert', exact: true }).click()
    const ins = win.getByRole('dialog', { name: 'Insert pages' })
    await ins.getByRole('radio', { name: 'From the picture on the clipboard' }).check()
    await expect(ins.locator('.pod-summary')).toContainText('1 page will be inserted', { timeout: 15_000 })
    await ins.getByRole('button', { name: 'Insert', exact: true }).click()
    await expect(win.locator('.page')).toHaveCount(5)

    // Insert a scanned sheet (the scanner is replaced by a picture file in tests).
    await win.locator('.thumb').first().click()
    await win.getByRole('button', { name: 'Insert', exact: true }).click()
    const ins2 = win.getByRole('dialog', { name: 'Insert pages' })
    await ins2.getByRole('radio', { name: 'From a scanner' }).check()
    await expect(ins2.getByRole('button', { name: 'Insert', exact: true })).toBeDisabled()
    await ins2.getByRole('button', { name: 'Scan…' }).click()
    const scan = win.getByRole('dialog', { name: 'Scan to PDF' })
    await scan.getByRole('checkbox', { name: /searchable/ }).uncheck()
    await scan.getByRole('button', { name: 'Scan', exact: true }).click()
    await expect(ins2.locator('.pod-summary')).toContainText('1 page will be inserted', { timeout: 30_000 })
    await ins2.getByRole('button', { name: 'Insert', exact: true }).click()
    await expect(win.locator('.page')).toHaveCount(6)
    await save(win)
    expect(firstWords(pdfPath)).toEqual(['Fifth', '-', '-', 'Third', '-', 'First'])
    expect(problems).toEqual([])
  } finally {
    await app.close()
    rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 })
  }
})
