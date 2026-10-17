import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(__dirname, '..')

async function launch(pdf: string, dir: string, extra: Record<string, string> = {}): Promise<{ app: ElectronApplication; win: Page; problems: string[] }> {
  const app = await electron.launch({ args: ['.', pdf], cwd: root, env: { ...process.env, OPENPDF_E2E: '1', OPENPDF_E2E_USERDATA: join(dir, 'ud'), OPENPDF_E2E_DISCARD: '1', ...extra } })
  const win = await app.firstWindow()
  const problems: string[] = []
  win.on('pageerror', (e) => problems.push(e.message))
  await expect(win.locator('.page')).toHaveCount(1)
  return { app, win, problems }
}

const py = (code: string, ...args: string[]) => JSON.parse(execFileSync('python', ['-c', code, ...args]).toString())

/** The colour of the rendered page at a point (points from the top-left), and the page's picture boxes. */
function probe(path: string, points: [number, number][]): { colours: number[][]; boxes: number[][] } {
  return py(
    `
import sys, json, pymupdf
d = pymupdf.open(sys.argv[1])
p = d[0]
pm = p.get_pixmap()
pts = json.loads(sys.argv[2])
print(json.dumps({"colours": [list(pm.pixel(int(x), int(y))) for x, y in pts], "boxes": [[round(v) for v in i["bbox"]] for i in p.get_image_info()]}))
`,
    path,
    JSON.stringify(points)
  )
}

const PICTURE = `
import sys, pymupdf
doc = pymupdf.open()
p = doc.new_page(width=595, height=842)
pm = pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, 40, 20))
pm.set_rect(pm.irect, (255, 0, 0))
p.insert_image(pymupdf.Rect(72, 100, 272, 200), pixmap=pm)
doc.save(sys.argv[1])
`

test('edit pictures: rotate, crop, change opacity and export', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'openpdf-e2e-'))
  const pdf = join(dir, 'picture.pdf')
  const exported = join(dir, 'picture.png')
  execFileSync('python', ['-c', PICTURE, pdf])
  const { app, win, problems } = await launch(pdf, dir, { OPENPDF_E2E_SAVE_TEXT: exported })
  try {
    await win.getByRole('tab', { name: 'Edit', exact: true }).click()
    await win.getByRole('button', { name: 'Edit image' }).click()
    const picture = win.getByRole('button', { name: /^Image 1$/ })

    // Turn it a quarter turn: the 200 x 100 box becomes 100 x 200 about the same centre.
    await picture.click()
    await win.getByRole('button', { name: 'Rotate right 90°' }).click()
    await expect(win.getByText('Image updated')).toBeVisible()

    // Half see-through.
    await picture.click()
    await win.getByRole('button', { name: 'Opacity…' }).click()
    await win.getByRole('textbox', { name: 'Opacity (percent)' }).fill('50')
    await win.getByRole('button', { name: 'Set', exact: true }).click()
    await expect(win.getByText('Picture opacity changed')).toBeVisible()

    // Trim 20 points off the left edge.
    await picture.click()
    await win.getByRole('button', { name: 'Crop…', exact: true }).click()
    await win.getByRole('textbox', { name: 'Trim left (points)' }).fill('20')
    await win.getByRole('button', { name: 'Crop', exact: true }).click()
    await expect(win.getByText(/Picture cropped/)).toBeVisible()

    // Export what is left as a PNG.
    await picture.click()
    await win.getByRole('button', { name: 'Export picture…' }).click()
    await expect.poll(() => (existsSync(exported) ? readFileSync(exported).subarray(1, 4).toString('latin1') : '')).toBe('PNG')

    await win.keyboard.press('Control+s')
    await expect(win.locator('.tab-dirty')).toHaveCount(0)
    const out = probe(pdf, [[130, 150], [180, 150], [172, 60]])
    const box = out.boxes[0]
    expect(Math.abs(box[0] - 122)).toBeLessThanOrEqual(3)
    expect(Math.abs(box[2] - box[0] - 100)).toBeLessThanOrEqual(3)
    expect(Math.abs(box[3] - box[1] - 200)).toBeLessThanOrEqual(3)
    // Trimmed strip is white, the rest is red at half strength (pink), and above the picture it is white.
    expect(out.colours[0]).toEqual([255, 255, 255])
    expect(out.colours[1][0]).toBeGreaterThan(230)
    expect(out.colours[1][1]).toBeGreaterThan(90)
    expect(out.colours[1][1]).toBeLessThan(200)
    expect(problems).toEqual([])
  } finally {
    await app.close()
    rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 })
  }
})

const SHAPE = `
import sys, pymupdf
doc = pymupdf.open()
p = doc.new_page(width=595, height=842)
p.draw_rect(pymupdf.Rect(100, 100, 220, 180), color=(0, 0, 1), fill=(1, 0, 0), width=3)
doc.save(sys.argv[1])
`

test('edit shapes: recolour the fill, change the line width', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'openpdf-e2e-'))
  const pdf = join(dir, 'shape.pdf')
  execFileSync('python', ['-c', SHAPE, pdf])
  const { app, win, problems } = await launch(pdf, dir)
  try {
    await win.getByRole('tab', { name: 'Edit', exact: true }).click()
    await win.getByRole('button', { name: 'Edit shape' }).click()
    await expect(win.locator('.imageedit-layer')).toBeVisible()
    const z = Number((await win.locator('.zoom-now').textContent())!.replace('%', '')) / 100
    const pb = (await win.locator('.page').first().boundingBox())!
    await win.mouse.click(pb.x + 160 * z, pb.y + 140 * z)
    const bar = win.getByRole('toolbar', { name: 'Shape tools' })
    await expect(bar).toBeVisible()
    await bar.getByLabel('Fill colour').fill('#00ff00')
    await bar.getByRole('textbox', { name: 'Line width (points)' }).fill('6')
    await bar.getByRole('button', { name: 'Apply look' }).click()
    await expect(win.getByText('Shape updated')).toBeVisible()

    await win.keyboard.press('Control+s')
    await expect(win.locator('.tab-dirty')).toHaveCount(0)
    const d = py(
      `
import sys, json, pymupdf
p = pymupdf.open(sys.argv[1])[0]
print(json.dumps([{"fill": [round(v, 1) for v in d["fill"]], "stroke": [round(v, 1) for v in d["color"]], "width": round(d["width"], 1)} for d in p.get_drawings()]))
`,
      pdf
    )
    expect(d).toHaveLength(1)
    expect(d[0].fill).toEqual([0, 1, 0])
    expect(d[0].stroke).toEqual([0, 0, 1])
    expect(d[0].width).toBe(6)
    expect(problems).toEqual([])
  } finally {
    await app.close()
    rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 })
  }
})

const TEXT = `
import sys, pymupdf
doc = pymupdf.open()
p = doc.new_page(width=595, height=842)
p.insert_text((72, 120), "Project name: Eagle Farm", fontsize=16, fontname="helv", color=(0.1, 0.2, 0.6))
p.insert_text((72, 200), "abab hello", fontsize=14, fontname="f1", fontfile=r"C:\\Windows\\Fonts\\arial.ttf")
doc.subset_fonts()
doc.save(sys.argv[1])
`

test('edit text: change font, size, colour and bold; a subset font refuses characters it lacks', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'openpdf-e2e-'))
  const pdf = join(dir, 'text.pdf')
  try {
    execFileSync('python', ['-c', TEXT, pdf])
  } catch {
    test.skip(true, 'No system font to make a subset font with')
  }
  const { app, win, problems } = await launch(pdf, dir)
  try {
    await win.getByRole('tab', { name: 'Edit', exact: true }).click()
    await win.getByRole('button', { name: 'Edit text' }).click()

    await win.getByRole('button', { name: 'Edit text: Project name: Eagle Farm' }).click()
    const bar = win.getByRole('toolbar', { name: 'Text format' })
    await expect(bar).toBeVisible()
    await bar.getByRole('combobox', { name: 'Font' }).selectOption('std:times')
    await bar.getByRole('textbox', { name: 'Font size (points)' }).fill('24')
    await bar.getByRole('button', { name: 'Bold' }).click()
    await bar.getByLabel('Text colour').fill('#ff0000')
    await bar.getByRole('textbox', { name: 'Font size (points)' }).press('Enter')
    await expect(win.getByText('Text formatted')).toBeVisible()

    // The subset font offers its own glyphs only.
    await win.getByRole('button', { name: 'Edit text: abab hello' }).click()
    const bar2 = win.getByRole('toolbar', { name: 'Text format' })
    const fontList = bar2.getByRole('combobox', { name: 'Font' })
    await expect(fontList.locator('option', { hasText: '(subset)' })).toHaveCount(1)
    const value = await fontList.locator('option', { hasText: '(subset)' }).getAttribute('value')
    await fontList.selectOption(value!)
    await expect(bar2.getByRole('button', { name: 'Bold' })).toBeDisabled()
    await expect(bar2.getByText(/subset font only holds/)).toBeVisible()
    const box = win.getByRole('textbox', { name: 'Edit text' })
    await box.fill('abab hello zq')
    await box.press('Enter')
    await expect(win.getByText(/is a subset/)).toBeVisible()

    await win.keyboard.press('Control+s')
    const spans = py(
      `
import sys, json, pymupdf
d = pymupdf.open(sys.argv[1])
out = []
for b in d[0].get_text("dict")["blocks"]:
    for l in b.get("lines", []):
        for s in l["spans"]:
            out.append({"text": s["text"], "size": round(s["size"], 1), "color": s["color"], "font": s["font"], "flags": s["flags"]})
print(json.dumps(out))
`,
      pdf
    )
    const edited = spans.find((s: { text: string }) => s.text === 'Project name: Eagle Farm')
    expect(edited).toBeTruthy()
    expect(edited.font).toMatch(/Times/i)
    expect(edited.flags & 16).toBeTruthy()
    expect(edited.size).toBeCloseTo(24, 0)
    expect(edited.color).toBe(0xff0000)
    expect(problems).toEqual([])
  } finally {
    await app.close()
    rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 })
  }
})

const PANE = `
import sys, pymupdf
doc = pymupdf.open()
p = doc.new_page(width=595, height=842)
p.draw_rect(pymupdf.Rect(100, 120, 200, 180), color=None, fill=(1, 0, 0))
pm = pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, 40, 20))
pm.set_rect(pm.irect, (0, 200, 0))
p.insert_image(pymupdf.Rect(72, 100, 272, 200), pixmap=pm)
p.draw_rect(pymupdf.Rect(300, 100, 380, 200), color=None, fill=(0, 0, 1))
p.insert_text((72, 400), "Content pane text", fontsize=14, fontname="helv")
doc.save(sys.argv[1])
`

test('content pane: list objects, select, hide, reorder and delete', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'openpdf-e2e-'))
  const pdf = join(dir, 'pane.pdf')
  execFileSync('python', ['-c', PANE, pdf])
  const { app, win, problems } = await launch(pdf, dir)
  try {
    await win.getByRole('tab', { name: 'Edit', exact: true }).click()
    await win.getByRole('button', { name: 'Content pane' }).click()
    const list = win.getByRole('list', { name: 'Page objects' })
    const names = () => list.locator('.content-name').allTextContents()
    await expect.poll(names).toEqual(['Shape 1', 'Picture 1', 'Shape 2', 'Text: Content pane text'])

    // Selecting a row points it out on the page.
    await list.getByRole('button', { name: 'Picture 1', exact: true }).click()
    await expect(win.locator('.content-highlight')).toBeVisible()

    // The picture covers the red box; bringing the box forward puts it on top.
    await win.getByRole('button', { name: 'Bring Shape 1 forward' }).click()
    await expect(win.getByText('Moved forward')).toBeVisible()
    await expect.poll(names).toEqual(['Picture 1', 'Shape 1', 'Shape 2', 'Text: Content pane text'])

    // Hide the second shape; delete the picture.
    await win.getByRole('button', { name: 'Hide Shape 2' }).click()
    await expect(win.getByText(/Object hidden/)).toBeVisible()
    await expect(win.getByRole('button', { name: 'Show Shape 2' })).toBeVisible()
    await win.getByRole('button', { name: 'Delete Picture 1' }).click()
    await expect(win.getByText('Image deleted')).toBeVisible()
    await expect.poll(names).toEqual(['Shape 1', 'Shape 2', 'Text: Content pane text'])

    await win.keyboard.press('Control+s')
    await expect(win.locator('.tab-dirty')).toHaveCount(0)
    const out = probe(pdf, [[150, 150], [340, 150], [90, 190]])
    expect(out.boxes).toHaveLength(0)
    expect(out.colours[0]).toEqual([255, 0, 0])
    // The hidden blue box is not drawn.
    expect(out.colours[1]).toEqual([255, 255, 255])
    expect(problems).toEqual([])
  } finally {
    await app.close()
    rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 })
  }
})
