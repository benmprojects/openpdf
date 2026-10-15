import { _electron as electron, expect, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(__dirname, '..')

// Two pages with a 2400 px picture each (one stored raw and deflated, one JPEG), and page text.
const MAKE = `
import sys, pymupdf
doc = pymupdf.open()
pm = pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, 2400, 1600), False)
w, h = pm.width, pm.height
buf = bytearray(w * h * 3)
for y in range(h):
    row = y * w * 3
    for x in range(0, w, 8):
        v = ((x * 7) ^ (y * 3)) & 255
        buf[row + x * 3: row + x * 3 + 24] = bytes([v, (x + y) & 255, (y * 2) & 255]) * 8
pm = pymupdf.Pixmap(pymupdf.csRGB, w, h, bytes(buf), False)
for i, kind in enumerate(["png", "jpeg"]):
    p = doc.new_page(width=595, height=842)
    p.insert_text((60, 60), f"Optimise page {i + 1}", fontsize=18)
    p.insert_image(pymupdf.Rect(40, 100, 555, 443), stream=pm.tobytes(kind) if kind == "jpeg" else pm.tobytes("png"))
doc.save(sys.argv[1], deflate=False)
`

function inspect(path: string): { widths: number[]; text: string; fast: boolean } {
  const py = `
import sys, json, pymupdf
d = pymupdf.open(sys.argv[1])
print(json.dumps({"widths": [i[2] for p in d for i in p.get_images()], "text": "".join(p.get_text() for p in d), "fast": bool(d.is_fast_webaccess)}))
`
  return JSON.parse(execFileSync('python', ['-c', py, path]).toString())
}

test('optimise reduces pictures, compresses and linearises', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'openpdf-e2e-'))
  const pdfPath = join(dir, 'big.pdf')
  execFileSync('python', ['-c', MAKE, pdfPath])
  const before = statSync(pdfPath).size
  expect(inspect(pdfPath).widths).toEqual([2400, 2400])
  const app = await electron.launch({ args: ['.', pdfPath], cwd: root, env: { ...process.env, OPENPDF_E2E: '1', OPENPDF_E2E_USERDATA: join(dir, 'ud'), OPENPDF_E2E_DISCARD: '1' } })
  try {
    const win = await app.firstWindow()
    const problems: string[] = []
    win.on('pageerror', (e) => problems.push(e.message))
    await expect(win.locator('.page')).toHaveCount(2)
    await win.getByRole('tab', { name: 'Organise', exact: true }).click()
    await win.getByRole('button', { name: 'Optimise', exact: true }).click()
    const dialog = win.getByRole('dialog', { name: 'Optimise' })
    await dialog.getByRole('combobox', { name: 'Preset' }).selectOption('screen')
    await dialog.getByRole('checkbox', { name: /Linearise/ }).check()
    await dialog.getByRole('button', { name: 'Optimise', exact: true }).click()
    await expect(win.getByText(/Optimised: .* smaller\); 2 pictures reduced/)).toBeVisible({ timeout: 30000 })
    await win.keyboard.press('Control+s')
    await expect(win.locator('.tab-dirty')).toHaveCount(0)
    const info = inspect(pdfPath)
    // 96 dpi on an A4 page: at most 842 / 72 * 96 = 1123 pixels.
    expect(info.widths.every((w) => w <= 1123)).toBe(true)
    expect(info.text).toContain('Optimise page 2')
    expect(info.fast).toBe(true)
    expect(statSync(pdfPath).size).toBeLessThan(before / 2)
    expect(problems).toEqual([])
  } finally {
    await app.close()
    rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 })
  }
})
