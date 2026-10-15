import { _electron as electron, expect, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(__dirname, '..')

test('the eraser splits a pencil stroke where it crosses it', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'openpdf-e2e-'))
  const pdfPath = join(dir, 'erase.pdf')
  execFileSync('python', [join(root, 'scripts', 'make-test-pdf.py'), pdfPath])
  const app = await electron.launch({ args: ['.', pdfPath], cwd: root, env: { ...process.env, OPENPDF_E2E: '1', OPENPDF_E2E_USERDATA: join(dir, 'ud'), OPENPDF_E2E_DISCARD: '1' } })
  try {
    const win = await app.firstWindow()
    await expect(win.locator('.page')).toHaveCount(6)
    await win.getByRole('tab', { name: 'Draw' }).click()
    const p = (await win.locator('.page').first().boundingBox())!

    await win.getByRole('button', { name: 'Pencil', exact: true }).click()
    await win.mouse.move(p.x + 100, p.y + 450)
    await win.mouse.down()
    for (let x = 100; x <= 400; x += 10) await win.mouse.move(p.x + x, p.y + 450 + ((x / 10) % 2) * 3)
    await win.mouse.up()

    await win.getByRole('button', { name: 'Eraser', exact: true }).click()
    await win.mouse.move(p.x + 250, p.y + 410)
    await win.mouse.down()
    await win.mouse.move(p.x + 250, p.y + 490, { steps: 6 })
    await win.mouse.up()

    await win.keyboard.press('Control+s')
    await expect(win.locator('.tab-dirty')).toHaveCount(0)
    const py = `
import sys, json, pymupdf
d = pymupdf.open(sys.argv[1])
print(json.dumps([len(a.vertices) for a in d[0].annots() if a.type[1] == "Ink"]))
`
    expect(JSON.parse(execFileSync('python', ['-c', py, pdfPath]).toString())).toEqual([2])
  } finally {
    await app.close()
    rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 })
  }
})
