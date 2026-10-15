import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(__dirname, '..')

function setup(): { dir: string; base: string; png1: string; png2: string; gif: string } {
  const dir = mkdtempSync(join(tmpdir(), 'openpdf-e2e-'))
  const base = join(dir, 'base.pdf')
  const png1 = join(dir, 'one.png')
  const png2 = join(dir, 'two.png')
  const gif = join(dir, 'three.gif')
  execFileSync('python', [
    '-c',
    `import sys, pymupdf
d = pymupdf.open()
d.new_page(width=300, height=300).insert_text((50, 100), "Base document", fontsize=14)
d.save(sys.argv[1])
for path, w, h, col in ((sys.argv[2], 200, 100, (200, 30, 30)), (sys.argv[3], 100, 200, (30, 160, 30))):
    pix = pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, w, h), False)
    pix.set_rect(pix.irect, col)
    pix.save(path)
from PIL import Image
Image.new("RGB", (120, 90), (30, 30, 200)).save(sys.argv[4])`,
    base,
    png1,
    png2,
    gif
  ])
  return { dir, base, png1, png2, gif }
}

async function launch(dir: string, args: string[], env: Record<string, string>): Promise<{ app: ElectronApplication; win: Page; problems: string[] }> {
  const app = await electron.launch({ args: ['.', ...args], cwd: root, env: { ...process.env, OPENPDF_E2E: '1', OPENPDF_E2E_USERDATA: join(dir, 'ud'), OPENPDF_E2E_DISCARD: '1', ...env } })
  const win = await app.firstWindow()
  const problems: string[] = []
  win.on('pageerror', (e) => problems.push(e.message))
  await expect(win.locator('.page')).toHaveCount(1)
  await win.getByRole('tab', { name: 'Convert', exact: true }).click()
  return { app, win, problems }
}

const done = (dir: string) => rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 })

test('pictures become pages of a new document, whatever their format', async () => {
  const f = setup()
  const { app, win, problems } = await launch(f.dir, [f.base], { OPENPDF_E2E_PICK: [f.png1, f.png2, f.gif].join('|') })
  try {
    await win.getByRole('button', { name: 'From pictures' }).click()
    const d = win.getByRole('dialog', { name: 'Create PDF from pictures' })
    await d.getByRole('combobox', { name: 'Page size' }).selectOption('a4')
    await d.getByRole('button', { name: 'Create' }).click()
    // A new tab opens, unsaved, with one page per picture.
    await expect(win.getByRole('tab', { name: /one\.pdf/ })).toBeVisible()
    await expect(win.locator('.page:visible')).toHaveCount(3)
    await expect(win.locator('.tab-dirty')).toHaveCount(1)
    expect(problems).toEqual([])
  } finally {
    await app.close()
    done(f.dir)
  }
})

test('a text file becomes a paginated document with its words in it', async () => {
  const f = setup()
  const txt = join(f.dir, 'notes.txt')
  writeFileSync(txt, Array.from({ length: 150 }, (_, i) => `Line ${i + 1}: the quick brown fox jumps over the lazy dog`).join('\n'))
  const { app, win, problems } = await launch(f.dir, [f.base], { OPENPDF_E2E_PICK: txt })
  try {
    await win.getByRole('button', { name: 'From text' }).click()
    await win.getByRole('dialog', { name: 'Create PDF from text' }).getByRole('button', { name: 'Create' }).click()
    await expect(win.getByRole('tab', { name: /notes\.pdf/ })).toBeVisible()
    await expect.poll(async () => win.locator('.page').count()).toBeGreaterThan(1)
    await win.keyboard.press('Control+f')
    const find = win.getByRole('searchbox', { name: 'Find in document' })
    await find.fill('lazy dog')
    await find.press('Enter')
    await expect(win.locator('.search-status')).toHaveText(/of 150/)
    expect(problems).toEqual([])
  } finally {
    await app.close()
    done(f.dir)
  }
})

test('a saved web page is printed to a PDF without running its scripts or loading from the network', async () => {
  const f = setup()
  mkdirSync(join(f.dir, 'site'))
  const html = join(f.dir, 'site', 'page.html')
  writeFileSync(html, '<html><body><h1>Quarterly summary</h1><p>Plain paragraph.</p><script>document.body.innerHTML = "SCRIPT RAN"</script><img src="http://127.0.0.1:9/never.png"></body></html>')
  const { app, win, problems } = await launch(f.dir, [f.base], { OPENPDF_E2E_PICK: html })
  try {
    await win.getByRole('button', { name: 'From web page' }).click()
    await expect(win.getByRole('tab', { name: /page\.pdf/ })).toBeVisible()
    await win.keyboard.press('Control+f')
    const find = win.getByRole('searchbox', { name: 'Find in document' })
    await find.fill('Quarterly summary')
    await find.press('Enter')
    await expect(win.locator('.search-status')).toHaveText(/1 of 1/)
    await find.fill('SCRIPT RAN')
    await expect(win.getByText('No matches').or(win.locator('.search-status'))).not.toHaveText(/of 1/)
    expect(problems).toEqual([])
  } finally {
    await app.close()
    done(f.dir)
  }
})

test('the clipboard picture becomes a document, and an Office file says what is missing when LibreOffice is not installed', async () => {
  const f = setup()
  const { app, win, problems } = await launch(f.dir, [f.base], { OPENPDF_E2E_CLIPIMG: f.png1, OPENPDF_E2E_PICK: join(f.dir, 'report.docx') })
  try {
    await win.getByRole('button', { name: 'From clipboard' }).click()
    await expect(win.getByRole('tab', { name: /Clipboard\.pdf/ })).toBeVisible()
    await expect(win.locator('.page:visible')).toHaveCount(1)
    // Back to the first document, whose Convert tab is still showing.
    await win.getByRole('tab', { name: /base\.pdf/ }).click()

    const installed = await win.evaluate(() => window.openpdf.officeAvailable())
    if (!installed) {
      writeFileSync(join(f.dir, 'report.docx'), 'not really a document')
      await win.getByRole('button', { name: 'From Office file' }).click()
      await expect(win.getByRole('alert')).toContainText('LibreOffice is not installed')
    }
    expect(problems).toEqual([])
  } finally {
    await app.close()
    done(f.dir)
  }
})
