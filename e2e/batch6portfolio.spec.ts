import { _electron as electron, expect, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { readPortfolio } from '../src/renderer/src/portfolio'

const root = resolve(__dirname, '..')

const makePdf = (path: string, text: string) => execFileSync('python', ['-c', `import sys, pymupdf\nd = pymupdf.open()\nd.new_page(width=300, height=300).insert_text((50, 100), ${JSON.stringify(text)}, fontsize=14)\nd.save(sys.argv[1])`, path])

test('a portfolio keeps its files in folders, shows PDFs as thumbnails, and moves, renames and removes folders', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'openpdf-e2e-'))
  const base = join(dir, 'base.pdf')
  makePdf(base, 'Base document')
  const a = join(dir, 'plan.pdf')
  const b = join(dir, 'section.pdf')
  const c = join(dir, 'notes.txt')
  makePdf(a, 'Plan sheet')
  makePdf(b, 'Section sheet')
  writeFileSync(c, 'Site notes.')
  const out = join(dir, 'pack.pdf')
  const app = await electron.launch({ args: ['.', base], cwd: root, env: { ...process.env, OPENPDF_E2E: '1', OPENPDF_E2E_USERDATA: join(dir, 'ud'), OPENPDF_E2E_DISCARD: '1', OPENPDF_E2E_PICK: [a, b, c].join('|'), OPENPDF_E2E_SAVE: out } })
  try {
    const win = await app.firstWindow()
    const problems: string[] = []
    win.on('pageerror', (e) => problems.push(e.message))
    await expect(win.locator('.page')).toHaveCount(1)
    await win.getByRole('tab', { name: 'Convert', exact: true }).click()
    await win.getByRole('button', { name: 'Portfolio' }).click()
    const d = win.getByRole('dialog', { name: 'Create a portfolio' })
    await d.getByRole('textbox', { name: 'Portfolio title' }).fill('Drawing pack')
    await d.getByRole('combobox', { name: 'First view' }).selectOption('T')
    await d.getByRole('textbox', { name: 'Folder for plan.pdf' }).fill('Drawings/Civil')
    await d.getByRole('textbox', { name: 'Folder for notes.txt' }).fill('Notes')
    // The pictures of the PDFs appear as they are drawn.
    await expect(d.getByRole('img', { name: 'First page of plan.pdf' })).toBeVisible({ timeout: 30000 })
    await expect(d.getByRole('img', { name: 'First page of section.pdf' })).toBeVisible({ timeout: 30000 })
    await d.getByRole('textbox', { name: 'Folder for plan.pdf' }).fill('Drawings//Civil/')
    await d.getByRole('button', { name: 'Create' }).click()
    await expect(win.getByRole('tab', { name: /Drawing pack\.pdf/ })).toBeVisible()

    // The pane: section.pdf is at the top level; the others are in their folders.
    const top = win.getByRole('list', { name: 'Attached files' })
    await expect(top.getByText('section.pdf')).toBeVisible()
    await expect(top.getByText('plan.pdf')).toHaveCount(0)
    const civil = win.getByRole('region', { name: 'Folder Drawings/Civil', exact: true })
    await expect(civil.getByText('plan.pdf')).toBeVisible()
    await expect(win.getByRole('region', { name: 'Folder Drawings', exact: true })).toBeVisible()
    await expect(win.getByRole('region', { name: 'Folder Notes', exact: true }).getByText('notes.txt')).toBeVisible()

    // Thumbnail view: the first page of each embedded PDF.
    await win.getByRole('button', { name: 'Thumbnail view' }).click()
    await expect(civil.getByRole('img', { name: 'First page of plan.pdf' })).toBeVisible({ timeout: 30000 })
    await expect(top.getByRole('img', { name: 'First page of section.pdf' })).toBeVisible({ timeout: 30000 })
    await win.getByRole('button', { name: 'List view' }).click()

    // Move a file into a folder, add and rename a folder, and take one away.
    await win.getByRole('combobox', { name: 'Folder for section.pdf' }).selectOption('Notes')
    await expect(win.getByRole('region', { name: 'Folder Notes', exact: true }).getByText('section.pdf')).toBeVisible()
    await win.getByRole('textbox', { name: 'Name of the new folder' }).fill('Archive')
    await win.getByRole('button', { name: 'Add folder' }).click()
    await expect(win.getByRole('region', { name: 'Folder Archive', exact: true })).toBeVisible()
    await win.getByRole('button', { name: 'Rename folder Archive' }).click()
    await win.getByRole('textbox', { name: 'New name of folder Archive' }).fill('Old')
    await win.getByRole('button', { name: 'Rename', exact: true }).click()
    await expect(win.getByRole('region', { name: 'Folder Old', exact: true })).toBeVisible()
    await win.getByRole('button', { name: 'Remove folder Old' }).click()
    await expect(win.getByRole('region', { name: 'Folder Old', exact: true })).toHaveCount(0)
    // A bad name is refused.
    await win.getByRole('textbox', { name: 'Name of the new folder' }).fill('a/b')
    await win.getByRole('button', { name: 'Add folder' }).click()
    await expect(win.getByText(/cannot hold a slash/)).toBeVisible()

    await win.keyboard.press('Control+s')
    await expect(win.locator('.tab-dirty')).toHaveCount(0)
    const info = await readPortfolio(new Uint8Array(readFileSync(out)))
    expect(info.view).toBe('T')
    expect(info.folders).toEqual(['Drawings', 'Drawings/Civil', 'Notes'])
    expect(info.assign).toEqual({ 'plan.pdf': 'Drawings/Civil', 'section.pdf': 'Notes', 'notes.txt': 'Notes' })
    expect(problems).toEqual([])
  } finally {
    await app.close()
    rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 })
  }
})
