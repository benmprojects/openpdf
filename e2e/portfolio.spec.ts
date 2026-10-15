import { _electron as electron, expect, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(__dirname, '..')

function makeBase(path: string): void {
  execFileSync('python', ['-c', 'import sys, pymupdf\nd = pymupdf.open()\nd.new_page(width=300, height=300).insert_text((50, 100), "Base document", fontsize=14)\nd.save(sys.argv[1])', path])
}

test('a portfolio is made from several files, opens on its file list, and the files are in the saved PDF', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'openpdf-e2e-'))
  const base = join(dir, 'base.pdf')
  makeBase(base)
  const a = join(dir, 'specification.txt')
  const b = join(dir, 'schedule.csv')
  writeFileSync(a, 'Specification text for the project.')
  writeFileSync(b, 'item,qty\npipe,40\n')
  const out = join(dir, 'pack.pdf')
  const app = await electron.launch({ args: ['.', base], cwd: root, env: { ...process.env, OPENPDF_E2E: '1', OPENPDF_E2E_USERDATA: join(dir, 'ud'), OPENPDF_E2E_DISCARD: '1', OPENPDF_E2E_PICK: [a, b].join('|'), OPENPDF_E2E_SAVE: out } })
  try {
    const win = await app.firstWindow()
    const problems: string[] = []
    win.on('pageerror', (e) => problems.push(e.message))
    await expect(win.locator('.page')).toHaveCount(1)
    await win.getByRole('tab', { name: 'Convert', exact: true }).click()
    await win.getByRole('button', { name: 'Portfolio' }).click()
    const d = win.getByRole('dialog', { name: 'Create a portfolio' })
    await d.getByRole('textbox', { name: 'Portfolio title' }).fill('Project pack')
    await d.getByRole('textbox', { name: 'Cover text' }).fill('Tender documents')
    await d.getByRole('button', { name: 'Create' }).click()
    await expect(win.getByRole('tab', { name: /Project pack\.pdf/ })).toBeVisible()
    // The new document opens on its attachments, and says it is a portfolio.
    const list = win.getByRole('list', { name: 'Attached files' })
    await expect(list.getByText('schedule.csv')).toBeVisible()
    await expect(list.getByText('specification.txt')).toBeVisible()
    await expect(win.getByText(/This PDF is a portfolio/)).toBeVisible()
    await win.keyboard.press('Control+s')
    await expect(win.locator('.tab-dirty')).toHaveCount(0)
    const info = JSON.parse(
      execFileSync('python', ['-c', `import sys, json, pymupdf\nd = pymupdf.open(sys.argv[1])\nnames = d.embfile_names()\nprint(json.dumps({"names": names, "text": d.embfile_get(names[0]).decode(), "page": d[0].get_text(), "collection": "Collection" in d.xref_object(d.pdf_catalog())}))`, out]).toString()
    )
    expect(info.names.sort()).toEqual(['schedule.csv', 'specification.txt'])
    expect(info.collection).toBe(true)
    expect(info.page).toContain('Project pack')
    expect(info.page).toContain('Tender documents')
    expect(problems).toEqual([])
  } finally {
    await app.close()
    rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 })
  }
})

test('files are attached to a document, saved out again all at once, and removed', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'openpdf-e2e-'))
  const base = join(dir, 'base.pdf')
  makeBase(base)
  const extra = join(dir, 'site-notes.txt')
  writeFileSync(extra, 'Notes from the site visit.')
  const outDir = join(dir, 'extracted')
  mkdirSync(outDir)
  const app = await electron.launch({ args: ['.', base], cwd: root, env: { ...process.env, OPENPDF_E2E: '1', OPENPDF_E2E_USERDATA: join(dir, 'ud'), OPENPDF_E2E_DISCARD: '1', OPENPDF_E2E_PICK: extra, OPENPDF_E2E_DIR: outDir } })
  try {
    const win = await app.firstWindow()
    const problems: string[] = []
    win.on('pageerror', (e) => problems.push(e.message))
    await expect(win.locator('.page')).toHaveCount(1)
    await win.getByRole('tab', { name: 'Attachments', exact: true }).click()
    await expect(win.getByText('This document has no attached files.')).toBeVisible()
    await win.getByRole('button', { name: 'Add files…' }).click()
    const list = win.getByRole('list', { name: 'Attached files' })
    await expect(list.getByText('site-notes.txt')).toBeVisible()
    await expect(win.locator('.tab-dirty')).toHaveCount(1)

    await win.getByRole('button', { name: 'Save all…' }).click()
    await expect.poll(() => readdirSync(outDir)).toEqual(['site-notes.txt'])
    expect(readFileSync(join(outDir, 'site-notes.txt'), 'utf8')).toBe('Notes from the site visit.')

    await win.getByRole('button', { name: 'Remove site-notes.txt' }).click()
    await expect(win.getByText('This document has no attached files.')).toBeVisible()
    expect(problems).toEqual([])
  } finally {
    await app.close()
    rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 })
  }
})
