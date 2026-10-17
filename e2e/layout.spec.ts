import { _electron as electron, expect, test, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(__dirname, '..')

/** Text, crop box and media box of every page, read with PyMuPDF. */
function inspect(path: string): { text: string; crop: number[]; media: number[] }[] {
  const py = `
import sys, json, pymupdf
d = pymupdf.open(sys.argv[1])
print(json.dumps([{"text": p.get_text(), "crop": [round(v) for v in p.cropbox], "media": [round(v) for v in p.mediabox]} for p in d]))
`
  return JSON.parse(execFileSync('python', ['-c', py, path]).toString())
}

async function save(win: Page) {
  await win.keyboard.press('Control+s')
  await expect(win.locator('.tab-dirty')).toHaveCount(0)
}

test('Layout: page numbers, header and footer, Bates, watermark, crop, resize and remove', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'openpdf-e2e-'))
  const pdfPath = join(dir, 'layout.pdf')
  execFileSync('python', [join(root, 'scripts', 'make-test-pdf.py'), pdfPath])
  const app = await electron.launch({ args: ['.', pdfPath], cwd: root, env: { ...process.env, OPENPDF_E2E: '1', OPENPDF_E2E_USERDATA: join(dir, 'ud'), OPENPDF_E2E_DISCARD: '1' } })
  try {
    const win = await app.firstWindow()
    const problems: string[] = []
    win.on('pageerror', (e) => problems.push(e.message))
    await expect(win.locator('.page')).toHaveCount(6)
    await win.getByRole('tab', { name: 'Layout', exact: true }).click()
    const dialog = win.getByRole('dialog')

    // Page numbers "Page 1 of 6".
    await win.getByRole('button', { name: 'Page numbers' }).click()
    await dialog.getByRole('button', { name: 'Apply', exact: true }).click()
    await expect(win.getByText(/Added page numbers to 6 pages/)).toBeVisible()

    // A Bates number on pages 2-3 only.
    await win.getByRole('button', { name: 'Bates numbers' }).click()
    await dialog.getByRole('textbox', { name: 'Prefix' }).fill('EPC')
    await dialog.getByRole('combobox', { name: 'Pages' }).selectOption('custom')
    await dialog.getByRole('textbox', { name: 'Page range' }).fill('2-3')
    await dialog.getByRole('button', { name: 'Apply', exact: true }).click()

    // A DRAFT watermark on every page.
    await win.getByRole('button', { name: 'Watermark', exact: true }).click()
    await dialog.getByRole('button', { name: 'Apply', exact: true }).click()
    await expect(win.getByText(/Added a watermark/)).toBeVisible()
    await win.screenshot({ path: test.info().outputPath('layout.png') })
    await save(win)
    let pages = inspect(pdfPath)
    expect(pages[5].text).toContain('Page 6 of 6')
    expect(pages[1].text).toContain('EPC000001')
    expect(pages[2].text).toContain('EPC000002')
    expect(pages[0].text).not.toContain('EPC')
    expect(pages.every((p) => p.text.includes('DRAFT'))).toBe(true)

    // Crop page 1 by 20 mm all round; resize page 2 to A3.
    await win.getByRole('button', { name: 'Crop…' }).click()
    await dialog.getByRole('combobox', { name: 'Pages' }).selectOption('current')
    for (const side of ['Top', 'Bottom', 'Left', 'Right']) await dialog.getByRole('spinbutton', { name: side }).fill('20')
    await dialog.getByRole('button', { name: 'Apply', exact: true }).click()
    await win.getByRole('button', { name: 'Resize…' }).click()
    await dialog.getByRole('combobox', { name: 'Paper' }).selectOption('A3')
    await dialog.getByRole('combobox', { name: 'Pages' }).selectOption('custom')
    await dialog.getByRole('textbox', { name: 'Page range' }).fill('2')
    await dialog.getByRole('button', { name: 'Apply', exact: true }).click()
    await expect(win.getByText(/Resized 1 page/)).toBeVisible()

    // Remove the watermarks again, keeping the numbers.
    await win.getByRole('button', { name: 'Remove marks' }).click()
    await dialog.getByRole('checkbox', { name: /Headers, footers/ }).uncheck()
    await dialog.getByRole('button', { name: 'Remove', exact: true }).click()
    await expect(win.getByText(/Removed 6 marks/)).toBeVisible()
    await save(win)
    pages = inspect(pdfPath)
    expect(pages.some((p) => p.text.includes('DRAFT'))).toBe(false)
    expect(pages[5].text).toContain('Page 6 of 6')
    const mm20 = Math.round((20 * 72) / 25.4)
    expect(pages[0].crop[2] - pages[0].crop[0]).toBeCloseTo(pages[0].media[2] - pages[0].media[0] - 2 * mm20, -1)
    // Page 2 of the test PDF is landscape, so it becomes A3 landscape (1191 x 842 points).
    expect(pages[1].media.slice(2)).toEqual([1191, 842])
    expect(problems).toEqual([])
  } finally {
    await app.close()
    rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 })
  }
})
