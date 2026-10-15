import { _electron as electron, expect, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(__dirname, '..')

test('a file opened from the command line shows in the recent list after its tab closes', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'openpdf-e2e-'))
  const pdfPath = join(dir, 'recent.pdf')
  const userData = join(dir, 'userdata')
  execFileSync('python', [join(root, 'scripts', 'make-test-pdf.py'), pdfPath], { stdio: 'inherit' })

  const app = await electron.launch({
    args: ['.', pdfPath],
    cwd: root,
    env: { ...process.env, OPENPDF_E2E: '1', OPENPDF_E2E_USERDATA: userData }
  })
  try {
    const win = await app.firstWindow()
    await expect(win.locator('.page')).toHaveCount(6)
    const settings = JSON.parse(readFileSync(join(userData, 'settings.json'), 'utf8'))
    expect(settings.recent[0].toLowerCase()).toBe(pdfPath.toLowerCase())

    await win.keyboard.press('Control+w')
    const entry = win.locator('.empty .recent-list button').first()
    await expect(entry).toHaveAttribute('title', new RegExp('recent\\.pdf$', 'i'))
    await expect(win.getByRole('button', { name: /Recent/ })).toBeEnabled()

    await entry.click()
    await expect(win.locator('.page')).toHaveCount(6)
  } finally {
    await app.close()
    rmSync(dir, { recursive: true, force: true })
  }
})
