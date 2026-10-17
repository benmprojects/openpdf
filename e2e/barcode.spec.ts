import { _electron as electron, expect, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { barcodeShape, encodeQr } from '../src/renderer/src/barcode'

const root = resolve(__dirname, '..')

const MAKE = `
import sys, pymupdf
d = pymupdf.open()
pages, rotation = int(sys.argv[2]), int(sys.argv[3])
for i in range(pages):
    p = d.new_page(width=595, height=842)
    if rotation:
        p.set_rotation(rotation)
d.save(sys.argv[1])
`

/**
 * Renders a page, finds the dark box of the symbol in the region and reads it back. For a QR code it samples the centre of
 * every module and counts the ones that differ from the expected matrix; for a bar code it reads one row across the bars
 * and returns the widths of the bars and spaces in modules.
 */
const READ = `
import sys, json, pymupdf
from PIL import Image
path, page, mode, arg = sys.argv[1], int(sys.argv[2]), sys.argv[3], json.loads(sys.argv[4])
d = pymupdf.open(path)
zoom = 6
pm = d[page].get_pixmap(matrix=pymupdf.Matrix(zoom, zoom), alpha=False)
img = Image.frombytes("RGB", (pm.width, pm.height), pm.samples).convert("L")
mask = img.point(lambda v: 255 if v < 110 else 0)
box = mask.getbbox()
if not box:
    print(json.dumps({"found": False})); sys.exit()
x0, y0, x1, y1 = box
px = mask.load()
dark = lambda x, y: px[x, y] > 0
if mode == "qr":
    rows = arg["rows"]
    k = len(rows)
    cell = (x1 - x0) / k
    wrong = 0
    for r in range(k):
        for c in range(k):
            if dark(int(x0 + (c + 0.5) * cell), int(y0 + (r + 0.5) * cell)) != (rows[r][c] == "1"):
                wrong += 1
    print(json.dumps({"found": True, "wrong": wrong, "size_pt": (x1 - x0) / zoom, "square": abs((x1 - x0) - (y1 - y0)) < 3 * zoom}))
else:
    unit = (x1 - x0) / arg["modules"]
    row = y0 + int((y1 - y0) * 0.3)
    runs, cur, length = [], True, 0
    for x in range(x0, x1):
        v = dark(x, row)
        if v == cur:
            length += 1
        else:
            runs.append(round(length / unit)); cur = v; length = 1
    runs.append(round(length / unit))
    runs = [r for r in runs if r > 0]
    print(json.dumps({"found": True, "runs": "".join(str(r) for r in runs), "width_pt": (x1 - x0) / zoom, "height_pt": (y1 - y0) / zoom}))
`

const ANNOTS = `
import sys, json, pymupdf
d = pymupdf.open(sys.argv[1])
print(json.dumps([[i, a.type[1], a.info.get("content", "")] for i, p in enumerate(d) for a in p.annots()]))
`

const read = (path: string, page: number, mode: 'qr' | 'bars', arg: unknown): Record<string, unknown> => JSON.parse(execFileSync('python', ['-c', READ, path, String(page), mode, JSON.stringify(arg)]).toString())

const rowsOf = (text: string, ecc: 'L' | 'M' | 'Q' | 'H') => encodeQr(text, ecc).modules.map((r) => r.map((v) => (v ? '1' : '0')).join(''))

const widthsOf = (kind: 'code128' | 'code39' | 'ean13', text: string) => {
  const s = barcodeShape(kind, text)
  let out = ''
  let at = 0
  for (const r of s.rects) {
    if (r.x > at) out += String(r.x - at)
    out += String(r.w)
    at = r.x + r.w
  }
  return { runs: out, modules: s.width }
}

async function launch(pdf: string, dir: string, env: Record<string, string> = {}) {
  const app = await electron.launch({ args: ['.', pdf], cwd: root, env: { ...process.env, OPENPDF_E2E: '1', OPENPDF_E2E_USERDATA: join(dir, 'ud'), OPENPDF_E2E_DISCARD: '1', ...env } })
  const win = await app.firstWindow()
  const problems: string[] = []
  win.on('pageerror', (e) => problems.push(e.message))
  return { app, win, problems }
}

test('QR code as page content on every page of a rotated document: each page has its own text and reads back upright', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'openpdf-e2e-'))
  const pdf = join(dir, 'Drawing A101.pdf')
  execFileSync('python', ['-c', MAKE, pdf, '3', '90'])
  const { app, win, problems } = await launch(pdf, dir)
  try {
    await expect(win.locator('.page')).toHaveCount(3)
    await win.getByRole('tab', { name: 'Edit', exact: true }).click()
    await win.getByRole('button', { name: 'QR / barcode' }).click()
    const d = win.getByRole('dialog', { name: 'Add a QR code or barcode' })
    await expect(d.getByRole('img', { name: 'Barcode preview' })).toBeVisible()
    await d.getByRole('textbox', { name: 'Barcode text' }).fill('{filename} p{page}/{pages}')
    await d.getByRole('combobox', { name: 'Error correction' }).selectOption('Q')
    await d.getByRole('spinbutton', { name: 'Width in millimetres' }).fill('30')
    await d.getByRole('combobox', { name: 'Pages', exact: true }).selectOption('all')
    await d.getByRole('combobox', { name: 'Position' }).selectOption('top-left')
    await d.getByRole('button', { name: 'Add barcode' }).click()
    await expect(win.getByText('3 barcodes added')).toBeVisible()
    await win.keyboard.press('Control+s')
    await expect(win.locator('.tab-dirty')).toHaveCount(0)
    for (let i = 0; i < 3; i++) {
      const r = read(pdf, i, 'qr', { rows: rowsOf(`Drawing A101 p${i + 1}/3`, 'Q') })
      expect(r.found, `page ${i + 1}`).toBe(true)
      expect(r.wrong, `page ${i + 1} modules that differ`).toBe(0)
      expect(r.square).toBe(true)
      // 30 mm, with a quiet zone that is white and so not measured: the dark area is a little less.
      expect(r.size_pt as number).toBeGreaterThan(55)
      expect(r.size_pt as number).toBeLessThanOrEqual(30 * 72 / 25.4 + 1)
    }
    expect(problems).toEqual([])
  } finally {
    await app.close()
    rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 })
  }
})

test('Code 128 as a stamp annotation with its text, and Code 39 and EAN-13 as content', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'openpdf-e2e-'))
  const pdf = join(dir, 'bars.pdf')
  execFileSync('python', ['-c', MAKE, pdf, '1', '0'])
  const { app, win, problems } = await launch(pdf, dir)
  try {
    await expect(win.locator('.page')).toHaveCount(1)
    await win.getByRole('tab', { name: 'Edit', exact: true }).click()
    const add = async (kind: string, text: string, as: string, spot: string, extra?: (d: ReturnType<typeof win.getByRole>) => Promise<void>) => {
      await win.getByRole('button', { name: 'QR / barcode' }).click()
      const d = win.getByRole('dialog', { name: 'Add a QR code or barcode' })
      await d.getByRole('combobox', { name: 'Barcode type' }).selectOption(kind)
      await d.getByRole('textbox', { name: 'Barcode text' }).fill(text)
      await d.getByRole('combobox', { name: 'Added as' }).selectOption(as)
      await d.getByRole('combobox', { name: 'Position' }).selectOption(spot)
      await d.getByRole('spinbutton', { name: 'Width in millimetres' }).fill('60')
      await d.getByRole('spinbutton', { name: 'Height in millimetres' }).fill('20')
      if (extra) await extra(d)
      await d.getByRole('button', { name: 'Add barcode' }).click()
      await expect(win.getByText('Barcode added')).toBeVisible()
    }
    // A text that does not suit EAN-13 is refused in the dialog.
    await win.getByRole('button', { name: 'QR / barcode' }).click()
    const bad = win.getByRole('dialog', { name: 'Add a QR code or barcode' })
    await bad.getByRole('combobox', { name: 'Barcode type' }).selectOption('ean13')
    await bad.getByRole('textbox', { name: 'Barcode text' }).fill('hello')
    await expect(bad.getByRole('alert')).toContainText('EAN-13 needs 12 digits')
    await bad.getByRole('button', { name: 'Cancel' }).click()

    await add('code128', 'A101-2', 'annotation', 'top-left', async (d) => d.getByRole('checkbox', { name: 'Print the text under the bars' }).uncheck())
    await add('code39', 'RFI 0042', 'content', 'centre', async (d) => d.getByRole('checkbox', { name: 'Print the text under the bars' }).uncheck())
    await add('ean13', '590123412345', 'content', 'bottom-right', async (d) => d.getByRole('checkbox', { name: 'Print the text under the bars' }).uncheck())
    await win.keyboard.press('Control+s')
    await expect(win.locator('.tab-dirty')).toHaveCount(0)

    const annots = JSON.parse(execFileSync('python', ['-c', ANNOTS, pdf]).toString()) as [number, string, string][]
    expect(annots).toEqual([[0, 'Stamp', 'A101-2']])
    // The reader takes the whole dark area of a page, so each symbol is read from a copy of the page with the others covered.
    const covered = (keep: 'tl' | 'c' | 'br') =>
      execFileSync('python', ['-c', `
import sys, pymupdf
d = pymupdf.open(sys.argv[1])
p = d[0]
w, h = p.rect.width, p.rect.height
keep = sys.argv[3]
zones = {"tl": pymupdf.Rect(0, 0, w / 2, h / 3), "c": pymupdf.Rect(0, h / 3, w, 2 * h / 3), "br": pymupdf.Rect(w / 2, 2 * h / 3, w, h)}
if keep != "tl":
    for a in list(p.annots()):
        p.delete_annot(a)
for k, r in zones.items():
    if k != keep:
        p.draw_rect(r, color=(1, 1, 1), fill=(1, 1, 1))
d.save(sys.argv[2])
`, pdf, join(dir, `only-${keep}.pdf`), keep])
    for (const [keep, kind, text] of [['tl', 'code128', 'A101-2'], ['c', 'code39', 'RFI 0042'], ['br', 'ean13', '590123412345']] as const) {
      covered(keep)
      const exp = widthsOf(kind, text)
      // The dark area runs from the first bar to the last: leave out the quiet zones.
      const r = read(join(dir, `only-${keep}.pdf`), 0, 'bars', { modules: exp.modules })
      expect(r.found, kind).toBe(true)
      expect(r.runs, kind).toBe(exp.runs)
      expect(Math.abs((r.width_pt as number) - 60 * 72 / 25.4 * (exp.modules / (exp.modules + 20))), kind).toBeLessThan(2)
    }
    expect(problems).toEqual([])
  } finally {
    await app.close()
    rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 })
  }
})

test('barcode field: typed text is saved as plain text and drawn as a bar code', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'openpdf-e2e-'))
  const pdf = join(dir, 'field.pdf')
  execFileSync('python', ['-c', MAKE, pdf, '1', '0'])
  const { app, win, problems } = await launch(pdf, dir)
  try {
    await expect(win.locator('.page')).toHaveCount(1)
    await win.getByRole('tab', { name: 'Forms', exact: true }).click()
    const z = Number((await win.locator('.zoom-now').textContent())!.replace('%', '')) / 100
    await win.getByRole('button', { name: 'Barcode', exact: true }).focus()
    await win.keyboard.press('Enter')
    const pb = (await win.locator('.page').first().boundingBox())!
    await win.mouse.move(pb.x + 100 * z, pb.y + 100 * z)
    await win.mouse.down()
    await win.mouse.move(pb.x + 300 * z, pb.y + 160 * z, { steps: 5 })
    await win.mouse.up()
    const d = win.getByRole('dialog', { name: 'New barcode field' })
    await expect(d.getByText('Other PDF viewers may show the plain text')).toBeVisible()
    await d.getByRole('textbox', { name: 'Field name' }).fill('asset')
    await d.getByRole('combobox', { name: 'Barcode type' }).selectOption('code128')
    await d.getByRole('textbox', { name: 'Default value' }).fill('AB-1234')
    await d.getByRole('button', { name: 'Add field' }).click()
    await expect(win.getByText('Field added')).toBeVisible()
    // Fill in the form: a new value is drawn when saved.
    await win.getByRole('button', { name: 'Edit fields' }).click()
    await win.getByRole('textbox', { name: 'asset' }).fill('PLANT-77')
    await win.getByRole('textbox', { name: 'asset' }).blur()
    await win.keyboard.press('Control+s')
    await expect(win.locator('.tab-dirty')).toHaveCount(0)
    const value = execFileSync('python', ['-c', 'import sys, pymupdf\nd = pymupdf.open(sys.argv[1])\nprint([w.field_value for w in d[0].widgets()])', pdf]).toString().trim()
    expect(value).toBe("['PLANT-77']")
    const exp = widthsOf('code128', 'PLANT-77')
    // The field's appearance shows the symbol and its text under the bars: read a row through the bars.
    const r = read(pdf, 0, 'bars', { modules: exp.modules })
    expect(r.found).toBe(true)
    expect(r.runs).toBe(exp.runs)
    expect(problems).toEqual([])
  } finally {
    await app.close()
    rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 })
  }
})
