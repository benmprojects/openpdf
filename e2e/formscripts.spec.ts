import { _electron as electron, expect, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(__dirname, '..')

/** Field values and the text drawn in each field's appearance, read with PyMuPDF. */
function inspect(path: string): Record<string, { value: string; drawn: string }> {
  const py = `
import sys, json, pymupdf
d = pymupdf.open(sys.argv[1])
out = {}
for w in d[0].widgets():
    drawn = ""
    try:
        t, ap = d.xref_get_key(w.xref, "AP/N")
        if t == "xref":
            drawn = d.xref_stream(int(ap.split()[0])).decode("latin-1")
    except Exception:
        pass
    out[w.field_name] = {"value": str(w.field_value), "drawn": drawn}
print(json.dumps(out))
`
  return JSON.parse(execFileSync('python', ['-c', py, path]).toString())
}

const hex = (t: string) => Buffer.from(t, 'latin1').toString('hex').toUpperCase()

test('form scripts: formats, calculation, validation and button scripts run in the sandbox', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'openpdf-e2e-'))
  const pdfPath = join(dir, 'calc.pdf')
  execFileSync(process.execPath, ['--import', 'tsx', join(root, 'scripts', 'make-calc-pdf.mts'), pdfPath], { cwd: root })
  const app = await electron.launch({ args: ['.', pdfPath], cwd: root, env: { ...process.env, OPENPDF_E2E: '1', OPENPDF_E2E_USERDATA: join(dir, 'ud'), OPENPDF_E2E_DISCARD: '1' } })
  try {
    const win = await app.firstWindow()
    const problems: string[] = []
    win.on('pageerror', (e) => problems.push(e.message))
    await expect(win.locator('.page')).toHaveCount(1)
    await win.getByRole('tab', { name: 'Forms', exact: true }).click()
    const a = win.getByRole('textbox', { name: 'a', exact: true })
    const b = win.getByRole('textbox', { name: 'b', exact: true })
    const total = win.getByRole('textbox', { name: 'total' })
    const rate = win.getByRole('textbox', { name: 'rate' })

    // Typing shows what was typed; leaving the field formats it, and the total follows.
    await a.fill('10')
    await expect(a).toHaveValue('10')
    await a.press('Tab')
    await expect(a).toHaveValue('10.00')
    await b.fill('5.5')
    await b.press('Tab')
    await expect(b).toHaveValue('5.50')
    await expect(total).toHaveValue('$15.50')
    // The total is worked out, not typed into.
    await expect(total).toHaveAttribute('readonly', '')

    // A value outside the range is refused with the script's message, and the old (empty) value comes back.
    await rate.fill('150')
    await rate.press('Tab')
    await expect(win.getByText('The value must be between 0 and 100.')).toBeVisible()
    await expect(rate).toHaveValue('')
    await rate.fill('50')
    await rate.press('Tab')
    await expect(rate).toHaveValue('50')

    // A button script sets a field; the calculation follows.
    await win.getByRole('button', { name: 'setA', exact: true }).focus()
    await win.keyboard.press('Enter')
    await expect(a).toHaveValue('5.00')
    await expect(total).toHaveValue('$10.50')

    // Saved: the value is what was entered, the appearance is the formatted text.
    await win.keyboard.press('Control+s')
    await expect(win.locator('.tab-dirty')).toHaveCount(0)
    const out = inspect(pdfPath)
    expect(out.total.value).toBe('10.5')
    expect(out.total.drawn.toUpperCase()).toContain(hex('$10.50'))
    expect(out.a.value).toBe('5')
    expect(out.a.drawn.toUpperCase()).toContain(hex('5.00'))
    expect(out.rate.value).toBe('50')

    // After the reload the formats and the calculation are still in force.
    await expect(win.getByRole('textbox', { name: 'total' })).toHaveValue('$10.50')
    await win.getByRole('button', { name: 'wipe', exact: true }).focus()
    await win.keyboard.press('Enter')
    await expect(win.getByRole('textbox', { name: 'a', exact: true })).toHaveValue('')
    // The total is worked out again from the empty fields, as in Acrobat: nothing plus nothing is $0.00.
    await expect(win.getByRole('textbox', { name: 'total' })).toHaveValue('$0.00')
    expect(problems).toEqual([])
  } finally {
    await app.close()
    rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 })
  }
})
