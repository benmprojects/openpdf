import { _electron as electron, expect, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { findTag, flattenTags, readDocAccess, readTagTree } from '../src/renderer/src/structTree'

const root = resolve(__dirname, '..')

const make = (path: string, ...flags: string[]) => execFileSync(process.execPath, ['--import', 'tsx', join(root, 'scripts', 'make-tagged-pdf.mts'), path, ...flags], { cwd: root })
const bytesOf = (path: string) => new Uint8Array(readFileSync(path))

async function launch(pdf: string, dir: string, extra: Record<string, string> = {}) {
  return electron.launch({ args: ['.', pdf], cwd: root, env: { ...process.env, OPENPDF_E2E: '1', OPENPDF_E2E_USERDATA: join(dir, 'ud'), OPENPDF_E2E_DISCARD: '1', ...extra } })
}

test('the Tags pane shows the tree, puts the element on the page, and edits alt text, type, order and artefacts', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'openpdf-e2e-'))
  const pdf = join(dir, 'tagged.pdf')
  make(pdf)
  const app = await launch(pdf, dir)
  try {
    const win = await app.firstWindow()
    const problems: string[] = []
    win.on('pageerror', (e) => problems.push(e.message))
    await expect(win.locator('.page')).toHaveCount(2)
    await win.getByRole('tab', { name: 'Tags', exact: true }).click()
    const tree = win.getByRole('tree', { name: 'Structure tree' })
    await expect(tree.getByRole('treeitem')).toHaveCount(6)
    await expect(win.getByText('This document has no tags.')).toHaveCount(0)

    // Selecting an element shows where it is on the page.
    await tree.getByRole('button', { name: /^Figure/ }).click()
    const mark = win.locator('.content-highlight')
    await expect(mark).toBeVisible()
    const box = await mark.evaluate((el) => ({ left: parseFloat((el as HTMLElement).style.left), width: parseFloat((el as HTMLElement).style.width) }))
    // The figure is a rectangle 100 points wide whose left edge is 20 points from the page edge.
    expect(box.width / box.left).toBeGreaterThan(4.2)
    expect(box.width / box.left).toBeLessThan(5.8)

    // Alternative text, a changed type and a title.
    await win.getByRole('textbox', { name: 'Alternative text' }).fill('A grey box standing for a chart')
    await win.getByRole('button', { name: 'Apply', exact: true }).click()
    await expect(win.locator('.tab-dirty')).toHaveCount(1)
    await tree.getByRole('button', { name: /^H3/ }).click()
    await win.getByRole('combobox', { name: 'Tag type' }).selectOption('H2')
    await win.getByRole('button', { name: 'Apply', exact: true }).click()
    await expect(tree.getByRole('button', { name: /^H2/ })).toBeVisible()

    // Reading order: the second paragraph moves up before the heading above it.
    await tree.getByRole('button', { name: /^P/ }).last().click()
    await win.getByRole('button', { name: 'Move up', exact: true }).click()
    await expect.poll(async () => (await tree.locator('[data-tag-id]').allTextContents()).map((x) => x.trim().split(/\s/)[0]).join(',')).toBe('Document,H1,P,Figure,P,H2')

    // Mark the figure as an artefact: it leaves the tree.
    await tree.getByRole('button', { name: /^Figure/ }).click()
    await win.getByRole('button', { name: 'Mark as artefact', exact: true }).click()
    await expect(tree.getByRole('treeitem')).toHaveCount(5)

    // The document title and language.
    await win.getByRole('textbox', { name: 'Document title' }).fill('Site report')
    await win.getByRole('combobox', { name: 'Document language' }).fill('not a tag')
    await expect(win.getByRole('button', { name: 'Set title and language' })).toBeDisabled()
    await win.getByRole('combobox', { name: 'Document language' }).fill('en-AU')
    await win.getByRole('button', { name: 'Set title and language' }).click()
    await expect.poll(async () => (await win.locator('.tab-dirty').count()) > 0).toBe(true)

    await win.keyboard.press('Control+s')
    await expect(win.locator('.tab-dirty')).toHaveCount(0)
    const saved = bytesOf(pdf)
    const t = await readTagTree(saved)
    const kinds = flattenTags(t.roots).map((n) => n.type)
    expect(kinds).toEqual(['Document', 'H1', 'P', 'P', 'H2'])
    expect(findTag(t.roots, '0')?.children.map((c) => c.type)).toEqual(['H1', 'P', 'P', 'H2'])
    expect(await readDocAccess(saved)).toMatchObject({ title: 'Site report', lang: 'en-AU', displayTitle: true })
    expect(problems).toEqual([])
  } finally {
    await app.close()
    rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 })
  }
})

test('alternative text on a figure is saved in the file', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'openpdf-e2e-'))
  const pdf = join(dir, 'tagged.pdf')
  make(pdf)
  const app = await launch(pdf, dir)
  try {
    const win = await app.firstWindow()
    await expect(win.locator('.page')).toHaveCount(2)
    await win.getByRole('tab', { name: 'Tags', exact: true }).click()
    const tree = win.getByRole('tree', { name: 'Structure tree' })
    await tree.getByRole('button', { name: /^Figure/ }).click()
    await win.getByRole('textbox', { name: 'Alternative text' }).fill('A grey box standing for a chart')
    await win.getByRole('button', { name: 'Apply', exact: true }).click()
    await win.keyboard.press('Control+s')
    await expect(win.locator('.tab-dirty')).toHaveCount(0)
    const fig = findTag((await readTagTree(bytesOf(pdf))).roots, '0/2')
    expect(fig?.alt).toBe('A grey box standing for a chart')
  } finally {
    await app.close()
    rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 })
  }
})

test('an untagged document says so in the Tags pane, and the title and language can still be set', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'openpdf-e2e-'))
  const pdf = join(dir, 'plain.pdf')
  execFileSync('python', ['-c', 'import sys, pymupdf\nd = pymupdf.open()\nd.new_page(width=300, height=300).insert_text((50, 100), "Plain", fontsize=14)\nd.save(sys.argv[1])', pdf])
  const app = await launch(pdf, dir)
  try {
    const win = await app.firstWindow()
    await expect(win.locator('.page')).toHaveCount(1)
    await win.getByRole('tab', { name: 'Tags', exact: true }).click()
    await expect(win.getByText('This document has no tags.')).toBeVisible()
    await win.getByRole('textbox', { name: 'Document title' }).fill('Plain document')
    await win.getByRole('combobox', { name: 'Document language' }).fill('en-AU')
    await win.getByRole('button', { name: 'Set title and language' }).click()
    await win.keyboard.press('Control+s')
    await expect(win.locator('.tab-dirty')).toHaveCount(0)
    expect(await readDocAccess(bytesOf(pdf))).toMatchObject({ title: 'Plain document', lang: 'en-AU', tagged: false })
  } finally {
    await app.close()
    rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 })
  }
})

test('the accessibility check lists failures with pages, goes to the element, and saves HTML and CSV reports', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'openpdf-e2e-'))
  const pdf = join(dir, 'tagged.pdf')
  make(pdf, '--link')
  const report = join(dir, 'report.out')
  const app = await launch(pdf, dir, { OPENPDF_E2E_SAVE_TEXT: report })
  try {
    const win = await app.firstWindow()
    const problems: string[] = []
    win.on('pageerror', (e) => problems.push(e.message))
    await expect(win.locator('.page')).toHaveCount(2)
    await win.getByRole('tab', { name: 'File', exact: true }).click()
    await win.getByRole('button', { name: 'Accessibility check' }).click()
    const d = win.getByRole('dialog', { name: 'Accessibility check' })
    await expect(d.getByText('Figures have alternative text').first()).toBeVisible()
    await expect(d.getByText('Heading levels do not skip').first()).toBeVisible()
    await expect(d.getByText('Links are tagged').first()).toBeVisible()
    await expect(d.getByText('The document language is set').first()).toBeVisible()
    await expect(d.getByRole('status', { name: 'Summary' })).toContainText('failed')

    await d.getByRole('button', { name: 'Save report (HTML)' }).click()
    await expect(d.getByText(/Report saved to/)).toBeVisible()
    const html = readFileSync(report, 'utf8')
    expect(html).toContain('<h1>Accessibility report</h1>')
    expect(html).toContain('Figures have alternative text')
    expect(html).toMatch(/\d{2}\/\d{2}\/\d{4}/)
    rmSync(report)
    await d.getByRole('button', { name: 'Save report (CSV)' }).click()
    await expect.poll(() => existsSync(report)).toBe(true)
    const csv = readFileSync(report, 'utf8')
    expect(csv).toContain('Result,Page,Finding,Detail,How to fix,Requirement')
    expect(csv).toMatch(/Failed,1,Figures have alternative text/)

    // Go to: the dialog closes and the element is selected in the Tags pane.
    await d.getByRole('button', { name: /^Go to: Figures have alternative text/ }).first().click()
    await expect(win.getByRole('dialog', { name: 'Accessibility check' })).toHaveCount(0)
    const tree = win.getByRole('tree', { name: 'Structure tree' })
    await expect(tree.getByRole('treeitem', { name: /^Figure/, selected: true }).first()).toBeVisible()
    await expect(win.getByRole('textbox', { name: 'Alternative text' })).toBeVisible()
    expect(problems).toEqual([])
  } finally {
    await app.close()
    rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 })
  }
})
