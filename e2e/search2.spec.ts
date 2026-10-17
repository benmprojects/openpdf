import { _electron as electron, expect, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(__dirname, '..')

const MAKE = `
import sys, pymupdf
d = pymupdf.open()
p = d.new_page(width=500, height=400)
p.insert_text((40, 60), "Call 07 3123 4567 or write to ann@example.com.au on 17/10/2026.", fontsize=11)
p.insert_text((40, 90), "Card 4111 1111 1111 1111 ref 123 456 782", fontsize=11)
q = d.new_page(width=500, height=400)
q.insert_text((40, 60), "Cat concat cat", fontsize=11)
q.add_text_annot((300, 200), "Check the culvert pit")
d.set_toc([[1, "Culvert design", 2]])
d.save(sys.argv[1])
`

const annotCount = (path: string): number =>
  Number(execFileSync('python', ['-c', 'import sys, pymupdf\nd = pymupdf.open(sys.argv[1])\nprint(sum(1 for a in d[1].annots() if a.type[1] == "Highlight"))', path]).toString().trim())

test('find with regular expressions, presets, whole words, comments and bookmarks; highlight all', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'openpdf-e2e-'))
  const pdfPath = join(dir, 'find.pdf')
  execFileSync('python', ['-c', MAKE, pdfPath])
  const app = await electron.launch({ args: ['.', pdfPath], cwd: root, env: { ...process.env, OPENPDF_E2E: '1', OPENPDF_E2E_USERDATA: join(dir, 'ud'), OPENPDF_E2E_DISCARD: '1' } })
  try {
    const win = await app.firstWindow()
    const problems: string[] = []
    win.on('pageerror', (e) => problems.push(e.message))
    await expect(win.locator('.page')).toHaveCount(2)

    await win.keyboard.press('Control+f')
    const find = win.getByRole('searchbox', { name: 'Find in document' })
    const status = win.locator('.docview:visible .search-status')

    // A regular expression.
    await win.getByRole('checkbox', { name: 'Regular expression' }).check()
    await find.fill('[a-z]+@[a-z.]+')
    await expect(status).toHaveText(/1 of 1/)
    // An invalid one says so and finds nothing.
    await find.fill('(')
    await expect(status).toHaveText(/Not a valid pattern/)

    // Whole words: "cat" is in Cat, cat and concat; whole word leaves out concat.
    await win.getByRole('checkbox', { name: 'Regular expression' }).uncheck()
    await find.fill('cat')
    await expect(status).toHaveText(/1 of 3/)
    await win.getByRole('checkbox', { name: 'Whole word' }).check()
    await expect(status).toHaveText(/1 of 2/)
    await win.getByRole('checkbox', { name: 'Whole word' }).uncheck()

    // Presets fill in the pattern.
    const preset = win.getByRole('combobox', { name: 'Pattern preset', exact: true })
    await preset.selectOption({ label: 'E-mail addresses' })
    await expect(status).toHaveText(/1 of 1/)
    await preset.selectOption({ label: 'Phone numbers (Australian)' })
    await expect(status).toHaveText(/1 of 1/)
    await preset.selectOption({ label: 'Dates' })
    await expect(status).toHaveText(/1 of 1/)
    // Card-like numbers must pass the Luhn check: the 123 456 782 group is not one, the 4111 number is.
    await preset.selectOption({ label: 'Card-like numbers (13 to 19 digits, Luhn tested)' })
    await expect(status).toHaveText(/1 of 1/)
    await preset.selectOption({ label: 'TFN-like groups (3 x 3 digits)' })
    await expect(status).toHaveText(/1 of 1/)

    // The results list is grouped by page and shows the words around each match.
    await win.getByRole('checkbox', { name: 'Regular expression' }).uncheck()
    await find.fill('cat')
    await expect(status).toHaveText(/1 of 3/)
    await win.getByRole('button', { name: 'Results list' }).click()
    const list = win.getByRole('region', { name: 'Search results list' })
    await expect(list.locator('.find-group h3')).toHaveText([/Page 2/])
    await expect(list.locator('.find-hit')).toHaveCount(3)
    await expect(list.locator('.find-hit').first()).toContainText('Cat')

    // Comments and bookmarks too.
    await find.fill('culvert')
    await win.getByRole('combobox', { name: 'Search in' }).selectOption('all')
    await expect(list.locator('.find-group h3').filter({ hasText: 'In comments' })).toBeVisible()
    await expect(list.locator('.find-group h3').filter({ hasText: 'In bookmarks' })).toBeVisible()
    await win.getByRole('combobox', { name: 'Search in' }).selectOption('bookmarks')
    await expect(list.locator('.find-group h3').filter({ hasText: 'In comments' })).toHaveCount(0)
    await expect(list.locator('.find-hit')).toHaveCount(1)

    // Highlight all results as highlight annotations, written on save.
    await win.getByRole('combobox', { name: 'Search in' }).selectOption('text')
    await find.fill('cat')
    await expect(status).toHaveText(/1 of 3/)
    await win.getByRole('button', { name: 'Highlight all' }).click()
    await expect(win.getByText('Highlighted 3 results.')).toBeVisible()
    await win.keyboard.press('Control+s')
    await expect(win.locator('.tab-dirty')).toHaveCount(0)
    expect(annotCount(pdfPath)).toBe(3)
    expect(problems).toEqual([])
  } finally {
    await app.close()
    rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 })
  }
})
