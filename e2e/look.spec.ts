import { _electron as electron, expect, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(__dirname, '..')

/** Screenshots of the welcome screen and a document in both themes, for eyeballing the design. */
for (const theme of ['light', 'dark'] as const) {
  test(`looks right in the ${theme} theme`, async () => {
    const dir = mkdtempSync(join(tmpdir(), 'openpdf-e2e-'))
    const pdfPath = join(dir, 'look.pdf')
    const userData = join(dir, 'userdata')
    execFileSync('python', [join(root, 'scripts', 'make-test-pdf.py'), pdfPath], { stdio: 'inherit' })
    mkdirSync(userData)
    writeFileSync(join(userData, 'settings.json'), JSON.stringify({ theme, recent: [pdfPath, join(dir, 'Quarterly report.pdf')] }))

    const app = await electron.launch({ args: ['.'], cwd: root, env: { ...process.env, OPENPDF_E2E: '1', OPENPDF_E2E_USERDATA: userData } })
    try {
      const win = await app.firstWindow()
      await expect(win.locator('.welcome-card')).toBeVisible()
      // Playwright pins prefers-color-scheme to light unless told not to; let Electron's theme through.
      await win.emulateMedia({ colorScheme: null })
      expect(await app.evaluate(({ nativeTheme }) => nativeTheme.themeSource)).toBe(theme)
      await expect.poll(() => win.evaluate(() => matchMedia('(prefers-color-scheme: dark)').matches)).toBe(theme === 'dark')
      await win.screenshot({ path: test.info().outputPath(`welcome-${theme}.png`) })
      await win.locator('.empty .recent-list button').first().click()
      await expect(win.locator('.page')).toHaveCount(6)
      await win.getByRole('tab', { name: 'Comment' }).click()
      await win.waitForTimeout(400)
      await win.screenshot({ path: test.info().outputPath(`doc-${theme}.png`) })
    } finally {
      await app.close()
      rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 })
    }
  })
}
