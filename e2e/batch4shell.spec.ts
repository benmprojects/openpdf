import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { readDestinations } from '../src/renderer/src/destinations'

const root = resolve(__dirname, '..')

const launch = (dir: string, args: string[] = [], env: Record<string, string> = {}) =>
  electron.launch({ args: ['.', ...args], cwd: root, env: { ...process.env, OPENPDF_E2E: '1', OPENPDF_E2E_USERDATA: join(dir, 'ud'), OPENPDF_E2E_DISCARD: '1', ...env } })

const settingsOf = (dir: string) => JSON.parse(readFileSync(join(dir, 'ud', 'settings.json'), 'utf8')) as Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

async function withDoc(run: (win: Page, app: ElectronApplication, dir: string, pdf: string) => Promise<void>) {
  const dir = mkdtempSync(join(tmpdir(), 'openpdf-e2e-'))
  const pdf = join(dir, 'work.pdf')
  execFileSync('python', [join(root, 'scripts', 'make-test-pdf.py'), pdf])
  const app = await launch(dir, [pdf])
  try {
    const win = await app.firstWindow()
    const problems: string[] = []
    win.on('pageerror', (e) => problems.push(e.message))
    await expect(win.locator('.page')).toHaveCount(6)
    await run(win, app, dir, pdf)
    expect(problems).toEqual([])
  } finally {
    await app.close()
    rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 })
  }
}

test('the quick-access toolbar: choose, order and use commands; the choice is saved', async () => {
  await withDoc(async (win, _app, dir) => {
    const qat = win.getByRole('toolbar', { name: 'Quick access' })
    const q = (n: string) => qat.getByRole('button', { name: `${n} (quick access)`, exact: true })
    for (const n of ['Open', 'Save', 'Print', 'Undo', 'Redo']) await expect(q(n)).toBeVisible()
    await expect(q('Find')).toHaveCount(0)

    await qat.getByRole('button', { name: 'Customise quick access' }).click()
    const menu = win.getByRole('dialog', { name: 'Customise quick access' })
    await menu.getByRole('checkbox', { name: 'Find' }).check()
    await expect(q('Find')).toBeVisible()
    await menu.getByRole('checkbox', { name: 'Print' }).uncheck()
    await expect(q('Print')).toHaveCount(0)
    // Order: move Find earlier, ahead of Redo and Undo.
    await menu.getByRole('button', { name: 'Move Find earlier' }).click()
    await menu.getByRole('button', { name: 'Move Find earlier' }).click()
    await expect.poll(() => qat.getByRole('button').evaluateAll((els) => els.filter((e) => !e.closest('.qat-menu')).map((e) => e.getAttribute('aria-label')))).toEqual(['Open (quick access)', 'Save (quick access)', 'Find (quick access)', 'Undo (quick access)', 'Redo (quick access)', 'Customise quick access'])
    await expect.poll(() => settingsOf(dir).quickAccess).toEqual(['open', 'save', 'find', 'undo', 'redo'])
    await win.keyboard.press('Escape')
    await expect(menu).toHaveCount(0)

    // The commands work: Find opens the find bar; a tool button shows as pressed.
    await q('Find').click()
    await expect(win.getByRole('searchbox', { name: 'Find in document' })).toBeVisible()
    await qat.getByRole('button', { name: 'Customise quick access' }).click()
    await win.getByRole('dialog', { name: 'Customise quick access' }).getByRole('checkbox', { name: 'Hand tool' }).check()
    await win.keyboard.press('Escape')
    await q('Hand tool').click()
    await expect(q('Hand tool')).toHaveAttribute('aria-pressed', 'true')
    // The same on every document tab: it is a setting, not part of the file.
    await expect(win.locator('.tab-dirty')).toHaveCount(0)
  })
})

test('the ribbon can be customised: tabs shown and their order, groups shown, and a reset', async () => {
  await withDoc(async (win, _app, dir) => {
    const tabs = win.getByRole('tablist', { name: 'Ribbon' })
    const names = () => tabs.getByRole('tab').evaluateAll((els) => els.map((e) => e.textContent))
    expect(await names()).toContain('Forms')

    await win.getByRole('toolbar', { name: 'Quick access' }).getByRole('button', { name: 'Customise quick access' }).click()
    await win.getByRole('dialog', { name: 'Customise quick access' }).getByRole('button', { name: 'Customise the ribbon…' }).click()
    const dlg = win.getByRole('dialog', { name: 'Customise the ribbon' })
    await expect(dlg).toBeVisible()
    // File cannot be left out: it holds Open and Save.
    await expect(dlg.getByRole('checkbox', { name: 'File' })).toBeDisabled()

    await dlg.getByRole('checkbox', { name: 'Forms' }).uncheck()
    await expect.poll(names).not.toContain('Forms')
    // View is last; move it up to just after File.
    for (let i = 0; i < 11; i++) await dlg.getByRole('button', { name: 'Move View earlier' }).click()
    await expect.poll(async () => (await names()).indexOf('View')).toBe(1)
    // Groups of the tab that was showing (Home): leave out Find.
    await dlg.getByRole('checkbox', { name: 'Find', exact: true }).uncheck()
    await expect(win.locator('.ribbon-body').getByRole('group', { name: 'Find', exact: true })).toHaveCount(0)
    await expect(win.locator('.ribbon-body').getByRole('group', { name: 'Document', exact: true })).toBeVisible()
    await expect.poll(() => settingsOf(dir).ribbonLayout.hiddenTabs).toEqual(['forms'])
    await expect.poll(() => settingsOf(dir).ribbonLayout.hiddenGroups).toEqual(['home/Find'])

    await dlg.getByRole('button', { name: 'Reset the ribbon' }).click()
    await expect.poll(names).toContain('Forms')
    await expect(win.locator('.ribbon-body').getByRole('group', { name: 'Find', exact: true })).toBeVisible()
    await dlg.getByRole('button', { name: 'Done' }).click()
    await expect(dlg).toHaveCount(0)
    await expect.poll(() => settingsOf(dir).ribbonLayout).toEqual({ tabOrder: [], hiddenTabs: [], hiddenGroups: [] })

    // A tab that is left out while it is showing is replaced by Home.
    await win.getByRole('tab', { name: 'Forms', exact: true }).click()
    await win.getByRole('toolbar', { name: 'Quick access' }).getByRole('button', { name: 'Customise quick access' }).click()
    await win.getByRole('dialog', { name: 'Customise quick access' }).getByRole('button', { name: 'Customise the ribbon…' }).click()
    await win.getByRole('dialog', { name: 'Customise the ribbon' }).getByRole('checkbox', { name: 'Forms' }).uncheck()
    await expect(win.getByRole('tab', { name: 'Home', exact: true })).toHaveAttribute('aria-selected', 'true')
  })
})

test('the ribbon, its quick-access toolbar and the View tab fit at 1000 and 1280 pixels wide', async () => {
  await withDoc(async (win, app) => {
    for (const width of [1000, 1280]) {
      // The window's frame makes the content a little wider than asked for: ask again for the difference.
      await app.evaluate(({ BrowserWindow }, w) => BrowserWindow.getAllWindows()[0].setContentSize(w, 800), width)
      const got = await win.evaluate(() => window.innerWidth)
      if (got !== width) await app.evaluate(({ BrowserWindow }, w) => BrowserWindow.getAllWindows()[0].setContentSize(w, 800), width - (got - width))
      await expect.poll(() => win.evaluate(() => window.innerWidth)).toBeLessThanOrEqual(width + 1)
      expect(await win.evaluate(() => window.innerWidth)).toBeGreaterThanOrEqual(width - 1)
      // (The tabs this batch changed: Home has the web search, View has the new display, split and pane buttons.)
      for (const tab of ['Home', 'View', 'Draw']) {
        await win.getByRole('tab', { name: tab, exact: true }).click()
        const report = await win.evaluate(() => {
          const tabs = document.querySelector('.docview:not([style*="none"]) .ribbon-tabs') as HTMLElement
          const body = document.querySelector('.docview:not([style*="none"]) .ribbon-body') as HTMLElement
          const clipped: string[] = []
          for (const el of body.querySelectorAll<HTMLElement>('.rb-label, .rgroup-label')) {
            // A label is cut off when its text is wider than the box that holds it.
            if (el.scrollWidth > el.clientWidth + 1) clipped.push(el.textContent ?? '')
          }
          const labelBoxes = [...body.querySelectorAll<HTMLElement>('.rgroup-label')].map((el) => el.getBoundingClientRect())
          const groupBoxes = [...body.querySelectorAll<HTMLElement>('.rgroup')].map((el) => el.getBoundingClientRect())
          const bad = [...body.querySelectorAll<HTMLElement>('.rgroup-label')].filter((el, i) => el.getBoundingClientRect().bottom > body.getBoundingClientRect().bottom + 1 || el.getBoundingClientRect().width > groupBoxes[i].width + 1).map((el) => el.textContent)
          return {
            bad,
            tabsOverflow: tabs.scrollWidth - tabs.clientWidth,
            tabsHeight: tabs.getBoundingClientRect().height,
            clipped,
            // Group names sit inside the ribbon's height (not hidden under a scroll bar).
            labelsInside: labelBoxes.every((b, i) => b.bottom <= body.getBoundingClientRect().bottom + 1 && b.width <= groupBoxes[i].width + 1)
          }
        })
        expect(report.tabsOverflow, `${tab} at ${width}`).toBeLessThanOrEqual(0)
        expect(report.tabsHeight, `${tab} at ${width}`).toBeLessThan(44)
        expect(report.clipped, `${tab} at ${width}`).toEqual([])
        expect(report.bad, `${tab} at ${width}`).toEqual([])
        expect(report.labelsInside, `${tab} at ${width}`).toBe(true)
      }
    }
    // The new View tab buttons are there (the ribbon scrolls sideways when it is too wide).
    await win.getByRole('tab', { name: 'View', exact: true }).click()
    for (const n of ['Right to left', 'Page gaps', 'Pan and zoom', 'Four-way split', 'Thin lines', 'Transparency grid', 'Page info', 'Float']) await expect(win.locator('.ribbon-body').getByRole('button', { name: n, exact: true })).toBeAttached()
  })
})

test('the side pane can float over the page, be moved, and be docked again', async () => {
  await withDoc(async (win, _app, dir) => {
    await win.getByRole('tab', { name: 'View', exact: true }).click()
    const pane = win.locator('aside.sidebar')
    await expect(pane).not.toHaveClass(/floating/)
    const scroller = win.locator('.scroller').first()
    const docked = (await scroller.boundingBox())!
    await win.getByRole('button', { name: 'Float' }).click()
    await expect(pane).toHaveClass(/floating/)
    await expect(win.getByRole('button', { name: 'Float' })).toHaveAttribute('aria-pressed', 'true')
    // The page area took the room the dock had.
    await expect.poll(async () => (await scroller.boundingBox())!.width).toBeGreaterThan(docked.width + 100)
    const before = (await pane.boundingBox())!
    expect(before.width).toBeGreaterThanOrEqual(220)

    // Drag by the title bar.
    const head = (await pane.locator('.float-head').boundingBox())!
    await win.mouse.move(head.x + 40, head.y + head.height / 2)
    await win.mouse.down()
    await win.mouse.move(head.x + 140, head.y + head.height / 2 + 60, { steps: 6 })
    await win.mouse.up()
    await expect.poll(async () => Math.round((await pane.boundingBox())!.x - before.x)).toBe(100)
    expect(Math.round((await pane.boundingBox())!.y - before.y)).toBe(60)
    await expect.poll(() => settingsOf(dir).floatPane).toMatchObject({ floating: true, x: Math.round(before.x + 100), y: Math.round(before.y + 60) })

    // The pane still works while floating: its tabs and the page thumbnails are there.
    await pane.getByRole('tab', { name: 'Bookmarks' }).click()
    await expect(pane.getByRole('tab', { name: 'Bookmarks' })).toHaveAttribute('aria-selected', 'true')

    // Dock it from its own button; the setting is saved.
    await pane.getByRole('button', { name: 'Dock the side pane' }).click()
    await expect(pane).not.toHaveClass(/floating/)
    await expect.poll(async () => Math.round((await scroller.boundingBox())!.width)).toBe(Math.round(docked.width))
    await expect.poll(() => settingsOf(dir).floatPane.floating).toBe(false)
    // And again from the ribbon, then back with Dock left.
    await win.getByRole('button', { name: 'Float' }).click()
    await expect(pane).toHaveClass(/floating/)
    await win.getByRole('button', { name: 'Dock left' }).click()
    await expect(pane).not.toHaveClass(/floating/)
  })
})

test('destinations: add one at the current view, go to it, rename it, delete it; saved in the file', async () => {
  await withDoc(async (win, _app, _dir, pdf) => {
    await win.locator('aside.sidebar').getByRole('tab', { name: 'Destinations' }).click()
    const pane = win.locator('aside.sidebar')
    await expect(pane.getByText('This document has no named destinations.')).toBeVisible()

    // Go to page 4, then name the place.
    const pageBox = win.getByRole('textbox', { name: 'Page number' })
    await pageBox.fill('4')
    await pageBox.press('Enter')
    await expect.poll(() => win.locator('.scroller').first().evaluate((el) => el.scrollTop)).toBeGreaterThan(500)
    await pane.getByRole('textbox', { name: 'Name of the new destination' }).fill('Plans')
    await pane.getByRole('button', { name: 'Add', exact: true }).click()
    const list = pane.getByRole('list', { name: 'Named destinations' })
    await expect(list.getByRole('button', { name: 'Go to Plans' })).toContainText('page 4')

    // A name already in use, and an empty one, are refused with a reason.
    await pane.getByRole('textbox', { name: 'Name of the new destination' }).fill('Plans')
    await pane.getByRole('button', { name: 'Add', exact: true }).click()
    await expect(pane.getByRole('alert')).toContainText('already exists')

    // Back to the first page, then go to the destination.
    await pageBox.fill('1')
    await pageBox.press('Enter')
    await expect(pageBox).toHaveValue('1')
    await list.getByRole('button', { name: 'Go to Plans' }).click()
    await expect(pageBox).toHaveValue('4')

    // Rename with the pencil.
    await list.getByRole('button', { name: 'Rename Plans' }).click()
    const rename = list.getByRole('textbox', { name: 'New name for Plans' })
    await rename.fill('Site plan')
    await rename.press('Enter')
    await expect(list.getByRole('button', { name: 'Go to Site plan' })).toBeVisible()
    await expect(list.getByRole('button', { name: 'Go to Plans' })).toHaveCount(0)

    // Saved in the file as a named destination on page 4.
    await win.keyboard.press('Control+s')
    await expect(win.locator('.tab-dirty')).toHaveCount(0)
    await expect.poll(async () => (await readDestinations(new Uint8Array(readFileSync(pdf)))).map((d) => `${d.name}@${d.page}`)).toEqual(['Site plan@3'])

    // Delete it.
    await list.getByRole('button', { name: 'Delete Site plan' }).click()
    await expect(pane.getByText('This document has no named destinations.')).toBeVisible()
    await win.keyboard.press('Control+s')
    await expect.poll(async () => (await readDestinations(new Uint8Array(readFileSync(pdf)))).length).toBe(0)
  })
})

test('the recovery pane lists snapshots with a preview, opens one as a document and deletes another', async () => {
  await withDoc(async (win, _app, _dir, pdf) => {
    const bytes = Array.from(readFileSync(pdf))
    await win.evaluate(async (b) => {
      const data = new Uint8Array(b)
      await window.openpdf.recoverySave('old-1', { name: 'Site plan.pdf' }, data)
      await window.openpdf.recoverySave('old-2', { name: 'Drainage.pdf' }, data)
    }, bytes)
    const pane = win.locator('aside.sidebar')
    await pane.getByRole('tab', { name: 'Recovery' }).click()
    const list = pane.getByRole('list', { name: 'Recovery snapshots' })
    await expect(list.getByRole('listitem')).toHaveCount(2)

    // Preview: the first page is drawn, with the page count.
    await list.locator('.recovery-name', { hasText: 'Site plan.pdf' }).click()
    const preview = list.locator('.recovery-preview')
    await expect(preview).toContainText('6 pages')
    await expect.poll(() => preview.locator('canvas').evaluate((c: HTMLCanvasElement) => c.width)).toBeGreaterThan(50)

    // Open it as a document of its own (unsaved); the snapshot goes.
    await list.getByRole('button', { name: 'Open Site plan.pdf' }).click()
    await expect(win.getByRole('tab', { name: /Site plan\.pdf/ })).toBeVisible()
    await expect(win.getByRole('tab', { name: /Site plan\.pdf/ }).locator('.tab-dirty')).toBeVisible()

    // Back in the first document, one snapshot is left; delete it.
    await win.getByRole('tab', { name: /work\.pdf/ }).click()
    await expect(win.locator('aside.sidebar').getByRole('list', { name: 'Recovery snapshots' }).getByRole('listitem')).toHaveCount(1)
    await win.locator('aside.sidebar').getByRole('button', { name: 'Delete the snapshot of Drainage.pdf' }).click()
    await expect(win.locator('aside.sidebar').getByText('There are no snapshots.')).toBeVisible()
  })
})
