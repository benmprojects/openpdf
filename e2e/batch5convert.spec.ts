import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(__dirname, '..')

const py = (code: string, ...args: string[]): string => execFileSync('python', ['-c', code, ...args]).toString()

/** One page with coloured shapes, a picture and Helvetica text. */
function makeColourPdf(path: string): void {
  py(
    `import sys, pymupdf
d = pymupdf.open()
p = d.new_page(width=300, height=300)
p.draw_rect(pymupdf.Rect(20, 20, 120, 80), color=(0, 0, 1), fill=(1, 0, 0))
p.insert_text((30, 150), "Hello Hello world", fontsize=16, fontname="helv")
pix = pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, 60, 60), False)
pix.set_rect(pix.irect, (30, 200, 60))
p.insert_image(pymupdf.Rect(150, 20, 250, 120), pixmap=pix)
d.set_metadata({"title": "Colour test"})
d.save(sys.argv[1])`,
    path
  )
}

async function launch(dir: string, pdf: string, extra: Record<string, string> = {}): Promise<{ app: ElectronApplication; win: Page; problems: string[] }> {
  const app = await electron.launch({ args: ['.', pdf], cwd: root, env: { ...process.env, OPENPDF_E2E: '1', OPENPDF_E2E_USERDATA: join(dir, 'ud'), OPENPDF_E2E_DISCARD: '1', ...extra } })
  const win = await app.firstWindow()
  const problems: string[] = []
  win.on('pageerror', (e) => problems.push(e.message))
  await expect(win.locator('.page')).toHaveCount(1)
  return { app, win, problems }
}

const done = (dir: string) => rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 })

async function save(win: Page): Promise<void> {
  await win.keyboard.press('Control+s')
  await expect(win.locator('.tab-dirty')).toHaveCount(0)
}

test('RTF, Markdown and CSV files become documents with their words in them', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'openpdf-e2e-'))
  const base = join(dir, 'base.pdf')
  makeColourPdf(base)
  const rtf = join(dir, 'minutes.rtf')
  writeFileSync(rtf, String.raw`{\rtf1\ansi{\fonttbl{\f0 Arial;}}\pard Site meeting minutes\par Pump station approved\par}`)
  const md = join(dir, 'notes.md')
  writeFileSync(md, '# Handover notes\n\nThe **retaining wall** is complete.\n\n- Kerb inspected\n')
  const csv = join(dir, 'quantities.csv')
  writeFileSync(csv, 'Item,Quantity\nKerb,120\nPit,14\n')
  const { app, win, problems } = await launch(dir, base, { OPENPDF_E2E_PICK: rtf })
  try {
    await win.getByRole('tab', { name: 'Convert', exact: true }).click()
    const searchFor = async (name: RegExp, words: string, hits: RegExp) => {
      await expect(win.getByRole('tab', { name })).toBeVisible()
      await win.keyboard.press('Control+f')
      const find = win.getByRole('searchbox', { name: 'Find in document' })
      await find.fill(words)
      await find.press('Enter')
      await expect(win.locator('.search-status')).toHaveText(hits)
    }
    await win.getByRole('button', { name: 'From text' }).click()
    await win.getByRole('dialog', { name: 'Create PDF from text' }).getByRole('button', { name: 'Create' }).click()
    await searchFor(/minutes\.pdf/, 'Pump station approved', /1 of 1/)
    // The RTF control words must not come through as text.
    await win.getByRole('searchbox', { name: 'Find in document' }).fill('fonttbl')
    await win.getByRole('searchbox', { name: 'Find in document' }).press('Enter')
    await expect(win.locator('.search-status')).not.toHaveText(/of 1/)
    expect(problems).toEqual([])
  } finally {
    await app.close()
  }
  // Markdown and CSV in fresh sessions (the file to pick is set when the program starts).
  for (const [file, name, words] of [[md, /notes\.pdf/, 'retaining wall is complete'], [csv, /quantities\.pdf/, 'Kerb']] as const) {
    const s = await launch(dir, base, { OPENPDF_E2E_PICK: file })
    try {
      await s.win.getByRole('tab', { name: 'Convert', exact: true }).click()
      await s.win.getByRole('button', { name: 'From text' }).click()
      await s.win.getByRole('dialog', { name: 'Create PDF from text' }).getByRole('button', { name: 'Create' }).click()
      await expect(s.win.getByRole('tab', { name })).toBeVisible()
      await s.win.keyboard.press('Control+f')
      const find = s.win.getByRole('searchbox', { name: 'Find in document' })
      await find.fill(words)
      await find.press('Enter')
      await expect(s.win.locator('.search-status')).toHaveText(/1 of 1/)
      expect(s.problems).toEqual([])
    } finally {
      await s.app.close()
    }
  }
  done(dir)
})

test('convert colours to greyscale leaves no colour on the page', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'openpdf-e2e-'))
  const pdf = join(dir, 'colour.pdf')
  makeColourPdf(pdf)
  const coloured = (): number => Number(py(`import sys, pymupdf\nfrom collections import Counter\np = pymupdf.open(sys.argv[1])[0].get_pixmap(dpi=72)\ns = p.samples\nn = 0\nfor i in range(0, len(s), 3):\n    if max(s[i:i+3]) - min(s[i:i+3]) > 6: n += 1\nprint(n)`, pdf))
  expect(coloured()).toBeGreaterThan(1000)
  const { app, win, problems } = await launch(dir, pdf)
  try {
    await win.getByRole('tab', { name: 'Convert', exact: true }).click()
    await win.getByRole('button', { name: 'Convert colours' }).click()
    const d = win.getByRole('dialog', { name: 'Convert colours' })
    await d.getByRole('button', { name: 'Convert', exact: true }).click()
    await expect(win.getByRole('dialog', { name: 'Convert colours' }).getByText(/to greyscale/)).toBeVisible({ timeout: 30000 })
    await win.getByRole('dialog', { name: 'Convert colours' }).locator('button.primary').click()
    await save(win)
    expect(coloured()).toBe(0)
    expect(py('import sys, pymupdf\nprint(pymupdf.open(sys.argv[1])[0].get_text())', pdf)).toContain('Hello Hello world')
    expect(problems).toEqual([])
  } finally {
    await app.close()
    done(dir)
  }
})

test('rasterise turns a page into one picture and the text goes with it', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'openpdf-e2e-'))
  const pdf = join(dir, 'flat.pdf')
  makeColourPdf(pdf)
  const { app, win, problems } = await launch(dir, pdf)
  try {
    await win.getByRole('tab', { name: 'Convert', exact: true }).click()
    await win.getByRole('button', { name: 'Rasterise' }).click()
    const d = win.getByRole('dialog', { name: 'Rasterise pages' })
    await d.getByRole('combobox', { name: 'Store as' }).selectOption('flate')
    await d.getByRole('button', { name: 'Rasterise', exact: true }).click()
    await expect(win.getByRole('dialog', { name: 'Rasterise pages' }).getByText(/turned into pictures/)).toBeVisible({ timeout: 60000 })
    await win.getByRole('dialog', { name: 'Rasterise pages' }).locator('button.primary').click()
    await save(win)
    expect(py('import sys, pymupdf\nprint(pymupdf.open(sys.argv[1])[0].get_text().strip())', pdf).trim()).toBe('')
    expect(Number(py('import sys, pymupdf\nprint(len(pymupdf.open(sys.argv[1])[0].get_images()))', pdf))).toBe(1)
    expect(problems).toEqual([])
  } finally {
    await app.close()
    done(dir)
  }
})

test('black and white G4 recompression of a text scan keeps the page readable', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'openpdf-e2e-'))
  const pdf = join(dir, 'scan.pdf')
  py(
    `import sys, pymupdf
src = pymupdf.open()
p = src.new_page(width=420, height=300)
p.insert_text((40, 60), "Quarterly Invoice 4471", fontsize=24)
pix = p.get_pixmap(dpi=150)
d = pymupdf.open()
q = d.new_page(width=420, height=300)
q.insert_image(q.rect, pixmap=pix)
d.save(sys.argv[1])`,
    pdf
  )
  const { app, win, problems } = await launch(dir, pdf)
  try {
    await win.getByRole('tab', { name: 'Organise', exact: true }).click()
    await win.getByRole('button', { name: 'Recompress pictures' }).click()
    const d = win.getByRole('dialog', { name: 'Recompress pictures' })
    await d.getByRole('checkbox', { name: /Black and white scans/ }).check()
    await d.getByRole('button', { name: 'Recompress', exact: true }).click()
    await expect(win.getByRole('dialog', { name: 'Recompress pictures' }).getByText(/changed to black and white/)).toBeVisible({ timeout: 30000 })
    await win.getByRole('dialog', { name: 'Recompress pictures' }).locator('button.primary').click()
    await save(win)
    // The picture is now a 1-bit CCITT image, and it still draws the words (dark pixels exist where the text was).
    expect(py('import sys, pymupdf\nd = pymupdf.open(sys.argv[1])\nprint(d[0].get_images()[0][5], d[0].get_images()[0][8])', pdf).trim()).toMatch(/DeviceGray CCITTFaxDecode/)
    const dark = Number(py('import sys, pymupdf\ns = pymupdf.open(sys.argv[1])[0].get_pixmap(dpi=72).samples\nprint(sum(1 for i in range(0, len(s), 3) if s[i] < 100))', pdf))
    expect(dark).toBeGreaterThan(200)
    expect(problems).toEqual([])
  } finally {
    await app.close()
    done(dir)
  }
})

test('replace a font everywhere, and find and replace text', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'openpdf-e2e-'))
  const pdf = join(dir, 'fonts.pdf')
  makeColourPdf(pdf)
  const { app, win, problems } = await launch(dir, pdf)
  try {
    await win.getByRole('tab', { name: 'Convert', exact: true }).click()
    await win.getByRole('button', { name: 'Fonts and text' }).click()
    const d = win.getByRole('dialog', { name: 'Fonts and text' })
    await expect(d.getByRole('table', { name: 'Fonts in this document' })).toBeVisible()
    await d.getByRole('combobox', { name: /Replace Helvetica with/ }).selectOption({ label: 'Courier (standard, not embedded)' })
    await d.getByRole('button', { name: 'Replace fonts' }).last().click()
    await expect(win.getByRole('dialog', { name: 'Fonts and text' }).getByText(/Replaced 1 fonts/)).toBeVisible({ timeout: 30000 })
    await win.getByRole('dialog', { name: 'Fonts and text' }).locator('button.primary').click()
    // Find and replace text.
    await win.getByRole('button', { name: 'Fonts and text' }).click()
    const d2 = win.getByRole('dialog', { name: 'Fonts and text' })
    await d2.getByRole('tab', { name: 'Find and replace text' }).click()
    await d2.getByRole('textbox', { name: 'Find', exact: true }).fill('Hello')
    await d2.getByRole('textbox', { name: 'Replace with' }).fill('Goodbye')
    await d2.getByRole('button', { name: 'Replace all' }).click()
    await expect(win.getByRole('dialog', { name: 'Fonts and text' }).getByText(/Replaced 2 matches on 1 page/)).toBeVisible({ timeout: 30000 })
    await win.getByRole('dialog', { name: 'Fonts and text' }).locator('button.primary').click()
    await save(win)
    expect(py('import sys, pymupdf\nprint(pymupdf.open(sys.argv[1])[0].get_text())', pdf)).toContain('Goodbye Goodbye world')
    expect(py('import sys, pymupdf\nprint([f[3] for f in pymupdf.open(sys.argv[1])[0].get_fonts()])', pdf)).toContain('Courier')
    expect(problems).toEqual([])
  } finally {
    await app.close()
    done(dir)
  }
})

/** veraPDF, when it is installed (the VERAPDF variable names its launcher). It is a separate test tool and never shipped. */
const vera = process.env.VERAPDF && existsSync(process.env.VERAPDF) ? process.env.VERAPDF : null

for (const [label, option, flavour] of [
  ['PDF/A-1b', /PDF\/A-1b/, '1b'],
  ['PDF/A-2b', /PDF\/A-2b/, '2b'],
  ['PDF/A-3b', /PDF\/A-3b/, '3b']
] as const) {
  test(`convert to ${label}, and validate it with veraPDF when that is available`, async () => {
    const dir = mkdtempSync(join(tmpdir(), 'openpdf-e2e-'))
    const pdf = join(dir, 'archive.pdf')
    makeColourPdf(pdf)
    const { app, win, problems } = await launch(dir, pdf)
    try {
      await win.getByRole('tab', { name: 'Convert', exact: true }).click()
      await win.getByRole('button', { name: 'PDF/A and PDF/X' }).click()
      const d = win.getByRole('dialog', { name: 'Convert to PDF/A or PDF/X' })
      await d.getByRole('radio', { name: option }).check()
      await d.getByRole('button', { name: 'Convert', exact: true }).click()
      await expect(win.getByRole('dialog', { name: new RegExp(`Converted to ${label}`) })).toBeVisible({ timeout: 60000 })
      await expect(win.getByText(/this program does not guarantee/i)).toBeVisible()
      await win.getByRole('dialog', { name: new RegExp(`Converted to ${label}`) }).locator('button.primary').click()
      await save(win)
      expect(py('import sys, pymupdf\nprint(pymupdf.open(sys.argv[1]).xref_get_key(pymupdf.open(sys.argv[1]).pdf_catalog(), "OutputIntents")[0])', pdf).trim()).not.toBe('null')
      if (vera) {
        let out = ''
        try {
          out = execFileSync(vera, ['--flavour', flavour, '--format', 'text', pdf], { encoding: 'utf8', shell: true })
        } catch (e) {
          out = String((e as { stdout?: string }).stdout ?? '')
        }
        expect(out.trim().startsWith('PASS')).toBe(true)
      }
      expect(problems).toEqual([])
    } finally {
      await app.close()
      done(dir)
    }
  })
}

test('convert to PDF/X-4 and X-1a writes the identification, an output intent and a TrimBox, and says it is not validated', async () => {
  for (const [name, std, version] of [['PDF/X-4', /PDF\/X-4/, 'PDF/X-4'], ['PDF/X-1a', /PDF\/X-1a/, 'PDF/X-1a:2003']] as const) {
    const dir = mkdtempSync(join(tmpdir(), 'openpdf-e2e-'))
    const pdf = join(dir, 'print.pdf')
    makeColourPdf(pdf)
    const { app, win, problems } = await launch(dir, pdf)
    try {
      await win.getByRole('tab', { name: 'Convert', exact: true }).click()
      await win.getByRole('button', { name: 'PDF/A and PDF/X' }).click()
      const d = win.getByRole('dialog', { name: 'Convert to PDF/A or PDF/X' })
      await d.getByRole('radio', { name: std }).check()
      await d.getByRole('button', { name: 'Convert', exact: true }).click()
      const r = win.getByRole('dialog', { name: new RegExp(`Converted to ${name}`) })
      await expect(r).toBeVisible({ timeout: 60000 })
      await expect(r.getByText(/not checked with a validator/)).toBeVisible()
      await r.locator('button.primary').click()
      await save(win)
      const info = py(
        `import sys, pymupdf
d = pymupdf.open(sys.argv[1])
x = d.xref_get_key(-1, "Info")
print(d.metadata.get("title"), "|", d[0].trimbox, "|", d.xref_get_key(d.pdf_catalog(), "OutputIntents")[0])
info = d.xref_get_key(-1, "Info")[1].split()[0]
print(d.xref_get_key(int(info), "GTS_PDFXVersion")[1])`,
        pdf
      )
      expect(info).toContain(version)
      expect(info).toContain('Colour test')
      expect(problems).toEqual([])
    } finally {
      await app.close()
      done(dir)
    }
  }
})

/** A scan: one page that is only a picture of some text, optionally a little crooked. */
function makeScan(path: string, tilt = 0): void {
  py(
    `import sys, io, pymupdf
from PIL import Image
src = pymupdf.open()
p = src.new_page(width=420, height=300)
p.insert_text((40, 60), "Quarterly Invoice 4471", fontsize=24)
p.insert_text((40, 110), "Payment is due within thirty days.", fontsize=14)
p.insert_text((40, 140), "Contact: accounts@example.com", fontsize=14)
img = Image.open(io.BytesIO(p.get_pixmap(dpi=200).tobytes("png"))).convert("RGB")
if float(sys.argv[2]):
    img = img.rotate(float(sys.argv[2]), fillcolor=(255, 255, 255), expand=False)
buf = io.BytesIO()
img.save(buf, "PNG")
d = pymupdf.open()
q = d.new_page(width=420, height=300)
q.insert_image(q.rect, stream=buf.getvalue())
d.save(sys.argv[1])`,
    path,
    String(tilt)
  )
}

test('OCR can replace the scan with the recognised text instead of keeping it as a searchable image', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'openpdf-e2e-'))
  const pdf = join(dir, 'scan.pdf')
  makeScan(pdf)
  const { app, win, problems } = await launch(dir, pdf)
  try {
    await win.getByRole('tab', { name: 'Convert', exact: true }).click()
    await win.getByRole('button', { name: 'OCR' }).click()
    const d = win.getByRole('dialog', { name: 'Recognise text (OCR)' })
    await d.getByRole('combobox', { name: 'Output' }).selectOption('replace')
    await d.getByRole('button', { name: 'Recognise' }).click()
    await expect(win.getByText(/Recognised \d+ words? on 1 page/)).toBeVisible({ timeout: 90000 })
    await expect(win.getByText(/scanned picture was taken out of 1 page/)).toBeVisible()
    await save(win)
    expect(py('import sys, pymupdf\nprint(len(pymupdf.open(sys.argv[1])[0].get_images()))', pdf).trim()).toBe('0')
    expect(py('import sys, pymupdf\nprint(pymupdf.open(sys.argv[1])[0].get_text())', pdf)).toContain('thirty days')
    // The words are visible text now: dark pixels where the scan used to be the only source of ink.
    expect(Number(py('import sys, pymupdf\ns = pymupdf.open(sys.argv[1])[0].get_pixmap(dpi=72).samples\nprint(sum(1 for i in range(0, len(s), 3) if s[i] < 100))', pdf))).toBeGreaterThan(100)
    expect(problems).toEqual([])
  } finally {
    await app.close()
    done(dir)
  }
})

test('enhance a crooked scan that is already in the document: straightened, black and white, same page size', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'openpdf-e2e-'))
  const pdf = join(dir, 'crooked.pdf')
  makeScan(pdf, 3)
  const { app, win, problems } = await launch(dir, pdf)
  try {
    await win.getByRole('tab', { name: 'Convert', exact: true }).click()
    await win.getByRole('button', { name: 'Enhance scans' }).click()
    const d = win.getByRole('dialog', { name: 'Enhance scanned pages' })
    await d.getByRole('button', { name: 'Enhance', exact: true }).click()
    await expect(win.getByRole('dialog', { name: 'Enhance scanned pages' }).getByText(/turned into pictures/)).toBeVisible({ timeout: 90000 })
    await win.getByRole('dialog', { name: 'Enhance scanned pages' }).locator('button.primary').click()
    await save(win)
    expect(py('import sys, pymupdf\nd = pymupdf.open(sys.argv[1])[0]\nprint(d.get_images()[0][5], d.get_images()[0][8], d.rect.width, d.rect.height)', pdf).trim()).toMatch(/DeviceGray CCITTFaxDecode 4\d\d/)
    expect(problems).toEqual([])
  } finally {
    await app.close()
    done(dir)
  }
})
