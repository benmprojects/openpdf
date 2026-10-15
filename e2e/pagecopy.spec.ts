import { _electron as electron, expect, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(__dirname, '..')

const firstLines = (path: string): string[] =>
  JSON.parse(execFileSync('python', ['-c', 'import sys, json, pymupdf\nprint(json.dumps([p.get_text().strip().splitlines()[0] if p.get_text().strip() else "" for p in pymupdf.open(sys.argv[1])]))', path]).toString())

test('copy, paste, duplicate and replace pages; split by bookmarks', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'openpdf-e2e-'))
  const pdfPath = join(dir, 'pages.pdf')
  const other = join(dir, 'other.pdf')
  const outDir = join(dir, 'split')
  mkdirSync(outDir)
  execFileSync('python', [join(root, 'scripts', 'make-test-pdf.py'), pdfPath])
  execFileSync('npx', ['tsx', join(root, 'scripts', 'make-feature-pdf.mts'), other], { cwd: root, shell: true })
  const app = await electron.launch({
    args: ['.', pdfPath],
    cwd: root,
    env: { ...process.env, OPENPDF_E2E: '1', OPENPDF_E2E_USERDATA: join(dir, 'ud'), OPENPDF_E2E_PICK: other, OPENPDF_E2E_DIR: outDir, OPENPDF_E2E_DISCARD: '1' }
  })
  try {
    const win = await app.firstWindow()
    const problems: string[] = []
    win.on('pageerror', (e) => problems.push(e.message))
    await expect(win.locator('.page')).toHaveCount(6)
    const thumbs = win.locator('.thumb')

    // Copy pages 1-2 (Ctrl+C in the thumbnails) and paste them after page 6.
    await thumbs.nth(0).click()
    await thumbs.nth(1).click({ modifiers: ['Shift'] })
    await win.keyboard.press('Control+c')
    await expect(win.getByText(/Copied 2 pages/)).toBeVisible()
    await thumbs.nth(5).click()
    await win.keyboard.press('Control+v')
    await expect(win.locator('.page')).toHaveCount(8)

    // Duplicate page 1 from the Organise tab.
    await thumbs.nth(0).click()
    await win.getByRole('tab', { name: 'Organise' }).click()
    await win.getByRole('button', { name: 'Duplicate' }).click()
    await expect(win.locator('.page')).toHaveCount(9)

    // Replace page 3 with pages 3-4 of the other file.
    await thumbs.nth(2).click()
    await win.getByRole('button', { name: 'Replace', exact: true }).click()
    await win.getByRole('textbox', { name: 'Replacement pages' }).fill('3-4')
    await win.locator('.page-dialog').getByRole('button', { name: 'Replace' }).click()
    await expect(win.locator('.page')).toHaveCount(10)

    await win.keyboard.press('Control+s')
    await expect(win.locator('.tab-dirty')).toHaveCount(0)
    expect(firstLines(pdfPath)).toEqual([
      'Chapter page 1',
      'Chapter page 1',
      'Body page 1',
      'Body page 2',
      'Chapter page 3',
      'Chapter page 4',
      'Chapter page 5',
      'Chapter page 6',
      'Chapter page 1',
      'Chapter page 2'
    ])

    // Split at the top-level bookmarks.
    await win.getByRole('button', { name: 'Split', exact: true }).click()
    await win.getByRole('combobox', { name: 'Split by' }).selectOption('bookmarks')
    await win.locator('.page-dialog').getByRole('button', { name: 'Split…' }).click()
    await expect(win.getByText(/Wrote \d+ files/)).toBeVisible()
    const files = readdirSync(outDir)
    expect(files.length).toBeGreaterThan(1)
    expect(files.some((f) => / - /.test(f))).toBe(true) // named after bookmarks
    expect(problems).toEqual([])
  } finally {
    await app.close()
    rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 })
  }
})
