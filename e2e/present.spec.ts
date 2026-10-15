import { _electron as electron, expect, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(__dirname, '..')

test('presentation mode: full screen, keys move between pages, Esc returns to that page', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'openpdf-e2e-'))
  const pdfPath = join(dir, 'present.pdf')
  execFileSync('python', [join(root, 'scripts', 'make-test-pdf.py'), pdfPath])
  const app = await electron.launch({ args: ['.', pdfPath], cwd: root, env: { ...process.env, OPENPDF_E2E: '1', OPENPDF_E2E_USERDATA: join(dir, 'ud') } })
  try {
    const win = await app.firstWindow()
    const problems: string[] = []
    win.on('pageerror', (e) => problems.push(e.message))
    await expect(win.locator('.page')).toHaveCount(6)
    await win.keyboard.press('F5')
    const show = win.getByRole('dialog', { name: 'Presentation' })
    await expect(show).toBeVisible()
    await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isFullScreen())).toBe(true)
    await expect(show.locator('.presentation-counter')).toHaveText('1 / 6')
    await expect.poll(() => show.locator('canvas').evaluate((c: HTMLCanvasElement) => c.width)).toBeGreaterThan(100)
    // The page fills the screen height or width.
    const box = (await show.locator('canvas').boundingBox())!
    const vp = await win.evaluate(() => ({ w: innerWidth, h: innerHeight }))
    expect(Math.max(box.width / vp.w, box.height / vp.h)).toBeGreaterThan(0.97)

    await win.keyboard.press('ArrowRight')
    await win.keyboard.press('Space')
    await expect(show.locator('.presentation-counter')).toHaveText('3 / 6')
    await win.keyboard.press('PageUp')
    await expect(show.locator('.presentation-counter')).toHaveText('2 / 6')
    await win.keyboard.press('End')
    await expect(show.locator('.presentation-counter')).toHaveText('6 / 6')
    await win.keyboard.press('ArrowRight') // stays on the last page
    await expect(show.locator('.presentation-counter')).toHaveText('6 / 6')
    await win.keyboard.press('Escape')
    await expect(show).toHaveCount(0)
    await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isFullScreen())).toBe(false)
    await expect(win.getByRole('textbox', { name: 'Page number' })).toHaveValue('6')
    expect(problems).toEqual([])
  } finally {
    await app.close()
    rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 })
  }
})
