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
def solid(rgb):
    pm = pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, 40, 20))
    pm.set_rect(pm.irect, rgb)
    return pm
p.insert_image(pymupdf.Rect(72, 100, 272, 200), pixmap=solid((200, 30, 30)))
p.insert_image(pymupdf.Rect(72, 300, 172, 350), pixmap=solid((30, 30, 200)))
doc.save(sys.argv[1])
pm = pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, 40, 40))
pm.set_rect(pm.irect, (30, 200, 30))
pm.save(sys.argv[2])
`

/** Image boxes (top-left origin, points) and the colour of the rendered page at a point. */
function inspect(path: string, probe?: [number, number]): { boxes: number[][]; colour?: number[] } {
  const py = `
import sys, json, pymupdf
d = pymupdf.open(sys.argv[1])
p = d[0]
boxes = [[round(v) for v in i["bbox"]] for i in p.get_image_info()]
out = {"boxes": boxes}
if len(sys.argv) > 3:
    x, y = float(sys.argv[2]), float(sys.argv[3])
    pm = p.get_pixmap()
    out["colour"] = list(pm.pixel(int(x), int(y)))
print(json.dumps(out))
`
  return JSON.parse(execFileSync('python', ['-c', py, path, ...(probe ? [String(probe[0]), String(probe[1])] : [])]).toString())
}

test('edit image: move, resize, replace and delete pictures', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'openpdf-e2e-'))
  const pdfPath = join(dir, 'images.pdf')
  const greenPath = join(dir, 'green.png')
  execFileSync('python', ['-c', MAKE, pdfPath, greenPath])
  const app = await electron.launch({
    args: ['.', pdfPath],
    cwd: root,
    env: { ...process.env, OPENPDF_E2E: '1', OPENPDF_E2E_USERDATA: join(dir, 'ud'), OPENPDF_E2E_DISCARD: '1', OPENPDF_E2E_PICK: greenPath }
  })
  try {
    const win = await app.firstWindow()
    const problems: string[] = []
    win.on('pageerror', (e) => problems.push(e.message))
    await expect(win.locator('.page')).toHaveCount(1)
    await win.getByRole('tab', { name: 'Edit', exact: true }).click()
    await win.getByRole('button', { name: 'Edit image' }).click()
    const images = win.getByRole('button', { name: /^Image \d/ })
    await expect(images).toHaveCount(2)
    const z = Number((await win.locator('.zoom-now').textContent())!.replace('%', '')) / 100

    // Move the first picture right 50 and down 30 points.
    const first = (await images.nth(0).boundingBox())!
    await win.mouse.move(first.x + first.width / 2, first.y + first.height / 2)
    await win.mouse.down()
    await win.mouse.move(first.x + first.width / 2 + 50 * z, first.y + first.height / 2 + 30 * z, { steps: 5 })
    await win.mouse.up()
    await expect(win.getByText('Image updated')).toBeVisible()

    // Resize it from the corner: the shape is kept, so 200 x 100 becomes 300 x 150.
    await expect(images).toHaveCount(2)
    await images.nth(0).click()
    const handle = win.getByLabel('Resize image')
    const hb = (await handle.boundingBox())!
    await win.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2)
    await win.mouse.down()
    await win.mouse.move(hb.x + hb.width / 2 + 100 * z, hb.y + hb.height / 2 + 50 * z, { steps: 5 })
    await win.mouse.up()
    await expect(win.getByText('Image updated')).toBeVisible()

    // The first picture is now 300 x 150 with its top-left at (122, 130).
    await win.keyboard.press('Control+s')
    await expect(win.locator('.tab-dirty')).toHaveCount(0)
    const mid = inspect(pdfPath).boxes[0]
    expect(Math.abs(mid[0] - 122)).toBeLessThanOrEqual(2)
    expect(Math.abs(mid[1] - 130)).toBeLessThanOrEqual(2)
    expect(Math.abs(mid[2] - mid[0] - 300)).toBeLessThanOrEqual(3)
    expect(Math.abs(mid[3] - mid[1] - 150)).toBeLessThanOrEqual(3)

    // Replace the second picture (the file picker answers with the green square).
    await expect(images).toHaveCount(2)
    await images.nth(1).click()
    await win.getByRole('button', { name: 'Replace…' }).click()
    await expect(win.getByText('Image replaced')).toBeVisible()

    // Delete the first picture.
    await expect(images).toHaveCount(2)
    await images.nth(0).click()
    await images.nth(0).press('Delete')
    await expect(win.getByText('Image deleted')).toBeVisible()

    await win.keyboard.press('Control+s')
    await expect(win.locator('.tab-dirty')).toHaveCount(0)
    const out = inspect(pdfPath, [122, 325])
    expect(out.boxes).toHaveLength(1)
    // The second picture was 100 x 50 at (72, 300): a 40 x 40 square fits inside as 50 x 50, centred.
    const [x0, y0, x1, y1] = out.boxes[0]
    expect(x1 - x0).toBe(50)
    expect(y1 - y0).toBe(50)
    expect(x0).toBe(97)
    expect(y0).toBe(300)
    // Rendered green where the new picture sits.
    expect(out.colour![1]).toBeGreaterThan(150)
    expect(out.colour![0]).toBeLessThan(80)
    expect(problems).toEqual([])
  } finally {
    await app.close()
    rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 })
  }
})

test('add image: choose a picture, click the page, and it is saved as page content', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'openpdf-e2e-'))
  const pdfPath = join(dir, 'blank.pdf')
  const greenPath = join(dir, 'green.png')
  // A blank page, and a 400 x 200 green picture.
  execFileSync('python', [
    '-c',
    `
import sys, pymupdf
d = pymupdf.open()
d.new_page(width=595, height=842)
d.save(sys.argv[1])
pm = pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, 400, 200))
pm.set_rect(pm.irect, (30, 200, 30))
pm.save(sys.argv[2])
`,
    pdfPath,
    greenPath
  ])
  const app = await electron.launch({
    args: ['.', pdfPath],
    cwd: root,
    env: { ...process.env, OPENPDF_E2E: '1', OPENPDF_E2E_USERDATA: join(dir, 'ud'), OPENPDF_E2E_DISCARD: '1', OPENPDF_E2E_PICK: greenPath }
  })
  try {
    const win = await app.firstWindow()
    await expect(win.locator('.page')).toHaveCount(1)
    await win.getByRole('tab', { name: 'Edit', exact: true }).click()
    await win.getByRole('button', { name: 'Add image' }).click()
    await expect(win.getByText('Click the page where the picture should go.')).toBeVisible()
    // The notice shifts the page: measure it again.
    // The zoom too is read here: the page can still be fitting its width when the window first opens.
    const pb2 = (await win.locator('.page').first().boundingBox())!
    const z = pb2.width / 595
    await win.mouse.click(pb2.x + 300 * z, pb2.y + 300 * z)
    await expect(win.getByText('Image added')).toBeVisible()
    await win.keyboard.press('Control+s')
    await expect(win.locator('.tab-dirty')).toHaveCount(0)
    const out = inspect(pdfPath, [300, 300])
    expect(out.boxes).toHaveLength(1)
    const [x0, y0, x1, y1] = out.boxes[0]
    // 400 px is 300 pt at 96 dpi, capped at 240 pt wide: 240 x 120, centred on (300, 300).
    expect(x1 - x0).toBeCloseTo(240, 0)
    expect(y1 - y0).toBeCloseTo(120, 0)
    expect(Math.abs((x0 + x1) / 2 - 300)).toBeLessThanOrEqual(2)
    expect(Math.abs((y0 + y1) / 2 - 300)).toBeLessThanOrEqual(2)
    expect(out.colour![1]).toBeGreaterThan(150)
  } finally {
    await app.close()
    rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 })
  }
})
