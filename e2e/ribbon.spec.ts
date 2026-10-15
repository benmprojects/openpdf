import { _electron as electron, expect, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(__dirname, '..')

test('ribbon tabs show their groups and the Organise tab edits the selected pages', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'openpdf-e2e-'))
  const pdfPath = join(dir, 'ribbon.pdf')
  execFileSync('python', [join(root, 'scripts', 'make-test-pdf.py'), pdfPath], { stdio: 'inherit' })

  const app = await electron.launch({
    args: ['.', pdfPath],
    cwd: root,
    env: { ...process.env, OPENPDF_E2E: '1', OPENPDF_E2E_USERDATA: join(dir, 'userdata'), OPENPDF_E2E_DISCARD: '1' }
  })
  try {
    const win = await app.firstWindow()
    const problems: string[] = []
    win.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`))
    win.on('console', (m) => {
      if (m.type() === 'error') problems.push(`console.error: ${m.text()}`)
    })
    await expect(win.locator('.page')).toHaveCount(6)

    const groups: Record<string, string[]> = {
      File: ['Document', 'Output'],
      Home: ['Tools', 'Edit', 'Find', 'Document'],
      Comment: ['Text markup', 'Notes', 'Stamp', 'Edit'],
      Draw: ['Drawing', 'Edit'],
      Organise: ['Insert and extract', 'Documents', 'Edit'],
      View: ['Panes', 'Zoom', 'Rotate view']
    }
    for (const [tab, names] of Object.entries(groups)) {
      await win.getByRole('tab', { name: tab, exact: true }).click()
      await expect(win.getByRole('tab', { name: tab, exact: true })).toHaveAttribute('aria-selected', 'true')
      for (const n of names) await expect(win.locator('.ribbon-body').getByRole('group', { name: n, exact: true })).toBeVisible()
      await win.screenshot({ path: test.info().outputPath(`ribbon-${tab}.png`) })
    }

    // Select thumbnail 2 and rotate it from the Organise tab: the page edit applies and the tab becomes unsaved.
    await win.locator('[data-thumb="1"]').click({ timeout: 5000 })
    await win.getByRole('tab', { name: 'Organise' }).click()
    await expect(win.locator('.ribbon-body').getByRole('group', { name: 'Page 2' })).toBeVisible()
    const before = await win.locator('.page').nth(1).boundingBox()
    await win.getByRole('button', { name: 'Rotate right' }).click({ timeout: 5000 })
    await expect(win.locator('.tab-dirty')).toBeVisible()
    await expect
      .poll(async () => {
        const after = await win.locator('.page').nth(1).boundingBox({ timeout: 1000 }).catch(() => null)
        return !!before && !!after && Math.abs(after.width / after.height - before.height / before.width) < 0.02
      })
      .toBe(true)

    // Dock the side pane on the right and back.
    await win.getByRole('tab', { name: 'View' }).click()
    await win.getByRole('button', { name: 'Dock right' }).click()
    await expect
      .poll(async () => ((await win.locator('aside.sidebar').boundingBox())?.x ?? 0) > ((await win.locator('.scroller').boundingBox())?.x ?? 0))
      .toBe(true)
    await win.getByRole('button', { name: 'Dock left' }).click()
    await expect
      .poll(async () => ((await win.locator('aside.sidebar').boundingBox())?.x ?? 1e9) < ((await win.locator('.scroller').boundingBox())?.x ?? 0))
      .toBe(true)

    // The status bar keeps page navigation and zoom on every tab.
    await expect(win.getByRole('toolbar', { name: 'Page and zoom' }).getByRole('textbox', { name: 'Page number' })).toBeVisible()
    expect(problems).toEqual([])
  } finally {
    await app.close()
    rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 })
  }
})
