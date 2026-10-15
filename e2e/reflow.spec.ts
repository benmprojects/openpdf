import { _electron as electron, expect, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(__dirname, '..')

const PARAGRAPH = 'Excavate to the levels shown on the drawings and compact the subgrade before placing any base material on site.'

const MAKE = `
import sys, pymupdf
doc = pymupdf.open()
p = doc.new_page(width=595, height=842)
p.insert_text((72, 100), "Earthworks", fontsize=18, fontname="hebo")
rc = p.insert_textbox(pymupdf.Rect(72, 130, 272, 260), "${PARAGRAPH}", fontsize=11, fontname="helv", lineheight=1.3)
assert rc >= 0, rc
p.insert_text((72, 700), "Footer stays put", fontsize=9, fontname="helv")
doc.save(sys.argv[1])
`

/** Text lines with their right edge, read with PyMuPDF. */
function lines(path: string): { text: string; x0: number; x1: number; y0: number }[] {
  const py = `
import sys, json, pymupdf
p = pymupdf.open(sys.argv[1])[0]
out = []
for b in p.get_text("dict")["blocks"]:
    for l in b.get("lines", []):
        t = "".join(s["text"] for s in l["spans"])
        out.append({"text": t, "x0": round(l["bbox"][0], 1), "x1": round(l["bbox"][2], 1), "y0": round(l["bbox"][1], 1)})
print(json.dumps(out))
`
  return JSON.parse(execFileSync('python', ['-c', py, path]).toString())
}

test('edit text: a paragraph is rewrapped to its width when edited', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'openpdf-e2e-'))
  const pdfPath = join(dir, 'reflow.pdf')
  execFileSync('python', ['-c', MAKE, pdfPath])
  const before = lines(pdfPath).filter((l) => l.y0 > 120 && l.y0 < 300)
  expect(before.length).toBeGreaterThanOrEqual(3)
  const app = await electron.launch({ args: ['.', pdfPath], cwd: root, env: { ...process.env, OPENPDF_E2E: '1', OPENPDF_E2E_USERDATA: join(dir, 'ud'), OPENPDF_E2E_DISCARD: '1' } })
  try {
    const win = await app.firstWindow()
    const problems: string[] = []
    win.on('pageerror', (e) => problems.push(e.message))
    await expect(win.locator('.page')).toHaveCount(1)
    await win.getByRole('tab', { name: 'Edit', exact: true }).click()
    await win.getByRole('button', { name: 'Edit text' }).click()

    // The three lines are one block; the heading and footer are their own.
    const block = win.getByRole('button', { name: `Edit text: ${PARAGRAPH}` })
    await expect(block).toBeVisible()
    await block.click()
    const box = win.getByRole('textbox', { name: 'Edit text' })
    await expect(box).toHaveValue(PARAGRAPH)
    const longer = `${PARAGRAPH} Then proof roll the formation and record the results for the Superintendent before any further work proceeds.`
    await box.fill(longer)
    await box.press('Enter')
    await expect(win.getByText('Text updated')).toBeVisible()

    await win.keyboard.press('Control+s')
    await expect(win.locator('.tab-dirty')).toHaveCount(0)
    const after = lines(pdfPath)
    const body = after.filter((l) => l.y0 > 120 && l.y0 < 400)
    // More lines than before, none wider than the original paragraph (200 pt box from x 72), same left edge.
    expect(body.length).toBeGreaterThan(before.length)
    for (const l of body) {
      expect(l.x0).toBeCloseTo(72, 0)
      expect(l.x1).toBeLessThanOrEqual(72 + 200 + 2)
    }
    expect(body.map((l) => l.text).join(' ').replace(/\s+/g, ' ')).toBe(longer)
    // Neighbours are untouched.
    expect(after.some((l) => l.text === 'Earthworks')).toBe(true)
    expect(after.some((l) => l.text === 'Footer stays put')).toBe(true)
    expect(problems).toEqual([])
  } finally {
    await app.close()
    rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 })
  }
})
