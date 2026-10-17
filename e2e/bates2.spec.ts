import { _electron as electron, expect, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(__dirname, '..')

/** Two small PDFs (2 and 3 pages) in dir/in. */
function setup(): { dir: string; a: string; b: string } {
  const dir = mkdtempSync(join(tmpdir(), 'openpdf-e2e-'))
  mkdirSync(join(dir, 'in'), { recursive: true })
  const a = join(dir, 'in', 'a.pdf')
  const b = join(dir, 'in', 'b.pdf')
  execFileSync('python', [
    '-c',
    `import sys, pymupdf
for path, n in ((sys.argv[1], 2), (sys.argv[2], 3)):
    d = pymupdf.open()
    for i in range(n):
        d.new_page(width=300, height=300).insert_text((50, 100), "Body " + str(i + 1), fontsize=14)
    d.save(path)`,
    a,
    b
  ])
  return { dir, a, b }
}

/** The text of every page, read with PyMuPDF. */
const pageTexts = (path: string): string[] =>
  JSON.parse(execFileSync('python', ['-c', 'import sys, json, pymupdf\nprint(json.dumps([p.get_text() for p in pymupdf.open(sys.argv[1])]))', path]).toString())

test('Bates numbers run on across several files, with a preview and a log', async () => {
  const { dir, a, b } = setup()
  const log = join(dir, 'log.csv')
  const app = await electron.launch({
    args: ['.', a],
    cwd: root,
    env: { ...process.env, OPENPDF_E2E: '1', OPENPDF_E2E_USERDATA: join(dir, 'ud'), OPENPDF_E2E_DISCARD: '1', OPENPDF_E2E_BATCH_PICK: `${a}|${b}`, OPENPDF_E2E_SAVE_TEXT: log }
  })
  try {
    const win = await app.firstWindow()
    const problems: string[] = []
    win.on('pageerror', (e) => problems.push(e.message))
    await expect(win.locator('.page')).toHaveCount(2)
    await win.getByRole('tab', { name: 'Layout', exact: true }).click()
    await win.getByRole('button', { name: 'Bates numbers' }).click()
    const marks = win.getByRole('dialog', { name: 'Bates numbering' })
    await marks.getByRole('textbox', { name: 'Prefix' }).fill('EPC')
    await marks.locator('#mk-bstart').fill('100')
    await marks.locator('#mk-digits').fill('4')
    await marks.getByRole('button', { name: 'Apply to several files…' }).click()

    const d = win.getByRole('dialog', { name: 'Number several files' })
    await d.getByRole('button', { name: 'Number the files' }).click()
    await expect(d.getByRole('alert')).toContainText('Add the files')
    await d.getByRole('button', { name: 'Add files…' }).click()
    const preview = d.getByRole('table', { name: 'Numbering preview' })
    await expect(preview.locator('tbody tr')).toHaveCount(2)
    // The number carries on from the first file into the second.
    await expect(preview.locator('tbody tr').nth(0).getByTestId('first')).toHaveText('EPC0100')
    await expect(preview.locator('tbody tr').nth(0).getByTestId('last')).toHaveText('EPC0101')
    await expect(preview.locator('tbody tr').nth(1).getByTestId('first')).toHaveText('EPC0102')
    await expect(preview.locator('tbody tr').nth(1).getByTestId('last')).toHaveText('EPC0104')

    // Putting the second file first renumbers the preview.
    await d.getByRole('button', { name: 'Move b.pdf up' }).click()
    await expect(preview.locator('tbody tr').nth(0).getByTestId('first')).toHaveText('EPC0100')
    await expect(preview.locator('tbody tr').nth(0).getByTestId('last')).toHaveText('EPC0102')
    await d.getByRole('button', { name: 'Move a.pdf up' }).click()
    await expect(preview.locator('tbody tr').nth(0).getByTestId('last')).toHaveText('EPC0101')

    await d.getByRole('textbox', { name: 'Results folder' }).fill(join(dir, 'out'))
    await d.getByRole('textbox', { name: 'Name suffix' }).fill('_numbered')
    await d.getByRole('button', { name: 'Number the files' }).click()
    await expect(d.getByText('Done: 2 of 2 files numbered')).toBeVisible({ timeout: 60_000 })
    await d.getByRole('button', { name: 'Save the log (CSV)…' }).click()
    await expect.poll(() => (existsSync(log) ? readFileSync(log, 'utf8') : '')).toContain('EPC0104')
    expect(problems).toEqual([])
  } finally {
    await app.close()
  }
  expect(readdirSync(join(dir, 'out')).sort()).toEqual(['a_numbered.pdf', 'b_numbered.pdf'])
  const first = pageTexts(join(dir, 'out', 'a_numbered.pdf'))
  const second = pageTexts(join(dir, 'out', 'b_numbered.pdf'))
  expect(first[0]).toContain('EPC0100')
  expect(first[1]).toContain('EPC0101')
  expect(second.map((t) => /EPC\d{4}/.exec(t)?.[0])).toEqual(['EPC0102', 'EPC0103', 'EPC0104'])
  const csv = readFileSync(log, 'utf8')
  expect(csv).toContain('File,Output,Pages,First number,Last number,Result')
  expect(csv).toContain('a.pdf,a_numbered.pdf,2,EPC0100,EPC0101,Done')
  expect(csv).toContain('b.pdf,b_numbered.pdf,3,EPC0102,EPC0104,Done')
  // The originals are not touched.
  expect(pageTexts(a)[0]).not.toContain('EPC')
  rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 })
})

test('page numbers also carry on across files, with the total for the whole set', async () => {
  const { dir, a, b } = setup()
  const app = await electron.launch({
    args: ['.', a],
    cwd: root,
    env: { ...process.env, OPENPDF_E2E: '1', OPENPDF_E2E_USERDATA: join(dir, 'ud'), OPENPDF_E2E_DISCARD: '1', OPENPDF_E2E_BATCH_PICK: `${a}|${b}` }
  })
  try {
    const win = await app.firstWindow()
    await expect(win.locator('.page')).toHaveCount(2)
    await win.getByRole('tab', { name: 'Layout', exact: true }).click()
    await win.getByRole('button', { name: 'Page numbers', exact: true }).click()
    await win.getByRole('dialog', { name: 'Page numbers' }).getByRole('button', { name: 'Apply to several files…' }).click()
    const d = win.getByRole('dialog', { name: 'Number several files' })
    await d.getByRole('button', { name: 'Add files…' }).click()
    await expect(d.getByRole('table', { name: 'Numbering preview' }).locator('tbody tr').nth(1).getByTestId('last')).toHaveText('5')
    await d.getByRole('textbox', { name: 'Results folder' }).fill(join(dir, 'out'))
    await d.getByRole('button', { name: 'Number the files' }).click()
    await expect(d.getByText('Done: 2 of 2 files numbered')).toBeVisible({ timeout: 60_000 })
  } finally {
    await app.close()
  }
  const second = pageTexts(join(dir, 'out', 'b_numbered.pdf'))
  expect(second[0]).toContain('Page 3 of 5')
  expect(second[2]).toContain('Page 5 of 5')
  rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 })
})

test('a Batch step numbers a folder of files with the number carried across', async () => {
  const { dir, a } = setup()
  const log = join(dir, 'batchlog.csv')
  const app = await electron.launch({
    args: ['.', a],
    cwd: root,
    env: { ...process.env, OPENPDF_E2E: '1', OPENPDF_E2E_USERDATA: join(dir, 'ud'), OPENPDF_E2E_DISCARD: '1', OPENPDF_E2E_SAVE_TEXT: log }
  })
  try {
    const win = await app.firstWindow()
    await expect(win.locator('.page')).toHaveCount(2)
    await win.getByRole('tab', { name: 'File', exact: true }).click()
    await win.getByRole('button', { name: 'Batch' }).click()
    const d = win.getByRole('dialog', { name: 'Batch processing' })
    await d.getByRole('combobox', { name: 'Add a step' }).selectOption('bates')
    await d.getByRole('textbox', { name: 'Bates prefix' }).fill('TND-')
    await d.getByRole('spinbutton', { name: 'Bates first number' }).fill('7')
    await d.getByRole('spinbutton', { name: 'Bates digits' }).fill('3')
    await d.getByRole('textbox', { name: 'Files and folders' }).fill(join(dir, 'in'))
    await d.getByRole('textbox', { name: 'Results folder' }).fill(join(dir, 'out'))
    await d.getByRole('textbox', { name: 'Name suffix' }).fill('_b')
    await d.getByRole('button', { name: 'Run', exact: true }).click()
    await expect(d.getByText('Done: 2 of 2 files processed')).toBeVisible({ timeout: 90_000 })
    await d.getByRole('button', { name: 'Save the Bates log (CSV)…' }).click()
    await expect.poll(() => (existsSync(log) ? readFileSync(log, 'utf8') : '')).toContain('TND-011')
  } finally {
    await app.close()
  }
  // a.pdf (2 pages) then b.pdf (3 pages): TND-007 to TND-011.
  const one = pageTexts(join(dir, 'out', 'a_b.pdf'))
  const two = pageTexts(join(dir, 'out', 'b_b.pdf'))
  expect(one.map((t) => /TND-\d{3}/.exec(t)?.[0])).toEqual(['TND-007', 'TND-008'])
  expect(two.map((t) => /TND-\d{3}/.exec(t)?.[0])).toEqual(['TND-009', 'TND-010', 'TND-011'])
  rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 })
})
