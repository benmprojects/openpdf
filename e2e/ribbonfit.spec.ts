import { _electron as electron, expect, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(__dirname, '..')

// Every ribbon tab keeps its buttons and group names inside the ribbon's height: a column of small buttons that is
// too tall pushes its last button over the group name, or below the ribbon where it cannot be seen.
test('no ribbon tab has controls that spill below the ribbon', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'openpdf-e2e-'))
  const pdfPath = join(dir, 'fit.pdf')
  execFileSync('python', [join(root, 'scripts', 'make-test-pdf.py'), pdfPath])
  const app = await electron.launch({ args: ['.', pdfPath], cwd: root, env: { ...process.env, OPENPDF_E2E: '1', OPENPDF_E2E_USERDATA: join(dir, 'ud') } })
  try {
    const win = await app.firstWindow()
    await expect(win.locator('.page').first()).toBeVisible()
    const tabs = await win.locator('[role=tablist] [role=tab].rtab').allTextContents()
    expect(tabs.length).toBeGreaterThan(5)
    const spills: string[] = []
    for (const name of tabs) {
      await win.getByRole('tab', { name: name.trim(), exact: true }).click()
      const out = await win.locator('.ribbon-body').evaluate((body) => {
        const bottom = body.getBoundingClientRect().bottom
        const bad: string[] = []
        for (const el of body.querySelectorAll<HTMLElement>('.rb, .rgroup-label')) {
          const b = el.getBoundingClientRect()
          if (b.height && b.bottom > bottom + 1) bad.push(el.textContent?.trim() ?? '')
        }
        // A button whose box reaches into its group's name.
        for (const g of body.querySelectorAll<HTMLElement>('.rgroup')) {
          const label = g.querySelector('.rgroup-label')?.getBoundingClientRect()
          if (!label) continue
          for (const el of g.querySelectorAll<HTMLElement>('.rb')) {
            const b = el.getBoundingClientRect()
            if (b.height && b.bottom > label.top + 2) bad.push(el.textContent?.trim() ?? '')
          }
        }
        return bad
      })
      for (const b of out) spills.push(`${name.trim()}: ${b}`)
    }
    expect(spills).toEqual([])
  } finally {
    await app.close()
  }
})
