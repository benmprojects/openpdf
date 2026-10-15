import { _electron as electron, expect, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(__dirname, '..')

const MAKE = `
import sys, pymupdf
doc = pymupdf.open()
p = doc.new_page(width=595, height=842)
p.insert_text((72, 120), "Project name: Eagle Farm", fontsize=16, fontname="helv", color=(0.1, 0.2, 0.6))
p.insert_text((72, 180), "Delete this line", fontsize=12, fontname="tiro")
p.insert_text((72, 240), "Untouched footer text", fontsize=10, fontname="cour")
doc.save(sys.argv[1])
`

/** Every text span: text, size and colour, read with PyMuPDF. */
function spans(path: string): { text: string; size: number; color: number }[] {
  const py = `
import sys, json, pymupdf
d = pymupdf.open(sys.argv[1])
out = []
for b in d[0].get_text("dict")["blocks"]:
    for l in b.get("lines", []):
        for s in l["spans"]:
            out.append({"text": s["text"], "size": round(s["size"], 1), "color": s["color"]})
print(json.dumps(out))
`
  return JSON.parse(execFileSync('python', ['-c', py, path]).toString())
}

test('edit text: change one line, delete another, keep size and colour, leave the rest', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'openpdf-e2e-'))
  const pdfPath = join(dir, 'edit.pdf')
  execFileSync('python', ['-c', MAKE, pdfPath])
  const app = await electron.launch({ args: ['.', pdfPath], cwd: root, env: { ...process.env, OPENPDF_E2E: '1', OPENPDF_E2E_USERDATA: join(dir, 'ud'), OPENPDF_E2E_DISCARD: '1' } })
  try {
    const win = await app.firstWindow()
    const problems: string[] = []
    win.on('pageerror', (e) => problems.push(e.message))
    await expect(win.locator('.page')).toHaveCount(1)
    await win.getByRole('tab', { name: 'Edit', exact: true }).click()
    await win.getByRole('button', { name: 'Edit text' }).click()

    // Change the first line.
    await win.getByRole('button', { name: 'Edit text: Project name: Eagle Farm' }).click()
    const box = win.getByRole('textbox', { name: 'Edit text' })
    await expect(box).toHaveValue('Project name: Eagle Farm')
    await box.fill('Project name: Sunset Park')
    await box.press('Enter')
    await expect(win.getByText('Text updated')).toBeVisible()

    // Delete the second line by emptying it.
    await win.getByRole('button', { name: 'Edit text: Delete this line' }).click()
    await win.getByRole('textbox', { name: 'Edit text' }).fill('')
    await win.getByRole('textbox', { name: 'Edit text' }).press('Enter')
    await expect(win.getByText('Text deleted')).toBeVisible()

    await win.keyboard.press('Control+s')
    await expect(win.locator('.tab-dirty')).toHaveCount(0)
    const out = spans(pdfPath)
    const texts = out.map((s) => s.text)
    expect(texts).toContain('Project name: Sunset Park')
    expect(texts).toContain('Untouched footer text')
    expect(texts.join('|')).not.toContain('Eagle Farm')
    expect(texts.join('|')).not.toContain('Delete this line')
    const edited = out.find((s) => s.text === 'Project name: Sunset Park')!
    expect(edited.size).toBeCloseTo(16, 0)
    // Colour (0.1, 0.2, 0.6) is 0x1A3399.
    expect(edited.color).toBe(0x1a3399)
    expect(out.find((s) => s.text === 'Untouched footer text')!.size).toBeCloseTo(10, 0)
    expect(problems).toEqual([])
  } finally {
    await app.close()
    rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 })
  }
})

const ARIAL = 'C:/Windows/Fonts/arial.ttf'
test('edit text: an installed font of the same family is used for the new text', async () => {
  test.skip(!existsSync(ARIAL), 'Arial is not installed')
  const dir = mkdtempSync(join(tmpdir(), 'openpdf-e2e-'))
  const pdfPath = join(dir, 'arial.pdf')
  const make = `
import sys, pymupdf
doc = pymupdf.open()
p = doc.new_page(width=595, height=842)
p.insert_text((72, 120), "Quantities schedule", fontsize=14, fontname="arl", fontfile=r"${ARIAL}")
doc.save(sys.argv[1])
`
  execFileSync('python', ['-c', make, pdfPath])
  const app = await electron.launch({ args: ['.', pdfPath], cwd: root, env: { ...process.env, OPENPDF_E2E: '1', OPENPDF_E2E_USERDATA: join(dir, 'ud'), OPENPDF_E2E_DISCARD: '1' } })
  try {
    const win = await app.firstWindow()
    await expect(win.locator('.page')).toHaveCount(1)
    await win.getByRole('tab', { name: 'Edit', exact: true }).click()
    await win.getByRole('button', { name: 'Edit text' }).click()
    await win.getByRole('button', { name: 'Edit text: Quantities schedule' }).click()
    const box = win.getByRole('textbox', { name: 'Edit text' })
    await box.fill('Quantities schedule (revised)')
    await box.press('Enter')
    await expect(win.getByText('Text updated')).toBeVisible()
    await win.keyboard.press('Control+s')
    await expect(win.locator('.tab-dirty')).toHaveCount(0)
    const py = `
import sys, json, pymupdf
d = pymupdf.open(sys.argv[1])
print(json.dumps([[s["text"], s["font"]] for b in d[0].get_text("dict")["blocks"] for l in b.get("lines", []) for s in l["spans"]]))
`
    const spans: [string, string][] = JSON.parse(execFileSync('python', ['-c', py, pdfPath]).toString())
    const edited = spans.find(([t]) => t.includes('revised'))!
    expect(edited[1].toLowerCase()).toContain('arial')
  } finally {
    await app.close()
    rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 })
  }
})
