import { _electron as electron, expect, test, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(__dirname, '..')

/** A file's text, or nothing while it is not there yet (expect.poll does not retry when its callback throws). */
const readText = (path: string): string => (existsSync(path) ? readFileSync(path, 'utf8') : '')

const MAKE = `
import sys, pymupdf
d = pymupdf.open()
heads = [("Introduction", 24), ("Background", 16), ("Scope of works", 16), ("Appendix", 24)]
for title, size in heads:
    p = d.new_page(width=595, height=842)
    p.insert_text((60, 90), title, fontsize=size)
    for i in range(6):
        p.insert_text((60, 140 + i * 18), "This is ordinary body text on the page, line %d, and it goes on a while." % (i + 1), fontsize=11)
d.save(sys.argv[1])
`

interface Outline {
  toc: [number, string, number][]
  /** Per bookmark title: /F, /C and /Dest as written in the file. */
  raw: Record<string, { F: string; C: string; Dest: string }>
}

function inspect(path: string): Outline {
  const py = `
import sys, json, pymupdf
d = pymupdf.open(sys.argv[1])
raw = {}
for x in range(1, d.xref_length()):
    t = d.xref_get_key(x, "Title")
    if t[0] == "null" or t[0] == "xref":
        continue
    raw[t[1]] = {"F": d.xref_get_key(x, "F")[1], "C": d.xref_get_key(x, "C")[1], "Dest": d.xref_get_key(x, "Dest")[1]}
print(json.dumps({"toc": d.get_toc(), "raw": raw}))
`
  return JSON.parse(execFileSync('python', ['-c', py, path]).toString())
}

async function save(win: Page) {
  await win.keyboard.press('Control+s')
  await expect(win.locator('.tab-dirty')).toHaveCount(0)
}

test('generate bookmarks from headings, style them, export, import, expand and collapse', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'openpdf-e2e-'))
  const pdfPath = join(dir, 'headings.pdf')
  const exportPath = join(dir, 'outline.out')
  const importPath = join(dir, 'outline.txt')
  execFileSync('python', ['-c', MAKE, pdfPath])
  writeFileSync(importPath, 'Imported A\t1\r\n\tImported B\t2\r\n')
  const app = await electron.launch({
    args: ['.', pdfPath],
    cwd: root,
    env: { ...process.env, OPENPDF_E2E: '1', OPENPDF_E2E_USERDATA: join(dir, 'ud'), OPENPDF_E2E_DISCARD: '1', OPENPDF_E2E_SAVE_TEXT: exportPath, OPENPDF_E2E_PICK: importPath }
  })
  try {
    const win = await app.firstWindow()
    const problems: string[] = []
    win.on('pageerror', (e) => problems.push(e.message))
    await expect(win.locator('.page')).toHaveCount(4)
    await win.getByRole('tab', { name: 'Bookmarks' }).click()
    await expect(win.getByText('This document has no bookmarks.')).toBeVisible()

    // Generate from headings: the 24 pt lines are top level, the 16 pt lines sit under them.
    await win.getByRole('button', { name: 'Generate bookmarks' }).click()
    const gen = win.getByRole('dialog', { name: 'Generate bookmarks' })
    await gen.getByRole('button', { name: 'Generate', exact: true }).click()
    const tree = win.getByRole('tree')
    await expect(tree.getByRole('button', { name: 'Introduction' })).toBeVisible({ timeout: 30_000 })
    await win.getByRole('button', { name: 'Expand all' }).click()
    await expect(tree.getByRole('button', { name: 'Scope of works' })).toBeVisible()
    await win.getByRole('button', { name: 'Collapse all' }).click()
    await expect(tree.getByRole('button', { name: 'Scope of works' })).toHaveCount(0)
    await win.getByRole('button', { name: 'Expand all' }).click()

    // Style one: bold, italic, red.
    await tree.getByRole('button', { name: 'Scope of works' }).click()
    await win.getByRole('button', { name: 'Bold', exact: true }).click()
    await win.getByRole('button', { name: 'Italic', exact: true }).click()
    await win.getByLabel('Bookmark colour').fill('#ff0000')
    await expect(tree.getByRole('button', { name: 'Scope of works' })).toHaveCSS('font-weight', '700')
    // Point it at the top of what is on screen.
    await win.getByRole('button', { name: 'Set to current view' }).click()
    await save(win)
    let out = inspect(pdfPath)
    expect(out.toc.map((e) => [e[0], e[1]])).toEqual([[1, 'Introduction'], [2, 'Background'], [2, 'Scope of works'], [1, 'Appendix']])
    expect(out.toc.map((e) => e[2])).toEqual([1, 2, 3, 4])
    expect(out.raw['Scope of works'].F).toBe('3')
    expect(out.raw['Scope of works'].C).toMatch(/^\[1 0 0\]|^\[1\.0 0\.0 0\.0\]/)
    expect(out.raw['Scope of works'].Dest).toContain('/XYZ')

    // Export as CSV and as text.
    await win.getByRole('button', { name: 'Export bookmarks as CSV' }).click()
    await expect.poll(() => readText(exportPath)).toContain('Level,Title,Page')
    const csv = readText(exportPath)
    expect(csv).toContain('Level,Title,Page')
    expect(csv).toContain('2,Scope of works,3')
    await win.getByRole('button', { name: 'Export bookmarks as text' }).click()
    await expect.poll(() => readText(exportPath)).toContain('\tScope of works\t3')

    // Import a text outline: it is added after the existing bookmarks.
    await win.getByRole('button', { name: 'Import bookmarks' }).click()
    await expect.poll(async () => (await tree.getByRole('button', { name: 'Imported A' }).count()) > 0).toBe(true)
    await save(win)
    out = inspect(pdfPath)
    expect(out.toc.map((e) => [e[0], e[1], e[2]])).toEqual([[1, 'Introduction', 1], [2, 'Background', 2], [2, 'Scope of works', 3], [1, 'Appendix', 4], [1, 'Imported A', 1], [2, 'Imported B', 2]])
    // The style survives other edits.
    expect(out.raw['Scope of works'].F).toBe('3')

    // One bookmark for each page replaces them all.
    await win.getByRole('button', { name: 'Generate bookmarks' }).click()
    const gen2 = win.getByRole('dialog', { name: 'Generate bookmarks' })
    await gen2.getByRole('radio', { name: 'One for each page' }).check()
    await gen2.getByRole('button', { name: 'Generate', exact: true }).click()
    await expect.poll(async () => (await tree.getByRole('button', { name: 'Page 4' }).count()) > 0).toBe(true)
    await save(win)
    out = inspect(pdfPath)
    expect(out.toc.map((e) => [e[0], e[1], e[2]])).toEqual([[1, 'Page 1', 1], [1, 'Page 2', 2], [1, 'Page 3', 3], [1, 'Page 4', 4]])
    expect(problems).toEqual([])
  } finally {
    await app.close()
    rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 })
  }
})
