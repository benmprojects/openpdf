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
      await win.getByRole('combobox', { name: 'Pages per sheet' }).selectOption(perSheet)
      await win.locator('.print-dialog').getByRole('button', { name: 'Print…' }).click()
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
