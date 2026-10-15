import { _electron as electron, expect, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(__dirname, '..')

test('rulers, guides, grid and snapping', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'openpdf-e2e-'))
  const pdfPath = join(dir, 'rulers.pdf')
  execFileSync('python', [join(root, 'scripts', 'make-test-pdf.py'), pdfPath])
  const app = await electron.launch({ args: ['.', pdfPath], cwd: root, env: { ...process.env, OPENPDF_E2E: '1', OPENPDF_E2E_USERDATA: join(dir, 'ud') } })
  try {
    const win = await app.firstWindow()
    const problems: string[] = []
    win.on('pageerror', (e) => problems.push(e.message))
    await expect(win.locator('.page')).toHaveCount(6)
    await win.getByRole('tab', { name: 'View' }).click()

    // Rulers appear above and left of the pages.
    await win.getByRole('button', { name: 'Rulers', exact: true }).click()
    await expect(win.locator('canvas.ruler-x')).toBeVisible()
    await expect(win.locator('canvas.ruler-y')).toBeVisible()

    // Drag a guide from the top ruler onto page 1, then another from the left ruler.
    const top = (await win.locator('canvas.ruler-x').boundingBox())!
    const left = (await win.locator('canvas.ruler-y').boundingBox())!
    const p0 = (await win.locator('.page').first().boundingBox())!
    await win.mouse.move(p0.x + 200, top.y + 10)
    await win.mouse.down()
    await win.mouse.move(p0.x + 200, p0.y + 150, { steps: 5 })
    await win.mouse.up()
    await expect(win.locator('.page').first().locator('.guide')).toHaveCount(1)
    await win.mouse.move(left.x + 10, p0.y + 300)
    await win.mouse.down()
    await win.mouse.move(p0.x + 120, p0.y + 300, { steps: 5 })
    await win.mouse.up()
    await expect(win.locator('.page').first().locator('.guide')).toHaveCount(2)
    // Guides show on every page.
    await expect(win.locator('.page').nth(1).locator('.guide')).toHaveCount(2)

    // Drag the horizontal guide back onto the top ruler: it goes.
    const hit = win.locator('.page').first().locator('.guide-hit.y')
    const hb = (await hit.boundingBox())!
    await win.mouse.move(p0.x + 300, hb.y + hb.height / 2)
    await win.mouse.down()
    await win.mouse.move(p0.x + 300, top.y + 5, { steps: 6 })
    await win.mouse.up()
    await expect(win.locator('.page').first().locator('.guide')).toHaveCount(1)

    // Grid on, 10 mm, with snap: a measured distance comes out as a whole number of centimetres.
    await win.getByRole('button', { name: 'Grid', exact: true }).click()
    await expect(win.locator('.page').first().locator('.grid-major').first()).toBeAttached()
    await win.getByRole('button', { name: 'Snap', exact: true }).click()
    await win.getByRole('tab', { name: 'Measure' }).click()
    await win.getByRole('button', { name: 'Distance' }).click()
    await win.mouse.click(p0.x + 213, p0.y + 401)
    await win.mouse.click(p0.x + 437, p0.y + 398)
    const label = (await win.locator('.measure:not(.live) .measure-label').textContent())!
    const mm = Number(label.replace(/[^\d.]/g, ''))
    expect(label).toMatch(/ mm$/)
    expect(mm % 10).toBeCloseTo(0, 5)
    await win.screenshot({ path: test.info().outputPath('rulers.png') })
    expect(problems).toEqual([])
  } finally {
    await app.close()
    rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 })
  }
})
