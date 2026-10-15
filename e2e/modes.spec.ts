import { _electron as electron, expect, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(__dirname, '..')

test('page display modes and the marquee zoom tool', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'openpdf-e2e-'))
  const pdfPath = join(dir, 'modes.pdf')
  execFileSync('python', [join(root, 'scripts', 'make-test-pdf.py'), pdfPath], { stdio: 'inherit' })
  const app = await electron.launch({ args: ['.', pdfPath], cwd: root, env: { ...process.env, OPENPDF_E2E: '1', OPENPDF_E2E_USERDATA: join(dir, 'ud') } })
  try {
    const win = await app.firstWindow()
    const problems: string[] = []
    win.on('pageerror', (e) => problems.push(e.message))
    win.on('console', (m) => m.type() === 'error' && problems.push(m.text()))
    await expect(win.locator('.page')).toHaveCount(6)
    await win.getByRole('tab', { name: 'View' }).click()

    // Two pages per row: 3 rows of 2, side by side.
    await win.getByRole('button', { name: 'Two pages' }).click()
    await expect(win.locator('.page-row')).toHaveCount(3)
    const [a, b] = await Promise.all([win.locator('.page').nth(0).boundingBox(), win.locator('.page').nth(1).boundingBox()])
    expect(b!.x).toBeGreaterThan(a!.x + a!.width - 1)
    expect(Math.abs(b!.y + b!.height / 2 - (a!.y + a!.height / 2))).toBeLessThan(2)

    // Cover page: the first row holds page 1 alone.
    await win.getByRole('button', { name: 'Cover page' }).click()
    await expect(win.locator('.page-row')).toHaveCount(4)
    await expect(win.locator('.page-row').first().locator('.page')).toHaveCount(1)

    // Not continuous: one row at a time; the page box and the wheel move between rows.
    await win.getByRole('button', { name: 'Continuous' }).click()
    await expect(win.locator('.page-row')).toHaveCount(1)
    const pageBox = win.getByRole('textbox', { name: 'Page number' })
    await pageBox.fill('4')
    await pageBox.press('Enter')
    await expect(win.locator('.page-row .page')).toHaveCount(2)
    await expect(win.locator('.page-row .page').first()).toHaveAttribute('data-page', '3')
    await win.locator('.scroller').hover()
    for (let i = 0; i < 12; i++) await win.mouse.wheel(0, 600)
    await expect(win.locator('.page-row .page').first()).toHaveAttribute('data-page', '5')

    // Back to single continuous.
    await win.getByRole('button', { name: 'Single' }).click()
    await win.getByRole('button', { name: 'Continuous' }).click()
    await expect(win.locator('.page-row')).toHaveCount(6)

    // Marquee zoom: drag a box around the heading of page 1; zoom rises and the box ends up in view.
    await win.getByRole('button', { name: 'Zoom tool' }).click()
    await pageBox.fill('1')
    await pageBox.press('Enter')
    const before = Number((await win.locator('.zoom-now').textContent())!.replace('%', ''))
    const p0 = (await win.locator('.page').first().boundingBox())!
    const x0 = p0.x + p0.width * 0.1
    const y0 = p0.y + p0.height * 0.08
    await win.mouse.move(x0, y0)
    await win.mouse.down()
    await win.mouse.move(x0 + p0.width * 0.3, y0 + p0.height * 0.06, { steps: 5 })
    await expect(win.locator('.zoom-band')).toBeVisible()
    await win.mouse.up()
    await expect.poll(async () => Number((await win.locator('.zoom-now').textContent())!.replace('%', ''))).toBeGreaterThan(before * 2)
    await expect(win.locator('.page').first().locator('canvas.page-tile')).toBeVisible()
    await win.waitForTimeout(300)
    await win.screenshot({ path: test.info().outputPath('marquee.png') })
    expect(problems).toEqual([])
  } finally {
    await app.close()
    rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 })
  }
})
