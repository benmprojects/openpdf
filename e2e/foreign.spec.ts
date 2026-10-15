import { _electron as electron, expect, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(__dirname, '..')

/** [type, rect, dashes] of each annotation on page 1, read with PyMuPDF. */
function annots(path: string): [string, number[], number][] {
  const py = `
import sys, json, pymupdf
d = pymupdf.open(sys.argv[1])
print(json.dumps([[a.type[1], [round(v) for v in a.rect], len(a.border.get("dashes") or [])] for a in d[0].annots()]))
`
  return JSON.parse(execFileSync('python', ['-c', py, path]).toString())
}

test("another tool's annotations: arrows, dashes and callouts are editable, the rest can be moved and deleted", async () => {
  const dir = mkdtempSync(join(tmpdir(), 'openpdf-e2e-'))
  const pdfPath = join(dir, 'foreign.pdf')
  execFileSync('python', [join(root, 'scripts', 'make-foreign-pdf.py'), pdfPath])
  const before = annots(pdfPath)
  const app = await electron.launch({ args: ['.', pdfPath], cwd: root, env: { ...process.env, OPENPDF_E2E: '1', OPENPDF_E2E_USERDATA: join(dir, 'ud'), OPENPDF_E2E_DISCARD: '1' } })
  try {
    const win = await app.firstWindow()
    const problems: string[] = []
    win.on('pageerror', (e) => problems.push(e.message))
    await expect(win.locator('.page')).toHaveCount(1)
    const page = win.locator('.page').first()
    // Callout imported as one of ours (box with text); stamp and file attachment as movable foreign annotations.
    await expect(page.locator('.annot-box.callout')).toHaveCount(1)
    await expect(page.locator('.annot-foreign')).toHaveCount(2)
    // The comment list shows all five.
    await win.getByRole('tab', { name: 'Comments', exact: true }).click()
    await expect(win.getByRole('list', { name: 'Comments' }).locator('li.comment')).toHaveCount(5)
    await expect(win.getByRole('list', { name: 'Comments' }).getByText('Arrow', { exact: true })).toHaveCount(1)

    // Move the stamp (foreign) by dragging it.
    const stamp = page.locator('.annot-foreign').first()
    await stamp.evaluate((el) => el.scrollIntoView({ block: 'center' }))
    await win.waitForTimeout(200)
    const sb = (await stamp.boundingBox())!
    await win.mouse.move(sb.x + sb.width / 2, sb.y + sb.height / 2)
    await win.mouse.down()
    await win.mouse.move(sb.x + sb.width / 2 + 80, sb.y + sb.height / 2 + 40, { steps: 5 })
    await win.mouse.up()
    await expect(win.locator('.tab-dirty')).toHaveCount(1)

    // Delete the file attachment (foreign).
    await page.locator('.annot-foreign').nth(1).click({ force: true })
    await win.keyboard.press('Delete')
    await expect(page.locator('.annot-foreign')).toHaveCount(1)

    // Recolour the dashed rectangle: it must stay dashed when rewritten.
    await win.locator('.scroller').evaluate((el) => (el.scrollTop = 0))
    await win.waitForTimeout(200)
    const z = Number((await win.locator('.zoom-now').textContent())!.replace('%', '')) / 100
    const pb = (await page.boundingBox())!
    await win.mouse.click(pb.x + 80 * z, pb.y + 300 * z) // its left edge
    await win.getByRole('tab', { name: 'Draw' }).click()
    await win.getByRole('button', { name: 'Colour #1f5fd1' }).click()

    await win.keyboard.press('Control+s')
    await expect(win.locator('.tab-dirty')).toHaveCount(0)
    const after = annots(pdfPath)
    expect(after.map((a) => a[0]).sort()).toEqual(['FreeText', 'Line', 'Square', 'Stamp'])
    const stampBefore = before.find((a) => a[0] === 'Stamp')![1]
    const stampAfter = after.find((a) => a[0] === 'Stamp')![1]
    expect(stampAfter[0] - stampBefore[0]).toBeGreaterThan(30) // moved right
    expect(stampAfter[2] - stampAfter[0]).toBe(stampBefore[2] - stampBefore[0]) // same size
    expect(after.find((a) => a[0] === 'Square')![2]).toBeGreaterThan(0) // still dashed
    expect(problems).toEqual([])
  } finally {
    await app.close()
    rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 })
  }
})
