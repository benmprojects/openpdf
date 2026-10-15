import { _electron as electron, expect, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(__dirname, '..')

test('two versions of a document are compared by their words and by how the pages look', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'openpdf-e2e-'))
  const a = join(dir, 'v1.pdf')
  const b = join(dir, 'v2.pdf')
  execFileSync('python', [
    '-c',
    `import sys, pymupdf
def build(path, days, colour):
    d = pymupdf.open()
    p = d.new_page(width=300, height=300)
    p.insert_text((40, 80), "Payment is due in " + days + " days from the invoice date.", fontsize=11)
    q = d.new_page(width=300, height=300)
    q.insert_text((40, 80), "Site plan", fontsize=11)
    q.draw_rect(pymupdf.Rect(60, 120, 240, 220), color=None, fill=colour)
    r = d.new_page(width=300, height=300)
    r.insert_text((40, 80), "Appendix unchanged", fontsize=11)
    d.save(path)
build(sys.argv[1], "thirty", (0.8, 0.1, 0.1))
build(sys.argv[2], "forty", (0.1, 0.1, 0.8))`,
    a,
    b
  ])
  const app = await electron.launch({ args: ['.', a], cwd: root, env: { ...process.env, OPENPDF_E2E: '1', OPENPDF_E2E_USERDATA: join(dir, 'ud'), OPENPDF_E2E_DISCARD: '1', OPENPDF_E2E_PICK: b } })
  try {
    const win = await app.firstWindow()
    const problems: string[] = []
    win.on('pageerror', (e) => problems.push(e.message))
    await expect(win.locator('.page')).toHaveCount(3)
    await win.getByRole('tab', { name: 'Organise', exact: true }).click()
    await win.getByRole('button', { name: 'Compare', exact: true }).click()
    const d = win.getByRole('dialog', { name: 'Compare documents' })
    await d.getByRole('button', { name: 'Choose a document…' }).click()

    const text = d.getByRole('region', { name: 'Text changes' })
    await expect(text.locator('del')).toHaveText('thirty')
    await expect(text.locator('ins')).toHaveText('forty')
    await expect(d.getByRole('tab', { name: /Text \(1 change\)/ })).toBeVisible()
    await expect(text.getByText(/Page 1/)).toBeVisible()

    await d.getByRole('tab', { name: 'Appearance' }).click()
    await d.getByRole('button', { name: 'Check every page' }).click()
    const pageSelect = d.getByRole('combobox', { name: 'Compare page' })
    await expect(pageSelect.locator('option').nth(2)).toHaveText(/3 \(same\)/, { timeout: 30000 })
    await expect(pageSelect.locator('option').nth(0)).toHaveText(/1 \(.*% differs\)/)
    await expect(pageSelect.locator('option').nth(1)).toHaveText(/2 \(.*% differs\)/)
    await expect(d.getByText('Pages that differ: 1, 2')).toBeVisible()
    // The overlay is drawn: the changed rectangle makes red or blue pixels.
    await pageSelect.selectOption('1')
    await expect(d.getByRole('status')).toContainText('of this page differs')
    const coloured = await d.getByLabel('Overlay of the two pages').evaluate((c: HTMLCanvasElement) => {
      const px = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data
      let n = 0
      for (let i = 0; i < px.length; i += 4) if (Math.abs(px[i] - px[i + 2]) > 100) n++
      return n
    })
    expect(coloured).toBeGreaterThan(1000)
    expect(problems).toEqual([])
  } finally {
    await app.close()
    rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 })
  }
})
