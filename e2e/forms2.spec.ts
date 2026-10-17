import { _electron as electron, expect, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(__dirname, '..')

type W = { name: string; page: number; rect: number[]; value: string; format: string }

const WIDGETS = `
import sys, json, pymupdf
d = pymupdf.open(sys.argv[1])
out = []
for i, p in enumerate(d):
    for w in p.widgets():
        # pdf-lib makes the field a parent of the widget: the format script is on the field.
        t, parent = d.xref_get_key(w.xref, "Parent")
        field = int(parent.split()[0]) if t == "xref" else w.xref
        t, js = d.xref_get_key(field, "AA/F/JS")
        if t == "null":
            js = ""
        elif js.startswith("<"):
            js = bytes.fromhex(js.strip("<>")).decode("utf-16")
        out.append({"name": w.field_name, "page": i, "rect": [round(v) for v in w.rect], "value": str(w.field_value or ""), "format": js})
print(json.dumps(out))
`

const widgets = (path: string): W[] => JSON.parse(execFileSync('python', ['-c', WIDGETS, path]).toString())

const BLANK = `
import sys, pymupdf
d = pymupdf.open()
for i in range(int(sys.argv[2])):
    d.new_page(width=595, height=842)
d.save(sys.argv[1])
`

async function launch(pdf: string, dir: string, env: Record<string, string> = {}) {
  const app = await electron.launch({ args: ['.', pdf], cwd: root, env: { ...process.env, OPENPDF_E2E: '1', OPENPDF_E2E_USERDATA: join(dir, 'ud'), OPENPDF_E2E_DISCARD: '1', ...env } })
  const win = await app.firstWindow()
  const problems: string[] = []
  win.on('pageerror', (e) => problems.push(e.message))
  return { app, win, problems }
}

const cleanup = (dir: string) => rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 })

test('date field with a picker, align and match size, duplicate to pages, Fields pane, document JavaScript', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'openpdf-e2e-'))
  const pdf = join(dir, 'forms2.pdf')
  execFileSync('python', ['-c', BLANK, pdf, '3'])
  const { app, win, problems } = await launch(pdf, dir)
  try {
    await expect(win.locator('.page')).toHaveCount(3)
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
    const added = async () => {
      await expect(win.getByText('Field added')).toBeVisible()
      await expect(win.locator('.form-layer.design')).toHaveCount(1)
    }

    // A date field: a text field that already has the date format chosen.
    await press('Date')
    await drag(100, 100, 300, 130)
    let d = win.getByRole('dialog', { name: 'New date field' })
    await expect(d.getByRole('combobox', { name: 'Format' })).toHaveValue('date')
    await d.getByRole('textbox', { name: 'Field name' }).fill('due')
    await d.getByRole('button', { name: 'Add field' }).click()
    await added()

    // Two text fields to arrange.
    for (const [name, box] of [['a', [100, 200, 250, 225]], ['b', [180, 260, 380, 300]]] as const) {
      await press('Text')
      await drag(box[0], box[1], box[2], box[3])
      d = win.getByRole('dialog', { name: 'New text field' })
      await d.getByRole('textbox', { name: 'Field name' }).fill(name)
      await d.getByRole('button', { name: 'Add field' }).click()
      await added()
    }

    // Select both with Shift, align left, then make b as wide as a (the first selected).
    await win.getByRole('button', { name: 'Field a', exact: true }).click()
    await win.getByRole('button', { name: 'Field b', exact: true }).click({ modifiers: ['Shift'] })
    await win.getByRole('button', { name: 'Left', exact: true }).click()
    await expect(win.getByText(/field.* arranged/)).toBeVisible()
    await win.getByRole('button', { name: 'Field a', exact: true }).click()
    await win.getByRole('button', { name: 'Field b', exact: true }).click({ modifiers: ['Shift'] })
    await win.getByRole('button', { name: 'Same width', exact: true }).click()
    await expect(win.getByText(/field.* arranged/)).toBeVisible()

    // Duplicate the date field onto the other pages.
    await win.getByRole('button', { name: 'Field due', exact: true }).click()
    await win.getByRole('button', { name: 'Duplicate', exact: true }).click()
    d = win.getByRole('dialog', { name: 'Duplicate field' })
    await expect(d.getByRole('textbox', { name: 'Pages to copy to' })).toHaveValue('1-3')
    await d.getByRole('button', { name: 'Duplicate', exact: true }).click()
    await expect(win.getByText('2 copies added')).toBeVisible()

    // The Fields pane lists every field with its type and page; rename one, delete another.
    await win.getByRole('button', { name: 'Fields pane', exact: true }).click()
    const pane = win.locator('.fields-pane')
    await expect(pane.locator('.fields-row')).toHaveCount(5)
    await expect(pane.locator('.fields-row', { hasText: 'due_2' })).toContainText('Date, page 2')
    await expect(pane.locator('.fields-row', { hasText: 'due_3' })).toContainText('Date, page 3')
    await pane.locator('.fields-row', { hasText: /^a/ }).first().dblclick()
    await pane.getByRole('textbox', { name: 'New name for a' }).fill('b')
    await pane.getByRole('textbox', { name: 'New name for a' }).press('Enter')
    await expect(pane.getByRole('alert')).toContainText('There is already a field called "b"')
    await pane.getByRole('textbox', { name: 'New name for a' }).fill('alpha')
    await pane.getByRole('textbox', { name: 'New name for a' }).press('Enter')
    await expect(win.getByText('Field updated')).toBeVisible()
    await pane.locator('.fields-row', { hasText: 'due_3' }).click()
    await pane.getByRole('button', { name: 'Delete', exact: true }).click()
    await expect(win.getByText('Field deleted')).toBeVisible()
    await expect(pane.locator('.fields-row')).toHaveCount(4)

    // Fill the date with the picker's value: it is written in the field's own form.
    await win.getByRole('button', { name: 'Edit fields' }).click()
    await expect(win.getByRole('button', { name: 'Pick a date for due', exact: true })).toBeVisible()
    await win.getByLabel('Date for due', { exact: true }).fill('2026-10-05')
    await expect(win.getByRole('textbox', { name: 'due', exact: true })).toHaveValue('05/10/2026')

    // Document JavaScript: write, run and save a function.
    await win.getByRole('button', { name: 'Document JavaScript' }).click()
    d = win.getByRole('dialog', { name: 'Document JavaScript' })
    await d.getByRole('textbox', { name: 'Script code' }).fill('function isPositive(n) { return n > 0; }\nconsole.println("ok " + isPositive(3));')
    await d.getByRole('button', { name: 'Run', exact: true }).click()
    await expect(d.getByLabel('Script output')).toContainText('ok true')
    await d.getByRole('button', { name: 'Save scripts' }).click()
    await expect(win.getByText('Document JavaScript saved')).toBeVisible()

    await win.keyboard.press('Control+s')
    await expect(win.locator('.tab-dirty')).toHaveCount(0)
    const out = widgets(pdf)
    const by = (n: string) => out.find((w) => w.name === n)!
    expect(out.map((w) => `${w.name}@${w.page}`).sort()).toEqual(['alpha@0', 'b@0', 'due@0', 'due_2@1'])
    expect(by('due').value).toBe('05/10/2026')
    expect(by('due').format).toContain('AFDate_FormatEx("dd/mm/yyyy")')
    expect(by('due_2').format).toContain('AFDate_FormatEx("dd/mm/yyyy")')
    expect(by('due_2').rect).toEqual(by('due').rect)
    expect(by('alpha').rect[0]).toBe(by('b').rect[0])
    expect(by('alpha').rect[2] - by('alpha').rect[0]).toBe(by('b').rect[2] - by('b').rect[0])
    const cat = execFileSync('python', ['-c', 'import sys, pymupdf\nd = pymupdf.open(sys.argv[1])\nprint(d.xref_get_key(d.pdf_catalog(), "Names"))', pdf]).toString()
    expect(cat).toContain('JavaScript')

    // The script comes back when the dialog is opened again.
    await win.getByRole('button', { name: 'Document JavaScript' }).click()
    await expect(win.getByRole('dialog', { name: 'Document JavaScript' }).getByRole('textbox', { name: 'Script code' })).toHaveValue(/function isPositive/)
    expect(problems).toEqual([])
  } finally {
    await app.close()
    cleanup(dir)
  }
})

test('a Submit button sends the form to a web address in the chosen format', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'openpdf-e2e-'))
  const pdf = join(dir, 'submit.pdf')
  execFileSync('python', ['-c', BLANK, pdf, '1'])
  const received: { type: string; body: string }[] = []
  const server = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => {
      received.push({ type: String(req.headers['content-type']), body: Buffer.concat(chunks).toString('utf8') })
      res.writeHead(200, { 'Content-Type': 'text/plain' })
      res.end('thanks')
    })
  })
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok))
  const port = (server.address() as { port: number }).port
  const { app, win, problems } = await launch(pdf, dir, { OPENPDF_E2E_SUBMIT: '1' })
  try {
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
    await press('Text')
    await drag(100, 100, 300, 130)
    let d = win.getByRole('dialog', { name: 'New text field' })
    await d.getByRole('textbox', { name: 'Field name' }).fill('client')
    await d.getByRole('checkbox', { name: 'Required' }).check()
    await d.getByRole('button', { name: 'Add field' }).click()
    await expect(win.getByText('Field added')).toBeVisible()
    await press('Button')
    await drag(100, 200, 200, 230)
    d = win.getByRole('dialog', { name: 'New button' })
    await d.getByRole('textbox', { name: 'Field name' }).fill('send')
    await d.getByRole('textbox', { name: 'Caption' }).fill('Send')
    await d.getByRole('combobox', { name: 'When pressed' }).selectOption('submit')
    await d.getByRole('textbox', { name: 'Web address' }).fill(`http://127.0.0.1:${port}/form`)
    await d.getByRole('combobox', { name: 'Send as' }).selectOption('html')
    await d.getByRole('button', { name: 'Add field' }).click()
    await expect(win.getByText('Field added')).toBeVisible()

    await win.getByRole('button', { name: 'Edit fields' }).click()
    // Required and empty: nothing is sent.
    await win.getByRole('button', { name: 'send', exact: true }).click()
    await expect(win.getByText('Fill in the required fields first: client.')).toBeVisible()
    expect(received).toEqual([])
    await win.getByRole('textbox', { name: 'client' }).fill('Acme & Sons')
    await win.getByRole('textbox', { name: 'client' }).blur()
    await win.getByRole('button', { name: 'send', exact: true }).click()
    await expect(win.getByText('The form was sent (the server answered 200).')).toBeVisible()
    expect(received).toHaveLength(1)
    expect(received[0].type).toMatch(/^application\/x-www-form-urlencoded/)
    expect(received[0].body).toBe('client=Acme+%26+Sons')
    expect(problems).toEqual([])
  } finally {
    await app.close()
    server.close()
    cleanup(dir)
  }
})

test('populate from a CSV: one filled PDF per row, named from a column', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'openpdf-e2e-'))
  const pdf = join(dir, 'template.pdf')
  const csv = join(dir, 'people.csv')
  const outDir = join(dir, 'out')
  mkdirSync(outDir)
  execFileSync('python', [
    '-c',
    `
import sys, pymupdf
d = pymupdf.open()
p = d.new_page(width=595, height=842)
for i, name in enumerate(["name", "site"]):
    w = pymupdf.Widget()
    w.field_name = name
    w.field_type = pymupdf.PDF_WIDGET_TYPE_TEXT
    w.rect = pymupdf.Rect(100, 100 + 40 * i, 300, 125 + 40 * i)
    p.add_widget(w)
d.save(sys.argv[1])
`,
    pdf
  ])
  writeFileSync(csv, 'file,name,site,extra\r\nA1,Ada,North,x\r\nB2,"Ben, Jr",South,y\r\nA1,Cy,East,z\r\n')
  const { app, win, problems } = await launch(pdf, dir, { OPENPDF_E2E_PICK: csv, OPENPDF_E2E_DIR: outDir })
  try {
    await expect(win.locator('.page')).toHaveCount(1)
    await win.getByRole('tab', { name: 'Forms', exact: true }).click()
    await win.getByRole('button', { name: 'Populate from CSV' }).click()
    const d = win.getByRole('dialog', { name: 'Populate from CSV' })
    await d.getByRole('button', { name: 'Choose CSV…' }).click()
    await expect(d.getByText('3 rows. 2 columns match fields.')).toBeVisible()
    await expect(d.getByText('Not used: file, extra.')).toBeVisible()
    await expect(d.getByRole('combobox', { name: 'File name column' })).toHaveValue('file')
    await expect(d.getByText('Files: A1.pdf, B2.pdf, A1 (2).pdf')).toBeVisible()
    await d.getByRole('button', { name: 'Create PDFs' }).click()
    await expect(win.getByText(/Saved 3 PDFs to/)).toBeVisible()
    expect(readdirSync(outDir).sort()).toEqual(['A1 (2).pdf', 'A1.pdf', 'B2.pdf'])
    const value = (file: string, name: string) => widgets(join(outDir, file)).find((w) => w.name === name)?.value
    expect(value('A1.pdf', 'name')).toBe('Ada')
    expect(value('A1.pdf', 'site')).toBe('North')
    expect(value('B2.pdf', 'name')).toBe('Ben, Jr')
    expect(value('A1 (2).pdf', 'site')).toBe('East')
    // The template itself is not changed.
    expect(widgets(pdf).map((w) => w.value)).toEqual(['', ''])
    expect(problems).toEqual([])
  } finally {
    await app.close()
    cleanup(dir)
  }
})

test('an image field lets the filler choose a picture, which fills the button and survives saving', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'openpdf-e2e-'))
  const pdf = join(dir, 'photo.pdf')
  const png = join(dir, 'green.png')
  execFileSync('python', ['-c', BLANK, pdf, '1'])
  execFileSync('python', ['-c', 'import sys, pymupdf\npm = pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, 40, 40))\npm.set_rect(pm.irect, (30, 200, 30))\npm.save(sys.argv[1])', png])
  const { app, win, problems } = await launch(pdf, dir, { OPENPDF_E2E_PICK: png })
  try {
    await expect(win.locator('.page')).toHaveCount(1)
    await win.getByRole('tab', { name: 'Forms', exact: true }).click()
    const z = Number((await win.locator('.zoom-now').textContent())!.replace('%', '')) / 100
    await win.getByRole('button', { name: 'Image', exact: true }).focus()
    await win.keyboard.press('Enter')
    const pb = (await win.locator('.page').first().boundingBox())!
    await win.mouse.move(pb.x + 100 * z, pb.y + 100 * z)
    await win.mouse.down()
    await win.mouse.move(pb.x + 300 * z, pb.y + 200 * z, { steps: 5 })
    await win.mouse.up()
    const d = win.getByRole('dialog', { name: 'New image field' })
    await expect(d.getByRole('textbox', { name: 'Caption' })).toHaveValue('Click to add a picture')
    await d.getByRole('textbox', { name: 'Field name' }).fill('photo')
    await d.getByRole('button', { name: 'Add field' }).click()
    await expect(win.getByText('Field added')).toBeVisible()
    await win.getByRole('button', { name: 'Edit fields' }).click()
    await win.getByRole('button', { name: 'photo', exact: true }).click()
    await expect(win.getByText('Picture added. Save to keep it.')).toBeVisible()
    await expect(win.getByRole('button', { name: 'photo', exact: true })).toHaveCSS('background-image', /data:image\/png/)
    await win.keyboard.press('Control+s')
    await expect(win.locator('.tab-dirty')).toHaveCount(0)
    // The centre of the box shows the picture in the saved file.
    const colour = JSON.parse(execFileSync('python', ['-c', 'import sys, json, pymupdf\nd = pymupdf.open(sys.argv[1])\npm = d[0].get_pixmap()\nprint(json.dumps(list(pm.pixel(200, 150))))', pdf]).toString()) as number[]
    expect(colour).toEqual([30, 200, 30])
    expect(problems).toEqual([])
  } finally {
    await app.close()
  }
  // Opened again, the field still shows its picture.
  const again = await launch(pdf, dir, { OPENPDF_E2E_PICK: png })
  try {
    await expect(again.win.locator('.page')).toHaveCount(1)
    await expect(again.win.getByRole('button', { name: 'photo', exact: true })).toHaveCSS('background-image', /data:image\/png/)
  } finally {
    await again.app.close()
    cleanup(dir)
  }
})
