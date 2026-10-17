import { _electron as electron, expect, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import JSZip from 'jszip'

const root = resolve(__dirname, '..')

/** Page 1: a heading, a ruled table of items, amounts and dates, and a picture. Page 2: two columns of text. */
function make(path: string): void {
  execFileSync('python', [
    '-c',
    `import sys, pymupdf
d = pymupdf.open()
p = d.new_page(width=400, height=500)
p.insert_text((40, 50), "Quantities", fontsize=24)
rows = [("Item", "Cost", "Done", "Date"), ("Pit", "$1,234.50", "12.5%", "31/12/2026"), ("Pipe", "42", "80%", "01/02/2027"), ("Kerb", "(15.25)", "5%", "n/a")]
x = [40, 120, 220, 290, 360]
y0 = 80
for i in range(len(rows) + 1):
    p.draw_line((x[0], y0 + i * 20), (x[-1], y0 + i * 20), width=0.7)
for xx in x:
    p.draw_line((xx, y0), (xx, y0 + len(rows) * 20), width=0.7)
for r, row in enumerate(rows):
    for c, t in enumerate(row):
        p.insert_text((x[c] + 4, y0 + r * 20 + 14), t, fontsize=10)
pix = pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, 80, 50), False)
pix.set_rect(pix.irect, (200, 40, 40))
p.insert_image(pymupdf.Rect(40, 220, 160, 295), pixmap=pix)
q = d.new_page(width=400, height=500)
q.insert_text((40, 50), "A heading across both columns of this page", fontsize=16)
for i in range(6):
    q.insert_text((40, 100 + i * 30), "Left column line number %d of text" % i, fontsize=10)
    q.insert_text((220, 100 + i * 30), "Right column line number %d of text" % i, fontsize=10)
d.save(sys.argv[1])`,
    path
  ])
}

async function open(dir: string, pdf: string, target: string) {
  const app = await electron.launch({ args: ['.', pdf], cwd: root, env: { ...process.env, OPENPDF_E2E: '1', OPENPDF_E2E_USERDATA: join(dir, 'ud'), OPENPDF_E2E_DISCARD: '1', OPENPDF_E2E_SAVE_TEXT: target } })
  const win = await app.firstWindow()
  const problems: string[] = []
  win.on('pageerror', (e) => problems.push(e.message))
  await expect(win.locator('.page')).toHaveCount(2)
  await win.getByRole('tab', { name: 'Convert', exact: true }).click()
  return { app, win, problems }
}

/** The package saved at `target`, once it is a zip. */
async function zipAt(target: string): Promise<JSZip> {
  await expect
    .poll(() => {
      try {
        return readFileSync(target).subarray(0, 2).toString('latin1')
      } catch {
        return ''
      }
    })
    .toBe('PK')
  return JSZip.loadAsync(readFileSync(target))
}

test('Word export rebuilds the table, keeps the picture and writes section columns; exact layout fixes text in frames', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'openpdf-e2e-'))
  const pdf = join(dir, 'plan.pdf')
  const target = join(dir, 'out.bin')
  make(pdf)
  const { app, win, problems } = await open(dir, pdf, target)
  try {
    await win.getByRole('button', { name: 'Word' }).click()
    let d = win.getByRole('dialog', { name: 'Export as Word' })
    await expect(d.getByRole('radio', { name: 'Flowing text' })).toBeChecked()
    await d.getByRole('button', { name: 'Export…' }).click()
    await expect(win.getByText(/^Exported /)).toBeVisible()
    let zip = await zipAt(target)
    let doc = await zip.file('word/document.xml')!.async('string')
    expect(doc).toContain('<w:tbl>')
    expect((doc.match(/<w:tr[ >]/g) ?? []).length).toBe(4)
    expect(doc).toContain('$1,234.50')
    expect(doc).toContain('Heading1')
    expect(doc).toContain('<w:drawing>')
    expect(Object.keys(zip.files).some((n) => n.startsWith('word/media/'))).toBe(true)
    expect(doc).toMatch(/<w:cols[^>]*w:num="2"/)
    expect(doc).toContain('Left column line number 5 of text')
    expect(doc.indexOf('Left column line number 5')).toBeLessThan(doc.indexOf('Right column line number 0'))

    // Exact layout: framed text, no table, picture floating behind.
    await win.getByRole('button', { name: 'Word' }).click()
    d = win.getByRole('dialog', { name: 'Export as Word' })
    await d.getByRole('radio', { name: 'Exact layout' }).check()
    await expect(d.getByText(/Tables are not rebuilt/)).toBeVisible()
    await d.getByRole('button', { name: 'Export…' }).click()
    await expect.poll(async () => (await JSZip.loadAsync(readFileSync(target)).then((z) => z.file('word/document.xml')!.async('string'))).includes('w:framePr')).toBe(true)
    zip = await JSZip.loadAsync(readFileSync(target))
    doc = await zip.file('word/document.xml')!.async('string')
    expect(doc).not.toContain('<w:tbl>')
    expect(doc).toContain('behindDoc="1"')
    expect(doc).toContain('Quantities')
    expect(problems).toEqual([])
  } finally {
    await app.close()
    rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 })
  }
})

test('Excel export writes the table with numbers, amounts, percentages and dates as values', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'openpdf-e2e-'))
  const pdf = join(dir, 'plan.pdf')
  const target = join(dir, 'out.bin')
  make(pdf)
  const { app, win, problems } = await open(dir, pdf, target)
  try {
    await win.getByRole('button', { name: 'Excel' }).click()
    const d = win.getByRole('dialog', { name: 'Export as Excel' })
    await d.getByRole('button', { name: 'Export…' }).click()
    await expect(win.getByText(/^Exported /)).toBeVisible()
    const zip = await zipAt(target)
    const names = Object.keys(zip.files)
    expect(names).toContain('xl/worksheets/sheet1.xml')
    expect(names).not.toContain('xl/worksheets/sheet2.xml') // only page 1 has a table
    const wb = await zip.file('xl/workbook.xml')!.async('string')
    expect(wb).toContain('name="Page 1"')
    const sheet = await zip.file('xl/worksheets/sheet1.xml')!.async('string')
    expect(sheet).toContain('>Pit<')
    expect(sheet).toMatch(/<c r="B2" s="\d+"><v>1234.5<\/v>/)
    expect(sheet).toMatch(/<c r="C2" s="\d+"><v>0.125<\/v>/)
    expect(sheet).toMatch(/<c r="D2" s="\d+"><v>46387<\/v>/)
    expect(sheet).toMatch(/<c r="B4" s="\d+"><v>-15.25<\/v>/)
    expect(sheet).toContain('>n/a<')
    expect(await zip.file('xl/styles.xml')!.async('string')).toContain('dd/mm/yyyy')
    expect(problems).toEqual([])
  } finally {
    await app.close()
    rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 })
  }
})

test('PowerPoint export makes one picture slide per page with the page text in the notes', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'openpdf-e2e-'))
  const pdf = join(dir, 'plan.pdf')
  const target = join(dir, 'out.bin')
  make(pdf)
  const { app, win, problems } = await open(dir, pdf, target)
  try {
    await win.getByRole('button', { name: 'PowerPoint' }).click()
    const d = win.getByRole('dialog', { name: 'Export as PowerPoint' })
    await d.getByRole('combobox', { name: 'Resolution' }).selectOption('96')
    await d.getByRole('button', { name: 'Export…' }).click()
    await expect(win.getByText(/^Exported /)).toBeVisible()
    const zip = await zipAt(target)
    const names = Object.keys(zip.files)
    expect(names).toContain('ppt/slides/slide1.xml')
    expect(names).toContain('ppt/slides/slide2.xml')
    expect(names).toContain('ppt/media/image1.png')
    const png = await zip.file('ppt/media/image1.png')!.async('nodebuffer')
    expect(png.subarray(1, 4).toString('latin1')).toBe('PNG')
    // 400 x 500 points at 96 dpi.
    expect(png.readUInt32BE(16)).toBe(533)
    expect(Math.abs(png.readUInt32BE(20) - 667)).toBeLessThanOrEqual(1)
    const pres = await zip.file('ppt/presentation.xml')!.async('string')
    const m = /<p:sldSz cx="(\d+)" cy="(\d+)"/.exec(pres)!
    expect(Number(m[1]) / Number(m[2])).toBeCloseTo(0.8, 2)
    expect(await zip.file('ppt/notesSlides/notesSlide2.xml')!.async('string')).toContain('Left column line number 0 of text')
    expect(problems).toEqual([])
  } finally {
    await app.close()
    rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 })
  }
})
