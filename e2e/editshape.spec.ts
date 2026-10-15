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
p.draw_rect(pymupdf.Rect(100, 100, 200, 160), color=None, fill=(1, 0, 0))
p.draw_rect(pymupdf.Rect(300, 100, 380, 200), color=None, fill=(0, 0, 1))
p.draw_line((100, 300), (300, 320), color=(0, 0, 0), width=3)
doc.save(sys.argv[1])
`

/** Painted shapes: box (top-left origin) and fill colour. */
function drawings(path: string): { rect: number[]; fill: number[] | null }[] {
  const py = `
import sys, json, pymupdf
p = pymupdf.open(sys.argv[1])[0]
print(json.dumps([{"rect": [round(v) for v in d["rect"]], "fill": [round(v, 1) for v in d["fill"]] if d.get("fill") else None} for d in p.get_drawings()]))
`
  return JSON.parse(execFileSync('python', ['-c', py, path]).toString())
}

test('edit shape: move, resize and delete vector shapes that are part of the page', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'openpdf-e2e-'))
  const pdfPath = join(dir, 'shapes.pdf')
  execFileSync('python', ['-c', MAKE, pdfPath])
  const app = await electron.launch({ args: ['.', pdfPath], cwd: root, env: { ...process.env, OPENPDF_E2E: '1', OPENPDF_E2E_USERDATA: join(dir, 'ud'), OPENPDF_E2E_DISCARD: '1' } })
  try {
    const win = await app.firstWindow()
    const problems: string[] = []
    win.on('pageerror', (e) => problems.push(e.message))
    await expect(win.locator('.page')).toHaveCount(1)
    await win.getByRole('tab', { name: 'Edit', exact: true }).click()
    await win.getByRole('button', { name: 'Edit shape' }).click()
    await expect(win.locator('.imageedit-layer')).toBeVisible()
    // Measured fresh for every action: the layout can still be settling under load.
    const z = Number((await win.locator('.zoom-now').textContent())!.replace('%', '')) / 100
    const at = async (x: number, y: number) => {
      const pb = (await win.locator('.page').first().boundingBox())!
      return [pb.x + x * z, pb.y + y * z] as const
    }

    // Move the red box right 40 and down 60 points.
    const [ax, ay] = await at(150, 130)
    await win.mouse.move(ax, ay)
    await win.mouse.down()
    await win.mouse.move(ax + 40 * z, ay + 60 * z, { steps: 5 })
    await win.mouse.up()
    await expect(win.getByText('Shape updated')).toBeVisible()

    // Select the moved red box and stretch it from its bottom-right corner by 50 x 30 points.
    await expect(win.locator('.imageedit-layer')).toBeVisible()
    const [rx, ry] = await at(190, 190)
    await win.mouse.click(rx, ry)
    const handle = (await win.getByLabel('Resize shape').boundingBox())!
    await win.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2)
    await win.mouse.down()
    await win.mouse.move(handle.x + handle.width / 2 + 50 * z, handle.y + handle.height / 2 + 30 * z, { steps: 5 })
    await win.mouse.up()
    await expect(win.getByText('Shape updated')).toBeVisible()

    // Delete the blue box with the Delete key (the tool's layer returns once the document has reloaded).
    await expect(win.locator('.imageedit-layer')).toBeVisible()
    const [bx, by] = await at(340, 150)
    await win.mouse.click(bx, by)
    await win.keyboard.press('Delete')
    await expect(win.getByText('Shape deleted')).toBeVisible()

    await win.keyboard.press('Control+s')
    await expect(win.locator('.tab-dirty')).toHaveCount(0)
    const out = drawings(pdfPath)
    expect(out).toHaveLength(2)
    const red = out.find((d) => d.fill && d.fill[0] === 1)!
    expect(red.rect).toEqual([140, 160, 290, 250])
    expect(out.some((d) => d.fill && d.fill[2] === 1)).toBe(false)
    // The line is still there.
    expect(out.some((d) => d.rect[1] >= 298 && d.rect[3] <= 322)).toBe(true)
    expect(problems).toEqual([])
  } finally {
    await app.close()
    rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 })
  }
})
