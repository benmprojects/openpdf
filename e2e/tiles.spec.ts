import { _electron as electron, expect, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(__dirname, '..')

test('at 800% the page renders as a small base plus a sharp tile that follows the view', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'openpdf-e2e-'))
  const pdfPath = join(dir, 'tiles.pdf')
  execFileSync('python', [join(root, 'scripts', 'make-test-pdf.py'), pdfPath], { stdio: 'inherit' })
  const app = await electron.launch({ args: ['.', pdfPath], cwd: root, env: { ...process.env, OPENPDF_E2E: '1', OPENPDF_E2E_USERDATA: join(dir, 'ud') } })
  try {
    const win = await app.firstWindow()
    const problems: string[] = []
    win.on('pageerror', (e) => problems.push(e.message))
    await expect(win.locator('.page')).toHaveCount(6)
    await win.getByRole('combobox', { name: 'Zoom' }).selectOption('8')

    const page0 = win.locator('.page').first()
    const tile = page0.locator('canvas.page-tile')
    await expect(tile).toBeVisible({ timeout: 15_000 })
    const info = () =>
      page0.evaluate((el) => {
        const [base, t] = el.querySelectorAll('canvas')
        const ctx = (t as HTMLCanvasElement).getContext('2d')!
        const { width, height } = t as HTMLCanvasElement
        const px = ctx.getImageData(0, 0, width, height).data
        let dark = 0
        for (let i = 0; i < px.length; i += 4 * 97) if (px[i] < 128) dark++
        return { baseW: base.width, baseH: base.height, tileW: width, tileH: height, left: (t as HTMLElement).style.left, top: (t as HTMLElement).style.top, dark }
      })
    // Go to the page's top left corner, where the heading is.
    await win.locator('.scroller').evaluate((el) => {
      const page = el.querySelector<HTMLElement>('.page')!
      el.scrollTop = 0
      el.scrollLeft = page.offsetLeft - 16
    })
    await expect.poll(async () => (await info()).dark, { timeout: 10_000 }).toBeGreaterThan(0)
    const first = await info()
    // The whole page at 800% would be about 4760 x 6736 device pixels per page; the base stays small.
    expect(first.baseW * first.baseH).toBeLessThan(4_000_000)
    expect(first.tileW * first.tileH).toBeLessThan(16_000_000)

    // Scroll down within the page: a new tile further down replaces the first.
    await win.locator('.scroller').evaluate((el) => (el.scrollTop += 2500))
    await expect.poll(async () => (await info()).top, { timeout: 10_000 }).not.toBe(first.top)
    await win.screenshot({ path: test.info().outputPath('tile.png') })
    expect(problems).toEqual([])
  } finally {
    await app.close()
    rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 })
  }
})
