import { _electron as electron, expect, test, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(__dirname, '..')

/** Drags across part of the first text line of page 1 to select it. */
async function selectWords(win: Page, from: number, to: number) {
  const p = (await win.locator('.page').first().boundingBox())!
  const z = Number((await win.locator('.zoom-now').textContent())!.replace('%', '')) / 100
  // make-test-pdf.py puts the first body line at about 105 pt from the top, starting at 72 pt.
  const y = p.y + 103 * z
  await win.mouse.move(p.x + from * z, y)
  await win.mouse.down()
  await win.mouse.move(p.x + to * z, y, { steps: 6 })
  await win.mouse.up()
}

function annotTypes(path: string): { type: string; content: string; irt: boolean; it: string }[] {
  const py = `
import sys, json, pymupdf
d = pymupdf.open(sys.argv[1])
out = []
for a in d[0].annots():
    x = d.xref_get_key(a.xref, "IRT")
    it = d.xref_get_key(a.xref, "IT")
    out.append({"type": a.type[1], "content": a.info.get("content", ""), "irt": x[0] == "xref", "it": it[1]})
print(json.dumps(out))
`
  return JSON.parse(execFileSync('python', ['-c', py, path]).toString())
}

test('squiggly, replace text and insert text are drawn, saved and read back', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'openpdf-e2e-'))
  const pdfPath = join(dir, 'edits.pdf')
  execFileSync('python', [join(root, 'scripts', 'make-test-pdf.py'), pdfPath])
  const launch = () => electron.launch({ args: ['.', pdfPath], cwd: root, env: { ...process.env, OPENPDF_E2E: '1', OPENPDF_E2E_USERDATA: join(dir, 'ud') } })
  let app = await launch()
  try {
    let win = await app.firstWindow()
    const problems: string[] = []
    win.on('pageerror', (e) => problems.push(e.message))
    await expect(win.locator('.page')).toHaveCount(6)
    await win.getByRole('tab', { name: 'Comment', exact: true }).click()

    await selectWords(win, 75, 150)
    await win.getByRole('button', { name: 'Squiggly' }).click()
    await expect(win.locator('.annot-wave')).toHaveCount(1)

    await selectWords(win, 200, 260)
    await win.getByRole('button', { name: 'Replace text' }).click()
    const replacement = win.getByRole('textbox', { name: 'Replacement text' })
    await expect(replacement).toBeFocused()
    await replacement.fill('swift')
    await replacement.press('Control+Enter')
    await expect(win.locator('.annot-caret-mark')).toHaveCount(1)

    await win.getByRole('button', { name: 'Insert text' }).click()
    const p = (await win.locator('.page').first().boundingBox())!
    const z = Number((await win.locator('.zoom-now').textContent())!.replace('%', '')) / 100
    await win.mouse.click(p.x + 300 * z, p.y + 103 * z)
    const insert = win.getByRole('textbox', { name: 'Text to insert' })
    await expect(insert).toBeFocused()
    await insert.fill('very ')
    await insert.press('Control+Enter')
    await expect(win.locator('.annot-caret-mark')).toHaveCount(2)
    await win.screenshot({ path: test.info().outputPath('textedits.png') })

    await win.keyboard.press('Control+s')
    await expect(win.locator('.tab-dirty')).toHaveCount(0)
    const types = annotTypes(pdfPath)
    expect(types.map((t) => t.type).sort()).toEqual(['Caret', 'Caret', 'Squiggly', 'StrikeOut'])
    const strike = types.find((t) => t.type === 'StrikeOut')!
    expect(strike.irt).toBe(true)
    expect(strike.it).toBe('/StrikeOutTextEdit')
    expect(types.filter((t) => t.type === 'Caret').map((t) => t.content).sort()).toEqual(['swift', 'very '])
    expect(problems).toEqual([])
    await app.close()

    // Reopen: PDFium draws them, and they import as editable annotations again.
    app = await launch()
    win = await app.firstWindow()
    await expect(win.locator('.page')).toHaveCount(6)
    await expect(win.locator('.page').first().locator('.annot-caret')).toHaveCount(2)
  } finally {
    await app.close()
    rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 })
  }
})
