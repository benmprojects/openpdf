import { _electron as electron, expect, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(__dirname, '..')

/** The real dictionary is downloaded the first time and can be missing, so the test gives the program a short word list. */
const DICTIONARY = 'the,pipe,is,by,a,rock,another,page,with,in,it'

function makeText(path: string): void {
  execFileSync('python', [
    '-c',
    `import sys, pymupdf
d = pymupdf.open()
d.new_page(width=300, height=300).insert_text((40, 100), "The pipe is blokced by a rock.", fontsize=12)
d.new_page(width=300, height=300).insert_text((40, 100), "Another page with wtih in it.", fontsize=12)
d.new_page(width=300, height=300)
d.save(sys.argv[1])`,
    path
  ])
}

test('Word count gives words, characters, lines and pages, and notes the page with no text', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'openpdf-e2e-'))
  const pdf = join(dir, 'words.pdf')
  makeText(pdf)
  const app = await electron.launch({ args: ['.', pdf], cwd: root, env: { ...process.env, OPENPDF_E2E: '1', OPENPDF_E2E_USERDATA: join(dir, 'ud'), OPENPDF_E2E_DISCARD: '1' } })
  try {
    const win = await app.firstWindow()
    const problems: string[] = []
    win.on('pageerror', (e) => problems.push(e.message))
    await expect(win.locator('.page')).toHaveCount(3)
    await win.getByRole('tab', { name: 'File', exact: true }).click()
    await win.getByRole('button', { name: 'Word count' }).click()
    const d = win.getByRole('dialog', { name: 'Word count' })
    const totals = d.getByRole('table', { name: 'Totals' })
    await expect(totals.getByRole('row', { name: /^Words/ })).toContainText('13')
    await expect(totals.getByRole('row', { name: /^Pages with text/ })).toContainText('2')
    await expect(totals.getByRole('row', { name: /^Pages\b(?! with)/ })).toContainText('3')
    await expect(totals.getByRole('row', { name: /^Lines/ })).toContainText('2')
    await expect(totals.getByRole('row', { name: /^Characters \(with spaces\)/ })).toContainText(String('The pipe is blokced by a rock.'.length + 'Another page with wtih in it.'.length))
    await expect(d.getByText(/Pages with no text are pictures only/)).toBeVisible()
    await d.getByText('Words on each page').click()
    await expect(d.getByRole('table', { name: 'Words on each page' }).getByRole('row')).toHaveCount(4)
    await win.keyboard.press('Escape')
    await expect(d).toHaveCount(0)
    expect(problems).toEqual([])
  } finally {
    await app.close()
    rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 })
  }
})

test('the Spelling pane lists words the dictionary does not know, shows them on the page, and ignores them', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'openpdf-e2e-'))
  const pdf = join(dir, 'spell.pdf')
  makeText(pdf)
  const app = await electron.launch({ args: ['.', pdf], cwd: root, env: { ...process.env, OPENPDF_E2E: '1', OPENPDF_E2E_USERDATA: join(dir, 'ud'), OPENPDF_E2E_DISCARD: '1', OPENPDF_E2E_SPELL_DICT: DICTIONARY } })
  try {
    const win = await app.firstWindow()
    const problems: string[] = []
    win.on('pageerror', (e) => problems.push(e.message))
    await expect(win.locator('.page')).toHaveCount(3)
    await win.getByRole('tab', { name: 'Spelling', exact: true }).click()
    const list = win.getByRole('list', { name: 'Words not in the dictionary' })
    await expect(list.getByRole('button', { name: 'blokced' })).toBeVisible()
    await expect(list.getByRole('button', { name: 'wtih' })).toBeVisible()
    await expect(list.getByRole('button', { name: 'pipe' })).toHaveCount(0)
    await list.getByRole('button', { name: 'wtih' }).click()
    const detail = win.getByRole('region', { name: 'Selected word' })
    await expect(detail).toContainText('Another page with wtih in it')
    await expect(detail).toContainText('page 2')
    await expect(win.locator('.content-highlight')).toBeVisible()
    await expect(detail.getByRole('list', { name: 'Suggestions' }).getByRole('button', { name: 'with' })).toBeVisible()
    await detail.getByRole('button', { name: 'Ignore' }).click()
    await expect(list.getByRole('button', { name: 'wtih' })).toHaveCount(0)
    await expect(list.getByRole('button', { name: 'blokced' })).toBeVisible()
    expect(problems).toEqual([])
  } finally {
    await app.close()
    rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 })
  }
})
