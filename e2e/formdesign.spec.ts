import { _electron as electron, expect, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(__dirname, '..')

type W = { name: string; type: string; rect: number[]; flags: number; label: string; values: string[] }

/** The widgets of page 1 with their kind, box, flags, tooltip and choices, read with PyMuPDF. */
function widgets(path: string): W[] {
  const py = `
import sys, json, pymupdf
d = pymupdf.open(sys.argv[1])
out = []
for w in d[0].widgets():
    out.append({"name": w.field_name, "type": w.field_type_string, "rect": [round(v) for v in w.rect], "flags": w.field_flags, "label": w.field_label or "", "values": [str(v) for v in (w.choice_values or [])]})
print(json.dumps(out))
`
  return JSON.parse(execFileSync('python', ['-c', py, path]).toString())
}

test('form designer: add every kind of field, edit and delete them, then fill the form', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'openpdf-e2e-'))
  const pdfPath = join(dir, 'design.pdf')
  execFileSync('python', ['-c', 'import sys, pymupdf\nd = pymupdf.open()\nd.new_page(width=595, height=842)\nd.save(sys.argv[1])', pdfPath])
  const app = await electron.launch({ args: ['.', pdfPath], cwd: root, env: { ...process.env, OPENPDF_E2E: '1', OPENPDF_E2E_USERDATA: join(dir, 'ud'), OPENPDF_E2E_DISCARD: '1' } })
  try {
    const win = await app.firstWindow()
    const problems: string[] = []
    win.on('pageerror', (e) => problems.push(e.message))
    await expect(win.locator('.page')).toHaveCount(1)
    await win.getByRole('tab', { name: 'Forms', exact: true }).click()
    const z = Number((await win.locator('.zoom-now').textContent())!.replace('%', '')) / 100
    // Measured fresh for every drag: notices move the page.
    const drag = async (x0: number, y0: number, x1: number, y1: number) => {
      const pb = (await win.locator('.page').first().boundingBox())!
      await win.mouse.move(pb.x + x0 * z, pb.y + y0 * z)
      await win.mouse.down()
      await win.mouse.move(pb.x + x1 * z, pb.y + y1 * z, { steps: 5 })
      await win.mouse.up()
    }
    const press = async (name: string) => {
      await win.getByRole('button', { name, exact: true }).focus()
      await win.keyboard.press('Enter')
    }
    const dialog = (name: string) => win.getByRole('dialog', { name })
    const added = async () => {
      await expect(win.getByText('Field added')).toBeVisible()
      await expect(win.locator('.imageedit-layer, .form-layer.design')).toBeVisible()
    }

    // A text field.
    await press('Text')
    await drag(100, 100, 300, 130)
    let d = dialog('New text field')
    await d.getByRole('textbox', { name: 'Field name' }).fill('client')
    await d.getByRole('textbox', { name: 'Tooltip' }).fill('Client name')
    await d.getByRole('checkbox', { name: 'Required' }).check()
    await d.getByRole('button', { name: 'Add field' }).click()
    await added()

    // A check box, ticked to begin with.
    await press('Check box')
    await drag(100, 160, 116, 176)
    d = dialog('New check box')
    await d.getByRole('textbox', { name: 'Field name' }).fill('agree')
    await d.getByRole('checkbox', { name: 'Ticked to begin with' }).check()
    await d.getByRole('button', { name: 'Add field' }).click()
    await added()

    // A drop-down with three options.
    await press('Drop-down')
    await drag(100, 200, 250, 225)
    d = dialog('New drop-down list')
    await d.getByRole('textbox', { name: 'Field name' }).fill('state')
    await d.getByRole('textbox', { name: 'Options' }).fill('QLD\nNSW\nVIC')
    await d.getByRole('combobox', { name: 'Selected to begin with' }).selectOption('NSW')
    await d.getByRole('button', { name: 'Add field' }).click()
    await added()

    // Two radio buttons in one group.
    await press('Radio')
    await drag(100, 250, 114, 264)
    d = dialog('New radio button')
    await d.getByRole('textbox', { name: 'Field name' }).fill('trade')
    await d.getByRole('textbox', { name: 'Choice name' }).fill('Civil')
    await d.getByRole('button', { name: 'Add field' }).click()
    await added()
    await press('Radio')
    await drag(200, 250, 214, 264)
    d = dialog('New radio button')
    await d.getByRole('textbox', { name: 'Field name' }).fill('trade')
    await d.getByRole('textbox', { name: 'Choice name' }).fill('Parks')
    await expect(d.getByText('Adds a button to the existing group')).toBeVisible()
    await d.getByRole('button', { name: 'Add field' }).click()
    await added()

    // A button that clears the form.
    await press('Button')
    await drag(100, 300, 180, 324)
    d = dialog('New button')
    await d.getByRole('textbox', { name: 'Field name' }).fill('clear')
    await d.getByRole('textbox', { name: 'Caption' }).fill('Clear')
    await d.getByRole('combobox', { name: 'When pressed' }).selectOption('reset')
    await d.getByRole('button', { name: 'Add field' }).click()
    await added()

    // Move the text field (design mode is on after adding): right 50, down 40.
    await expect(win.getByRole('button', { name: 'Field client' })).toBeVisible()
    const box = (await win.getByRole('button', { name: 'Field client' }).boundingBox())!
    await win.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await win.mouse.down()
    await win.mouse.move(box.x + box.width / 2 + 50 * z, box.y + box.height / 2 + 40 * z, { steps: 5 })
    await win.mouse.up()
    await expect(win.getByText('Field moved')).toBeVisible()

    // Rename the check box from its properties, then delete the drop-down with the Delete key.
    await expect(win.getByRole('button', { name: 'Field agree' })).toBeVisible()
    await win.getByRole('button', { name: 'Field agree' }).dblclick()
    d = dialog('Check box properties')
    await d.getByRole('textbox', { name: 'Field name' }).fill('accepted')
    await d.getByRole('button', { name: 'Apply' }).click()
    await expect(win.getByText('Field updated')).toBeVisible()
    await expect(win.getByRole('button', { name: 'Field accepted' })).toBeVisible()
    await win.getByRole('button', { name: 'Field state' }).click()
    await win.keyboard.press('Delete')
    await expect(win.getByText('Field deleted')).toBeVisible()

    await win.keyboard.press('Control+s')
    await expect(win.locator('.tab-dirty')).toHaveCount(0)
    const out = widgets(pdfPath)
    const by = (n: string) => out.filter((w) => w.name === n)
    expect(out.map((w) => w.name).sort()).toEqual(['accepted', 'clear', 'client', 'trade', 'trade'])
    expect(by('client')[0].type).toBe('Text')
    expect(by('client')[0].label).toBe('Client name')
    expect(by('client')[0].flags & 2).toBe(2) // required
    // Drawn at (100,100)-(300,130), moved by (50,40).
    const r = by('client')[0].rect
    expect(Math.abs(r[0] - 150)).toBeLessThanOrEqual(2)
    expect(Math.abs(r[1] - 140)).toBeLessThanOrEqual(2)
    expect(Math.abs(r[2] - r[0] - 200)).toBeLessThanOrEqual(2)
    expect(by('accepted')[0].type).toBe('CheckBox')
    expect(by('trade').map((w) => w.type)).toEqual(['RadioButton', 'RadioButton'])
    expect(by('clear')[0].type).toBe('Button')

    // Fill the form in, then press the button that clears it.
    await win.getByRole('button', { name: 'Edit fields' }).click()
    await expect(win.getByRole('textbox', { name: 'client' })).toBeVisible()
    await win.getByRole('textbox', { name: 'client' }).fill('Acme')
    await win.getByRole('checkbox', { name: 'accepted' }).check()
    await win.getByRole('radio', { name: 'trade: Civil' }).check()
    await win.getByRole('button', { name: 'clear', exact: true }).click()
    await expect(win.getByRole('textbox', { name: 'client' })).toHaveValue('')
    await expect(win.getByRole('checkbox', { name: 'accepted' })).not.toBeChecked()
    await expect(win.getByRole('radio', { name: 'trade: Civil' })).not.toBeChecked()
    expect(problems).toEqual([])
  } finally {
    await app.close()
    rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 })
  }
})
