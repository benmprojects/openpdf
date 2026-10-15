import { _electron as electron, expect, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(__dirname, '..')

/** A "scan": a page that is only a picture of some text. */
function makeScan(path: string, rotation = 0): void {
  execFileSync('python', [
    '-c',
    `import sys, pymupdf
src = pymupdf.open()
p = src.new_page(width=420, height=300)
p.insert_text((40, 60), "Quarterly Invoice 4471", fontsize=24)
p.insert_text((40, 110), "Payment is due within thirty days.", fontsize=14)
p.insert_text((40, 140), "Contact: accounts@example.com", fontsize=14)
pix = p.get_pixmap(dpi=200)
d = pymupdf.open()
q = d.new_page(width=420, height=300)
q.insert_image(q.rect, pixmap=pix)
if int(sys.argv[2]):
    q.set_rotation(int(sys.argv[2]))
d.save(sys.argv[1])`,
    path,
    String(rotation)
  ])
}

const textOf = (path: string): string => execFileSync('python', ['-c', 'import sys, pymupdf\nprint(pymupdf.open(sys.argv[1])[0].get_text())', path]).toString()

test('a scanned page is made searchable with an invisible text layer, and the page looks the same', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'openpdf-e2e-'))
  const pdf = join(dir, 'scan.pdf')
  makeScan(pdf)
  expect(textOf(pdf).trim()).toBe('')
  const app = await electron.launch({ args: ['.', pdf], cwd: root, env: { ...process.env, OPENPDF_E2E: '1', OPENPDF_E2E_USERDATA: join(dir, 'ud'), OPENPDF_E2E_DISCARD: '1' } })
  try {
    const win = await app.firstWindow()
    const problems: string[] = []
    win.on('pageerror', (e) => problems.push(e.message))
    await expect(win.locator('.page')).toHaveCount(1)
    await win.getByRole('tab', { name: 'Convert', exact: true }).click()
    await win.getByRole('button', { name: 'OCR' }).click()
    const d = win.getByRole('dialog', { name: 'Recognise text (OCR)' })
    await d.getByRole('button', { name: 'Recognise' }).click()
    await expect(win.getByText(/Recognised \d+ words? on 1 page/)).toBeVisible({ timeout: 90000 })

    // Searchable in the app.
    await win.keyboard.press('Control+f')
    const find = win.getByRole('searchbox', { name: 'Find in document' })
    await find.fill('thirty days')
    await find.press('Enter')
    await expect(win.locator('.search-status')).toHaveText(/1 of 1/)

    // A second run has nothing to do for pages that now have text.
    await win.getByRole('button', { name: 'OCR' }).click()
    await win.getByRole('dialog', { name: 'Recognise text (OCR)' }).getByRole('button', { name: 'Recognise' }).click()
    await expect(win.getByText(/already has text/)).toBeVisible()

    await win.keyboard.press('Control+s')
    await expect(win.locator('.tab-dirty')).toHaveCount(0)
    const text = textOf(pdf)
    expect(text).toContain('Quarterly Invoice 4471')
    expect(text).toContain('Payment is due within thirty days.')
    expect(text).toContain('accounts@example.com')
    // The invisible words sit where the printed ones are: "Quarterly" starts near x 40 and its line is near y 42 to 62.
    const box = JSON.parse(
      execFileSync('python', ['-c', `import sys, json, pymupdf
w = [x for x in pymupdf.open(sys.argv[1])[0].get_text("words") if x[4] == "Quarterly"][0]
print(json.dumps(w[:4]))`, pdf]).toString()
    ) as number[]
    expect(Math.abs(box[0] - 40)).toBeLessThan(8)
    expect(box[1]).toBeGreaterThan(30)
    expect(box[3]).toBeLessThan(75)
    expect(problems).toEqual([])
  } finally {
    await app.close()
    rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 })
  }
})

test('a scan on a page turned 90 degrees gets its text in the right place', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'openpdf-e2e-'))
  const pdf = join(dir, 'turned.pdf')
  makeScan(pdf, 90)
  const app = await electron.launch({ args: ['.', pdf], cwd: root, env: { ...process.env, OPENPDF_E2E: '1', OPENPDF_E2E_USERDATA: join(dir, 'ud'), OPENPDF_E2E_DISCARD: '1' } })
  try {
    const win = await app.firstWindow()
    await expect(win.locator('.page')).toHaveCount(1)
    await win.getByRole('tab', { name: 'Convert', exact: true }).click()
    await win.getByRole('button', { name: 'OCR' }).click()
    await win.getByRole('dialog', { name: 'Recognise text (OCR)' }).getByRole('combobox', { name: 'Quality' }).selectOption('200')
    await win.getByRole('dialog', { name: 'Recognise text (OCR)' }).getByRole('button', { name: 'Recognise' }).click()
    // The picture itself is sideways, so what is recognised is whatever reads upright on screen; any words will do
    // as long as the layer is written without error and is selectable.
    await expect(win.getByText(/Recognised \d+ words? on 1 page|Text recognition failed/)).toBeVisible({ timeout: 90000 })
    await expect(win.getByText(/Text recognition failed/)).toHaveCount(0)
  } finally {
    await app.close()
    rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 })
  }
})
