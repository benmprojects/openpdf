import { _electron as electron, expect, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(__dirname, '..')

/** big.pdf: a 1200 x 1600 pt sheet with a word in each corner, then a small page. */
function makeBig(dir: string): string {
  const path = join(dir, 'big.pdf')
  execFileSync('python', [
    '-c',
    `import sys, pymupdf
d = pymupdf.open()
p = d.new_page(width=1200, height=1600)
p.insert_text((60, 100), "TOPLEFT", fontsize=40)
p.insert_text((900, 100), "TOPRIGHT", fontsize=40)
p.insert_text((60, 1540), "BOTTOMLEFT", fontsize=40)
p.insert_text((880, 1540), "BOTTOMRIGHT", fontsize=40)
d.new_page(width=300, height=300).insert_text((50, 100), "SMALL", fontsize=20)
d.save(sys.argv[1])`,
    path
  ])
  return path
}

test('Split pages: a grid cuts each sheet into pages that show their own corner', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'openpdf-e2e-'))
  const pdf = makeBig(dir)
  const app = await electron.launch({ args: ['.', pdf], cwd: root, env: { ...process.env, OPENPDF_E2E: '1', OPENPDF_E2E_USERDATA: join(dir, 'ud') } })
  try {
    const win = await app.firstWindow()
    const problems: string[] = []
    win.on('pageerror', (e) => problems.push(e.message))
    await expect(win.locator('.page')).toHaveCount(2)
    await win.getByRole('tab', { name: 'Organise', exact: true }).click()
    await win.getByRole('button', { name: 'Split pages…' }).click()
    const d = win.getByRole('dialog', { name: 'Split pages' })

    // By paper size: this sheet is about 424 x 565 mm, so A3 pieces, turned to suit.
    await d.getByLabel('Pages', { exact: true }).selectOption('custom')
    await d.getByRole('textbox', { name: 'Page range' }).fill('1')
    await d.getByLabel('Paper', { exact: true }).selectOption('A3')
    await d.getByLabel('Overlap').fill('0')
    await expect(d.getByTestId('split-preview')).toContainText('Page 1 becomes 4 pages (2 rows by 2 columns)')

    // As a grid of 2 rows by 2 columns.
    await d.getByLabel('Cut').selectOption('grid')
    await d.getByRole('spinbutton', { name: 'Rows' }).fill('2')
    await d.getByRole('spinbutton', { name: 'Columns' }).fill('2')
    await expect(d.getByTestId('split-preview')).toContainText('becomes 4 pages')
    await d.getByRole('button', { name: 'Split', exact: true }).click()
    await expect(win.locator('.page')).toHaveCount(5)
    await win.keyboard.press('Control+s')
    await expect(win.locator('.tab-dirty')).toHaveCount(0)
    expect(problems).toEqual([])
  } finally {
    await app.close()
  }
  const info = JSON.parse(
    execFileSync('python', ['-c', 'import sys, json, pymupdf\nd = pymupdf.open(sys.argv[1])\nprint(json.dumps([{"w": round(p.rect.width), "h": round(p.rect.height), "text": p.get_text().strip()} for p in d]))', pdf]).toString()
  )
  expect(info).toHaveLength(5)
  expect(info.slice(0, 4).map((p: { w: number; h: number }) => [p.w, p.h])).toEqual([[600, 800], [600, 800], [600, 800], [600, 800]])
  expect(info[0].text).toBe('TOPLEFT')
  expect(info[1].text).toBe('TOPRIGHT')
  expect(info[2].text).toBe('BOTTOMLEFT')
  expect(info[3].text).toBe('BOTTOMRIGHT')
  expect(info[4].text).toBe('SMALL')
  rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 })
})

/** Dark pixels on each page of the printed PDF (a 30 dpi render). */
function darkness(path: string): { pages: number; w: number; h: number; dark: number[] } {
  const py = `
import sys, json, pymupdf
d = pymupdf.open(sys.argv[1])
dark = []
for p in d:
    pix = p.get_pixmap(dpi=30)
    n = 0
    for y in range(pix.height):
        for x in range(pix.width):
            if pix.pixel(x, y)[0] < 128: n += 1
    dark.append(n)
print(json.dumps({"pages": d.page_count, "w": round(d[0].rect.width), "h": round(d[0].rect.height), "dark": dark}))
`
  return JSON.parse(execFileSync('python', ['-c', py, path]).toString())
}

test('Print: Tile large pages shows the tiles in the preview and prints one sheet each', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'openpdf-e2e-'))
  const pdf = join(dir, 'one.pdf')
  const out = join(dir, 'tiles.pdf')
  execFileSync('python', [
    '-c',
    `import sys, pymupdf
d = pymupdf.open()
d.new_page(width=595, height=842).insert_text((50, 100), "TOPLEFT", fontsize=40)
d.save(sys.argv[1])`,
    pdf
  ])
  const app = await electron.launch({ args: ['.', pdf], cwd: root, env: { ...process.env, OPENPDF_E2E: '1', OPENPDF_E2E_USERDATA: join(dir, 'ud'), OPENPDF_E2E_PRINT: out } })
  try {
    const win = await app.firstWindow()
    const problems: string[] = []
    win.on('pageerror', (e) => problems.push(e.message))
    await expect(win.locator('.page')).toHaveCount(1)
    await win.keyboard.press('Control+p')
    const dialog = win.getByRole('dialog', { name: 'Print' })
    const status = dialog.locator('.print-sheet-label')
    await expect(status).toContainText('Sheet 1 of 1')

    await dialog.getByRole('combobox', { name: 'Page scaling' }).selectOption('tile')
    await dialog.getByRole('spinbutton', { name: 'Tile scale (percent)' }).fill('200')
    await dialog.getByRole('spinbutton', { name: 'Tile overlap (mm)' }).fill('0')
    // Left on Auto, the paper is turned to whichever way needs fewer sheets (landscape: 8).
    await expect(status).toContainText('Sheet 1 of 8')
    await dialog.getByRole('combobox', { name: 'Orientation' }).selectOption('portrait')
    // A4 portrait at 200% needs 3 sheets across and 3 down.
    await expect(status).toContainText('Sheet 1 of 9')
    await expect(status).toContainText('row 1 column 1 (of 3 x 3)')
    await expect(dialog.getByTestId('tile-mark')).toHaveCount(4)
    await expect(dialog.getByTestId('tile-label')).toContainText('Page 1, row 1 column 1')
    await expect(dialog.getByRole('combobox', { name: 'Pages per sheet' })).toBeDisabled()
    await dialog.getByRole('button', { name: 'Next sheet' }).click()
    await expect(status).toContainText('Sheet 2 of 9')
    await expect(status).toContainText('row 1 column 2')
    // The first tile shows the page's top left, where the word is.
    await dialog.getByRole('button', { name: 'Previous sheet' }).click()
    await expect
      .poll(() =>
        dialog.getByTestId('tile-canvas').evaluate((c: HTMLCanvasElement) => {
          const data = c.getContext('2d')?.getImageData(0, 0, c.width, c.height).data
          if (!data) return 0
          let dark = 0
          for (let i = 0; i < data.length; i += 4) if (data[i] < 100) dark++
          return dark
        })
      )
      .toBeGreaterThan(50)

    // Print without marks or labels so a blank sheet is blank.
    await dialog.getByLabel('Cut marks').uncheck()
    await dialog.getByLabel('Labels').uncheck()
    await expect(dialog.getByTestId('tile-mark')).toHaveCount(0)
    await dialog.getByRole('button', { name: 'Print', exact: true }).click()
    await expect.poll(() => existsSync(out) && statSync(out).size > 1000, { timeout: 90_000 }).toBe(true)
    expect(problems).toEqual([])
  } finally {
    await app.close()
  }
  const r = darkness(out)
  expect(r.pages).toBe(9)
  expect(r.h).toBeGreaterThan(r.w)
  expect(r.dark[0]).toBeGreaterThan(0) // the word
  expect(r.dark[8]).toBe(0) // the bottom right corner of the sheet is blank
  rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 })
})
