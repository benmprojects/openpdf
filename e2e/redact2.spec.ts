import { _electron as electron, expect, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(__dirname, '..')

const MAKE = `
import sys, pymupdf
d = pymupdf.open()
p = d.new_page(width=420, height=300)
p.insert_text((50, 60), "Contact joe@example.com today", fontsize=14)
p.insert_text((50, 110), "Account SECRET-4471 balance", fontsize=14)
p.insert_text((50, 160), "Second SECRET-9999 line", fontsize=14)
p.insert_text((50, 210), "Public paragraph stays", fontsize=14)
d.save(sys.argv[1])
`

/** The page's text, and how many streams anywhere in the file hold the given words. */
function inspect(path: string, words: string[]): { text: string; streams: Record<string, number> } {
  const py = `
import sys, json, pymupdf
d = pymupdf.open(sys.argv[1])
words = sys.argv[2:]
out = {w: 0 for w in words}
for x in range(1, d.xref_length()):
    try:
        if d.xref_is_stream(x):
            s = d.xref_stream(x) or b''
            for w in words:
                if w.encode() in s:
                    out[w] += 1
    except Exception:
        pass
print(json.dumps({"text": d[0].get_text(), "streams": out}))
`
  return JSON.parse(execFileSync('python', ['-c', py, path, ...words]).toString())
}

test('find and redact by pattern, mark properties with overlay text, apply a single mark', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'openpdf-e2e-'))
  const pdfPath = join(dir, 'redact2.pdf')
  execFileSync('python', ['-c', MAKE, pdfPath])
  const app = await electron.launch({ args: ['.', pdfPath], cwd: root, env: { ...process.env, OPENPDF_E2E: '1', OPENPDF_E2E_USERDATA: join(dir, 'ud'), OPENPDF_E2E_DISCARD: '1' } })
  try {
    const win = await app.firstWindow()
    const problems: string[] = []
    win.on('pageerror', (e) => problems.push(e.message))
    await expect(win.locator('.page')).toHaveCount(1)
    await win.getByRole('tab', { name: 'Redact', exact: true }).click()

    // Find and redact: the e-mail preset, then a pattern of our own.
    await win.getByRole('button', { name: 'Find and redact' }).click()
    const find = win.getByRole('dialog', { name: 'Find and redact' })
    await find.getByRole('checkbox', { name: 'E-mail addresses' }).check()
    await find.getByRole('button', { name: 'Find', exact: true }).click()
    await expect(find.getByText('1 match on 1 page')).toBeVisible()
    await find.getByRole('textbox', { name: 'Other text or pattern' }).fill('SECRET-\\d+')
    await find.getByRole('checkbox', { name: 'Regular expression' }).check()
    await find.getByRole('button', { name: 'Find', exact: true }).click()
    await expect(find.getByText('3 matches on 1 page')).toBeVisible()
    await find.getByRole('button', { name: 'Mark all matches' }).click()
    await expect(win.locator('.redact-mark')).toHaveCount(3)

    // Right-click the SECRET-4471 mark (second): give it overlay text.
    await win.locator('.redact-mark').nth(1).click({ button: 'right' })
    const props = win.getByRole('dialog', { name: 'Redaction mark' })
    await props.getByRole('textbox', { name: 'Overlay text' }).fill('REDACTED')
    await props.getByRole('button', { name: 'OK', exact: true }).click()
    await expect(win.locator('.redact-mark')).toHaveCount(3)

    // Apply only that mark.
    await win.locator('.redact-mark').nth(1).click({ button: 'right' })
    await win.getByRole('dialog', { name: 'Redaction mark' }).getByRole('button', { name: 'Apply this mark' }).click()
    const confirm = win.getByRole('dialog', { name: 'Apply redactions' })
    await expect(confirm).toContainText('1 marked area')
    await confirm.getByRole('button', { name: 'Redact' }).click()
    await expect(win.getByText(/Redacted: .*removed/)).toBeVisible()
    await expect(win.locator('.redact-mark')).toHaveCount(2)

    await win.keyboard.press('Control+s')
    await expect(win.locator('.tab-dirty')).toHaveCount(0)
    let out = inspect(pdfPath, ['SECRET-4471', 'SECRET-9999', 'joe@example.com'])
    expect(out.streams['SECRET-4471']).toBe(0)
    expect(out.text).toContain('SECRET-9999')
    expect(out.text).toContain('joe@example.com')
    expect(out.text).toContain('REDACTED')
    expect(out.text).not.toContain('4471')

    // Mark properties for new marks, then apply all that is left.
    await win.getByRole('button', { name: 'Mark properties' }).click()
    const defaults = win.getByRole('dialog', { name: 'Redaction mark properties' })
    await defaults.getByRole('checkbox', { name: 'Also set this on every mark already placed' }).check()
    await defaults.getByRole('textbox', { name: 'Overlay text' }).fill('CODE-7')
    await defaults.getByRole('checkbox', { name: 'Repeat across the box' }).check()
    await defaults.getByRole('button', { name: 'OK', exact: true }).click()
    await win.getByRole('button', { name: 'Apply', exact: true }).click()
    await win.getByRole('dialog', { name: 'Apply redactions' }).getByRole('button', { name: 'Redact' }).click()
    await expect(win.locator('.redact-mark')).toHaveCount(0)
    await win.keyboard.press('Control+s')
    await expect(win.locator('.tab-dirty')).toHaveCount(0)
    out = inspect(pdfPath, ['SECRET', 'joe@example.com'])
    expect(out.streams['SECRET']).toBe(0)
    expect(out.streams['joe@example.com']).toBe(0)
    expect(out.text).toContain('CODE-7')
    expect(out.text).toContain('Public paragraph stays')
    expect(problems).toEqual([])
  } finally {
    await app.close()
    rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 })
  }
})
