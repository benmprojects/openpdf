import { _electron as electron, expect, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(__dirname, '..')

test('opens, finds, rotates the view and prints', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'openpdf-e2e-'))
  const pdfPath = join(dir, 'test.pdf')
  const printPath = join(dir, 'printed.pdf')
  execFileSync('python', [join(root, 'scripts', 'make-test-pdf.py'), pdfPath], { stdio: 'inherit' })

  const app = await electron.launch({
    args: ['.', pdfPath],
    cwd: root,
    env: { ...process.env, OPENPDF_E2E: '1', OPENPDF_E2E_PRINT: printPath, OPENPDF_E2E_USERDATA: join(dir, 'userdata') }
  })
  try {
    const win = await app.firstWindow()
    const problems: string[] = []
    win.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`))
    win.on('console', (m) => {
      if (m.type() === 'error') problems.push(`console.error: ${m.text()}`)
    })

    // The test PDF has 6 pages.
    await expect(win.locator('.page')).toHaveCount(6)

    // Find.
    await win.keyboard.press('Control+f')
    const find = win.getByRole('searchbox', { name: 'Find in document' })
    await expect(find).toBeVisible()
    await find.fill('fox')
    await find.press('Enter')
    await expect(win.locator('.search-status')).toHaveText(/of 24/)

    // Rotate the view clockwise: page 0 becomes landscape.
    await win.getByRole('button', { name: 'Rotate view clockwise' }).click()
    await expect
      .poll(async () => {
        const box = await win.locator('.page').first().boundingBox()
        return box ? box.width > box.height : false
      })
      .toBe(true)

    // Print through the test hook, which writes the print job to a PDF.
    await win.keyboard.press('Control+p')
    await win.locator('.print-dialog').getByRole('button', { name: 'Print…' }).click()
    await expect.poll(() => existsSync(printPath), { timeout: 60_000 }).toBe(true)
    await expect
      .poll(() => (existsSync(printPath) ? readFileSync(printPath).subarray(0, 4).toString('latin1') : ''))
      .toBe('%PDF')

    expect(problems).toEqual([])
  } finally {
    await app.close()
    rmSync(dir, { recursive: true, force: true })
  }
})
