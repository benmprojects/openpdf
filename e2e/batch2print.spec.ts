import { _electron as electron, expect, test, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(__dirname, '..')

interface Inspected {
  pages: number
  text: string
  images: number
  sizes: number[][]
  /** RGB at the centre of the green box of the feature PDF on page 1 (top-left origin, page points). */
  green: number[]
}

/** What a PDF holds: text that can be read back, pictures, page sizes and a pixel. */
function inspect(path: string): Inspected {
  const py = `
import sys, json, pymupdf
d = pymupdf.open(sys.argv[1])
pix = d[0].get_pixmap(dpi=72)
x, y = 420, 282
px = list(pix.pixel(x, y)) if x < pix.width and y < pix.height else [0, 0, 0]
print(json.dumps({
  "pages": d.page_count,
  "text": " ".join(p.get_text() for p in d),
  "images": sum(len(p.get_images()) for p in d),
  "sizes": [[round(p.rect.width), round(p.rect.height)] for p in d],
  "green": px,
}))
`
  return JSON.parse(execFileSync('python', ['-c', py, path]).toString())
}

const exists = (p: string) => (existsSync(p) ? 1 : 0)

async function openPrint(win: Page) {
  await win.keyboard.press('Control+p')
  const dialog = win.getByRole('dialog', { name: 'Print' })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('combobox', { name: 'Printer' }).selectOption({ label: 'Print to PDF file' })
  return dialog
}

test('Save as PDF writes the pages as vector content with the text kept, and falls back to pictures on request', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'openpdf-e2e-'))
  const pdfPath = join(dir, 'pages.pdf')
  const out = join(dir, 'out.pdf')
  execFileSync('python', [join(root, 'scripts', 'make-test-pdf.py'), pdfPath])
  const app = await electron.launch({ args: ['.', pdfPath], cwd: root, env: { ...process.env, OPENPDF_E2E: '1', OPENPDF_E2E_USERDATA: join(dir, 'ud'), OPENPDF_E2E_PRINT: out } })
  try {
    const win = await app.firstWindow()
    const problems: string[] = []
    win.on('pageerror', (e) => problems.push(e.message))
    await expect(win.locator('.page')).toHaveCount(6)
    const dialog = await openPrint(win)
    // No layers in this file: no choice of layers.
    await expect(dialog.getByRole('combobox', { name: 'Layers to print' })).toHaveCount(0)
    const keep = dialog.getByRole('checkbox', { name: 'Keep text searchable (vector)' })
    await expect(keep).toBeChecked()
    await dialog.getByRole('combobox', { name: 'Page range' }).selectOption('custom')
    await dialog.getByRole('textbox', { name: 'Page range, for example 1-3, 5' }).fill('1-2')
    await dialog.getByRole('combobox', { name: 'Pages per sheet' }).selectOption('2')
    await dialog.getByRole('button', { name: 'Save as PDF…' }).click()
    await expect.poll(() => exists(out)).toBe(1)
    await expect(win.getByText(/Print output written to/)).toBeVisible()
    let r = inspect(out)
    expect(r.pages).toBe(1) // two pages on one sheet
    expect(r.images).toBe(0) // not rasterised
    expect(r.text).toContain('Chapter page 1')
    expect(r.text).toContain('Chapter page 2')
    expect(r.sizes[0]).toEqual([842, 595]) // two-up is landscape A4

    // Switched off: the pages are pictures, with no text to find.
    rmSync(out)
    const again = await openPrint(win)
    await again.getByRole('combobox', { name: 'Page range' }).selectOption('custom')
    await again.getByRole('textbox', { name: 'Page range, for example 1-3, 5' }).fill('3')
    await again.getByRole('checkbox', { name: 'Keep text searchable (vector)' }).uncheck()
    await again.getByRole('button', { name: 'Save as PDF…' }).click()
    await expect.poll(() => exists(out)).toBe(1)
    r = inspect(out)
    expect(r.pages).toBe(1)
    expect(r.images).toBeGreaterThan(0)
    expect(r.text.trim()).toBe('')

    // Vector output of a single page keeps its size and text; text stays searchable.
    rmSync(out)
    const third = await openPrint(win)
    await third.getByRole('combobox', { name: 'Page range' }).selectOption('custom')
    await third.getByRole('textbox', { name: 'Page range, for example 1-3, 5' }).fill('2')
    await third.getByRole('button', { name: 'Save as PDF…' }).click()
    await expect.poll(() => exists(out)).toBe(1)
    r = inspect(out)
    expect(r.pages).toBe(1)
    expect(r.text).toContain('Chapter page 2')
    expect(r.sizes[0]).toEqual([595, 842]) // page 2 is landscape, turned to fill portrait paper
    expect(problems).toEqual([])
  } finally {
    await app.close()
    rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 })
  }
})

test('Print layers: visible, all, or as set in the file', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'openpdf-e2e-'))
  const pdfPath = join(dir, 'feature.pdf')
  const out = join(dir, 'layers.pdf')
  execFileSync('npx', ['tsx', join(root, 'scripts', 'make-feature-pdf.mts'), pdfPath], { cwd: root, shell: true })
  const app = await electron.launch({ args: ['.', pdfPath], cwd: root, env: { ...process.env, OPENPDF_E2E: '1', OPENPDF_E2E_USERDATA: join(dir, 'ud'), OPENPDF_E2E_PRINT: out } })
  const isGreen = (p: number[]) => p[1] > 120 && p[0] < 80 && p[2] < 80
  try {
    const win = await app.firstWindow()
    await expect(win.locator('.page').first()).toBeVisible()
    // As the file opens: the hidden layer is off, so its green box is not printed.
    let dialog = await openPrint(win)
    const layers = dialog.getByRole('combobox', { name: 'Layers to print' })
    await expect(layers).toHaveValue('visible')
    await expect(layers.locator('option')).toHaveCount(3)
    await dialog.getByRole('combobox', { name: 'Page range' }).selectOption('current')
    await dialog.getByRole('button', { name: 'Save as PDF…' }).click()
    await expect.poll(() => exists(out)).toBe(1)
    expect(isGreen(inspect(out).green)).toBe(false)

    // All layers: the green box is there, still as vector content.
    rmSync(out)
    dialog = await openPrint(win)
    await dialog.getByRole('combobox', { name: 'Layers to print' }).selectOption('all')
    await dialog.getByRole('combobox', { name: 'Page range' }).selectOption('current')
    await expect(dialog.getByRole('button', { name: 'Save as PDF…' })).toBeEnabled()
    await dialog.getByRole('button', { name: 'Save as PDF…' }).click()
    await expect.poll(() => exists(out)).toBe(1)
    const all = inspect(out)
    expect(isGreen(all.green)).toBe(true)
    expect(all.images).toBe(0)
    expect(all.text).toContain('Front matter 1')

    // As in the file: off again.
    rmSync(out)
    dialog = await openPrint(win)
    await dialog.getByRole('combobox', { name: 'Layers to print' }).selectOption('file')
    await dialog.getByRole('combobox', { name: 'Page range' }).selectOption('current')
    await expect(dialog.getByRole('button', { name: 'Save as PDF…' })).toBeEnabled()
    await dialog.getByRole('button', { name: 'Save as PDF…' }).click()
    await expect.poll(() => exists(out)).toBe(1)
    expect(isGreen(inspect(out).green)).toBe(false)
  } finally {
    await app.close()
    rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 })
  }
})
