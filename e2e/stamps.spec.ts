import { _electron as electron, expect, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(__dirname, '..')

test('dated text stamps and image stamps: picked, placed, saved, read back', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'openpdf-e2e-'))
  const pdfPath = join(dir, 'stamps.pdf')
  const png = join(dir, 'Site sign-off.png')
  execFileSync('python', [join(root, 'scripts', 'make-test-pdf.py'), pdfPath])
  execFileSync('python', [
    '-c',
    'import sys, pymupdf\np = pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, 120, 60), 0)\np.clear_with(90)\np.save(sys.argv[1])',
    png
  ])
  const userData = join(dir, 'ud')
  const launch = () =>
    electron.launch({
      args: ['.', pdfPath],
      cwd: root,
      env: { ...process.env, OPENPDF_E2E: '1', OPENPDF_E2E_USERDATA: userData, OPENPDF_E2E_IMAGES: png, OPENPDF_E2E_DISCARD: '1' }
    })
  let app = await launch()
  try {
    let win = await app.firstWindow()
    const problems: string[] = []
    win.on('pageerror', (e) => problems.push(e.message))
    await expect(win.locator('.page')).toHaveCount(6)
    await win.getByRole('tab', { name: 'Comment', exact: true }).click()
    const p = (await win.locator('.page').first().boundingBox())!

    // A dated APPROVED stamp.
    await win.getByRole('button', { name: 'Choose stamp' }).click()
    const picker = win.getByRole('dialog', { name: 'Stamps' })
    await picker.getByRole('checkbox', { name: /name, date and time/ }).check()
    await picker.getByRole('button', { name: 'APPROVED', exact: true }).click()
    await win.mouse.click(p.x + 200, p.y + 450)
    await expect(win.locator('.annot-svg text').filter({ hasText: /\d\d\/\d\d\/\d{4} \d\d:\d\d/ })).toHaveCount(1)

    // Add an image to the library and stamp it.
    await win.getByRole('button', { name: 'Choose stamp' }).click()
    await picker.getByRole('button', { name: 'Add image…' }).click()
    await expect(picker.getByRole('button', { name: 'Image stamp Site sign-off' })).toBeVisible()
    await picker.getByRole('button', { name: 'Image stamp Site sign-off' }).click()
    await win.mouse.click(p.x + 450, p.y + 450)
    await expect(win.locator('.annot-svg image')).toHaveCount(1)
    await win.screenshot({ path: test.info().outputPath('stamps.png') })

    await win.keyboard.press('Control+s')
    await expect(win.locator('.tab-dirty')).toHaveCount(0)
    const py = `
import sys, json, pymupdf
d = pymupdf.open(sys.argv[1])
out = []
for a in d[0].annots():
    ap = d.xref_get_key(a.xref, "AP/N")
    xo = d.xref_get_key(int(ap[1].split()[0]), "Resources/XObject") if ap[0] == "xref" else ("null", "")
    out.append({"type": a.type[1], "content": a.info.get("content", ""), "image": xo[0] != "null"})
print(json.dumps(out))
`
    const saved: { type: string; content: string; image: boolean }[] = JSON.parse(execFileSync('python', ['-c', py, pdfPath]).toString())
    expect(saved.map((s) => s.type)).toEqual(['Stamp', 'Stamp'])
    expect(saved[0].content).toMatch(/^APPROVED\n.*\d\d\/\d\d\/\d{4} \d\d:\d\d$/)
    expect(saved[1].image).toBe(true)
    expect(problems).toEqual([])
    await app.close()

    // Reopen: the dated stamp is editable with its second line; the image stamp library survives.
    app = await launch()
    win = await app.firstWindow()
    await expect(win.locator('.page')).toHaveCount(6)
    await expect(win.locator('.annot-svg text').filter({ hasText: /\d\d\/\d\d\/\d{4}/ })).toHaveCount(1)
    await win.getByRole('tab', { name: 'Comment', exact: true }).click()
    await win.getByRole('button', { name: 'Choose stamp' }).click()
    await expect(win.getByRole('dialog', { name: 'Stamps' }).getByRole('button', { name: 'Image stamp Site sign-off' })).toBeVisible()
  } finally {
    await app.close()
    rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 })
  }
})
