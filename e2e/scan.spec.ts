import { _electron as electron, expect, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(__dirname, '..')

// There is no scanner in the test environment: the scanning step is replaced by picture files (a test hook), and
// everything after it (the new document, its page size from the resolution, text recognition) runs for real.
test('a scan becomes a new searchable document at the right physical size', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'openpdf-e2e-'))
  const base = join(dir, 'base.pdf')
  const sheet1 = join(dir, 'sheet1.png')
  const sheet2 = join(dir, 'sheet2.png')
  execFileSync('python', [
    '-c',
    `import sys, pymupdf
d = pymupdf.open()
d.new_page(width=300, height=300).insert_text((50, 100), "Base document", fontsize=14)
d.save(sys.argv[1])
for path, lines in ((sys.argv[2], ["Delivery docket 88213", "Goods received in good order."]), (sys.argv[3], ["Second sheet", "Signed by the site foreman."])):
    s = pymupdf.open()
    p = s.new_page(width=420, height=300)
    p.insert_text((40, 60), lines[0], fontsize=24)
    p.insert_text((40, 110), lines[1], fontsize=14)
    p.get_pixmap(dpi=200).save(path)`,
    base,
    sheet1,
    sheet2
  ])
  const app = await electron.launch({ args: ['.', base], cwd: root, env: { ...process.env, OPENPDF_E2E: '1', OPENPDF_E2E_USERDATA: join(dir, 'ud'), OPENPDF_E2E_DISCARD: '1', OPENPDF_E2E_SCAN: [sheet1, sheet2].join('|') } })
  try {
    const win = await app.firstWindow()
    const problems: string[] = []
    win.on('pageerror', (e) => problems.push(e.message))
    await expect(win.locator('.page')).toHaveCount(1)
    await win.getByRole('tab', { name: 'Convert', exact: true }).click()
    await win.getByRole('button', { name: 'Scan', exact: true }).click()
    const d = win.getByRole('dialog', { name: 'Scan to PDF' })
    // The direct settings appear for the non-dialog methods.
    await d.getByRole('combobox', { name: 'Method' }).selectOption('feeder')
    await expect(d.getByRole('combobox', { name: 'Resolution' })).toBeVisible()
    await d.getByRole('combobox', { name: 'Resolution' }).selectOption('200')
    await d.getByRole('button', { name: 'Scan', exact: true }).click()
    await expect(win.getByRole('tab', { name: /^Scan \d/ })).toBeVisible({ timeout: 90000 })
    await expect(win.locator('.page:visible')).toHaveCount(2)

    await win.keyboard.press('Control+f')
    const find = win.getByRole('searchbox', { name: 'Find in document' })
    await find.fill('foreman')
    await find.press('Enter')
    await expect(win.locator('.search-status')).toHaveText(/1 of 1/)
    // 1167 px at 200 dpi is 420 points wide: the page has the paper's size, not the screen's.
    const w = await win.locator('.page:visible').first().evaluate((el) => el.getBoundingClientRect().width)
    expect(w).toBeGreaterThan(300)
    expect(problems).toEqual([])
  } finally {
    await app.close()
    rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 })
  }
})
