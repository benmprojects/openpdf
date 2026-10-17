import { _electron as electron, expect, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(__dirname, '..')
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64')

test('Combine files: mixed list, ranges, ordering, folders, bookmarks, new tab and saved file', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'openpdf-e2e-'))
  const aPath = join(dir, 'a.pdf')
  const more = join(dir, 'more')
  mkdirSync(more)
  const picPath = join(dir, 'pic.png')
  const out = join(dir, 'combined-out.pdf')
  execFileSync('python', [join(root, 'scripts', 'make-test-pdf.py'), aPath])
  copyFileSync(aPath, join(more, 'b.pdf'))
  writeFileSync(join(more, 'ignored.txt'), 'not combinable')
  writeFileSync(picPath, PNG)
  const app = await electron.launch({
    args: ['.', aPath],
    cwd: root,
    env: {
      ...process.env,
      OPENPDF_E2E: '1',
      OPENPDF_E2E_USERDATA: join(dir, 'ud'),
      OPENPDF_E2E_DISCARD: '1',
      OPENPDF_E2E_COMBINE_PICK: `${aPath}|${picPath}`,
      OPENPDF_E2E_COMBINE_DIR: more,
      OPENPDF_E2E_SAVE: out
    }
  })
  try {
    const win = await app.firstWindow()
    const problems: string[] = []
    win.on('pageerror', (e) => problems.push(e.message))
    await expect(win.locator('.page')).toHaveCount(6)

    await win.getByRole('tab', { name: 'File', exact: true }).click()
    await win.getByRole('button', { name: 'Combine files', exact: true }).click()
    const dlg = win.getByRole('dialog', { name: 'Combine files' })
    await expect(dlg).toBeVisible()
    await expect(dlg.getByRole('alert')).toContainText('Add at least one file')

    await dlg.getByRole('button', { name: 'Add files…' }).click()
    await dlg.getByRole('button', { name: 'Add folder…' }).click()
    const rows = dlg.locator('ul.combine-files > li')
    // a.pdf, pic.png, then the folder's b.pdf; its .txt file is left out.
    await expect(rows).toHaveCount(3)
    await expect(rows.nth(2)).toContainText('b.pdf')
    await expect(dlg).not.toContainText('ignored.txt')

    // Sorting by name puts the pictures after the PDFs here (a, b, pic).
    await dlg.getByRole('button', { name: /Sort by name/ }).click()
    await expect(rows.nth(1)).toContainText('b.pdf')
    await expect(rows.nth(2)).toContainText('pic.png')
    // Down and Up change the order; then drag it back with the mouse.
    await dlg.getByRole('button', { name: 'Move b.pdf down' }).click()
    await expect(rows.nth(1)).toContainText('pic.png')
    await dlg.getByRole('button', { name: 'Move b.pdf up' }).click()
    await expect(rows.nth(1)).toContainText('b.pdf')
    await rows.nth(2).dragTo(rows.nth(1))
    await expect(rows.nth(1)).toContainText('pic.png')

    // Page ranges: a.pdf pages 1-2, b.pdf the last page. Pictures cannot take one.
    await dlg.getByRole('textbox', { name: 'Pages to take from a.pdf' }).fill('1-2')
    await dlg.getByRole('textbox', { name: 'Pages to take from b.pdf' }).fill('9')
    await expect(dlg.getByRole('alert')).toContainText('outside pages 1 to 6')
    await dlg.getByRole('textbox', { name: 'Pages to take from b.pdf' }).fill('6')
    await expect(dlg.getByRole('textbox', { name: 'Pages to take from pic.png' })).toBeDisabled()
    await expect(dlg.getByRole('alert')).toHaveCount(0)

    // Save to a chosen path: a, pic, b = 2 + 1 + 1 pages with a bookmark per file.
    await dlg.getByRole('combobox', { name: 'Result' }).selectOption('save')
    await dlg.getByRole('button', { name: 'Combine', exact: true }).click()
    await expect(dlg).toHaveCount(0)
    await expect.poll(() => existsSync(out)).toBe(true)
    const py = `
import sys, json, pymupdf
d = pymupdf.open(sys.argv[1])
print(json.dumps({"pages": d.page_count, "toc": d.get_toc(), "w": [round(p.rect.width) for p in d]}))
`
    const saved = JSON.parse(execFileSync('python', ['-c', py, out]).toString())
    expect(saved.pages).toBe(4)
    expect(saved.toc.map((t: [number, string, number]) => [t[1], t[2]])).toEqual([['a', 1], ['pic', 3], ['b', 4]])
    // The picture was fitted to A4 (595 pt wide).
    expect(saved.w[2]).toBe(595)

    // Open as a new document: it is a new, unsaved tab.
    await win.getByRole('button', { name: 'Combine files', exact: true }).click()
    await dlg.getByRole('button', { name: 'Add files…' }).click()
    await dlg.getByRole('combobox', { name: 'Page size for pictures' }).selectOption('image')
    await dlg.getByRole('button', { name: 'Combine', exact: true }).click()
    await expect(win.getByRole('tab', { name: /Combined/ })).toBeVisible()
    await expect(win.locator('.page:visible')).toHaveCount(7)
    expect(problems).toEqual([])
  } finally {
    await app.close()
    rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 })
  }
})
