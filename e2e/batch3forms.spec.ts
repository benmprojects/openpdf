import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(__dirname, '..')

async function launch(dir: string, args: string[], extra: Record<string, string> = {}): Promise<{ app: ElectronApplication; win: Page; problems: string[] }> {
  const app = await electron.launch({ args: ['.', ...args], cwd: root, env: { ...process.env, OPENPDF_E2E: '1', OPENPDF_E2E_USERDATA: join(dir, 'ud'), OPENPDF_E2E_DISCARD: '1', ...extra } })
  const win = await app.firstWindow()
  const problems: string[] = []
  win.on('pageerror', (e) => problems.push(e.message))
  return { app, win, problems }
}

const cleanup = (dir: string) => rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 })

type Box = { name: string; rect: number[]; flags: number; size: number }

/** The text fields of page 1 with their boxes, flags and text size, read with PyMuPDF. */
function fields(path: string): Box[] {
  const py = `
import sys, json, pymupdf
d = pymupdf.open(sys.argv[1])
print(json.dumps([{"name": w.field_name, "rect": [round(v) for v in w.rect], "flags": w.field_flags, "size": w.text_fontsize} for w in d[0].widgets()]))
`
  return JSON.parse(execFileSync('python', ['-c', py, path]).toString())
}

const THREE_FIELDS = `
import sys, pymupdf
d = pymupdf.open()
p = d.new_page(width=595, height=842)
for name, y in [("a", 100), ("b", 150), ("c", 400)]:
    w = pymupdf.Widget()
    w.field_type = pymupdf.PDF_WIDGET_TYPE_TEXT
    w.field_name = name
    w.rect = pymupdf.Rect(100, y, 250, y + 20)
    w.field_value = ""
    p.add_widget(w)
d.save(sys.argv[1])
`

test('forms: drag a box to select fields, move them as a group, and change what they share', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'openpdf-e2e-'))
  const pdf = join(dir, 'three.pdf')
  execFileSync('python', ['-c', THREE_FIELDS, pdf])
  const { app, win, problems } = await launch(dir, [pdf])
  try {
    await expect(win.locator('.page')).toHaveCount(1)
    await win.getByRole('tab', { name: 'Forms', exact: true }).click()
    await win.getByRole('button', { name: 'Edit fields', exact: true }).click()
    const z = Number((await win.locator('.zoom-now').textContent())!.replace('%', '')) / 100
    const drag = async (x0: number, y0: number, x1: number, y1: number, from?: { x: number; y: number }) => {
      const pb = (await win.locator('.page').first().boundingBox())!
      await win.mouse.move(pb.x + (from?.x ?? x0) * z, pb.y + (from?.y ?? y0) * z)
      await win.mouse.down()
      await win.mouse.move(pb.x + x1 * z, pb.y + y1 * z, { steps: 6 })
      await win.mouse.up()
    }

    // A box over the first two fields (and not the third) selects them.
    await drag(60, 80, 300, 200)
    await expect(win.getByRole('button', { name: 'Field a' })).toHaveAttribute('aria-pressed', 'true')
    await expect(win.getByRole('button', { name: 'Field b' })).toHaveAttribute('aria-pressed', 'true')
    await expect(win.getByRole('button', { name: 'Field c' })).toHaveAttribute('aria-pressed', 'false')

    // What they share is changed in one go.
    await win.getByRole('button', { name: 'Selection properties' }).click()
    const d = win.getByRole('dialog', { name: 'Properties of 2 fields' })
    await expect(d).toBeVisible()
    await d.getByRole('button', { name: 'Apply' }).click()
    await expect(d.getByRole('alert')).toContainText('at least one property')
    await d.getByRole('combobox', { name: 'Required' }).selectOption('yes')
    await d.getByRole('spinbutton', { name: 'Text size' }).fill('14')
    await d.getByRole('button', { name: 'Apply' }).click()
    await expect(win.getByText('2 fields updated')).toBeVisible()

    // Dragging one of the selected fields moves both: right 40, down 60.
    const a = (await win.getByRole('button', { name: 'Field a' }).boundingBox())!
    const pb = (await win.locator('.page').first().boundingBox())!
    const from = { x: (a.x + a.width / 2 - pb.x) / z, y: (a.y + a.height / 2 - pb.y) / z }
    await drag(0, 0, from.x + 40, from.y + 60, from)
    await expect(win.getByText('2 fields moved')).toBeVisible()

    await win.keyboard.press('Control+s')
    await expect(win.locator('.tab-dirty')).toHaveCount(0)
    const saved = Object.fromEntries(fields(pdf).map((f) => [f.name, f]))
    expect(saved.a.rect[0]).toBeGreaterThanOrEqual(139)
    expect(saved.a.rect[0]).toBeLessThanOrEqual(141)
    expect(saved.a.rect[1]).toBeGreaterThanOrEqual(159)
    expect(saved.a.rect[1]).toBeLessThanOrEqual(161)
    expect(saved.b.rect[0]).toBeGreaterThanOrEqual(139)
    expect(saved.b.rect[1]).toBeGreaterThanOrEqual(209)
    expect(saved.b.rect[1]).toBeLessThanOrEqual(211)
    // The third was not selected, so it stayed.
    expect(saved.c.rect.slice(0, 2)).toEqual([100, 400])
    // Required (bit 2) and 14 pt on the two, and not on the third.
    expect(saved.a.flags & 2).toBe(2)
    expect(saved.b.flags & 2).toBe(2)
    expect(saved.c.flags & 2).toBe(0)
    expect(saved.a.size).toBe(14)
    expect(saved.b.size).toBe(14)
    expect(problems).toEqual([])
  } finally {
    await app.close()
    cleanup(dir)
  }
})

test('forms: a picture in an image field can be cleared again', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'openpdf-e2e-'))
  const pdf = join(dir, 'photo.pdf')
  const png = join(dir, 'green.png')
  execFileSync('python', ['-c', 'import sys, pymupdf\nd = pymupdf.open()\nd.new_page(width=595, height=842)\nd.save(sys.argv[1])', pdf])
  execFileSync('python', ['-c', 'import sys, pymupdf\npm = pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, 40, 40))\npm.set_rect(pm.irect, (30, 200, 30))\npm.save(sys.argv[1])', png])
  const { app, win, problems } = await launch(dir, [pdf], { OPENPDF_E2E_PICK: png })
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
    await d.getByRole('textbox', { name: 'Field name' }).fill('photo')
    await d.getByRole('button', { name: 'Add field' }).click()
    await expect(win.getByText('Field added')).toBeVisible()
    await win.getByRole('button', { name: 'Edit fields', exact: true }).click()
    await win.getByRole('button', { name: 'photo', exact: true }).click()
    await expect(win.getByRole('button', { name: 'photo', exact: true })).toHaveCSS('background-image', /data:image\/png/)

    // The picture can be cleared before saving: the clear button goes with it.
    await win.getByRole('button', { name: 'Clear the picture in photo' }).click()
    await expect(win.getByText('Picture cleared')).toBeVisible()
    await expect(win.getByRole('button', { name: 'photo', exact: true })).not.toHaveCSS('background-image', /data:image/)
    await expect(win.getByRole('button', { name: 'Clear the picture in photo' })).toHaveCount(0)

    // Add one again, save, and clear it from the saved file.
    await win.getByRole('button', { name: 'photo', exact: true }).click()
    await expect(win.getByText('Picture added. Save to keep it.')).toBeVisible()
    await win.keyboard.press('Control+s')
    await expect(win.locator('.tab-dirty')).toHaveCount(0)
    const centre = () => JSON.parse(execFileSync('python', ['-c', 'import sys, json, pymupdf\nd = pymupdf.open(sys.argv[1])\nprint(json.dumps(list(d[0].get_pixmap().pixel(200, 150))))', pdf]).toString()) as number[]
    expect(centre()).toEqual([30, 200, 30])
    await win.getByRole('button', { name: 'Clear the picture in photo' }).click()
    await win.keyboard.press('Control+s')
    await expect(win.locator('.tab-dirty')).toHaveCount(0)
    expect(centre()).not.toEqual([30, 200, 30])
    expect(problems).toEqual([])
  } finally {
    await app.close()
  }
  // Opened again, the field has no picture.
  const again = await launch(dir, [pdf])
  try {
    await expect(again.win.locator('.page')).toHaveCount(1)
    await expect(again.win.getByRole('button', { name: 'photo', exact: true })).not.toHaveCSS('background-image', /data:image/)
    await expect(again.win.getByRole('button', { name: 'Clear the picture in photo' })).toHaveCount(0)
  } finally {
    await again.app.close()
    cleanup(dir)
  }
})

test('forms: e-mail the form data saves a data file and then offers what can honestly be done', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'openpdf-e2e-'))
  const pdf = join(dir, 'form.pdf')
  const data = join(dir, 'data.xfdf')
  const log = join(dir, 'mail.log')
  execFileSync(process.execPath, ['--import', 'tsx', join(root, 'scripts', 'make-form-pdf.mts'), pdf], { cwd: root })
  const { app, win, problems } = await launch(dir, [pdf], { OPENPDF_E2E_SAVE_TEXT: data, OPENPDF_E2E_MAIL_LOG: log })
  try {
    await expect(win.locator('.page')).toHaveCount(1)
    await win.getByRole('tab', { name: 'Forms', exact: true }).click()
    await win.getByRole('textbox', { name: 'fullname' }).fill('Zed Zebra')
    await win.getByRole('button', { name: 'E-mail data' }).click()
    const d = win.getByRole('dialog', { name: 'E-mail form data' })
    await expect(d).toContainText('cannot attach files')
    await expect(d.getByRole('combobox', { name: 'Data format' })).toHaveValue('xfdf')
    await d.getByRole('button', { name: 'Save and continue' }).click()
    const mail = win.getByRole('dialog', { name: 'Send by e-mail' })
    await expect(mail).toContainText('data.xfdf is saved')
    await mail.getByRole('button', { name: 'Show in Explorer' }).click()
    await expect.poll(() => (existsSync(log) ? readFileSync(log, 'utf8') : '')).toBe(`reveal|${data}`)
    expect(readFileSync(data, 'utf8')).toContain('<field name="fullname"><value>Zed Zebra</value></field>')
    expect(problems).toEqual([])
  } finally {
    await app.close()
    cleanup(dir)
  }
})
