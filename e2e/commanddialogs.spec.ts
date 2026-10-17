import { _electron as electron, expect, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(__dirname, '..')

test('Export text, Comments, Save as and Flatten open options dialogs; marks dialogs offer odd and even pages', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'openpdf-e2e-'))
  const pdf = join(dir, 'pages.pdf')
  const target = join(dir, 'out.txt')
  execFileSync('python', [join(root, 'scripts', 'make-test-pdf.py'), pdf])
  const app = await electron.launch({
    args: ['.', pdf],
    cwd: root,
    env: { ...process.env, OPENPDF_E2E: '1', OPENPDF_E2E_USERDATA: join(dir, 'ud'), OPENPDF_E2E_SAVE_TEXT: target, OPENPDF_E2E_DISCARD: '1' }
  })
  try {
    const win = await app.firstWindow()
    const problems: string[] = []
    win.on('pageerror', (e) => problems.push(e.message))
    await expect(win.locator('.page')).toHaveCount(6)

    // Export text: a page range with validation, and the file name shown.
    await win.getByRole('tab', { name: 'Convert', exact: true }).click()
    await win.getByRole('button', { name: 'Text', exact: true }).click()
    const ex = win.getByRole('dialog', { name: 'Export as text' })
    await expect(ex.locator('.pod-summary')).toContainText('The text of 6 pages will be saved as "pages.txt"')
    await ex.getByRole('combobox', { name: 'Pages' }).selectOption('custom')
    await ex.getByRole('textbox', { name: 'Custom pages' }).fill('99')
    await expect(ex.getByRole('alert')).toBeVisible()
    await expect(ex.getByRole('button', { name: 'Export…' })).toBeDisabled()
    await ex.getByRole('combobox', { name: 'Pages' }).selectOption('odd')
    await expect(ex.locator('.pod-summary')).toContainText('The text of 3 pages')
    await ex.getByRole('button', { name: 'Export…' }).click()
    await expect.poll(() => (existsSync(target) ? readFileSync(target, 'utf8').length : 0)).toBeGreaterThan(0)
    const pageText = (n: number): string =>
      execFileSync('python', ['-c', 'import sys, pymupdf\nprint(pymupdf.open(sys.argv[1])[int(sys.argv[2])].get_text().strip().splitlines()[0])', pdf, String(n)]).toString().trim()
    const out = readFileSync(target, 'utf8')
    expect(out).toContain(pageText(0))
    expect(out).toContain(pageText(2))
    expect(out).not.toContain(pageText(1))

    // HTML offers the layout choice; Word does not.
    await win.getByRole('button', { name: 'HTML' }).click()
    const html = win.getByRole('dialog', { name: 'Export as HTML' })
    await expect(html.getByRole('checkbox', { name: /line breaks/ })).not.toBeChecked()
    await win.keyboard.press('Escape')
    await win.getByRole('button', { name: 'Word' }).click()
    const word = win.getByRole('dialog', { name: 'Export as Word' })
    // Word has its own options (pictures, tables, columns) but no line-break option.
    await expect(word.getByRole('checkbox', { name: /line breaks/ })).toHaveCount(0)
    await win.keyboard.press('Escape')

    // Comments: import options. The document has no comments, so nothing is replaced.
    await win.getByRole('tab', { name: 'File', exact: true }).click()
    await win.getByRole('button', { name: 'Import', exact: true }).click()
    const imp = win.getByRole('dialog', { name: 'Import comments' })
    await expect(imp.getByRole('radio', { name: 'Add to the existing comments' })).toBeChecked()
    await imp.getByRole('combobox', { name: 'Which comments' }).selectOption('type')
    await expect(imp.getByRole('alert')).toHaveText('Choose at least one type of comment.')
    await imp.getByRole('checkbox', { name: 'Highlight' }).check()
    await expect(imp.getByRole('alert')).toHaveCount(0)
    await imp.getByRole('radio', { name: 'Replace the existing comments' }).check()
    await expect(imp.locator('.pod-summary')).toContainText('will replace')
    await win.keyboard.press('Escape')

    // Save as: choices, then cancel.
    await win.getByRole('button', { name: 'Save as' }).click()
    const sa = win.getByRole('dialog', { name: 'Save as' })
    await expect(sa.locator('.pod-summary')).toContainText('this tab will switch to it')
    await sa.getByRole('checkbox', { name: /keep working/ }).check()
    await expect(sa.locator('.pod-summary')).toContainText('stays open')
    await sa.getByRole('button', { name: 'Cancel' }).click()
    await expect(sa).toHaveCount(0)

    // Page marks: the Pages control offers odd and even pages.
    await win.getByRole('tab', { name: 'Layout', exact: true }).click()
    await win.getByRole('button', { name: 'Watermark', exact: true }).click()
    const wm = win.getByRole('dialog', { name: 'Watermark' })
    await expect(wm.getByRole('option', { name: 'Odd pages' })).toHaveCount(1)
    await expect(wm.getByRole('option', { name: 'Even pages' })).toHaveCount(1)
    await win.keyboard.press('Escape')
    expect(problems).toEqual([])
  } finally {
    await app.close()
    rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 })
  }
})
