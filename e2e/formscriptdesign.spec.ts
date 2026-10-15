import { _electron as electron, expect, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(__dirname, '..')

/** The JavaScript in each field's additional actions, read with PyMuPDF. */
function scripts(path: string): Record<string, string[]> {
  const py = `
import sys, json, pymupdf
d = pymupdf.open(sys.argv[1])
out = {}
for w in d[0].widgets():
    js = []
    # pdf-lib makes the field a parent of the widget: the scripts are on the field.
    t, parent = d.xref_get_key(w.xref, "Parent")
    field = int(parent.split()[0]) if t == "xref" else w.xref
    for key in ("F", "K", "V", "C"):
        t, v = d.xref_get_key(field, "AA/" + key + "/JS")
        if t != "null":
            js.append(key)
    out[w.field_name] = js
print(json.dumps(out))
`
  return JSON.parse(execFileSync('python', ['-c', py, path]).toString())
}

test('form scripts: set up a calculation in the field dialog and use it', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'openpdf-e2e-'))
  const pdfPath = join(dir, 'quote.pdf')
  execFileSync('python', ['-c', 'import sys, pymupdf\nd = pymupdf.open()\nd.new_page(width=595, height=842)\nd.save(sys.argv[1])', pdfPath])
  const app = await electron.launch({ args: ['.', pdfPath], cwd: root, env: { ...process.env, OPENPDF_E2E: '1', OPENPDF_E2E_USERDATA: join(dir, 'ud'), OPENPDF_E2E_DISCARD: '1' } })
  try {
    const win = await app.firstWindow()
    const problems: string[] = []
    win.on('pageerror', (e) => problems.push(e.message))
    await expect(win.locator('.page')).toHaveCount(1)
    await win.getByRole('tab', { name: 'Forms', exact: true }).click()
    const z = Number((await win.locator('.zoom-now').textContent())!.replace('%', '')) / 100
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
    const addText = async (name: string, y: number, setup: (d: ReturnType<typeof win.getByRole>) => Promise<void>) => {
      await press('Text')
      await drag(150, y, 300, y + 22)
      const d = win.getByRole('dialog', { name: 'New text field' })
      await d.getByRole('textbox', { name: 'Field name' }).fill(name)
      await setup(d)
      await d.getByRole('button', { name: 'Add field' }).click()
      await expect(win.getByRole('button', { name: `Field ${name}` })).toBeVisible()
    }

    await addText('qty', 100, async (d) => {
      await d.getByRole('combobox', { name: 'Format' }).selectOption('number')
      await d.getByRole('spinbutton', { name: 'Decimal places' }).fill('0')
    })
    await addText('price', 140, async (d) => {
      await d.getByRole('combobox', { name: 'Format' }).selectOption('number')
      await d.getByRole('textbox', { name: 'Currency symbol' }).fill('$')
      await d.getByRole('combobox', { name: 'Check' }).selectOption('range')
      await d.getByRole('spinbutton', { name: 'Range from' }).fill('0')
    })
    await addText('cost', 180, async (d) => {
      await d.getByRole('combobox', { name: 'Format' }).selectOption('number')
      await d.getByRole('textbox', { name: 'Currency symbol' }).fill('$')
      await d.getByRole('combobox', { name: 'Calculate' }).selectOption('PRD')
      const group = d.getByRole('group', { name: 'Fields to calculate from' })
      await group.getByRole('checkbox', { name: 'qty' }).check()
      await group.getByRole('checkbox', { name: 'price' }).check()
    })

    // Back to filling in: type a quantity and a price; the cost follows, formatted.
    await win.getByRole('button', { name: 'Edit fields' }).click()
    await expect(win.getByRole('textbox', { name: 'qty' })).toBeVisible()
    await win.getByRole('textbox', { name: 'qty' }).fill('3')
    await win.getByRole('textbox', { name: 'qty' }).press('Tab')
    await win.getByRole('textbox', { name: 'price' }).fill('4.5')
    await win.getByRole('textbox', { name: 'price' }).press('Tab')
    await expect(win.getByRole('textbox', { name: 'price' })).toHaveValue('$4.50')
    await expect(win.getByRole('textbox', { name: 'cost' })).toHaveValue('$13.50')
    // A negative price is refused by the range check.
    await win.getByRole('textbox', { name: 'price' }).focus()
    await win.getByRole('textbox', { name: 'price' }).fill('-1')
    await win.getByRole('textbox', { name: 'price' }).press('Tab')
    await expect(win.getByText('The value must be at least 0.')).toBeVisible()
    await expect(win.getByRole('textbox', { name: 'price' })).toHaveValue('$4.50')

    // The dialog shows the choices again when the field is opened.
    await win.getByRole('button', { name: 'Edit fields' }).click()
    await win.getByRole('button', { name: 'Field cost' }).dblclick()
    const props = win.getByRole('dialog', { name: 'Text field properties' })
    await expect(props.getByRole('combobox', { name: 'Calculate' })).toHaveValue('PRD')
    await expect(props.getByRole('checkbox', { name: 'qty' })).toBeChecked()
    await expect(props.getByRole('combobox', { name: 'Format' })).toHaveValue('number')
    await props.getByRole('button', { name: 'Apply' }).click()
    await expect(win.getByText('Field updated')).toBeVisible()

    await win.keyboard.press('Control+s')
    await expect(win.locator('.tab-dirty')).toHaveCount(0)
    const js = scripts(pdfPath)
    expect(js.qty).toEqual(['F', 'K'])
    expect(js.price).toEqual(['F', 'K', 'V'])
    expect(js.cost).toEqual(['F', 'K', 'C'])
    expect(problems).toEqual([])
  } finally {
    await app.close()
    rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 })
  }
})
