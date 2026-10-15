import { _electron as electron, expect, test } from '@playwright/test'
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(__dirname, '..')

test('export comments as XFDF and FDF, and import them into another copy', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'openpdf-e2e-'))
  const source = join(dir, 'source.pdf')
  const target = join(dir, 'target.pdf')
  execFileSync('python', [join(root, 'scripts', 'make-foreign-pdf.py'), source])
  execFileSync('python', [join(root, 'scripts', 'make-test-pdf.py'), target])
  const xfdf = join(dir, 'comments.xfdf')
  const fdf = join(dir, 'comments.fdf')
  const launch = (file: string, save: string, pick?: string) =>
    electron.launch({
      args: ['.', file],
      cwd: root,
      env: { ...process.env, OPENPDF_E2E: '1', OPENPDF_E2E_USERDATA: join(dir, 'ud'), OPENPDF_E2E_SAVE_TEXT: save, ...(pick ? { OPENPDF_E2E_PICK: pick } : {}), OPENPDF_E2E_DISCARD: '1' }
    })

  // Export the five comments of the "another tool" fixture (the stamp and attachment are foreign: left out).
  for (const [fmt, out] of [['XFDF', xfdf], ['FDF', fdf]] as const) {
    const app = await launch(source, out)
    try {
      const win = await app.firstWindow()
      await expect(win.locator('.page')).toHaveCount(1)
      await win.getByRole('tab', { name: 'File', exact: true }).click()
      await win.getByRole('button', { name: `Export ${fmt}` }).click()
      await expect.poll(() => existsSync(out)).toBe(true)
    } finally {
      await app.close()
    }
  }
  const xml = readFileSync(xfdf, 'utf8')
  expect(xml).toContain('<line ')
  expect(xml).toContain('<freetext ')
  expect(xml).toContain('intent="FreeTextCallout"')
  expect(readFileSync(fdf).subarray(0, 8).toString('latin1')).toBe('%FDF-1.2')

  // Import each into a clean copy of another document: three comments arrive.
  for (const file of [xfdf, fdf]) {
    copyFileSync(target, join(dir, 'copy.pdf'))
    const app = await launch(join(dir, 'copy.pdf'), join(dir, 'unused'), file)
    try {
      const win = await app.firstWindow()
      await expect(win.locator('.page')).toHaveCount(6)
      await win.getByRole('tab', { name: 'File', exact: true }).click()
      await win.getByRole('button', { name: 'Import', exact: true }).click()
      await expect(win.getByText(/Imported 3 comments/)).toBeVisible()
      await win.getByRole('tab', { name: 'Comments', exact: true }).click()
      const list = win.getByRole('list', { name: 'Comments' })
      await expect(list.locator('li.comment')).toHaveCount(3)
      await expect(list.getByText('Arrow', { exact: true })).toHaveCount(1)
      await expect(list.getByText('Callout', { exact: true })).toHaveCount(1)
      await expect(win.locator('.page').first().locator('.annot-box.callout')).toHaveText('Callout from another tool')
    } finally {
      await app.close()
    }
  }
  rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 })
})
