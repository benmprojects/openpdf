import { _electron as electron, expect, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(__dirname, '..')

function freeTexts(path: string): { it: string; content: string; cl: boolean }[] {
  const py = `
import sys, json, pymupdf
d = pymupdf.open(sys.argv[1])
out = []
for a in d[0].annots():
    if a.type[1] != "FreeText": continue
    out.append({"it": d.xref_get_key(a.xref, "IT")[1], "content": a.info.get("content", ""), "cl": d.xref_get_key(a.xref, "CL")[0] == "array"})
print(json.dumps(out))
`
  return JSON.parse(execFileSync('python', ['-c', py, path]).toString())
}

test('typewriter and callout: drawn, typed, saved and read back', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'openpdf-e2e-'))
  const pdfPath = join(dir, 'callout.pdf')
  execFileSync('python', [join(root, 'scripts', 'make-test-pdf.py'), pdfPath])
  const launch = () => electron.launch({ args: ['.', pdfPath], cwd: root, env: { ...process.env, OPENPDF_E2E: '1', OPENPDF_E2E_USERDATA: join(dir, 'ud'), OPENPDF_E2E_DISCARD: '1' } })
  let app = await launch()
  try {
    let win = await app.firstWindow()
    const problems: string[] = []
    win.on('pageerror', (e) => problems.push(e.message))
    await expect(win.locator('.page')).toHaveCount(6)
    await win.getByRole('tab', { name: 'Comment' }).click()
    const p = (await win.locator('.page').first().boundingBox())!

    // Typewriter: click, type two lines; the box fits the text.
    await win.getByRole('button', { name: 'Typewriter', exact: true }).click()
    await win.mouse.click(p.x + 100, p.y + 420)
    const ed = win.getByRole('textbox', { name: 'Text box contents' })
    await expect(ed).toBeFocused()
    await ed.fill('Typed straight onto the page\nSecond line')
    await ed.press('Control+Enter')
    const tw = win.locator('.annot-box.typewriter')
    await expect(tw).toHaveText(/Typed straight onto the page/)
    const twBox = (await tw.boundingBox())!
    expect(twBox.width).toBeGreaterThan(120)

    // Callout: drag from a point on the page to where the box goes.
    await win.getByRole('button', { name: 'Callout', exact: true }).click()
    await win.mouse.move(p.x + 150, p.y + 600)
    await win.mouse.down()
    await win.mouse.move(p.x + 400, p.y + 520, { steps: 6 })
    await win.mouse.up()
    const ced = win.getByRole('textbox', { name: 'Text box contents' })
    await expect(ced).toBeFocused()
    await ced.fill('Check this level')
    await ced.press('Control+Enter')
    await expect(win.locator('.annot-box.callout')).toHaveText('Check this level')
    await expect(win.locator('.annot-callout-line')).toHaveCount(1)
    await win.screenshot({ path: test.info().outputPath('callout.png') })

    await win.keyboard.press('Control+s')
    await expect(win.locator('.tab-dirty')).toHaveCount(0)
    const ft = freeTexts(pdfPath)
    const typewriter = ft.find((f) => f.it === '/FreeTextTypeWriter')!
    const callout = ft.find((f) => f.it === '/FreeTextCallout')!
    expect(typewriter.content).toBe('Typed straight onto the page\nSecond line')
    expect(callout.content).toBe('Check this level')
    expect(callout.cl).toBe(true)
    expect(problems).toEqual([])
    await app.close()

    // Reopen: the typewriter is editable again; the callout stays drawn by PDFium.
    app = await launch()
    win = await app.firstWindow()
    await expect(win.locator('.page')).toHaveCount(6)
    await expect(win.locator('.annot-box.typewriter')).toHaveCount(1)
    await expect(win.locator('.annot-box.callout')).toHaveCount(0)
  } finally {
    await app.close()
    rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 })
  }
})
