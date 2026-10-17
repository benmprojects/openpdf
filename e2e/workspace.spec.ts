import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(__dirname, '..')

const launch = (dir: string, args: string[] = [], env: Record<string, string> = {}) =>
  electron.launch({ args: ['.', ...args], cwd: root, env: { ...process.env, OPENPDF_E2E: '1', OPENPDF_E2E_USERDATA: join(dir, 'ud'), OPENPDF_E2E_DISCARD: '1', ...env } })

const zoomNow = async (win: Page) => Number((await win.locator('.zoom-now').innerText()).replace('%', ''))

test('Fit visible, the loupe and a split view', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'openpdf-e2e-'))
  const pdfPath = join(dir, 'work.pdf')
  execFileSync('python', [join(root, 'scripts', 'make-test-pdf.py'), pdfPath])
  let app: ElectronApplication | null = null
  try {
    app = await launch(dir, [pdfPath])
    const win = await app.firstWindow()
    const problems: string[] = []
    win.on('pageerror', (e) => problems.push(e.message))
    await expect(win.locator('.page')).toHaveCount(6)
    await win.getByRole('tab', { name: 'View', exact: true }).click()

    // Fit visible fits the content, so it zooms in further than fit width, which fits the page including its margins.
    await win.getByRole('button', { name: 'Fit width' }).click()
    const wide = await zoomNow(win)
    await win.getByRole('button', { name: 'Fit visible' }).click()
    await expect(win.getByRole('button', { name: 'Fit visible' })).toHaveAttribute('aria-pressed', 'true')
    await expect.poll(() => zoomNow(win)).toBeGreaterThan(wide)
    await expect(win.getByRole('toolbar', { name: 'Page and zoom' }).getByLabel('Zoom', { exact: true })).toHaveValue('fit-visible')
    // The page edge may not be cut off by the content box: the zoom stays within the program's limit.
    expect(await zoomNow(win)).toBeLessThanOrEqual(800)
    await win.getByRole('button', { name: 'Fit width' }).click()

    // Loupe: a magnifier window that follows the pointer over a page.
    await expect(win.locator('.loupe')).toBeHidden()
    await win.getByRole('button', { name: 'Loupe', exact: true }).click()
    await expect(win.getByRole('button', { name: 'Loupe', exact: true })).toHaveAttribute('aria-pressed', 'true')
    const box = await win.locator('.page').first().boundingBox()
    expect(box).not.toBeNull()
    await win.mouse.move(box!.x + 100, box!.y + 100)
    await win.mouse.move(box!.x + 110, box!.y + 105)
    await expect(win.locator('.loupe')).toBeVisible()
    await expect.poll(() => win.locator('.loupe canvas').evaluate((c: HTMLCanvasElement) => c.width)).toBeGreaterThan(0)
    // Off the pages (over the ribbon) it goes away; turning it off removes it.
    await win.mouse.move(400, 60)
    await expect(win.locator('.loupe')).toBeHidden()
    await win.getByRole('button', { name: 'Loupe', exact: true }).click()
    await expect(win.locator('.loupe')).toHaveCount(0)

    // Split view: the same document in a second pane with its own zoom and scrolling.
    await expect(win.getByRole('region', { name: 'Second view' })).toHaveCount(0)
    await win.getByRole('button', { name: 'Split vertically' }).click()
    const second = win.getByRole('region', { name: 'Second view' })
    await expect(second).toBeVisible()
    await expect(second.locator('[data-split-page]')).toHaveCount(6)
    await expect(win.getByRole('button', { name: 'Split vertically' })).toHaveAttribute('aria-pressed', 'true')
    await expect(second).toHaveClass(/vertical/)
    const before = await zoomNow(win)
    await second.getByLabel('Second view zoom').selectOption('2')
    await expect(second.locator('[data-split-page="0"]')).toHaveAttribute('data-zoom', '2')
    expect(await zoomNow(win)).toBe(before) // the first view's zoom is its own
    // Scrolling one pane leaves the other where it was.
    const mainScroller = win.locator('.scroller').first()
    const mainTop = await mainScroller.evaluate((el) => el.scrollTop)
    await second.getByRole('group', { name: 'Second view pages' }).evaluate((el) => {
      el.scrollTop = 600
    })
    await expect.poll(() => second.getByRole('group', { name: 'Second view pages' }).evaluate((el) => el.scrollTop)).toBeGreaterThan(100)
    expect(await mainScroller.evaluate((el) => el.scrollTop)).toBe(mainTop)
    // The second pane draws the pages.
    await expect.poll(() => second.locator('canvas').first().evaluate((c: HTMLCanvasElement) => c.width)).toBeGreaterThan(0)
    // Switching direction keeps the pane; closing it removes it.
    await win.getByRole('button', { name: 'Split horizontally' }).click()
    await expect(second).not.toHaveClass(/vertical/)
    await expect(win.getByRole('button', { name: 'Split horizontally' })).toHaveAttribute('aria-pressed', 'true')
    await second.getByRole('button', { name: 'Close second view' }).click()
    await expect(second).toHaveCount(0)
    await expect(win.locator('.page')).toHaveCount(6)
    expect(problems).toEqual([])
  } finally {
    await app?.close().catch(() => undefined)
    rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 })
  }
})

test('settings are exported to a file and imported back, and a wrong file is refused', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'openpdf-e2e-'))
  const file = join(dir, 'settings.json')
  let app: ElectronApplication | null = null
  try {
    app = await launch(dir, [], { OPENPDF_E2E_SETTINGS_FILE: file })
    const win = await app.firstWindow()
    await win.getByRole('button', { name: 'Settings' }).click()
    const dialog = win.getByRole('dialog', { name: 'Settings' })
    await dialog.getByLabel('Author name for comments').fill('Test Author')
    await dialog.getByLabel('Theme').selectOption('dark')
    await dialog.getByRole('button', { name: 'Export settings…' }).click()
    await expect(dialog.getByText(/Settings saved to/)).toBeVisible()
    await expect.poll(() => (existsSync(file) ? readFileSync(file, 'utf8') : '')).toContain('Test Author')
    const saved = JSON.parse(readFileSync(file, 'utf8'))
    expect(saved.format).toBe('openpdf-settings')
    expect(saved.settings.theme).toBe('dark')
    expect(saved.settings).not.toHaveProperty('recent')
    expect(saved.settings).not.toHaveProperty('updates')

    // Change things, then import the file: they come back.
    await dialog.getByLabel('Author name for comments').fill('Someone else')
    await dialog.getByLabel('Theme').selectOption('light')
    await dialog.getByRole('button', { name: 'Import settings…' }).click()
    await expect(dialog.getByText(/Imported \d+ settings/)).toBeVisible()
    await expect(dialog.getByLabel('Author name for comments')).toHaveValue('Test Author')
    await expect(dialog.getByLabel('Theme')).toHaveValue('dark')

    // A file that is not a settings file changes nothing and says why.
    writeFileSync(file, '{"theme":"light"}')
    await dialog.getByRole('button', { name: 'Import settings…' }).click()
    await expect(dialog.getByText('That file is not an OpenPDF settings file.')).toBeVisible()
    await expect(dialog.getByLabel('Theme')).toHaveValue('dark')
    writeFileSync(file, 'not json at all')
    await dialog.getByRole('button', { name: 'Import settings…' }).click()
    await expect(dialog.getByText(/not valid JSON/)).toBeVisible()
  } finally {
    await app?.close().catch(() => undefined)
    rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 })
  }
})
