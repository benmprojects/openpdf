import { _electron as electron, expect, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(__dirname, '..')

test('properties panel: opacity, width, font, tool defaults and presets', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'openpdf-e2e-'))
  const pdfPath = join(dir, 'props.pdf')
  const userData = join(dir, 'ud')
  execFileSync('python', [join(root, 'scripts', 'make-test-pdf.py'), pdfPath])
  const launch = () =>
    electron.launch({ args: ['.', pdfPath], cwd: root, env: { ...process.env, OPENPDF_E2E: '1', OPENPDF_E2E_USERDATA: userData, OPENPDF_E2E_DISCARD: '1' } })
  let app = await launch()
  try {
    let win = await app.firstWindow()
    const problems: string[] = []
    win.on('pageerror', (e) => problems.push(e.message))
    await expect(win.locator('.page')).toHaveCount(6)
    const p = (await win.locator('.page').first().boundingBox())!

    // Rectangle tool: set 50% opacity and 4 pt in the panel, make it the default, save a preset.
    await win.getByRole('tab', { name: 'Draw' }).click()
    await win.getByRole('button', { name: 'Rectangle', exact: true }).click()
    await win.keyboard.press('Control+e')
    const panel = win.getByRole('complementary', { name: 'Properties' })
    await expect(panel).toBeVisible()
    await panel.getByRole('slider', { name: 'Opacity' }).fill('50')
    await panel.getByRole('combobox', { name: 'Line width' }).selectOption('4')
    await panel.getByRole('button', { name: /Make default for Rectangle/ }).click()
    await panel.getByRole('textbox', { name: 'Preset name' }).fill('Faded thick box')
    await panel.getByRole('button', { name: 'Save preset' }).click()
    await expect(panel.locator('.props-preset', { hasText: 'Faded thick box' })).toBeVisible()
    const settings = JSON.parse(readFileSync(join(userData, 'settings.json'), 'utf8'))
    expect(settings.toolDefaults.rectangle).toMatchObject({ opacity: 0.5, lineWidth: 4 })
    expect(settings.toolPresets[0]).toMatchObject({ name: 'Faded thick box', kind: 'rectangle' })

    await win.mouse.move(p.x + 100, p.y + 450)
    await win.mouse.down()
    await win.mouse.move(p.x + 300, p.y + 520, { steps: 4 })
    await win.mouse.up()
    await expect(win.locator('.annot-svg g[opacity="0.5"]')).toHaveCount(1)

    // A text box in Times, 18 pt.
    await win.getByRole('tab', { name: 'Comment', exact: true }).click()
    await win.getByRole('button', { name: 'Text box', exact: true }).click()
    await win.mouse.click(p.x + 380, p.y + 120)
    await win.getByRole('textbox', { name: 'Text box contents' }).fill('Set out per drawing')
    await win.getByRole('textbox', { name: 'Text box contents' }).press('Control+Enter')
    await panel.getByRole('combobox', { name: 'Font', exact: true }).selectOption('Times')
    await panel.getByRole('combobox', { name: 'Font size' }).selectOption('18')
    await expect(win.locator('.annot-box.textbox')).toHaveCSS('font-family', /Times/)
    await win.screenshot({ path: test.info().outputPath('properties.png') })

    await win.keyboard.press('Control+s')
    await expect(win.locator('.tab-dirty')).toHaveCount(0)
    const py = `
import sys, json, pymupdf
d = pymupdf.open(sys.argv[1])
print(json.dumps([[a.type[1], a.opacity, a.border.get("width"), d.xref_get_key(a.xref, "DA")[1]] for a in d[0].annots()]))
`
    const saved: [string, number, number, string][] = JSON.parse(execFileSync('python', ['-c', py, pdfPath]).toString())
    const sq = saved.find((s) => s[0] === 'Square')!
    expect(sq[1]).toBeCloseTo(0.5, 2)
    expect(sq[2]).toBe(4)
    expect(saved.find((s) => s[0] === 'FreeText')![3]).toMatch(/\/TiRo 18 Tf/)
    expect(problems).toEqual([])
    await app.close()

    // Reopen: the text box comes back in Times; the rectangle tool still starts faded and thick.
    app = await launch()
    win = await app.firstWindow()
    await expect(win.locator('.page')).toHaveCount(6)
    await expect(win.locator('.annot-box.textbox')).toHaveCSS('font-family', /Times/)
    await win.getByRole('tab', { name: 'Draw' }).click()
    await win.getByRole('button', { name: 'Rectangle', exact: true }).click()
    await win.mouse.move(p.x + 100, p.y + 600)
    await win.mouse.down()
    await win.mouse.move(p.x + 250, p.y + 650, { steps: 4 })
    await win.mouse.up()
    await expect(win.locator('.annot-svg g[opacity="0.5"]')).not.toHaveCount(0)
  } finally {
    await app.close()
    rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 })
  }
})
