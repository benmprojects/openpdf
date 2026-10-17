import { _electron as electron, expect, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(__dirname, '..')

/** base.pdf: two pages with the word BASE. over.pdf: one page with the word REVISED in black. */
function setup(): { dir: string; base: string; over: string } {
  const dir = mkdtempSync(join(tmpdir(), 'openpdf-e2e-'))
  const base = join(dir, 'base.pdf')
  const over = join(dir, 'over.pdf')
  execFileSync('python', [
    '-c',
    `import sys, pymupdf
d = pymupdf.open()
for i in range(2):
    d.new_page(width=300, height=300).insert_text((40, 80), "BASE " + str(i + 1), fontsize=20)
d.save(sys.argv[1])
o = pymupdf.open()
p = o.new_page(width=300, height=300)
p.insert_text((40, 200), "REVISED", fontsize=30)
p.draw_rect(pymupdf.Rect(30, 220, 270, 240), color=(0, 0, 0), fill=(0, 0, 0))
o.save(sys.argv[2])`,
    base,
    over
  ])
  return { dir, base, over }
}

/** Per page: the words, and how many pixels are clearly red and clearly black (a 100 dpi render). */
function inspect(path: string): { text: string; red: number; black: number }[] {
  const py = `
import sys, json, pymupdf
d = pymupdf.open(sys.argv[1])
out = []
for p in d:
    pix = p.get_pixmap(dpi=100)
    red = black = 0
    for y in range(0, pix.height):
        for x in range(0, pix.width):
            r, g, b = pix.pixel(x, y)[:3]
            if r > 150 and g < 90 and b < 90: red += 1
            elif r < 60 and g < 60 and b < 60: black += 1
    out.append({"text": p.get_text(), "red": red, "black": black})
print(json.dumps(out))
`
  return JSON.parse(execFileSync('python', ['-c', py, path]).toString())
}

test('Overlay: a tinted overlay on one page shows its lines in the colour and leaves the other page alone', async () => {
  const { dir, base, over } = setup()
  const app = await electron.launch({ args: ['.', base], cwd: root, env: { ...process.env, OPENPDF_E2E: '1', OPENPDF_E2E_USERDATA: join(dir, 'ud'), OPENPDF_E2E_PICK: over } })
  try {
    const win = await app.firstWindow()
    const problems: string[] = []
    win.on('pageerror', (e) => problems.push(e.message))
    await expect(win.locator('.page')).toHaveCount(2)
    await win.getByRole('tab', { name: 'Organise', exact: true }).click()
    await win.getByRole('button', { name: 'Overlay…' }).click()
    const d = win.getByRole('dialog', { name: 'Overlay pages' })

    // Nothing chosen yet.
    await d.getByRole('button', { name: 'Apply', exact: true }).click()
    await expect(d.getByRole('alert')).toContainText('Choose the PDF to overlay')
    await d.getByRole('button', { name: 'Choose…' }).click()
    await expect(d.getByTestId('overlay-source')).toContainText('over.pdf')

    await d.getByLabel('Over pages').selectOption('current')
    await d.getByLabel('Size').selectOption('actual')
    await d.getByLabel('Draw the overlay in one colour').check()
    await d.locator('input[type=color]').fill('#ff0000')
    await d.getByRole('button', { name: 'Apply', exact: true }).click()
    await expect(win.getByText(/Overlaid 1 pages from over\.pdf/)).toBeVisible()

    // PDFium shows the red linework too (the view re-renders the page).
    await expect
      .poll(() =>
        win.locator('.page canvas').first().evaluate((c: HTMLCanvasElement) => {
          const data = c.getContext('2d')?.getImageData(0, 0, c.width, c.height).data
          if (!data) return 0
          let red = 0
          for (let i = 0; i < data.length; i += 4) if (data[i] > 150 && data[i + 1] < 90 && data[i + 2] < 90) red++
          return red
        })
      )
      .toBeGreaterThan(200)

    await win.keyboard.press('Control+s')
    await expect(win.locator('.tab-dirty')).toHaveCount(0)
    expect(problems).toEqual([])
  } finally {
    await app.close()
  }
  const pages = inspect(base)
  expect(pages).toHaveLength(2)
  expect(pages[0].text).toContain('REVISED')
  expect(pages[0].text).toContain('BASE 1')
  expect(pages[0].red).toBeGreaterThan(200) // the bar and the word, in red
  expect(pages[0].black).toBeLessThan(pages[1].black * 1.5) // the overlay's own black became red; only BASE stays black
  expect(pages[1].text).not.toContain('REVISED')
  expect(pages[1].red).toBe(0)
  rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 })
})

test('Overlay: under every page with the first source page, and Remove marks takes it off again', async () => {
  const { dir, base, over } = setup()
  const app = await electron.launch({ args: ['.', base], cwd: root, env: { ...process.env, OPENPDF_E2E: '1', OPENPDF_E2E_USERDATA: join(dir, 'ud'), OPENPDF_E2E_PICK: over } })
  try {
    const win = await app.firstWindow()
    await expect(win.locator('.page')).toHaveCount(2)
    await win.getByRole('tab', { name: 'Organise', exact: true }).click()
    await win.getByRole('button', { name: 'Overlay…' }).click()
    const d = win.getByRole('dialog', { name: 'Overlay pages' })
    await d.getByRole('button', { name: 'Choose…' }).click()
    await d.getByLabel('Pairing').selectOption('first')
    await d.getByLabel('Place').selectOption('under')
    await d.getByRole('button', { name: 'Apply', exact: true }).click()
    await expect(win.getByText(/Overlaid 2 pages from over\.pdf/)).toBeVisible()

    await win.getByRole('tab', { name: 'Layout', exact: true }).click()
    await win.getByRole('button', { name: 'Remove marks' }).click()
    const r = win.getByRole('dialog', { name: 'Remove marks' })
    await expect(r.getByLabel(/Overlaid pages/)).toBeChecked()
    await r.getByRole('button', { name: 'Remove', exact: true }).click()
    await expect(win.getByText(/Removed 2 marks/)).toBeVisible()
    await win.keyboard.press('Control+s')
    await expect(win.locator('.tab-dirty')).toHaveCount(0)
  } finally {
    await app.close()
  }
  const pages = inspect(base)
  expect(pages.every((p) => !p.text.includes('REVISED'))).toBe(true)
  rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 })
})
