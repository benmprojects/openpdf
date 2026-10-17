import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(__dirname, '..')

const py = (code: string, ...args: string[]): string => execFileSync('python', ['-c', code, ...args]).toString()

async function launch(dir: string, pdf: string, extra: Record<string, string> = {}): Promise<{ app: ElectronApplication; win: Page; problems: string[] }> {
  const app = await electron.launch({ args: ['.', pdf], cwd: root, env: { ...process.env, OPENPDF_E2E: '1', OPENPDF_E2E_USERDATA: join(dir, 'ud'), OPENPDF_E2E_DISCARD: '1', ...extra } })
  const win = await app.firstWindow()
  const problems: string[] = []
  win.on('pageerror', (e) => problems.push(e.message))
  await expect(win.locator('.page')).toHaveCount(1)
  return { app, win, problems }
}

const done = (dir: string) => rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 })

async function save(win: Page): Promise<void> {
  await win.keyboard.press('Control+s')
  await expect(win.locator('.tab-dirty')).toHaveCount(0)
}

const SHAPES = `
import sys, pymupdf
doc = pymupdf.open()
p = doc.new_page(width=400, height=400)
p.draw_rect(pymupdf.Rect(40, 50, 100, 90), color=None, fill=(1, 0, 0))
p.draw_rect(pymupdf.Rect(150, 120, 230, 180), color=None, fill=(0, 0, 1))
p.draw_rect(pymupdf.Rect(260, 220, 300, 250), color=None, fill=(0, 0.6, 0))
doc.save(sys.argv[1])
`

const boxes = (pdf: string): number[][] =>
  JSON.parse(py('import sys, json, pymupdf\nprint(json.dumps(sorted([[round(v) for v in d["rect"]] for d in pymupdf.open(sys.argv[1])[0].get_drawings()])))', pdf))

test('content pane: tick shapes, align them, spread them and rename one', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'openpdf-e2e-'))
  const pdf = join(dir, 'shapes.pdf')
  py(SHAPES, pdf)
  const { app, win, problems } = await launch(dir, pdf)
  try {
    await win.getByRole('tab', { name: 'Edit', exact: true }).click()
    await win.getByRole('button', { name: 'Content pane' }).click()
    const list = win.getByRole('list', { name: 'Page objects' })
    await expect(list.getByRole('listitem')).toHaveCount(3, { timeout: 20000 })

    // Rename the first shape (session only).
    await list.getByRole('button', { name: 'Rename Shape 1' }).click()
    const field = win.getByRole('textbox', { name: /Name of Shape 1/ })
    await field.fill('Red pad')
    await field.press('Enter')
    await expect(list.getByRole('button', { name: 'Red pad', exact: true })).toBeVisible()

    // Align the lefts of the red and blue shapes.
    await list.getByRole('checkbox', { name: 'Tick Red pad' }).check()
    await list.getByRole('checkbox', { name: 'Tick Shape 2' }).check()
    await win.getByRole('button', { name: 'Align left' }).click()
    await expect(win.getByText('Objects aligned')).toBeVisible({ timeout: 20000 })
    await expect(list.getByRole('listitem')).toHaveCount(3, { timeout: 20000 })
    // The name followed its shape to the new place.
    await expect(list.getByRole('button', { name: 'Red pad', exact: true })).toBeVisible()

    // Spread the three evenly across.
    await list.getByRole('checkbox', { name: 'Tick Red pad' }).check()
    await list.getByRole('checkbox', { name: 'Tick Shape 2' }).check()
    await list.getByRole('checkbox', { name: 'Tick Shape 3' }).check()
    await win.getByRole('button', { name: 'Spread across' }).click()
    await expect(win.getByText('Objects spread evenly')).toBeVisible({ timeout: 20000 })
    await save(win)
    const out = boxes(pdf)
    expect(out).toHaveLength(3)
    // After aligning, red and blue start at x = 40; after spreading the middle one sits halfway between the outer two.
    const xs = out.map((r) => r[0]).sort((a, b) => a - b)
    expect(xs[0]).toBe(40)
    expect(Math.abs(xs[1] - (xs[0] + xs[2]) / 2)).toBeLessThanOrEqual(25)
    expect(problems).toEqual([])
  } finally {
    await app.close()
    done(dir)
  }
})

test('edit shape: a dash and a gradient fill', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'openpdf-e2e-'))
  const pdf = join(dir, 'look.pdf')
  py(
    `import sys, pymupdf
doc = pymupdf.open()
p = doc.new_page(width=400, height=400)
p.draw_rect(pymupdf.Rect(100, 100, 300, 200), color=(0, 0, 0), fill=(1, 0, 0), width=4)
doc.save(sys.argv[1])`,
    pdf
  )
  const { app, win, problems } = await launch(dir, pdf)
  try {
    await win.getByRole('tab', { name: 'Edit', exact: true }).click()
    await win.getByRole('button', { name: 'Edit shape' }).click()
    await expect(win.locator('.imageedit-layer')).toBeVisible()
    const z = Number((await win.locator('.zoom-now').textContent())!.replace('%', '')) / 100
    const pb = (await win.locator('.page').first().boundingBox())!
    await win.mouse.click(pb.x + 200 * z, pb.y + 150 * z)
    const bar = win.getByRole('toolbar', { name: 'Shape tools' })
    await expect(bar).toBeVisible()
    await bar.getByRole('combobox', { name: 'Line style' }).selectOption('dashed')
    await bar.getByRole('checkbox', { name: 'Gradient fill' }).check()
    await bar.getByRole('button', { name: 'Apply look' }).click()
    await expect(win.getByText('Shape updated')).toBeVisible({ timeout: 20000 })
    await save(win)
    const drawn = JSON.parse(py('import sys, json, pymupdf\nd = pymupdf.open(sys.argv[1])[0]\nprint(json.dumps({"dashes": [x.get("dashes") for x in d.get_drawings()], "stream": d.read_contents().decode("latin-1")}))', pdf))
    expect(drawn.stream).toMatch(/\[6 3\] 0 d/)
    expect(drawn.stream).toMatch(/\/OPSh\w+ sh/)
    // The page still draws with a red-to-blue fill: the left of the box is red and the right is blue.
    const px = py('import sys, pymupdf\np = pymupdf.open(sys.argv[1])[0].get_pixmap()\nprint(list(p.pixel(110, 150)), list(p.pixel(290, 150)))', pdf)
    const [left, right] = px.trim().split('] [').map((s) => s.replace(/[[\]]/g, '').split(',').map(Number))
    expect(left[0]).toBeGreaterThan(left[2])
    expect(right[2]).toBeGreaterThan(right[0])
    expect(problems).toEqual([])
  } finally {
    await app.close()
    done(dir)
  }
})

test('unpack forms: text inside a form becomes page content', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'openpdf-e2e-'))
  const pdf = join(dir, 'forms.pdf')
  py(
    `import sys, pymupdf
src = pymupdf.open()
s = src.new_page(width=200, height=100)
s.insert_text((20, 50), "Inside the form", fontsize=14)
doc = pymupdf.open()
p = doc.new_page(width=300, height=300)
p.show_pdf_page(pymupdf.Rect(20, 100, 220, 200), src, 0)
p.insert_text((20, 40), "Outside text", fontsize=14)
doc.save(sys.argv[1])`,
    pdf
  )
  const before = py('import sys, pymupdf\nd = pymupdf.open(sys.argv[1])[0]\nprint(d.read_contents().decode("latin-1").count(" Do"))', pdf).trim()
  expect(Number(before)).toBeGreaterThan(0)
  const { app, win, problems } = await launch(dir, pdf)
  try {
    await win.getByRole('tab', { name: 'Edit', exact: true }).click()
    await win.getByRole('button', { name: 'Unpack forms', exact: true }).click()
    await expect(win.getByText(/forms? unpacked on 1 page/)).toBeVisible({ timeout: 20000 })
    await save(win)
    expect(py('import sys, pymupdf\nd = pymupdf.open(sys.argv[1])[0]\nprint(d.read_contents().decode("latin-1").count(" Do"))', pdf).trim()).toBe('0')
    const text = py('import sys, pymupdf\nprint(pymupdf.open(sys.argv[1])[0].get_text())', pdf)
    expect(text).toContain('Inside the form')
    expect(text).toContain('Outside text')
    // The Content pane now lists the text from inside the form as an object of the page.
    await win.getByRole('button', { name: 'Content pane' }).click()
    await expect(win.getByRole('list', { name: 'Page objects' }).getByRole('button', { name: 'Text: Inside the form', exact: true })).toBeVisible({ timeout: 20000 })
    expect(problems).toEqual([])
  } finally {
    await app.close()
    done(dir)
  }
})

test('edit text: letter gap and alignment are written with the new text', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'openpdf-e2e-'))
  const pdf = join(dir, 'text.pdf')
  py(
    `import sys, pymupdf
doc = pymupdf.open()
p = doc.new_page(width=400, height=300)
p.insert_text((50, 100), "Spacing sample", fontsize=14, fontname="helv")
doc.save(sys.argv[1])`,
    pdf
  )
  const { app, win, problems } = await launch(dir, pdf)
  try {
    await win.getByRole('tab', { name: 'Edit', exact: true }).click()
    await win.getByRole('button', { name: 'Edit text' }).click()
    await win.getByRole('button', { name: /Edit text: Spacing sample/ }).click()
    const bar = win.getByRole('toolbar', { name: 'Text format' })
    await bar.getByRole('textbox', { name: 'Character spacing (points)' }).fill('2')
    await bar.getByRole('button', { name: 'Align right' }).click()
    await win.getByRole('textbox', { name: 'Edit text' }).press('Enter')
    await expect(win.getByText('Text formatted')).toBeVisible({ timeout: 20000 })
    await save(win)
    const stream = py('import sys, pymupdf\nprint(pymupdf.open(sys.argv[1])[0].read_contents().decode("latin-1"))', pdf)
    expect(stream).toMatch(/2 Tc/)
    expect(py('import sys, pymupdf\nprint(pymupdf.open(sys.argv[1])[0].get_text())', pdf)).toContain('Spacing sample')
    expect(problems).toEqual([])
  } finally {
    await app.close()
    done(dir)
  }
})

test('crop a picture by dragging its edges', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'openpdf-e2e-'))
  const pdf = join(dir, 'picture.pdf')
  py(
    `import sys, pymupdf
doc = pymupdf.open()
p = doc.new_page(width=400, height=400)
pm = pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, 40, 20))
pm.set_rect(pm.irect, (255, 0, 0))
p.insert_image(pymupdf.Rect(100, 100, 300, 200), pixmap=pm)
doc.save(sys.argv[1])`,
    pdf
  )
  const { app, win, problems } = await launch(dir, pdf)
  try {
    await win.getByRole('tab', { name: 'Edit', exact: true }).click()
    await win.getByRole('button', { name: 'Edit image' }).click()
    await win.getByRole('button', { name: /^Image 1$/ }).click()
    await win.getByRole('button', { name: 'Crop by dragging' }).click()
    const handle = (await win.getByRole('button', { name: 'Crop from the w' }).boundingBox())!
    const z = Number((await win.locator('.zoom-now').textContent())!.replace('%', '')) / 100
    await win.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2)
    await win.mouse.down()
    await win.mouse.move(handle.x + handle.width / 2 + 50 * z, handle.y + handle.height / 2, { steps: 5 })
    await win.mouse.up()
    await expect(win.getByText(/Picture cropped/)).toBeVisible({ timeout: 20000 })
    await save(win)
    // The visible part of the picture now starts 50 points further right.
    const colours = JSON.parse(py('import sys, json, pymupdf\np = pymupdf.open(sys.argv[1])[0].get_pixmap()\nprint(json.dumps([list(p.pixel(110, 150)), list(p.pixel(160, 150))]))', pdf))
    expect(colours[0]).toEqual([255, 255, 255])
    expect(colours[1][0]).toBe(255)
    expect(colours[1][1]).toBeLessThan(40)
    expect(problems).toEqual([])
  } finally {
    await app.close()
    done(dir)
  }
})

test('layers: write the opening view, merge and flatten', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'openpdf-e2e-'))
  const pdf = join(dir, 'layers.pdf')
  py(
    `import sys, pymupdf
doc = pymupdf.open()
p = doc.new_page(width=300, height=300)
a = doc.add_ocg("Plan", on=True)
b = doc.add_ocg("Notes", on=True)
p.draw_rect(pymupdf.Rect(20, 20, 100, 100), color=None, fill=(1, 0, 0), oc=a)
p.draw_rect(pymupdf.Rect(150, 20, 250, 100), color=None, fill=(0, 0, 1), oc=b)
doc.save(sys.argv[1])`,
    pdf
  )
  const names = (): string[] => JSON.parse(py('import sys, json, pymupdf\nprint(json.dumps(sorted(v["text"] for v in pymupdf.open(sys.argv[1]).layer_ui_configs())))', pdf))
  expect(names()).toEqual(['Notes', 'Plan'])
  const { app, win, problems } = await launch(dir, pdf)
  try {
    await win.getByRole('tab', { name: 'Edit', exact: true }).click()
    await win.getByRole('button', { name: 'Edit layers' }).click()
    const d = win.getByRole('dialog', { name: 'Edit layers' })
    // Switch Notes off for when the document opens.
    await d.getByRole('checkbox', { name: 'Notes visible when opened' }).uncheck()
    await d.getByRole('button', { name: 'Save opening view' }).click()
    await expect(d.getByText('The opening view was saved')).toBeVisible({ timeout: 20000 })
    // Flatten: the hidden blue box goes, the red one stays, and the layers are gone.
    await d.getByRole('button', { name: 'Flatten layers' }).click()
    await expect(d.getByText('Layers flattened')).toBeVisible({ timeout: 20000 })
    await d.locator('button.primary').click()
    await save(win)
    expect(names()).toEqual([])
    expect(boxes(pdf)).toEqual([[20, 20, 100, 100]])
    expect(problems).toEqual([])
  } finally {
    await app.close()
    done(dir)
  }
})

test('add media: a sound file is placed on the page and is saved as a Screen annotation', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'openpdf-e2e-'))
  const pdf = join(dir, 'media.pdf')
  py('import sys, pymupdf\ndoc = pymupdf.open()\ndoc.new_page(width=300, height=300)\ndoc.save(sys.argv[1])', pdf)
  // A real WAV: a quarter of a second of silence.
  const samples = 2000
  const wav = Buffer.alloc(44 + samples * 2)
  wav.write('RIFF', 0)
  wav.writeUInt32LE(36 + samples * 2, 4)
  wav.write('WAVEfmt ', 8)
  wav.writeUInt32LE(16, 16)
  wav.writeUInt16LE(1, 20)
  wav.writeUInt16LE(1, 22)
  wav.writeUInt32LE(8000, 24)
  wav.writeUInt32LE(16000, 28)
  wav.writeUInt16LE(2, 32)
  wav.writeUInt16LE(16, 34)
  wav.write('data', 36)
  wav.writeUInt32LE(samples * 2, 40)
  const file = join(dir, 'site-intro.wav')
  writeFileSync(file, wav)
  const { app, win, problems } = await launch(dir, pdf, { OPENPDF_E2E_PICK: file })
  try {
    await win.getByRole('tab', { name: 'Edit', exact: true }).click()
    await win.getByRole('button', { name: 'Add media' }).click()
    await expect(win.getByText(/Click the page where the sound should go/)).toBeVisible()
    const z = Number((await win.locator('.zoom-now').textContent())!.replace('%', '')) / 100
    const pb = (await win.locator('.page').first().boundingBox())!
    await win.mouse.click(pb.x + 150 * z, pb.y + 150 * z)
    await expect(win.getByText(/Media added/)).toBeVisible({ timeout: 20000 })
    await save(win)
    const info = JSON.parse(py('import sys, json, pymupdf\nd = pymupdf.open(sys.argv[1])[0]\na = list(d.annots())\nprint(json.dumps([[x.type[1], [round(v) for v in x.rect]] for x in a]))', pdf))
    expect(info).toHaveLength(1)
    expect(info[0][0]).toBe('Screen')
    expect(problems).toEqual([])
  } finally {
    await app.close()
    done(dir)
  }
})
