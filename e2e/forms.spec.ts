import { _electron as electron, expect, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(__dirname, '..')

/** Field values and the text drawn in each field's appearance stream, read with PyMuPDF. */
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
    out.setdefault(w.field_name, {"value": str(w.field_value), "drawn": ""})
    out[w.field_name]["drawn"] += drawn
print(json.dumps(out))
`
  return JSON.parse(execFileSync('python', ['-c', py, path]).toString())
}

/** How pdf-lib writes text into an appearance stream: a hex string. */
const hex = (t: string) => Buffer.from(t, 'latin1').toString('hex').toUpperCase()

test('forms: every field type can be filled in, saved, and shown again', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'openpdf-e2e-'))
  const pdfPath = join(dir, 'form.pdf')
  execFileSync(process.execPath, ['--import', 'tsx', join(root, 'scripts', 'make-form-pdf.mts'), pdfPath], { cwd: root })
  const app = await electron.launch({ args: ['.', pdfPath], cwd: root, env: { ...process.env, OPENPDF_E2E: '1', OPENPDF_E2E_USERDATA: join(dir, 'ud'), OPENPDF_E2E_DISCARD: '1' } })
  try {
    const win = await app.firstWindow()
    const problems: string[] = []
    win.on('pageerror', (e) => problems.push(e.message))
    await expect(win.locator('.page')).toHaveCount(1)
    await win.getByRole('tab', { name: 'Forms', exact: true }).click()
    await expect(win.getByText('Fill (7 fields)')).toBeVisible()

    // The file's values show in the controls.
    const name = win.getByRole('textbox', { name: 'fullname' })
    await expect(name).toHaveValue('Jane Citizen')
    await expect(win.getByRole('checkbox', { name: 'accept' })).toBeChecked()
    await expect(win.getByRole('radio', { name: 'trade: Parks' })).toBeChecked()
    await expect(win.getByRole('combobox', { name: 'state' })).toHaveValue('QLD')

    await name.fill('Sam Smith')
    await win.getByRole('checkbox', { name: 'accept' }).uncheck()
    await win.getByRole('radio', { name: 'trade: Civil' }).check()
    await win.getByRole('combobox', { name: 'state' }).selectOption('VIC')
    await win.getByRole('listbox', { name: 'tools' }).selectOption('Grader')
    await win.getByRole('textbox', { name: 'notes' }).fill('Line one\nLine two')
    await expect(win.locator('.tab-dirty')).toHaveCount(1)

    await win.keyboard.press('Control+s')
    await expect(win.locator('.tab-dirty')).toHaveCount(0)
    const out = inspect(pdfPath)
    expect(out.fullname.value).toBe('Sam Smith')
    expect(out.fullname.drawn.toUpperCase()).toContain(hex('Sam Smith'))
    expect(out.accept.value).toBe('Off')
    expect(out.trade.value).toBe('0')
    expect(out.state.value).toBe('VIC')
    expect(out.tools.value).toBe('Grader')
    expect(out.notes.value).toBe('Line one\nLine two')
    expect(out.notes.drawn.toUpperCase()).toContain(hex('Line two'))

    // After the reload the controls show what was saved.
    await expect(win.getByRole('textbox', { name: 'fullname' })).toHaveValue('Sam Smith')
    await expect(win.getByRole('radio', { name: 'trade: Civil' })).toBeChecked()
    await expect(win.getByRole('checkbox', { name: 'accept' })).not.toBeChecked()
    expect(problems).toEqual([])
  } finally {
    await app.close()
    rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 })
  }
})
