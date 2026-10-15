import { _electron as electron, expect, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(__dirname, '..')

function shapes(path: string): { type: string; vertices: number; fill: boolean; dashed: boolean; cloud: boolean }[] {
  const py = `
import sys, json, pymupdf
d = pymupdf.open(sys.argv[1])
out = []
for a in d[0].annots():
    v = a.vertices or []
    out.append({"type": a.type[1], "vertices": len(v), "fill": bool(a.colors.get("fill")), "dashed": bool(a.border.get("dashes")), "cloud": d.xref_get_key(a.xref, "BE")[0] == "dict"})
print(json.dumps(out))
`
  return JSON.parse(execFileSync('python', ['-c', py, path]).toString())
}

test('polygon, polyline and cloud with fill and dashes: drawn, saved, read back', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'openpdf-e2e-'))
  const pdfPath = join(dir, 'shapes.pdf')
  execFileSync('python', [join(root, 'scripts', 'make-test-pdf.py'), pdfPath])
  const launch = () =>
    electron.launch({ args: ['.', pdfPath], cwd: root, env: { ...process.env, OPENPDF_E2E: '1', OPENPDF_E2E_USERDATA: join(dir, 'ud'), OPENPDF_E2E_DISCARD: '1' } })
  let app = await launch()
  try {
    let win = await app.firstWindow()
    const problems: string[] = []
    win.on('pageerror', (e) => problems.push(e.message))
    await expect(win.locator('.page')).toHaveCount(6)
    await win.getByRole('tab', { name: 'Draw' }).click()
    const p = (await win.locator('.page').first().boundingBox())!
    const clicks = async (pts: [number, number][]) => {
      for (const [x, y] of pts) await win.mouse.click(p.x + x, p.y + y)
    }

    // Polygon with a fill and a dashed line, chosen before drawing.
    await win.getByRole('button', { name: 'Polygon', exact: true }).click()
    await win.getByRole('button', { name: 'Fill #fff4c2' }).click()
    await win.getByRole('combobox', { name: 'Line style' }).selectOption('dashed')
    await clicks([[100, 450], [250, 470], [180, 560]])
    await win.keyboard.press('Enter')

    // Polyline finished with a double-click on its last point.
    await win.getByRole('button', { name: 'Polyline', exact: true }).click()
    await clicks([[320, 450], [380, 520]])
    await win.mouse.dblclick(p.x + 460, p.y + 470)

    // Cloud.
    await win.getByRole('button', { name: 'Cloud', exact: true }).click()
    await clicks([[330, 300], [500, 300], [500, 400], [330, 400]])
    await win.keyboard.press('Enter')
    await expect(win.locator('.page').first().locator('.annot-svg path')).not.toHaveCount(0)
    await win.screenshot({ path: test.info().outputPath('shapes2.png') })

    await win.keyboard.press('Control+s')
    await expect(win.locator('.tab-dirty')).toHaveCount(0)
    const got = shapes(pdfPath)
    const polygon = got.find((s) => s.type === 'Polygon' && !s.cloud)!
    expect(polygon).toMatchObject({ vertices: 3, fill: true, dashed: true })
    expect(got.find((s) => s.type === 'PolyLine')).toMatchObject({ vertices: 3 })
    expect(got.find((s) => s.cloud)).toMatchObject({ type: 'Polygon', vertices: 4 })
    expect(problems).toEqual([])
    await app.close()

    // Reopen: all three come back as editable shapes; select the polygon and drag a corner.
    app = await launch()
    win = await app.firstWindow()
    await expect(win.locator('.page')).toHaveCount(6)
    // Wait for the saved shapes to be imported as editable ones.
    await expect(win.locator('.page').first().locator('.annot-svg path')).toHaveCount(6)
    // The layout settles once settings load; wait until the polygon is under the pointer.
    await expect
      .poll(() => win.evaluate(([x, y]) => document.elementFromPoint(x, y)?.tagName, [p.x + 180, p.y + 495]))
      .toBe('path')
    await win.mouse.click(p.x + 180, p.y + 495) // inside the filled polygon
    await expect(win.locator('.point-handle')).toHaveCount(3)
    const h = (await win.locator('.point-handle').nth(2).boundingBox())!
    await win.mouse.move(h.x + 5, h.y + 5)
    await win.mouse.down()
    await win.mouse.move(h.x + 45, h.y + 35, { steps: 4 })
    await win.mouse.up()
    await expect(win.locator('.tab-dirty')).toHaveCount(1)
  } finally {
    await app.close()
    rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 })
  }
})
