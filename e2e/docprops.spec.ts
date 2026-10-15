import { _electron as electron, expect, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(__dirname, '..')

/** Info dictionary and XMP, read with PyMuPDF. */
function inspect(path: string): { meta: Record<string, string>; xmp: string } {
  const py = `
import sys, json, pymupdf
d = pymupdf.open(sys.argv[1])
print(json.dumps({"meta": {k: v for k, v in d.metadata.items() if v}, "xmp": d.get_xml_metadata()}))
`
  return JSON.parse(execFileSync('python', ['-c', py, path]).toString())
}

test('document properties are edited, kept in XMP, and can be removed', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'openpdf-e2e-'))
  const pdfPath = join(dir, 'props.pdf')
  execFileSync('python', [join(root, 'scripts', 'make-test-pdf.py'), pdfPath])
  const app = await electron.launch({ args: ['.', pdfPath], cwd: root, env: { ...process.env, OPENPDF_E2E: '1', OPENPDF_E2E_USERDATA: join(dir, 'ud'), OPENPDF_E2E_DISCARD: '1' } })
  try {
    const win = await app.firstWindow()
    const problems: string[] = []
    win.on('pageerror', (e) => problems.push(e.message))
    await expect(win.locator('.page')).toHaveCount(6)
    await win.getByRole('tab', { name: 'File', exact: true }).click()
    await win.getByRole('button', { name: 'Properties' }).click()
    const dialog = win.getByRole('dialog', { name: 'Document properties' })
    await dialog.getByRole('textbox', { name: 'Title' }).fill('Eagle Farm drainage plans')
    await dialog.getByRole('textbox', { name: 'Author' }).fill('Example Constructions')
    await dialog.getByRole('textbox', { name: 'Keywords' }).fill('civil, drainage')
    await dialog.getByRole('button', { name: 'Apply' }).click()
    await expect(win.getByText('Document properties updated')).toBeVisible()
    await win.keyboard.press('Control+s')
    await expect(win.locator('.tab-dirty')).toHaveCount(0)
    let info = inspect(pdfPath)
    expect(info.meta.title).toBe('Eagle Farm drainage plans')
    expect(info.meta.author).toBe('Example Constructions')
    expect(info.meta.keywords).toBe('civil, drainage')
    expect(info.xmp).toContain('Eagle Farm drainage plans')
    expect(info.xmp).toContain('<pdf:Keywords>civil, drainage</pdf:Keywords>')

    // The saved values show again when the dialog is reopened.
    await win.getByRole('button', { name: 'Properties' }).click()
    await expect(dialog.getByRole('textbox', { name: 'Title' })).toHaveValue('Eagle Farm drainage plans')
    await dialog.getByRole('button', { name: 'Remove all metadata' }).click()
    await expect(win.getByText('All metadata removed')).toBeVisible()
    await win.keyboard.press('Control+s')
    await expect(win.locator('.tab-dirty')).toHaveCount(0)
    info = inspect(pdfPath)
    expect(info.meta.title).toBeUndefined()
    expect(info.meta.author).toBeUndefined()
    expect(info.xmp).toBe('')
    expect(problems).toEqual([])
  } finally {
    await app.close()
    rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 })
  }
})
