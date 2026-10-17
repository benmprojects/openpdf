import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { PDFDocument, rgb } from 'pdf-lib'

const root = resolve(__dirname, '..')

const launch = (dir: string, args: string[] = [], env: Record<string, string> = {}) =>
  electron.launch({ args: ['.', ...args], cwd: root, env: { ...process.env, OPENPDF_E2E: '1', OPENPDF_E2E_USERDATA: join(dir, 'ud'), OPENPDF_E2E_DISCARD: '1', ...env } })

const box = async (win: Page, i: number) => (await win.locator(`.scroller [data-page="${i}"]`).boundingBox())!

async function withDoc(run: (win: Page, app: ElectronApplication, dir: string, pdf: string) => Promise<void>, make?: (dir: string, pdf: string) => Promise<void> | void) {
  const dir = mkdtempSync(join(tmpdir(), 'openpdf-e2e-'))
  const pdf = join(dir, 'work.pdf')
  if (make) await make(dir, pdf)
  else execFileSync('python', [join(root, 'scripts', 'make-test-pdf.py'), pdf])
  const app = await launch(dir, [pdf])
  try {
    const win = await app.firstWindow()
    const problems: string[] = []
    win.on('pageerror', (e) => problems.push(e.message))
    await expect(win.locator('.page')).not.toHaveCount(0)
    await run(win, app, dir, pdf)
    expect(problems).toEqual([])
  } finally {
    await app.close()
    rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 })
  }
}

test('two pages can run right to left, and the gaps between pages can be turned off', async () => {
  await withDoc(async (win) => {
    await win.getByRole('tab', { name: 'View', exact: true }).click()
    await win.getByRole('button', { name: 'Two pages' }).click()
    // Right to left needs two pages in a row; the button is off for a single column.
    const rtl = win.getByRole('button', { name: 'Right to left' })
    await expect(rtl).toBeEnabled()
    await expect.poll(async () => (await box(win, 1)).x > (await box(win, 0)).x).toBe(true) // left to right: page 2 is on the right
    await rtl.click()
    await expect(rtl).toHaveAttribute('aria-pressed', 'true')
    await expect.poll(async () => (await box(win, 1)).x < (await box(win, 0)).x).toBe(true) // page 2 is now on the left
    // Still the same pair on one row.
    // (Pages of different heights are centred on the row, so compare their middles.)
    const mid = async (i: number) => {
      const b = await box(win, i)
      return b.y + b.height / 2
    }
    await expect.poll(async () => Math.abs((await mid(0)) - (await mid(1)))).toBeLessThan(2)

    // Gaps: pages in a row touch when they are off, and are apart when on.
    const gap = async () => {
      const a = await box(win, 0)
      const b = await box(win, 1)
      return Math.round(Math.max(a.x, b.x) - Math.min(a.x + a.width, b.x + b.width))
    }
    await expect.poll(gap).toBeGreaterThan(6)
    await win.getByRole('button', { name: 'Page gaps' }).click()
    await expect(win.getByRole('button', { name: 'Page gaps' })).toHaveAttribute('aria-pressed', 'false')
    await expect.poll(gap).toBeLessThanOrEqual(1)
    // Single column: rows touch too.
    await win.getByRole('button', { name: 'Single' }).click()
    await expect
      .poll(async () => {
        const a = await box(win, 0)
        const b = await box(win, 1)
        return Math.round(b.y - (a.y + a.height))
      })
      .toBeLessThanOrEqual(1)
  })
})

test('the page size and pointer position show in the status bar', async () => {
  await withDoc(async (win) => {
    await win.getByRole('tab', { name: 'View', exact: true }).click()
    const status = win.getByRole('toolbar', { name: 'Page and zoom' })
    await expect(status.getByRole('status', { name: 'Page size and position' })).toHaveCount(0)
    await win.getByRole('button', { name: 'Page info' }).click()
    const readout = status.getByRole('status', { name: 'Page size and position' })
    await expect(readout).toContainText(/\d+\.\d × \d+\.\d mm/)
    const p = await box(win, 0)
    await win.mouse.move(p.x + 100, p.y + 100)
    await win.mouse.move(p.x + 106, p.y + 103)
    await expect(readout).toContainText(/x \d+\.\d, y \d+\.\d mm/)
    // The position is measured from the page's top-left corner: 100 px at the shown zoom, as millimetres.
    const zoom = Number((await win.locator('.zoom-now').innerText()).replace('%', '')) / 100
    const text = await readout.innerText()
    const m = /x (\d+\.\d), y (\d+\.\d) mm/.exec(text)!
    expect(Number(m[1])).toBeCloseTo(((106 / zoom) * 25.4) / 72, 0)
    expect(Number(m[2])).toBeCloseTo(((103 / zoom) * 25.4) / 72, 0)
    // Units follow the ruler unit.
    await win.getByLabel('Ruler units').selectOption('in')
    await expect(readout).toContainText(' in')
    // Off the page the position goes, the size stays.
    await win.mouse.move(400, 60)
    await expect(readout).not.toContainText('x ')
    await win.getByRole('button', { name: 'Page info' }).click()
    await expect(readout).toHaveCount(0)
  })
})

/** A page with one hairline across it, for the thin lines check. */
async function hairlinePdf(_dir: string, pdf: string) {
  const doc = await PDFDocument.create()
  const page = doc.addPage([400, 300])
  page.drawLine({ start: { x: 20, y: 20 }, end: { x: 380, y: 280 }, thickness: 0.25, color: rgb(0, 0, 0) })
  writeFileSync(pdf, await doc.save())
}

test('thin lines draw hairlines without smoothing, and the transparency grid clears the page background', async () => {
  await withDoc(async (win) => {
    await win.getByRole('tab', { name: 'View', exact: true }).click()
    await win.getByRole('button', { name: 'Actual size' }).click()
    const canvas = win.locator('.scroller [data-page="0"] canvas').first()
    // Pixels the line touches: smoothed it is spread over about two pixels across, drawn without smoothing about one.
    const inked = () =>
      canvas.evaluate((c: HTMLCanvasElement) => {
        const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data
        let n = 0
        for (let i = 0; i < d.length; i += 4) if (d[i] < 250) n++
        return n
      })
    // The page is drawn again when the zoom settles: wait for a bitmap of the final size (400 pt at 100%).
    await expect.poll(() => canvas.evaluate((c: HTMLCanvasElement) => c.width / (window.devicePixelRatio || 1))).toBeCloseTo(400, 0)
    await expect.poll(inked).toBeGreaterThan(100)
    const smooth = await inked()
    const thin = win.getByRole('button', { name: 'Thin lines' })
    await thin.click()
    await expect(thin).toHaveAttribute('aria-pressed', 'true')
    await expect.poll(inked, { timeout: 15_000 }).toBeLessThan(smooth * 0.8)
    const thinInked = await inked()
    await thin.click()
    await expect(thin).toHaveAttribute('aria-pressed', 'false')
    await expect.poll(inked, { timeout: 15_000 }).toBe(smooth)
    expect(thinInked).toBeLessThan(smooth)

    // Transparency grid: the page is drawn with a clear background over a chequered one.
    const corner = () => canvas.evaluate((c: HTMLCanvasElement) => c.getContext('2d')!.getImageData(2, 2, 1, 1).data[3])
    await expect.poll(corner).toBe(255)
    const grid = win.getByRole('button', { name: 'Transparency grid' })
    await grid.click()
    await expect(grid).toHaveAttribute('aria-pressed', 'true')
    await expect(win.locator('.scroller.tgrid')).toHaveCount(1)
    await expect.poll(corner, { timeout: 15_000 }).toBe(0)
    await grid.click()
    await expect.poll(corner, { timeout: 15_000 }).toBe(255)
  }, hairlinePdf)
})

test('the pan and zoom window moves the view and zooms it', async () => {
  await withDoc(async (win) => {
    await win.getByRole('tab', { name: 'View', exact: true }).click()
    await win.getByRole('button', { name: 'Actual size' }).click()
    const scroller = win.locator('.scroller').first()
    await expect(win.getByRole('region', { name: 'Pan and zoom' })).toHaveCount(0)
    await win.getByRole('button', { name: 'Pan and zoom' }).click()
    const pz = win.getByRole('region', { name: 'Pan and zoom' })
    await expect(pz).toBeVisible()
    await expect.poll(() => pz.locator('canvas').evaluate((c: HTMLCanvasElement) => c.width)).toBeGreaterThan(0)
    const view = pz.getByTestId('panzoom-view')
    await expect(view).toBeVisible()
    const page = pz.locator('.panzoom-page')
    const pageBox = (await page.boundingBox())!
    const before = await scroller.evaluate((el) => el.scrollTop)

    // Click low on the overview: the main view moves down.
    await page.click({ position: { x: pageBox.width / 2, y: pageBox.height * 0.9 } })
    await expect.poll(() => scroller.evaluate((el) => el.scrollTop)).toBeGreaterThan(before + 100)
    // The rectangle followed.
    await expect.poll(async () => (await view.boundingBox())!.y - pageBox.y).toBeGreaterThan(pageBox.height * 0.4)

    // Drag the rectangle up: the main view moves back up.
    const vb = (await view.boundingBox())!
    const mid = await scroller.evaluate((el) => el.scrollTop)
    await win.mouse.move(vb.x + vb.width / 2, vb.y + vb.height / 2)
    await win.mouse.down()
    await win.mouse.move(vb.x + vb.width / 2, vb.y + vb.height / 2 - 40, { steps: 5 })
    await win.mouse.up()
    await expect.poll(() => scroller.evaluate((el) => el.scrollTop)).toBeLessThan(mid - 50)

    // Drag the corner handle to make the rectangle narrower: the zoom goes up.
    const zoomBefore = Number((await win.locator('.zoom-now').innerText()).replace('%', ''))
    const h = (await pz.locator('.panzoom-handle').boundingBox())!
    const vb2 = (await view.boundingBox())!
    await win.mouse.move(h.x + h.width / 2, h.y + h.height / 2)
    await win.mouse.down()
    await win.mouse.move(vb2.x + vb2.width * 0.5, h.y + h.height / 2, { steps: 5 })
    await win.mouse.up()
    await expect.poll(async () => Number((await win.locator('.zoom-now').innerText()).replace('%', ''))).toBeGreaterThan(zoomBefore)

    await pz.getByRole('button', { name: 'Close pan and zoom' }).click()
    await expect(pz).toHaveCount(0)
  })
})

test('presentation: a transition plays when the page changes, and pages advance by themselves', async () => {
  await withDoc(async (win) => {
    await win.keyboard.press('F5')
    const show = win.getByRole('dialog', { name: 'Presentation' })
    await expect(show).toBeVisible()
    await expect(show.locator('.presentation-counter')).toHaveText('1 / 6')
    await expect.poll(() => show.locator('canvas').evaluate((c: HTMLCanvasElement) => c.width)).toBeGreaterThan(100)
    await win.evaluate(() => {
      const w = window as unknown as { __anim: number }
      w.__anim = 0
      const original = HTMLCanvasElement.prototype.animate
      HTMLCanvasElement.prototype.animate = function (...args: Parameters<Element['animate']>) {
        w.__anim++
        return original.apply(this, args)
      }
    })
    const bar = show.getByRole('toolbar', { name: 'Presentation options' })
    await bar.getByLabel('Transition', { exact: true }).selectOption('fade')
    await win.keyboard.press('ArrowRight')
    await expect(show.locator('.presentation-counter')).toHaveText('2 / 6')
    await expect.poll(() => win.evaluate(() => (window as unknown as { __anim: number }).__anim)).toBeGreaterThan(0)

    // No transition: moving on plays nothing.
    await bar.getByLabel('Transition', { exact: true }).selectOption('none')
    const count = await win.evaluate(() => (window as unknown as { __anim: number }).__anim)
    await win.keyboard.press('ArrowRight')
    await expect(show.locator('.presentation-counter')).toHaveText('3 / 6')
    await win.waitForTimeout(600)
    expect(await win.evaluate(() => (window as unknown as { __anim: number }).__anim)).toBe(count)

    // Automatic advance every 2 seconds; A pauses it.
    await bar.getByLabel('Advance automatically').selectOption('2')
    await expect(show.locator('.presentation-counter')).toHaveText('4 / 6', { timeout: 6000 })
    await win.keyboard.press('a')
    await expect(bar.getByRole('button', { name: 'Resume' })).toBeVisible()
    await win.waitForTimeout(2600)
    await expect(show.locator('.presentation-counter')).toHaveText('4 / 6')
    await win.keyboard.press('a')
    await expect(show.locator('.presentation-counter')).toHaveText('5 / 6', { timeout: 6000 })
    // At the end it stops (looping is off).
    await expect(show.locator('.presentation-counter')).toHaveText('6 / 6', { timeout: 6000 })
    await win.waitForTimeout(2600)
    await expect(show.locator('.presentation-counter')).toHaveText('6 / 6')
    // With looping it goes back to the first page (the bar fades after a moment without the pointer: wake it).
    await win.mouse.move(300, 300)
    await win.mouse.move(320, 310)
    await bar.getByRole('button', { name: 'Resume' }).click()
    await bar.getByRole('checkbox', { name: 'Loop' }).check()
    await expect(show.locator('.presentation-counter')).toHaveText('1 / 6', { timeout: 6000 })
    await win.keyboard.press('Escape')
    await expect(show).toHaveCount(0)
  })
})

test('the choices made in a presentation are remembered', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'openpdf-e2e-'))
  const pdf = join(dir, 'work.pdf')
  execFileSync('python', [join(root, 'scripts', 'make-test-pdf.py'), pdf])
  try {
    let app = await launch(dir, [pdf])
    let win = await app.firstWindow()
    await expect(win.locator('.page')).toHaveCount(6)
    await win.keyboard.press('F5')
    const bar = win.getByRole('dialog', { name: 'Presentation' }).getByRole('toolbar', { name: 'Presentation options' })
    await bar.getByLabel('Transition', { exact: true }).selectOption('wipe')
    await bar.getByLabel('Advance automatically').selectOption('30')
    await win.keyboard.press('Escape')
    await app.close()
    app = await launch(dir, [pdf])
    win = await app.firstWindow()
    await expect(win.locator('.page')).toHaveCount(6)
    await win.keyboard.press('F5')
    const bar2 = win.getByRole('dialog', { name: 'Presentation' }).getByRole('toolbar', { name: 'Presentation options' })
    await expect(bar2.getByLabel('Transition', { exact: true })).toHaveValue('wipe')
    await expect(bar2.getByLabel('Advance automatically')).toHaveValue('30')
    await win.keyboard.press('Escape')
    await app.close()
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 })
  }
})

test('other views show comments and form fields, and a four-way split has four views', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'openpdf-e2e-'))
  const pdf = join(dir, 'form.pdf')
  execFileSync(process.execPath, ['--import', 'tsx', join(root, 'scripts', 'make-form-pdf.mts'), pdf], { cwd: root })
  const app = await launch(dir, [pdf])
  try {
    const win = await app.firstWindow()
    const problems: string[] = []
    win.on('pageerror', (e) => problems.push(e.message))
    await expect(win.locator('.page')).not.toHaveCount(0)
    // A note drawn by the overlay (it is new, so PDFium does not draw it).
    await win.getByRole('tab', { name: 'Comment', exact: true }).click()
    await win.getByRole('button', { name: 'Note', exact: true }).click()
    const p = await box(win, 0)
    await win.mouse.click(p.x + 40, p.y + 30)
    await win.getByRole('textbox', { name: 'Note text' }).fill('Check this')
    await win.getByRole('textbox', { name: 'Note text' }).press('Control+Enter')
    await expect(win.locator('.scroller [data-page="0"] .annot-box.note').first()).toBeVisible()

    await win.getByRole('tab', { name: 'View', exact: true }).click()
    await win.getByRole('button', { name: 'Split vertically' }).click()
    const second = win.getByRole('region', { name: 'Second view' })
    await expect(second).toBeVisible()
    // The form fields are controls over the second view's pages, read-only.
    await expect(second.locator('.form-layer').first()).toBeVisible()
    expect(await second.locator('.form-layer input, .form-layer select, .form-layer textarea').count()).toBeGreaterThan(0)
    // The note is drawn there too.
    await expect(second.locator('.annot-box.note').first()).toBeVisible()
    // What is drawn over the second view cannot be clicked or focused: it is inert.
    expect(await second.locator('.split-overlay[inert]').count()).toBeGreaterThan(1)

    // Four-way split: the first view and three more.
    await win.getByRole('button', { name: 'Four-way split' }).click()
    await expect(win.getByRole('button', { name: 'Four-way split' })).toHaveAttribute('aria-pressed', 'true')
    for (const name of ['Second view', 'Third view', 'Fourth view']) await expect(win.getByRole('region', { name, exact: true })).toBeVisible()
    const regions = ['Second view', 'Third view', 'Fourth view'].map((n) => win.getByRole('region', { name: n, exact: true }))
    const boxes = await Promise.all(regions.map(async (r) => (await r.boundingBox())!))
    const main = (await win.locator('.scroller').first().boundingBox())!
    // A 2 by 2 grid: no pane sits on top of another.
    const all = [main, ...boxes]
    for (let i = 0; i < all.length; i++)
      for (let j = i + 1; j < all.length; j++) {
        const a = all[i]
        const b = all[j]
        const overlap = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x) > 4 && Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y) > 4
        expect(overlap).toBe(false)
      }
    // Each pane scrolls and zooms on its own.
    await regions[1].getByLabel('Third view zoom').selectOption('2')
    await expect(regions[1].locator('[data-split-page="0"]')).toHaveAttribute('data-zoom', '2')
    await expect(regions[0].locator('[data-split-page="0"]')).not.toHaveAttribute('data-zoom', '2')
    // Closing one closes the extra views.
    await regions[2].getByRole('button', { name: 'Close fourth view' }).click()
    await expect(win.getByRole('region', { name: 'Third view', exact: true })).toHaveCount(0)
    expect(problems).toEqual([])
  } finally {
    await app.close()
    rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 })
  }
})
