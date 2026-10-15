import { _electron as electron, expect, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(__dirname, '..')

// Copy A: three comments. Copy B: the first with new text, the second unchanged, the third missing, plus a new one.
const MAKE = `
import sys, pymupdf
def build(path, variant):
    doc = pymupdf.open()
    p = doc.new_page(width=595, height=842)
    p.insert_text((60, 80), "Compare comments", fontsize=20)
    a = p.add_rect_annot(pymupdf.Rect(60, 150, 200, 220)); a.set_info(content="Check footing" if variant == "A" else "Check footing, revised"); a.update()
    b = p.add_text_annot((300, 160), "Confirm levels"); b.update()
    if variant == "A":
        c = p.add_circle_annot(pymupdf.Rect(60, 300, 160, 380)); c.set_info(content="Only in A"); c.update()
    else:
        d = p.add_rect_annot(pymupdf.Rect(300, 400, 450, 470)); d.set_info(content="Only in B"); d.update()
    doc.save(path)
build(sys.argv[1], "A")
build(sys.argv[2], "B")
`

test('compare comments with another copy, add the missing one and take a revised text', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'openpdf-e2e-'))
  const a = join(dir, 'A.pdf')
  const b = join(dir, 'B.pdf')
  execFileSync('python', ['-c', MAKE, a, b])
  const app = await electron.launch({ args: ['.', a], cwd: root, env: { ...process.env, OPENPDF_E2E: '1', OPENPDF_E2E_USERDATA: join(dir, 'ud'), OPENPDF_E2E_PICK: b, OPENPDF_E2E_DISCARD: '1' } })
  try {
    const win = await app.firstWindow()
    const problems: string[] = []
    win.on('pageerror', (e) => problems.push(e.message))
    await expect(win.locator('.page')).toHaveCount(1)
    await win.getByRole('tab', { name: 'File', exact: true }).click()
    await win.getByRole('button', { name: 'Compare…' }).click()
    const panel = win.getByRole('complementary', { name: 'Compare comments' })
    await expect(panel).toContainText('1 the same, 1 changed, 1 only there, 1 only here')
    await expect(panel.getByRole('list', { name: 'Changed comments' })).toContainText('Check footing, revised')

    // Bring in the comment only in B, and take B's revised text.
    await panel.getByRole('list', { name: 'Comments only in the other copy' }).getByRole('button', { name: /Add/ }).click()
    await panel.getByRole('button', { name: 'Use theirs' }).click()
    await expect(panel).toContainText('2 the same, 0 changed, 0 only there, 1 only here')

    await win.getByRole('tab', { name: 'Comments', exact: true }).click()
    const list = win.getByRole('list', { name: 'Comments', exact: true })
    await expect(list.locator('li.comment')).toHaveCount(4)
    await expect(list).toContainText('Only in B')
    await expect(list).toContainText('Check footing, revised')
    expect(problems).toEqual([])
  } finally {
    await app.close()
    rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 })
  }
})
