import { _electron as electron, expect, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(__dirname, '..')

test('synced cloud folders are offered as places and the Open dialog starts in the one chosen', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'openpdf-e2e-'))
  const pdf = join(dir, 'from-cloud.pdf')
  execFileSync('python', ['-c', 'import sys, pymupdf\nd = pymupdf.open()\nd.new_page(width=300, height=300).insert_text((50, 100), "Cloud copy", fontsize=14)\nd.save(sys.argv[1])', pdf])
  const log = join(dir, 'startin.txt')
  const places = [
    { kind: 'sharepoint', label: 'Tenders - Documents (SharePoint: Tenders)', path: join(dir, 'Tenders') },
    { kind: 'onedrive', label: 'OneDrive', path: join(dir, 'OneDrive') }
  ]
  const app = await electron.launch({ args: ['.'], cwd: root, env: { ...process.env, OPENPDF_E2E: '1', OPENPDF_E2E_USERDATA: join(dir, 'ud'), OPENPDF_E2E_DISCARD: '1', OPENPDF_E2E_PLACES: JSON.stringify(places), OPENPDF_E2E_OPEN: pdf, OPENPDF_E2E_OPENDIR_LOG: log } })
  try {
    const win = await app.firstWindow()
    const problems: string[] = []
    win.on('pageerror', (e) => problems.push(e.message))
    await win.getByRole('button', { name: 'Places' }).click()
    const menu = win.getByRole('menu', { name: 'Places' })
    await expect(menu.getByRole('menuitem')).toHaveCount(2)
    await expect(menu.getByText('Tenders - Documents (SharePoint: Tenders)')).toBeVisible()
    await menu.getByRole('menuitem', { name: /OneDrive/ }).click()
    await expect(win.getByRole('tab', { name: /from-cloud\.pdf/ })).toBeVisible()
    expect(readFileSync(log, 'utf8')).toBe(join(dir, 'OneDrive'))
    expect(problems).toEqual([])
  } finally {
    await app.close()
    rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 })
  }
})
