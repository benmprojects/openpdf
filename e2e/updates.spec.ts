import { _electron as electron, expect, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(__dirname, '..')

test('updates are off unless turned on, the privacy statement is shown, and a bad address is refused', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'openpdf-e2e-'))
  const pdf = join(dir, 'a.pdf')
  execFileSync('python', ['-c', 'import sys, pymupdf\nd = pymupdf.open()\nd.new_page(width=300, height=300)\nd.save(sys.argv[1])', pdf])
  const app = await electron.launch({ args: ['.', pdf], cwd: root, env: { ...process.env, OPENPDF_E2E: '1', OPENPDF_E2E_USERDATA: join(dir, 'ud'), OPENPDF_E2E_DISCARD: '1' } })
  try {
    const win = await app.firstWindow()
    const problems: string[] = []
    win.on('pageerror', (e) => problems.push(e.message))
    await expect(win.locator('.page')).toHaveCount(1)
    await win.getByRole('button', { name: 'Settings' }).click()
    const d = win.getByRole('dialog', { name: 'Settings' })
    const section = d.getByRole('region', { name: 'Updates and privacy' })
    await expect(section.getByText(/collects no usage data/)).toBeVisible()
    await expect(section.getByRole('checkbox', { name: /Check for updates/ })).not.toBeChecked()

    await section.getByRole('button', { name: 'Check now' }).click()
    await expect(section.getByRole('status')).toContainText('Enter the update address first.')
    await section.getByRole('textbox', { name: 'Update address' }).fill('http://updates.example.com/feed')
    await section.getByRole('button', { name: 'Check now' }).click()
    await expect(section.getByRole('status')).toContainText('must start with https://')
    // An acceptable address cannot be used from `electron .`: only the installed program checks.
    await section.getByRole('textbox', { name: 'Update address' }).fill('https://updates.example.com/feed')
    await section.getByRole('button', { name: 'Check now' }).click()
    await expect(section.getByRole('status')).toContainText('only be checked in the installed program')

    // The choice is saved, and nothing was written that turns checking on.
    await section.getByRole('checkbox', { name: /Check for updates/ }).check()
    await expect.poll(() => JSON.parse(readFileSync(join(dir, 'ud', 'settings.json'), 'utf8')).updates).toEqual({ check: true, feed: 'https://updates.example.com/feed' })
    expect(problems).toEqual([])
  } finally {
    await app.close()
    rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 })
  }
})
