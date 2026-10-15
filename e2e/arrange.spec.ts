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
for rect, fill in [((100, 100, 160, 140), (1, 0, 0)), ((200, 200, 280, 240), (0, 0.7, 0)), ((320, 150, 360, 190), (0, 0, 1))]:
    a = p.add_rect_annot(pymupdf.Rect(*rect))
    a.set_colors(stroke=(0, 0, 0), fill=fill)
    a.set_border(width=1)
    a.update()
doc.save(sys.argv[1])
`

/** Annotation boxes and fill colours, in the order they stack in the file. */
function annots(path: string): { x0: number; y0: number; fill: number[] }[] {
  const py = `
import sys, json, pymupdf
p = pymupdf.open(sys.argv[1])[0]
print(json.dumps([{"x0": round(a.rect.x0, 1), "y0": round(a.rect.y0, 1), "fill": [round(v, 1) for v in (a.colors.get("fill") or [])]} for a in p.annots()]))
`
  return JSON.parse(execFileSync('python', ['-c', py, path]).toString())
}

test('arrange: select several annotations, align them and change their stacking order', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'openpdf-e2e-'))
  const pdfPath = join(dir, 'arrange.pdf')
  execFileSync('python', ['-c', MAKE, pdfPath])
  const app = await electron.launch({ args: ['.', pdfPath], cwd: root, env: { ...process.env, OPENPDF_E2E: '1', OPENPDF_E2E_USERDATA: join(dir, 'ud'), OPENPDF_E2E_DISCARD: '1' } })
  try {
    const win = await app.firstWindow()
    const problems: string[] = []
    win.on('pageerror', (e) => problems.push(e.message))
    await expect(win.locator('.page')).toHaveCount(1)
    // Zoom and page position are read fresh for every click: they can still be settling under load.
    const click = async (x: number, y: number, shift = false) => {
      const z = Number((await win.locator('.zoom-now').textContent())!.replace('%', '')) / 100
      const pb = (await win.locator('.page').first().boundingBox())!
      if (shift) await win.keyboard.down('Shift')
      await win.mouse.click(pb.x + x * z, pb.y + y * z)
      if (shift) await win.keyboard.up('Shift')
    }
    await win.getByRole('tab', { name: 'Edit', exact: true }).click()

    // Nothing is selected: the arrange buttons are off.
    await expect(win.getByRole('button', { name: 'Left', exact: true })).toBeDisabled()

    // Select all three with Shift-click, then align their left edges.
    // Rectangles take clicks on their outline: use each one's left edge.
    await click(100, 120)
    await click(200, 220, true)
    await click(320, 170, true)
    await expect(win.locator('.multi-sel')).toHaveCount(2)
    await win.getByRole('button', { name: 'Left', exact: true }).click()
    await win.keyboard.press('Control+s')
    await expect(win.locator('.tab-dirty')).toHaveCount(0)
    let out = annots(pdfPath)
    // The three share one left edge (a rewritten rectangle's box includes half its line width, so about 99).
    expect(new Set(out.map((a) => a.x0)).size).toBe(1)
    expect(Math.abs(out[0].x0 - 100)).toBeLessThanOrEqual(1.5)
    // Vertical positions are untouched: 100, 200 and 150 apart as before.
    expect(out[1].y0 - out[0].y0).toBeCloseTo(100, 0)
    expect(out[2].y0 - out[0].y0).toBeCloseTo(50, 0)

    // Bring the middle (green) one to the front: it must be last in the file.
    await expect(win.locator('.page')).toHaveCount(1)
    await click(100, 220)
    await win.getByRole('button', { name: 'To front' }).click()
    await win.keyboard.press('Control+s')
    await expect(win.locator('.tab-dirty')).toHaveCount(0)
    out = annots(pdfPath)
    expect(out).toHaveLength(3)
    expect(out[out.length - 1].fill).toEqual([0, 0.7, 0])
    expect(out.map((a) => a.fill[0] + a.fill[2])).toEqual([1, 1, 0])
    expect(problems).toEqual([])
  } finally {
    await app.close()
    rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 })
  }
})
