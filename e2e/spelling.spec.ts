import { _electron as electron, expect, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(__dirname, '..')

test('spell check can be turned off in Settings and the choice is remembered', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'openpdf-e2e-'))
  const pdfPath = join(dir, 'spell.pdf')
  execFileSync('python', [join(root, 'scripts', 'make-test-pdf.py'), pdfPath])
  const userData = join(dir, 'ud')
  const app = await electron.launch({ args: ['.', pdfPath], cwd: root, env: { ...process.env, OPENPDF_E2E: '1', OPENPDF_E2E_USERDATA: userData, OPENPDF_E2E_DISCARD: '1' } })
  try {
    const win = await app.firstWindow()
    await expect(win.locator('.page')).toHaveCount(6)
    await win.getByRole('button', { name: 'Settings' }).click()
    const box = win.getByRole('checkbox', { name: /Check spelling/ })
    await expect(box).toBeChecked()
    await box.uncheck()
    await expect(box).not.toBeChecked()
    await expect.poll(() => (existsSync(join(userData, 'settings.json')) ? JSON.parse(readFileSync(join(userData, 'settings.json'), 'utf8')).spellcheck : null)).toBe(false)
    // The text boxes are checked by the browser engine only while it is on.
    expect(await app.evaluate(({ session }) => session.defaultSession.isSpellCheckerEnabled())).toBe(false)
    await box.check()
    expect(await app.evaluate(({ session }) => session.defaultSession.isSpellCheckerEnabled())).toBe(true)
  } finally {
    await app.close()
    rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 })
  }
})
