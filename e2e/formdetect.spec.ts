import { _electron as electron, expect, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(__dirname, '..')

const MAKE = `
import sys, pymupdf
doc = pymupdf.open()
p = doc.new_page(width=595, height=842)
p.insert_text((72, 70), "Site visit register", fontsize=18)
p.draw_line((72, 80), (523, 80), width=1)
p.insert_text((72, 140), "Full name:", fontsize=11)
p.insert_text((140, 140), "_____________________", fontsize=11)
p.insert_text((72, 200), "Phone", fontsize=11)
p.draw_line((130, 202), (280, 202), width=0.8)
p.insert_text((72, 262), "Address", fontsize=11)
p.draw_rect(pymupdf.Rect(130, 246, 400, 270), width=0.8)
p.draw_rect(pymupdf.Rect(72, 311, 83, 322), width=0.8)
p.insert_text((92, 320), "I have read the induction", fontsize=11)
doc.save(sys.argv[1])
`

function widgets(path: string): { name: string; type: string; rect: number[]; label: string }[] {
  const py = `
import sys, json, pymupdf
d = pymupdf.open(sys.argv[1])
print(json.dumps([{"name": w.field_name, "type": w.field_type_string, "rect": [round(v) for v in w.rect], "label": w.field_label or ""} for w in d[0].widgets()]))
`
  return JSON.parse(execFileSync('python', ['-c', py, path]).toString())
}

test('detect fields: blanks, rules, boxes and squares become fields named from their labels', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'openpdf-e2e-'))
  const pdfPath = join(dir, 'register.pdf')
  execFileSync('python', ['-c', MAKE, pdfPath])
  const app = await electron.launch({ args: ['.', pdfPath], cwd: root, env: { ...process.env, OPENPDF_E2E: '1', OPENPDF_E2E_USERDATA: join(dir, 'ud'), OPENPDF_E2E_DISCARD: '1' } })
  try {
    const win = await app.firstWindow()
    const problems: string[] = []
    win.on('pageerror', (e) => problems.push(e.message))
    await expect(win.locator('.page')).toHaveCount(1)
    await win.getByRole('tab', { name: 'Forms', exact: true }).click()
    await win.getByRole('button', { name: 'Detect fields' }).focus()
    await win.keyboard.press('Enter')
    const dialog = win.getByRole('dialog', { name: 'Detected fields' })
    await expect(dialog).toBeVisible({ timeout: 20000 })
    await expect(dialog.getByText('Found 4 places for a field')).toBeVisible()
    // Named from their labels; the unlabelled header rule is not offered.
    for (const [i, n] of ['Full_name', 'Phone', 'Address', 'I_have_read_the_induction'].entries()) await expect(dialog.getByRole('textbox', { name: `Name of field ${i + 1}` })).toHaveValue(n)
    // Untick nothing; rename one.
    await dialog.getByRole('textbox', { name: 'Name of field 4' }).fill('read_induction')
    await dialog.getByRole('button', { name: 'Create 4 fields' }).click()
    await expect(win.getByText('4 fields added')).toBeVisible()
    await win.keyboard.press('Control+s')
    await expect(win.locator('.tab-dirty')).toHaveCount(0)

    const out = widgets(pdfPath)
    expect(out.map((w) => [w.name, w.type])).toEqual([
      ['Full_name', 'Text'],
      ['Phone', 'Text'],
      ['Address', 'Text'],
      ['read_induction', 'CheckBox']
    ])
    // The blank's field sits over the underscores, the rule's field just above the rule, the box's field is the box.
    expect(out[0].rect[0]).toBeGreaterThanOrEqual(138)
    expect(out[0].rect[0]).toBeLessThanOrEqual(142)
    expect(out[1].rect[3]).toBeLessThanOrEqual(204)
    expect(out[1].rect[3]).toBeGreaterThanOrEqual(200)
    expect(out[2].rect).toEqual([130, 246, 400, 270])
    expect(out[3].rect).toEqual([72, 311, 83, 322])
    // The label became the tooltip.
    expect(out[0].label).toBe('Full name')

    // A second run finds nothing new: the fields are there already.
    await win.getByRole('button', { name: 'Detect fields' }).focus()
    await win.keyboard.press('Enter')
    await expect(win.getByRole('dialog', { name: 'Detected fields' }).getByText(/No blanks, rules, boxes or check squares/)).toBeVisible({ timeout: 20000 })
    expect(problems).toEqual([])
  } finally {
    await app.close()
    rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 })
  }
})
