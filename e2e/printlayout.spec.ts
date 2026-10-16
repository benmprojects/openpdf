import { _electron as electron, expect, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(__dirname, '..')

/** Page count and first page size (points) of a PDF, read with PyMuPDF. */
function inspect(path: string): { pages: number; w: number; h: number; nonBlankCells: number[] } {
  const py = `
import sys, json, pymupdf
d = pymupdf.open(sys.argv[1])
p = d[0]
pix = p.get_pixmap(dpi=40)
# Darkness per quarter of the first sheet (left/right halves), to see which cells hold a page.
w, h = pix.width, pix.height
def dark(x0, x1):
    n = 0
    for y in range(0, h, 2):
        for x in range(x0, x1, 2):
            if pix.pixel(x, y)[0] < 200: n += 1
    return n
print(json.dumps({"pages": d.page_count, "w": round(p.rect.width), "h": round(p.rect.height), "nonBlankCells": [dark(0, w // 2), dark(w // 2, w)]}))
`
  return JSON.parse(execFileSync('python', ['-c', py, path]).toString())
}

test('Print dialog: printers, range, subset, preview and output', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'openpdf-e2e-'))
  const pdfPath = join(dir, 'dialog.pdf')
  const out = join(dir, 'odd.pdf')
  execFileSync('python', [join(root, 'scripts', 'make-test-pdf.py'), pdfPath])
  const app = await electron.launch({
    args: ['.', pdfPath],
    cwd: root,
    env: { ...process.env, OPENPDF_E2E: '1', OPENPDF_E2E_USERDATA: join(dir, 'ud'), OPENPDF_E2E_PRINT: out }
  })
  try {
    const win = await app.firstWindow()
    await expect(win.locator('.page')).toHaveCount(6)
    await win.keyboard.press('Control+p')
    const dialog = win.getByRole('dialog', { name: 'Print' })
    const print = dialog.getByRole('button', { name: 'Print', exact: true })

    // The printer list always offers printing to a file; the installed printers (if any) come from the main process.
    const printer = dialog.getByRole('combobox', { name: 'Printer' })
    await expect(printer.locator('option', { hasText: 'Print to PDF file' })).toHaveCount(1)
    const installed = await win.evaluate(() => (window as unknown as { openpdf: { printPrinters(): Promise<unknown[]> } }).openpdf.printPrinters())
    // One option per printer plus the file; with no printers, the system's own dialog is offered as well.
    await expect(printer).toBeEnabled()
    await expect(printer.locator('option')).toHaveCount(installed.length ? installed.length + 1 : 2)

    // Preview of the first sheet with its caption and totals.
    const status = dialog.locator('.print-sheet-label')
    await expect(status).toHaveText('Sheet 1 of 6 · A4 · 210 x 297 mm')
    await expect(dialog.locator('.print-sheet canvas')).toHaveCount(1)
    await expect
      .poll(() =>
        dialog.locator('.print-sheet canvas').evaluate((c: HTMLCanvasElement) => {
          const d = c.getContext('2d')?.getImageData(0, 0, c.width, c.height).data
          if (!d) return 0
          let dark = 0
          for (let i = 0; i < d.length; i += 4) if (d[i] < 128) dark++
          return dark
        })
      )
      .toBeGreaterThan(0)

    // Custom pages 2-5, odd page numbers only: pages 3 and 5.
    await dialog.getByRole('combobox', { name: 'Page range' }).selectOption('custom')
    await dialog.getByRole('textbox', { name: 'Page range, for example 1-3, 5' }).fill('2-5')
    await dialog.getByRole('combobox', { name: 'Subset' }).selectOption('odd')
    await expect(status).toHaveText('Sheet 1 of 2 · A4 · 210 x 297 mm')
    await dialog.getByRole('button', { name: 'Next sheet' }).click()
    await expect(status).toHaveText('Sheet 2 of 2 · A4 · 210 x 297 mm')

    // An invalid range explains itself and cannot be printed.
    await dialog.getByRole('textbox', { name: 'Page range, for example 1-3, 5' }).fill('9-12')
    await expect(print).toBeDisabled()
    await expect(dialog.getByRole('alert')).toContainText('outside pages')
    await dialog.getByRole('textbox', { name: 'Page range, for example 1-3, 5' }).fill('2-5')
    await expect(print).toBeEnabled()

    // Enter prints.
    await dialog.getByRole('textbox', { name: 'Page range, for example 1-3, 5' }).press('Enter')
    await expect.poll(() => existsSync(out) && statSync(out).size > 1000, { timeout: 60_000 }).toBe(true)
  } finally {
    await app.close()
  }
  expect(inspect(out).pages).toBe(2)
  rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 })
})

test('N-up and booklet print layouts', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'openpdf-e2e-'))
  const pdfPath = join(dir, 'layout.pdf')
  execFileSync('python', [join(root, 'scripts', 'make-test-pdf.py'), pdfPath])
  const runs: [string, string][] = [
    ['4', join(dir, 'four.pdf')],
    ['2', join(dir, 'two.pdf')],
    ['booklet', join(dir, 'booklet.pdf')]
  ]
  for (const [perSheet, out] of runs) {
    const app = await electron.launch({
      args: ['.', pdfPath],
      cwd: root,
      env: { ...process.env, OPENPDF_E2E: '1', OPENPDF_E2E_USERDATA: join(dir, 'ud'), OPENPDF_E2E_PRINT: out }
    })
    try {
      const win = await app.firstWindow()
      await expect(win.locator('.page')).toHaveCount(6)
      await win.keyboard.press('Control+p')
      const dialog = win.getByRole('dialog', { name: 'Print' })
      await dialog.getByRole('combobox', { name: 'Pages per sheet' }).selectOption(perSheet)
      await dialog.getByRole('button', { name: 'Print', exact: true }).click()
      await expect.poll(() => existsSync(out) && statSync(out).size > 1000, { timeout: 60_000 }).toBe(true)
    } finally {
      await app.close()
    }
  }
  const four = inspect(runs[0][1])
  expect(four.pages).toBe(2) // 6 pages, 4 per sheet
  expect(four.h).toBeGreaterThan(four.w) // portrait A4
  const two = inspect(runs[1][1])
  expect(two.pages).toBe(3)
  expect(two.w).toBeGreaterThan(two.h) // landscape
  const booklet = inspect(runs[2][1])
  expect(booklet.pages).toBe(4) // 6 pages padded to 8: 2 sheets, 4 sides
  expect(booklet.w).toBeGreaterThan(booklet.h)
  // First side holds page 8 (blank, left) and page 1 (right).
  expect(booklet.nonBlankCells[0]).toBe(0)
  expect(booklet.nonBlankCells[1]).toBeGreaterThan(0)
  rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 })
})
