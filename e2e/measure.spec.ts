import { _electron as electron, expect, test, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(__dirname, '..')

async function zoomOf(win: Page) {
  return Number((await win.locator('.zoom-now').textContent())!.replace('%', '')) / 100
}
const num = (s: string) => Number(s.replace(/[^\d.]/g, ''))

test('measure distance and area at paper scale, after calibrating, and with a document scale', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'openpdf-e2e-'))
  const plain = join(dir, 'plain.pdf')
  execFileSync('python', [join(root, 'scripts', 'make-test-pdf.py'), plain])
  const app = await electron.launch({ args: ['.', plain], cwd: root, env: { ...process.env, OPENPDF_E2E: '1', OPENPDF_E2E_USERDATA: join(dir, 'ud') } })
  try {
    const win = await app.firstWindow()
    const problems: string[] = []
    win.on('pageerror', (e) => problems.push(e.message))
    await expect(win.locator('.page')).toHaveCount(6)
    await win.getByRole('tab', { name: 'Measure' }).click()
    const z = await zoomOf(win)
    const p0 = (await win.locator('.page').first().boundingBox())!
    const ox = p0.x + 100
    const oy = p0.y + 300

    // Distance: 144 screen px = 144 / zoom points; at paper scale that is (144 / zoom) * 25.4 / 72 mm.
    await win.getByRole('button', { name: 'Distance' }).click()
    await win.mouse.click(ox, oy)
    await win.mouse.move(ox + 100, oy)
    await expect(win.locator('.measure.live')).toHaveCount(1)
    await win.mouse.click(ox + 144, oy)
    const label = win.locator('.measure:not(.live) .measure-label')
    await expect(label).toHaveCount(1)
    expect(await label.textContent()).toMatch(/ mm$/)
    expect(Math.abs(num((await label.textContent())!) - ((144 / z) * 25.4) / 72)).toBeLessThan(0.2)

    // Area: a 100 x 100 px square, finished with Enter.
    await win.getByRole('button', { name: 'Area' }).click()
    for (const [dx, dy] of [[0, 0], [100, 0], [100, 100], [0, 100]]) await win.mouse.click(ox + dx, oy + 60 + dy)
    await win.keyboard.press('Enter')
    await expect(label).toHaveCount(2)
    const area = (await label.nth(1).textContent())!
    expect(area).toMatch(/mm²$/)
    expect(Math.abs(num(area) - ((100 / z) * 25.4 / 72) ** 2) / ((100 / z) * 25.4 / 72) ** 2).toBeLessThan(0.01)

    // Calibrate: a 200 px line is 10 m, so a 100 px distance reads 5 m.
    await win.getByRole('button', { name: 'Calibrate' }).click()
    await win.mouse.click(ox, oy + 200)
    await win.mouse.click(ox + 200, oy + 200)
    await win.getByRole('textbox', { name: 'Real length' }).fill('10')
    await win.getByRole('combobox', { name: 'Unit' }).selectOption('m')
    await win.getByRole('button', { name: 'Set scale' }).click()
    await expect(win.getByText(/^Calibrated:/)).toBeVisible()
    // Calibrating switches to the distance tool.
    await win.mouse.click(ox, oy + 230)
    await win.mouse.click(ox + 100, oy + 230)
    await expect(label).toHaveCount(3)
    expect(await label.nth(2).textContent()).toBe('5 m')
    // Existing labels follow the new scale too.
    expect(await label.nth(0).textContent()).toMatch(/ m$/)
    await win.screenshot({ path: test.info().outputPath('measure.png') })

    expect(problems).toEqual([])
  } finally {
    await app.close()
    rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 })
  }
})

test('a document scale (viewport measure dictionary) is used automatically', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'openpdf-e2e-'))
  const scaled = join(dir, 'scaled.pdf')
  execFileSync('npx', ['tsx', join(root, 'scripts', 'make-feature-pdf.mts'), scaled], { cwd: root, shell: true })
  const app = await electron.launch({ args: ['.', scaled], cwd: root, env: { ...process.env, OPENPDF_E2E: '1', OPENPDF_E2E_USERDATA: join(dir, 'ud') } })
  try {
    const win = await app.firstWindow()
    await expect(win.locator('.page')).toHaveCount(4)
    await win.getByRole('tab', { name: 'Measure' }).click()
    await expect(win.getByText('From the document: 1:100 (m)')).toBeVisible()
    const z = await zoomOf(win)
    const p0 = (await win.locator('.page').first().boundingBox())!
    await win.getByRole('button', { name: 'Distance' }).click()
    await win.mouse.click(p0.x + 50, p0.y + 200)
    await win.mouse.click(p0.x + 50 + 72 * z, p0.y + 200)
    const label = win.locator('.measure:not(.live) .measure-label')
    await expect(label).toHaveCount(1)
    expect(Math.abs(num((await label.textContent())!) - 2.54)).toBeLessThan(0.02)
    expect(await label.textContent()).toMatch(/ m$/)
  } finally {
    await app.close()
    rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 })
  }
})
