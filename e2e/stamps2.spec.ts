import { _electron as electron, expect, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(__dirname, '..')

test('stamp palette: categories, search, a numbered dynamic stamp, rotation, recents and collection export', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'openpdf-e2e-'))
  const pdfPath = join(dir, 'stamps2.pdf')
  const collection = join(dir, 'collection.opstamps')
  execFileSync('python', [join(root, 'scripts', 'make-test-pdf.py'), pdfPath])
  const app = await electron.launch({
    args: ['.', pdfPath],
    cwd: root,
    env: { ...process.env, OPENPDF_E2E: '1', OPENPDF_E2E_USERDATA: join(dir, 'ud'), OPENPDF_E2E_SAVE_TEXT: collection, OPENPDF_E2E_DISCARD: '1' }
  })
  try {
    const win = await app.firstWindow()
    const problems: string[] = []
    win.on('pageerror', (e) => problems.push(e.message))
    await expect(win.locator('.page')).toHaveCount(6)
    await win.getByRole('tab', { name: 'Comment', exact: true }).click()
    const p = (await win.locator('.page').first().boundingBox())!
    const picker = win.getByRole('dialog', { name: 'Stamps' })

    // Categories and the construction set are there, with thumbnails drawn as the stamps appear.
    await win.getByRole('button', { name: 'Choose stamp' }).click()
    for (const c of ['Standard business', 'Construction', 'Sign here', 'My stamps']) await expect(picker.getByRole('heading', { name: c })).toBeVisible()
    await expect(picker.getByRole('button', { name: 'APPROVED FOR CONSTRUCTION', exact: true })).toBeVisible()
    await expect(picker.locator('svg.stamp-thumb').first()).toBeVisible()

    // Search narrows the palette.
    await picker.getByRole('searchbox', { name: 'Search stamps' }).fill('tender')
    await expect(picker.getByRole('button', { name: 'ISSUED FOR TENDER', exact: true })).toBeVisible()
    await expect(picker.getByRole('button', { name: 'APPROVED', exact: true })).toHaveCount(0)
    await picker.getByRole('searchbox', { name: 'Search stamps' }).fill('')

    // Make a numbered text stamp with a date line.
    await picker.getByRole('button', { name: 'Text stamp…' }).click()
    const dlg = win.getByRole('dialog', { name: 'New text stamp' })
    await dlg.getByRole('textbox', { name: 'Name', exact: true }).fill('RFI numbered')
    const wording = dlg.getByRole('textbox', { name: 'Wording' })
    await wording.fill('')
    await dlg.getByRole('button', { name: 'Number', exact: true }).click()
    await dlg.getByRole('textbox', { name: 'Second line' }).fill('{date:YYYY-MM-DD}')
    await dlg.getByRole('textbox', { name: 'Number prefix' }).fill('RFI-')
    await dlg.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(dlg).toHaveCount(0)

    const place = async (x: number, y: number) => {
      await win.getByRole('button', { name: 'Choose stamp' }).click()
      await picker.getByRole('button', { name: 'Stamp RFI numbered', exact: true }).click()
      await win.mouse.click(p.x + x, p.y + y)
    }
    await place(150, 400)
    await place(150, 480)
    // The third is turned and half transparent.
    await win.getByRole('button', { name: 'Choose stamp' }).click()
    await picker.getByRole('spinbutton', { name: 'Stamp rotation in degrees' }).fill('90')
    await picker.getByRole('slider', { name: 'Stamp opacity' }).fill('50')
    await picker.getByRole('button', { name: 'Stamp RFI numbered', exact: true }).click()
    await win.mouse.click(p.x + 400, p.y + 450)
    await expect(win.locator('.annot-svg g[transform^="rotate(90"]')).toHaveCount(1)

    // The stamp is now in the recently used list; export the collection.
    await win.getByRole('button', { name: 'Choose stamp' }).click()
    await expect(picker.getByRole('button', { name: 'Recently used: RFI numbered' })).toBeVisible()
    await picker.getByRole('button', { name: 'Export collection…' }).click()
    await expect.poll(() => (existsSync(collection) ? readFileSync(collection, 'utf8') : '')).toContain('openpdf-stamps')
    expect(readFileSync(collection, 'utf8')).toContain('RFI numbered')

    await win.keyboard.press('Escape')
    await win.keyboard.press('Control+s')
    await expect(win.locator('.tab-dirty')).toHaveCount(0)
    const py = `
import sys, json, pymupdf
d = pymupdf.open(sys.argv[1])
out = []
for a in d[0].annots():
    out.append({"type": a.type[1], "content": a.info.get("content", ""), "label": d.xref_get_key(a.xref, "OPLabel")[1], "info": d.xref_get_key(a.xref, "OPInfo")[1], "rot": d.xref_get_key(a.xref, "OPRot")[1], "w": a.rect.width, "h": a.rect.height, "opacity": a.opacity})
print(json.dumps(out))
`
    const saved: { type: string; content: string; label: string; info: string; rot: string; w: number; h: number; opacity: number }[] = JSON.parse(execFileSync('python', ['-c', py, pdfPath]).toString())
    expect(saved).toHaveLength(3)
    // Numbers count up with each use; fields are filled in; and, as ever, no /Contents.
    expect(saved.map((s) => s.label)).toEqual(['RFI-001', 'RFI-002', 'RFI-003'])
    for (const s of saved) {
      expect(s.content).toBe('')
      expect(s.info).toMatch(/[0-9]{4}-[0-9]{2}-[0-9]{2}/)
    }
    expect(saved[0].rot).toBe('null')
    expect(saved[2].rot).toContain('90')
    // Turned a quarter, the box is taller than wide, and it is half transparent.
    expect(saved[2].h).toBeGreaterThan(saved[2].w)
    expect(saved[2].opacity).toBeCloseTo(0.5, 1)
    expect(problems).toEqual([])
  } finally {
    await app.close()
    rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 })
  }
})
