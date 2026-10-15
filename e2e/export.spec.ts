import { _electron as electron, expect, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(__dirname, '..')

function make(path: string): void {
  execFileSync('python', [
    '-c',
    `import sys, pymupdf
d = pymupdf.open()
p = d.new_page(width=300, height=400)
p.insert_text((40, 60), "Annual Report", fontsize=26)
p.insert_text((40, 110), "This paragraph describes the year in plain words.", fontsize=11)
p.insert_text((40, 126), "It carries on over a second line of the same paragraph.", fontsize=11)
p.insert_text((40, 190), "Results", fontsize=18)
p.insert_text((40, 230), "Revenue rose and costs fell during the period.", fontsize=11)
q = d.new_page(width=300, height=400)
q.insert_text((40, 80), "Appendix text on the second page.", fontsize=11)
d.save(sys.argv[1])`,
    path
  ])
}

async function open(dir: string, pdf: string, env: Record<string, string>) {
  const app = await electron.launch({ args: ['.', pdf], cwd: root, env: { ...process.env, OPENPDF_E2E: '1', OPENPDF_E2E_USERDATA: join(dir, 'ud'), OPENPDF_E2E_DISCARD: '1', ...env } })
  const win = await app.firstWindow()
  const problems: string[] = []
  win.on('pageerror', (e) => problems.push(e.message))
  await expect(win.locator('.page')).toHaveCount(2)
  await win.getByRole('tab', { name: 'Convert', exact: true }).click()
  return { app, win, problems }
}

test('pages export as PNG, JPEG or TIFF pictures at the chosen resolution, one file each', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'openpdf-e2e-'))
  const out = join(dir, 'pictures')
  mkdirSync(out)
  const pdf = join(dir, 'report.pdf')
  make(pdf)
  const { app, win, problems } = await open(dir, pdf, { OPENPDF_E2E_DIR: out })
  try {
    for (const [format, ext] of [
      ['png', 'png'],
      ['jpg', 'jpg'],
      ['tiff', 'tiff']
    ] as const) {
      await win.getByRole('button', { name: 'Pictures', exact: true }).click()
      const d = win.getByRole('dialog', { name: 'Export pages as pictures' })
      await d.getByRole('combobox', { name: 'Format' }).selectOption(format)
      await d.getByRole('combobox', { name: 'Resolution' }).selectOption('72')
      await d.getByRole('button', { name: 'Export' }).click()
      await expect(win.getByText(/Saved 2 pictures/)).toBeVisible()
      expect(readdirSync(out)).toContain(`report-page-001.${ext}`)
      expect(readdirSync(out)).toContain(`report-page-002.${ext}`)
    }
    // Sizes: 300 x 400 points at 72 dpi is 300 x 400 pixels; and each is a real picture of its kind.
    const info = JSON.parse(
      execFileSync('python', ['-c', `import sys, json\nfrom PIL import Image\nout = {}\nfor n in ("report-page-001.png", "report-page-001.jpg", "report-page-002.tiff"):\n    im = Image.open(sys.argv[1] + "/" + n)\n    out[n] = [im.format, im.size[0], im.size[1]]\nprint(json.dumps(out))`, out]).toString()
    )
    expect(info['report-page-001.png']).toEqual(['PNG', 300, 400])
    expect(info['report-page-001.jpg']).toEqual(['JPEG', 300, 400])
    expect(info['report-page-002.tiff']).toEqual(['TIFF', 300, 400])
    // Exporting again does not overwrite.
    await win.getByRole('button', { name: 'Pictures', exact: true }).click()
    await win.getByRole('dialog', { name: 'Export pages as pictures' }).getByRole('button', { name: 'Export' }).click()
    await expect(win.getByText(/Saved 2 pictures/)).toBeVisible()
    expect(readdirSync(out).filter((n) => n.includes('(2)')).length).toBeGreaterThan(0)
    expect(problems).toEqual([])
  } finally {
    await app.close()
    rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 })
  }
})

test('text, HTML and Word exports keep the words, with headings found from the type sizes', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'openpdf-e2e-'))
  const pdf = join(dir, 'report.pdf')
  make(pdf)
  const target = join(dir, 'out.bin')
  const { app, win, problems } = await open(dir, pdf, { OPENPDF_E2E_SAVE_TEXT: target })
  try {
    await win.getByRole('button', { name: 'Text', exact: true }).click()
    await expect(win.getByText(/^Exported /)).toBeVisible()
    const txt = readFileSync(target, 'utf8')
    expect(txt).toContain('Annual Report')
    expect(txt).toContain('Appendix text on the second page.')

    await win.getByRole('button', { name: 'HTML' }).click()
    await expect.poll(() => readFileSync(target, 'utf8')).toContain('<!DOCTYPE html>')
    const html = readFileSync(target, 'utf8')
    expect(html).toContain('<h1>Annual Report</h1>')
    expect(html).toContain('<h2>Results</h2>')
    expect(html).toContain('This paragraph describes the year in plain words. It carries on over a second line of the same paragraph.')
    expect(html).toContain('<section id="page-2"')

    await win.getByRole('button', { name: 'Word' }).click()
    await expect.poll(() => readFileSync(target).subarray(0, 2).toString('latin1')).toBe('PK')
    const docx = execFileSync('python', ['-c', `import sys, zipfile\nprint(zipfile.ZipFile(sys.argv[1]).read("word/document.xml").decode("utf8"))`, target]).toString()
    expect(docx).toContain('Heading1')
    expect(docx).toContain('Annual Report')
    expect(docx).toContain('Revenue rose and costs fell during the period.')
    expect(problems).toEqual([])
  } finally {
    await app.close()
    rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 })
  }
})
