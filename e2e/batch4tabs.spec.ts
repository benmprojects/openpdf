import { _electron as electron, expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(__dirname, '..')

async function withTabs(names: string[], run: (win: Page, app: ElectronApplication, dir: string) => Promise<void>) {
  const dir = mkdtempSync(join(tmpdir(), 'openpdf-e2e-'))
  const first = join(dir, names[0])
  execFileSync('python', [join(root, 'scripts', 'make-test-pdf.py'), first])
  const paths = [first]
  for (const n of names.slice(1)) {
    copyFileSync(first, join(dir, n))
    paths.push(join(dir, n))
  }
  const app = await electron.launch({ args: ['.', ...paths], cwd: root, env: { ...process.env, OPENPDF_E2E: '1', OPENPDF_E2E_USERDATA: join(dir, 'ud'), OPENPDF_E2E_DISCARD: '1' } })
  try {
    const win = await app.firstWindow()
    const problems: string[] = []
    win.on('pageerror', (e) => problems.push(e.message))
    await expect(win.getByRole('tablist', { name: 'Open documents' }).getByRole('tab')).toHaveCount(names.length)
    await run(win, app, dir)
    expect(problems).toEqual([])
  } finally {
    await app.close()
    rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 })
  }
}

const strip = (win: Page) => win.getByRole('tablist', { name: 'Open documents' })
const tab = (win: Page, name: string) => strip(win).getByRole('tab', { name: new RegExp(name.replace('.', '\\.')) })
const order = (win: Page) => strip(win).getByRole('tab').evaluateAll((els) => els.map((e) => e.querySelector('.tab-name')?.textContent))
const menuItem = (win: Page, name: string) => win.getByRole('menu').getByRole('menuitem', { name, exact: true })

/** Drags one tab to another with the events a real drag sends. */
async function dragTab(from: Locator, to: Locator | null, end?: { x: number; y: number }) {
  const dt = await from.evaluateHandle(() => new DataTransfer())
  await from.dispatchEvent('dragstart', { dataTransfer: dt })
  if (to) {
    await to.dispatchEvent('dragover', { dataTransfer: dt })
    await to.dispatchEvent('drop', { dataTransfer: dt })
  }
  await from.dispatchEvent('dragend', { dataTransfer: dt, ...(end ? { clientX: end.x, clientY: end.y } : {}) })
}

test('tabs can be grouped: name, colour, collapse, remove and ungroup', async () => {
  await withTabs(['a.pdf', 'b.pdf', 'c.pdf'], async (win) => {
    await tab(win, 'a.pdf').click({ button: 'right' })
    await menuItem(win, 'Add to new group').click()
    const chip = strip(win).getByRole('button', { name: /Tab group Group 1/ })
    await expect(chip).toBeVisible()
    await expect(tab(win, 'a.pdf')).toHaveClass(/grouped/)

    // Put c in the same group: it moves next to a.
    await tab(win, 'c.pdf').click({ button: 'right' })
    await menuItem(win, 'Add to Group 1').click()
    await expect.poll(() => order(win)).toEqual(['a.pdf', 'c.pdf', 'b.pdf'])
    await expect(strip(win).locator('.tab.grouped')).toHaveCount(2)
    await expect(tab(win, 'b.pdf')).not.toHaveClass(/grouped/)

    // Rename and recolour the group from its chip.
    await chip.click({ button: 'right' })
    const name = win.getByRole('menu').getByRole('textbox', { name: 'Group name' })
    await name.fill('Drainage')
    await name.press('Enter')
    await expect(strip(win).getByRole('button', { name: /Tab group Drainage/ })).toBeVisible()
    await strip(win).getByRole('button', { name: /Tab group Drainage/ }).click({ button: 'right' })
    const before = await strip(win).locator('.tab.grouped').first().evaluate((el) => getComputedStyle(el).borderTopColor)
    await win.getByRole('menu').getByRole('menuitemradio').nth(3).click()
    await expect.poll(() => strip(win).locator('.tab.grouped').first().evaluate((el) => getComputedStyle(el).borderTopColor)).not.toBe(before)
    await win.keyboard.press('Escape')

    // Collapse: the group's tabs hide except the one in front.
    await tab(win, 'c.pdf').click()
    const chip2 = strip(win).getByRole('button', { name: /Tab group Drainage/ })
    await chip2.click()
    await expect(chip2).toHaveAttribute('aria-expanded', 'false')
    await expect(chip2).toContainText('(+1)')
    await expect.poll(() => order(win)).toEqual(['c.pdf', 'b.pdf'])
    await chip2.click()
    await expect.poll(() => order(win)).toEqual(['a.pdf', 'c.pdf', 'b.pdf'])

    // Remove one tab from the group, then ungroup the rest.
    await tab(win, 'c.pdf').click({ button: 'right' })
    await menuItem(win, 'Remove from group').click()
    await expect(strip(win).locator('.tab.grouped')).toHaveCount(1)
    await strip(win).getByRole('button', { name: /Tab group Drainage/ }).click({ button: 'right' })
    await menuItem(win, 'Ungroup').click()
    await expect(strip(win).locator('.tab.grouped')).toHaveCount(0)
    await expect(strip(win).getByRole('button', { name: /Tab group/ })).toHaveCount(0)
    expect(await order(win)).toEqual(['a.pdf', 'c.pdf', 'b.pdf'])
  })
})

test('closing a group closes its tabs; close options: others, to the right, all', async () => {
  await withTabs(['a.pdf', 'b.pdf', 'c.pdf', 'd.pdf'], async (win) => {
    await tab(win, 'b.pdf').click({ button: 'right' })
    await menuItem(win, 'Add to new group').click()
    await tab(win, 'c.pdf').click({ button: 'right' })
    await menuItem(win, 'Add to Group 1').click()
    await strip(win).getByRole('button', { name: /Tab group Group 1/ }).click({ button: 'right' })
    await menuItem(win, 'Close group').click()
    await expect.poll(() => order(win)).toEqual(['a.pdf', 'd.pdf'])
    await expect(strip(win).getByRole('button', { name: /Tab group/ })).toHaveCount(0)
  })
  await withTabs(['a.pdf', 'b.pdf', 'c.pdf', 'd.pdf'], async (win) => {
    await tab(win, 'b.pdf').click({ button: 'right' })
    await menuItem(win, 'Close tabs to the right').click()
    await expect.poll(() => order(win)).toEqual(['a.pdf', 'b.pdf'])
    await tab(win, 'a.pdf').click({ button: 'right' })
    await menuItem(win, 'Close other tabs').click()
    await expect.poll(() => order(win)).toEqual(['a.pdf'])
    await tab(win, 'a.pdf').click({ button: 'right' })
    await menuItem(win, 'Close all tabs').click()
    await expect(strip(win).getByRole('tab')).toHaveCount(0)
    await expect(win.getByRole('heading', { name: 'OpenPDF' })).toBeVisible()
  })
})

test('a tab can be dragged to a new place in the strip', async () => {
  await withTabs(['a.pdf', 'b.pdf', 'c.pdf'], async (win) => {
    await dragTab(tab(win, 'c.pdf'), tab(win, 'a.pdf'))
    await expect.poll(() => order(win)).toEqual(['c.pdf', 'a.pdf', 'b.pdf'])
    // Dropped on the empty end of the strip: it goes last.
    await dragTab(tab(win, 'c.pdf'), win.locator('.tab-end'))
    await expect.poll(() => order(win)).toEqual(['a.pdf', 'b.pdf', 'c.pdf'])
    // Dragging a tab is not a file being dropped: no "drop PDFs" overlay.
    await expect(win.locator('.drop-overlay')).toHaveCount(0)
  })
})

test('a saved document opens in a new window from its menu, and leaves this one', async () => {
  await withTabs(['a.pdf', 'b.pdf'], async (win, app) => {
    const opened = app.waitForEvent('window')
    await tab(win, 'b.pdf').click({ button: 'right' })
    await menuItem(win, 'Open in new window').click()
    const second = await opened
    await expect(second.getByRole('tablist', { name: 'Open documents' }).getByRole('tab')).toHaveCount(1)
    await expect(second.getByRole('tablist', { name: 'Open documents' }).getByRole('tab', { name: /b\.pdf/ })).toBeVisible()
    await expect(second.locator('.page')).toHaveCount(6)
    // The first window has only a.pdf left.
    await expect.poll(() => order(win)).toEqual(['a.pdf'])
    expect(app.windows()).toHaveLength(2)
    // The new window does not repeat the crash-recovery offer or the command-line files.
    await expect(second.locator('.recovery-bar')).toHaveCount(0)
  })
})

test('a tab dragged out of the window opens in a window of its own; unsaved work is not moved', async () => {
  await withTabs(['a.pdf', 'b.pdf'], async (win, app) => {
    const opened = app.waitForEvent('window')
    await dragTab(tab(win, 'a.pdf'), null, { x: -30, y: 300 })
    const second = await opened
    await expect(second.getByRole('tablist', { name: 'Open documents' }).getByRole('tab', { name: /a\.pdf/ })).toBeVisible()
    await expect.poll(() => order(win)).toEqual(['b.pdf'])

    // A document with unsaved changes stays: the message says to save first.
    await win.getByRole('tab', { name: 'Comment', exact: true }).click()
    await win.getByRole('button', { name: 'Note', exact: true }).click()
    const p = (await win.locator('.page').first().boundingBox())!
    await win.mouse.click(p.x + 200, p.y + 100)
    await win.getByRole('textbox', { name: 'Note text' }).fill('Unsaved')
    await win.getByRole('textbox', { name: 'Note text' }).press('Control+Enter')
    await expect(win.locator('.tab-dirty')).toBeVisible()
    await tab(win, 'b.pdf').click({ button: 'right' })
    await menuItem(win, 'Open in new window').click()
    await expect(win.getByRole('alert')).toContainText('unsaved changes')
    expect(await order(win)).toEqual(['b.pdf'])
    expect(app.windows()).toHaveLength(2)
  })
})
