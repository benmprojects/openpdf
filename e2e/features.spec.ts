import { _electron as electron, expect, test, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(__dirname, '..')

/** Colour of page 1's canvas at a point given in PDF points from the top left. */
async function pixel(win: Page, x: number, y: number) {
  return win.locator('.page').first().evaluate(
    (el, [x, y]) => {
      const cv = el.querySelector('canvas') as HTMLCanvasElement
      const s = cv.width / 595
      const [r, g, b] = cv.getContext('2d')!.getImageData(Math.round(x * s), Math.round(y * s), 1, 1).data
      return { r, g, b }
    },
    [x, y]
  )
}
const isBlue = (c: { r: number; g: number; b: number }) => c.b > 200 && c.r < 60 && c.g < 60
const isGreen = (c: { r: number; g: number; b: number }) => c.g > 120 && c.r < 60 && c.b < 60
const isWhite = (c: { r: number; g: number; b: number }) => c.r > 240 && c.g > 240 && c.b > 240

test('page labels, attachments and layers', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'openpdf-e2e-'))
  const pdfPath = join(dir, 'feature.pdf')
  const outDir = join(dir, 'out')
  mkdirSync(outDir)
  execFileSync('npx', ['tsx', join(root, 'scripts', 'make-feature-pdf.mts'), pdfPath], { cwd: root, shell: true })
  const app = await electron.launch({
    args: ['.', pdfPath],
    cwd: root,
    env: { ...process.env, OPENPDF_E2E: '1', OPENPDF_E2E_USERDATA: join(dir, 'ud'), OPENPDF_E2E_DIR: outDir, OPENPDF_E2E_DISCARD: '1' }
  })
  try {
    const win = await app.firstWindow()
    const problems: string[] = []
    win.on('pageerror', (e) => problems.push(e.message))
    win.on('console', (m) => m.type() === 'error' && problems.push(m.text()))
    await expect(win.locator('.page')).toHaveCount(4)

    // Page labels: thumbnails and the page box use them; typing a label goes to that page.
    await expect(win.locator('.thumb span')).toHaveText(['i', 'ii', '1', '2'])
    const pageBox = win.getByRole('textbox', { name: 'Page number' })
    await expect(pageBox).toHaveValue('i')
    await pageBox.fill('1')
    await pageBox.press('Enter')
    await expect(pageBox).toHaveValue('1')
    await expect(win.getByText('(3 of 4)')).toBeVisible()
    await pageBox.fill('ii')
    await pageBox.press('Enter')
    await expect(win.getByText('(2 of 4)')).toBeVisible()

    // Attachments: listed with sizes; Save writes the file (the test hook answers the dialog).
    await win.getByRole('tab', { name: 'Attachments' }).click()
    await expect(win.locator('.side-list li')).toHaveCount(2)
    await win.getByRole('button', { name: 'Save notes.txt' }).click()
    await expect.poll(() => existsSync(join(outDir, 'notes.txt'))).toBe(true)
    expect(readFileSync(join(outDir, 'notes.txt'), 'utf8')).toBe('Hello from an attached text file.\n')

    // Layers: "Hidden layer" starts off. Make an unsaved annotation first; toggling layers must keep it.
    await win.locator('.scroller').evaluate((el) => (el.scrollTop = 0))
    await win.getByRole('tab', { name: 'Comment' }).click()
    await win.getByRole('button', { name: 'Rectangle' }).click()
    const p0 = (await win.locator('.page').first().boundingBox())!
    await win.mouse.move(p0.x + p0.width * 0.55, p0.y + 40)
    await win.mouse.down()
    await win.mouse.move(p0.x + p0.width * 0.8, p0.y + 110, { steps: 4 })
    await win.mouse.up()
    await expect(win.locator('.tab-dirty')).toBeVisible()
    const shapes = await win.locator('.page').first().locator('.annot-svg *').count()

    await win.getByRole('tab', { name: 'Layers' }).click()
    await expect(win.locator('.side-list li')).toHaveCount(2)
    await expect.poll(async () => isBlue(await pixel(win, 160, 282))).toBe(true)
    expect(isWhite(await pixel(win, 420, 282))).toBe(true)

    await win.getByRole('button', { name: 'Show Hidden layer' }).click()
    await expect.poll(async () => isGreen(await pixel(win, 420, 282)), { timeout: 10_000 }).toBe(true)
    await win.getByRole('button', { name: 'Hide Notes layer' }).click()
    await expect.poll(async () => isWhite(await pixel(win, 160, 282)), { timeout: 10_000 }).toBe(true)

    // The unsaved rectangle is still there and the tab is still unsaved.
    await expect(win.locator('.tab-dirty')).toBeVisible()
    expect(await win.locator('.page').first().locator('.annot-svg *').count()).toBe(shapes)
    await win.screenshot({ path: test.info().outputPath('layers.png') })
    expect(problems).toEqual([])
  } finally {
    await app.close()
    rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 })
  }
})
