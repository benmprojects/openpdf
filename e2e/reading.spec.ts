import { _electron as electron, expect, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(__dirname, '..')

test('reading mode, page colours, screen-reader text and read aloud', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'openpdf-e2e-'))
  const pdfPath = join(dir, 'reading.pdf')
  execFileSync('python', [join(root, 'scripts', 'make-test-pdf.py'), pdfPath])
  const app = await electron.launch({ args: ['.', pdfPath], cwd: root, env: { ...process.env, OPENPDF_E2E: '1', OPENPDF_E2E_USERDATA: join(dir, 'ud') } })
  try {
    const win = await app.firstWindow()
    const problems: string[] = []
    win.on('pageerror', (e) => problems.push(e.message))
    await expect(win.locator('.page')).toHaveCount(6)

    // Screen readers get each visible page's text.
    await expect(win.getByRole('article', { name: 'Page 1' })).toContainText('The quick brown fox jumps over the lazy dog')

    // Reading mode hides the ribbon and side pane; Esc brings them back.
    await win.keyboard.press('Control+h')
    await expect(win.locator('.ribbon')).toBeHidden()
    await expect(win.locator('aside.sidebar')).toHaveCount(0)
    await expect(win.getByRole('button', { name: 'Leave reading mode' })).toBeVisible()
    await win.keyboard.press('Escape')
    await expect(win.locator('.ribbon')).toBeVisible()
    await expect(win.locator('aside.sidebar')).toHaveCount(1)

    // Night colours invert the page canvas (view only).
    await win.getByRole('tab', { name: 'View' }).click()
    await win.getByRole('button', { name: 'Night' }).click()
    await expect(win.locator('.scroller')).toHaveClass(/colours-night/)
    expect(await win.locator('.page canvas').first().evaluate((c) => getComputedStyle(c).filter)).toContain('invert')
    await win.screenshot({ path: test.info().outputPath('night.png') })
    await win.getByRole('button', { name: 'Normal colours' }).click()
    await expect(win.locator('.scroller')).toHaveClass(/colours-normal/)

    // Read aloud: with a voice installed, Read starts speaking and Stop ends it.
    const voices = await win.evaluate(() => new Promise<number>((r) => {
      const n = speechSynthesis.getVoices().length
      if (n) return r(n)
      speechSynthesis.addEventListener('voiceschanged', () => r(speechSynthesis.getVoices().length), { once: true })
      setTimeout(() => r(speechSynthesis.getVoices().length), 2000)
    }))
    test.info().annotations.push({ type: 'voices', description: String(voices) })
    if (voices > 0) {
      await win.getByRole('button', { name: 'Read', exact: true }).click()
      await expect(win.getByRole('button', { name: 'Pause' })).toBeVisible()
      await expect.poll(() => win.evaluate(() => speechSynthesis.speaking)).toBe(true)
      await win.getByRole('button', { name: 'Stop' }).click()
      await expect(win.getByRole('button', { name: 'Read', exact: true })).toBeVisible()
      await expect.poll(() => win.evaluate(() => speechSynthesis.speaking)).toBe(false)
    }
    expect(problems).toEqual([])
  } finally {
    await app.close()
    rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 })
  }
})
