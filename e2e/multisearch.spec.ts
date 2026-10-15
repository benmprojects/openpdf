import { _electron as electron, expect, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(__dirname, '..')

test('search in files: open documents and a folder, then jump to a hit', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'openpdf-e2e-'))
  const folder = join(dir, 'library')
  mkdirSync(join(folder, 'sub'), { recursive: true })
  execFileSync('python', [join(root, 'scripts', 'make-test-pdf.py'), join(folder, 'alpha.pdf')])
  execFileSync('python', [join(root, 'scripts', 'make-test-pdf.py'), join(folder, 'sub', 'beta.pdf')])
  execFileSync('npx', ['tsx', join(root, 'scripts', 'make-feature-pdf.mts'), join(folder, 'gamma.pdf')], { cwd: root, shell: true })
  writeFileSync(join(folder, 'broken.pdf'), 'not a pdf')
  const app = await electron.launch({
    args: ['.', join(folder, 'alpha.pdf')],
    cwd: root,
    env: { ...process.env, OPENPDF_E2E: '1', OPENPDF_E2E_USERDATA: join(dir, 'ud'), OPENPDF_E2E_SEARCH_DIR: folder }
  })
  try {
    const win = await app.firstWindow()
    const problems: string[] = []
    win.on('pageerror', (e) => problems.push(e.message))
    await expect(win.locator('.page')).toHaveCount(6)

    // Open documents: alpha.pdf only.
    await win.keyboard.press('Control+Shift+F')
    const panel = win.getByRole('complementary', { name: 'Search in files' })
    await expect(panel).toBeVisible()
    await panel.getByRole('searchbox', { name: 'Text to find in files' }).fill('fox')
    await panel.getByRole('button', { name: 'Search', exact: true }).click()
    await expect(panel.locator('.search-panel-status')).toHaveText(/24 matches in 1 of 1 files/)

    // Folder with subfolders: alpha and beta match, gamma does not, broken.pdf reports an error.
    await panel.getByRole('button', { name: 'Choose…' }).click()
    await panel.getByRole('button', { name: 'Search', exact: true }).click()
    await expect(panel.locator('.search-panel-status')).toHaveText(/48 matches in 2 of 4 files/, { timeout: 30_000 })
    await expect(panel.locator('.search-error')).toHaveCount(1)

    // Without subfolders beta drops out.
    await panel.getByRole('checkbox', { name: 'Include subfolders' }).uncheck()
    await panel.getByRole('button', { name: 'Search', exact: true }).click()
    await expect(panel.locator('.search-panel-status')).toHaveText(/24 matches in 1 of 3 files/, { timeout: 30_000 })

    // Back to subfolders; click a hit on page 4 of beta.pdf: it opens in a new tab at that match.
    await panel.getByRole('checkbox', { name: 'Include subfolders' }).check()
    await panel.getByRole('button', { name: 'Search', exact: true }).click()
    await expect(panel.locator('.search-panel-status')).toHaveText(/48 matches/, { timeout: 30_000 })
    const betaHits = panel.locator('li', { has: win.locator('.search-file', { hasText: 'beta.pdf' }) }).locator('.search-hit')
    await betaHits.filter({ hasText: 'p. 4' }).first().click()
    await expect(win.getByRole('tab', { name: /beta\.pdf/ })).toHaveAttribute('aria-selected', 'true')
    await expect(win.locator('.docview:visible .search-status')).toHaveText(/of 24/)
    await expect(win.locator('.docview:visible .page[data-page="3"] .hl.match.current')).toHaveCount(1)
    await expect(win.locator('.docview:visible .page[data-page="3"] .hl.match.current')).toBeInViewport()
    await win.screenshot({ path: test.info().outputPath('search-files.png') })
    expect(problems).toEqual([])
  } finally {
    await app.close()
    rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 })
  }
})
