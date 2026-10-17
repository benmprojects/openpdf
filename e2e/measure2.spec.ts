import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(__dirname, '..')

/** A one-page PDF with a 200 x 100 pt rectangle drawn at (100, 100) from the top left: real vector content to snap to. */
function makeVectorPdf(dir: string): string {
  const script = join(dir, 'make.py')
  writeFileSync(
    script,
    [
      'import sys, pymupdf',
      'd = pymupdf.open()',
      'p = d.new_page(width=595, height=842)',
      'p.draw_rect(pymupdf.Rect(100, 100, 300, 200), color=(0, 0, 0), width=1)',
      'd.save(sys.argv[1])'
    ].join('\n')
  )
  const out = join(dir, 'vector.pdf')
  execFileSync('python', [script, out])
  return out
}

async function open(pdf: string, dir: string): Promise<{ app: ElectronApplication; win: Page; problems: string[] }> {
  const app = await electron.launch({ args: ['.', pdf], cwd: root, env: { ...process.env, OPENPDF_E2E: '1', OPENPDF_E2E_USERDATA: join(dir, 'ud'), OPENPDF_E2E_DISCARD: '1' } })
  const win = await app.firstWindow()
  const problems: string[] = []
  win.on('pageerror', (e) => problems.push(e.message))
  await expect(win.locator('.page')).toHaveCount(1)
  await win.getByRole('tab', { name: 'Measure', exact: true }).click()
  return { app, win, problems }
}


test('a named scale, units and precision apply to measurements and are written as a viewport scale', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'openpdf-e2e-'))
  const pdf = makeVectorPdf(dir)
  const { app, win, problems } = await open(pdf, dir)
  try {
    await win.getByRole('button', { name: 'Scale…', exact: true }).click()
    await win.getByRole('combobox', { name: 'Drawing scale' }).selectOption('100')
    await win.getByRole('combobox', { name: 'Units' }).selectOption('m')
    await win.getByRole('combobox', { name: 'Precision' }).selectOption('decimals')
    await win.getByRole('spinbutton', { name: 'Decimal places' }).fill('3')
    await expect(win.getByLabel('Preview')).toContainText('on paper is')
    await win.getByRole('radio', { name: /Whole document/ }).check()
    await win.getByRole('button', { name: 'Set scale', exact: true }).click()
    await expect(win.getByText('Scale: 1:100 (m)')).toBeVisible()

    // 72 points on paper is 25.4 mm: at 1:100 that is 2.540 m with three decimals.
    const z = (await win.locator(".page").first().boundingBox())!.width / 595
    const p0 = (await win.locator('.page').first().boundingBox())!
    await win.getByRole('button', { name: 'Distance', exact: true }).click()
    await win.mouse.click(p0.x + 50, p0.y + 300)
    await win.mouse.click(p0.x + 50 + 72 * z, p0.y + 300)
    const label = win.locator('.measure-annot-label')
    await expect(label).toHaveCount(1)
    // Three decimals shown; the drag length is only accurate to a pixel or so, so compare the number loosely
    // (the scale maths itself is exact in measureScale.test.ts).
    const shown = (await label.textContent())!
    expect(shown).toMatch(/^\d\.\d{3} m$/)
    expect(Math.abs(parseFloat(shown) - 2.54)).toBeLessThan(0.05)

    // Saved: the page carries a /VP viewport with a rectilinear /Measure.
    await win.keyboard.press('Control+s')
    await expect(win.locator('.tab-dirty')).toHaveCount(0)
    const py = ['import sys, pymupdf', 'd = pymupdf.open(sys.argv[1])', 'k = d.xref_get_key(d[0].xref, "VP")', 'print(k[0], k[1])'].join('\n')
    const script = join(dir, 'vp.py')
    writeFileSync(script, py)
    const out = execFileSync('python', [script, pdf]).toString()
    expect(out).toMatch(/^array/)
    expect(out).toMatch(/Measure/)
    expect(out).toMatch(/RL/)
    expect(problems).toEqual([])
  } finally {
    await app.close()
    rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 })
  }
})

test('a saved scale can be chosen again, and a custom "mm on paper = m" scale works', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'openpdf-e2e-'))
  const { app, win, problems } = await open(makeVectorPdf(dir), dir)
  try {
    await win.getByRole('button', { name: 'Scale…', exact: true }).click()
    await win.getByRole('radio', { name: /Custom/ }).check()
    await win.getByRole('textbox', { name: 'Paper length (mm)' }).fill('10')
    await win.getByRole('textbox', { name: 'Real length' }).fill('2')
    await win.getByRole('combobox', { name: 'Real unit' }).selectOption('m')
    await win.getByRole('textbox', { name: 'Name for this scale' }).fill('Site plan')
    await win.getByRole('button', { name: 'Save scale', exact: true }).click()
    await win.getByRole('button', { name: 'Set scale', exact: true }).click()
    await expect(win.getByText('Scale: 10 mm = 2 m (m)')).toBeVisible()

    // The preset is offered next time the dialog opens.
    await win.getByRole('button', { name: 'Scale…', exact: true }).click()
    await expect(win.getByRole('combobox', { name: 'Saved scale' }).locator('option', { hasText: 'Site plan' })).toHaveCount(1)
    expect(problems).toEqual([])
  } finally {
    await app.close()
    rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 })
  }
})

test('count markers are numbered per label and listed with totals; rows can be labelled and deleted', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'openpdf-e2e-'))
  const { app, win, problems } = await open(makeVectorPdf(dir), dir)
  try {
    const p0 = (await win.locator('.page').first().boundingBox())!
    await win.getByRole('textbox', { name: 'Count label' }).fill('Door')
    await win.getByRole('button', { name: 'Count', exact: true }).click()
    for (const dx of [0, 40, 80]) await win.mouse.click(p0.x + 300 + dx, p0.y + 420)
    await win.getByRole('textbox', { name: 'Count label' }).fill('Pit')
    await win.mouse.click(p0.x + 300, p0.y + 480)

    await win.getByRole('button', { name: 'Measurements', exact: true }).click()
    const pane = win.locator('.measure-pane')
    await expect(pane.locator('tr.mp-row')).toHaveCount(4)
    await expect(pane.getByText('Door: 3')).toBeVisible()
    await expect(pane.getByText('Pit: 1')).toBeVisible()
    await expect(pane.locator('tr.mp-row').nth(2)).toContainText('Door #3')

    // Rename one marker's group; the totals follow.
    await pane.getByRole('textbox', { name: /Label Door #3/ }).fill('Gate')
    await pane.getByRole('textbox', { name: /Label Door #3/ }).press('Enter')
    await expect(pane.getByText('Door: 2')).toBeVisible()
    await expect(pane.getByText('Gate: 1')).toBeVisible()

    // Delete one.
    await pane.getByRole('button', { name: /Delete Door #1/ }).click()
    await expect(pane.locator('tr.mp-row')).toHaveCount(3)

    // Markers are saved as circles that read back as count markers.
    await win.keyboard.press('Control+s')
    await expect(win.locator('.tab-dirty')).toHaveCount(0)
    expect(problems).toEqual([])
  } finally {
    await app.close()
    rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 })
  }
})

test('measuring snaps to the corners of the drawing, with a marker, switches, and Ctrl to turn it off', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'openpdf-e2e-'))
  const { app, win, problems } = await open(makeVectorPdf(dir), dir)
  try {
    const z = (await win.locator(".page").first().boundingBox())!.width / 595
    const p0 = (await win.locator('.page').first().boundingBox())!
    const at = (x: number, y: number) => ({ x: p0.x + x * z, y: p0.y + y * z })
    await win.getByRole('button', { name: 'Distance', exact: true }).click()

    // The first move over a page loads its geometry; the marker shows once it is in.
    const nearCorner = at(100, 100)
    await win.mouse.move(nearCorner.x + 20, nearCorner.y + 20)
    await win.mouse.move(nearCorner.x + 2, nearCorner.y + 2)
    await expect(win.locator('[data-snap="end"]')).toBeVisible({ timeout: 10_000 })

    // Holding Ctrl turns snapping off while it is held.
    await win.keyboard.down('Control')
    await win.mouse.move(nearCorner.x + 3, nearCorner.y + 2)
    await expect(win.locator('[data-snap]')).toHaveCount(0)
    await win.keyboard.up('Control')

    // Switching end points off removes the end point marker at the corner.
    await win.getByRole('button', { name: 'Endpoint', exact: true }).click()
    await win.mouse.move(nearCorner.x + 2, nearCorner.y + 3)
    await expect(win.locator('[data-snap="end"]')).toHaveCount(0)
    await win.getByRole('button', { name: 'Endpoint', exact: true }).click()
    await win.mouse.move(nearCorner.x + 2, nearCorner.y + 2)
    await expect(win.locator('[data-snap="end"]')).toBeVisible()

    // Clicking a couple of pixels off each end of the top edge measures exactly 200 pt: 70.56 mm at paper scale.
    await win.mouse.click(nearCorner.x + 2, nearCorner.y + 2)
    const farCorner = at(300, 100)
    await win.mouse.move(farCorner.x - 20, farCorner.y + 20)
    await win.mouse.move(farCorner.x - 2, farCorner.y + 2)
    await expect(win.locator('[data-snap="end"]')).toBeVisible()
    await win.mouse.click(farCorner.x - 2, farCorner.y + 2)
    const label = win.locator('.measure-annot-label')
    await expect(label).toHaveCount(1)
    await expect(label).toHaveText('70.56 mm')
    expect(problems).toEqual([])
  } finally {
    await app.close()
    rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 })
  }
})
