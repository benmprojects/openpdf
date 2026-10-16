import { _electron as electron, expect, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(__dirname, '..')

function pageInfo(path: string): { widgets: number; text: string } {
  const py = `
import sys, json, pymupdf
d = pymupdf.open(sys.argv[1])
print(json.dumps({"widgets": len(list(d[0].widgets())), "text": d[0].get_text()}))
`
  return JSON.parse(execFileSync('python', ['-c', py, path]).toString())
}

test('form data: export as CSV, XFDF, FDF and XML, import from CSV, and flatten', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'openpdf-e2e-'))
  const pdfPath = join(dir, 'form.pdf')
  const exported = join(dir, 'exported.txt')
  execFileSync(process.execPath, ['--import', 'tsx', join(root, 'scripts', 'make-form-pdf.mts'), pdfPath], { cwd: root })
  const app = await electron.launch({
    args: ['.', pdfPath],
    cwd: root,
    env: { ...process.env, OPENPDF_E2E: '1', OPENPDF_E2E_USERDATA: join(dir, 'ud'), OPENPDF_E2E_DISCARD: '1', OPENPDF_E2E_SAVE_TEXT: exported }
  })
  try {
    const win = await app.firstWindow()
    const problems: string[] = []
    win.on('pageerror', (e) => problems.push(e.message))
    await expect(win.locator('.page')).toHaveCount(1)
    await win.getByRole('tab', { name: 'Forms', exact: true }).click()
    await win.getByRole('textbox', { name: 'fullname' }).fill('Zed Zebra')

    // Export: each format reaches the file the test hook names.
    await win.getByRole('button', { name: 'CSV', exact: true }).click()
    await expect(win.getByText(/Exported 6 fields/)).toBeVisible()
    // The CSV starts with a byte order mark so Excel reads it as UTF-8.
    const raw = readFileSync(exported, 'utf8')
    const csv = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw
    expect(csv.split(/\r?\n/)[0]).toBe('fullname,accept,trade,state,tools,notes')
    expect(csv).toContain('Zed Zebra')
    expect(csv).toContain('Parks')

    // Each export shows a notice that moves the ribbon, so press the buttons from the keyboard rather than chase them.
    const press = async (name: string) => {
      await win.getByRole('button', { name, exact: true }).focus()
      await win.keyboard.press('Enter')
    }
    await press('XFDF')
    await expect(win.getByText(/Exported 6 fields/)).toBeVisible()
    await expect.poll(() => readFileSync(exported, 'utf8')).toContain('<field name="fullname"><value>Zed Zebra</value></field>')
    await press('FDF')
    await expect(win.getByText(/Exported 6 fields/)).toBeVisible()
    await expect.poll(() => readFileSync(exported, 'latin1').startsWith('%FDF-1.2')).toBe(true)
    await press('XML')
    await expect(win.getByText(/Exported 6 fields/)).toBeVisible()
    await expect.poll(() => readFileSync(exported, 'utf8')).toContain('<field name="fullname">Zed Zebra</field>')

    // Import a CSV: the controls take the new values, and the file is not written until saved.
    const incoming = join(dir, 'incoming.csv')
    writeFileSync(incoming, 'fullname,accept,trade,state\r\nImported Name,Off,Landscape,NSW\r\n')
    await app.evaluate((_, p) => void (process.env.OPENPDF_E2E_PICK = p), incoming)
    await win.getByRole('button', { name: 'Import…' }).click()
    await expect(win.getByText(/Filled 4 of 6 fields/)).toBeVisible()
    await expect(win.getByRole('textbox', { name: 'fullname' })).toHaveValue('Imported Name')
    await expect(win.getByRole('checkbox', { name: 'accept' })).not.toBeChecked()
    await expect(win.getByRole('radio', { name: 'trade: Landscape' })).toBeChecked()
    await expect(win.getByRole('combobox', { name: 'state' })).toHaveValue('NSW')

    // Flatten: the values are written first, then the fields become page content.
    await win.getByRole('button', { name: 'Flatten' }).click()
    const flat = win.getByRole('dialog', { name: 'Flatten' })
    await flat.getByRole('radio', { name: 'Comments and annotations' }).check()
    await expect(flat.getByRole('alert')).toHaveText('There are no comments or annotations on these pages.')
    await flat.getByRole('radio', { name: 'Form fields' }).check()
    await expect(flat.getByRole('alert')).toHaveCount(0)
    await expect(flat.locator('.pod-warn')).toContainText('cannot be undone')
    await flat.getByRole('button', { name: 'Flatten' }).click()
    await expect(win.getByText(/Flattened 4 form fields|Flattened \d+ form field/)).toBeVisible()
    await expect(win.locator('.form-widget')).toHaveCount(0)
    await win.keyboard.press('Control+s')
    await expect(win.locator('.tab-dirty')).toHaveCount(0)
    const out = pageInfo(pdfPath)
    expect(out.widgets).toBe(0)
    expect(out.text).toContain('Imported Name')
    expect(out.text).toContain('NSW')
    expect(problems).toEqual([])
  } finally {
    await app.close()
    rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 })
  }
})
