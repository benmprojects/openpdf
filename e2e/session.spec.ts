import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { PDFDocument } from 'pdf-lib'

const root = resolve(__dirname, '..')

const launch = (dir: string, args: string[] = [], env: Record<string, string> = {}) =>
  electron.launch({
    args: ['.', ...args],
    cwd: root,
    env: { ...process.env, OPENPDF_E2E: '1', OPENPDF_E2E_USERDATA: join(dir, 'ud'), OPENPDF_E2E_DISCARD: '1', ...env }
  })

const tabNames = async (app: ElectronApplication) => (await app.firstWindow()).locator('.tabs [role=tab] .tab-name').allTextContents()

/** The paths in the saved last-session list, once the settings file has them. */
const savedSession = (dir: string): string[] => {
  const file = join(dir, 'ud', 'settings.json')
  if (!existsSync(file)) return []
  try {
    return (JSON.parse(readFileSync(file, 'utf8')).lastSession as string[]) ?? []
  } catch {
    return []
  }
}

test('the last session is reopened when the setting is on, and by a command when it is off', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'openpdf-e2e-'))
  const a = join(dir, 'alpha.pdf')
  const b = join(dir, 'beta.pdf')
  execFileSync('python', [join(root, 'scripts', 'make-test-pdf.py'), a])
  copyFileSync(a, b)
  let app: ElectronApplication | null = null
  try {
    // Run 1: two documents open, the setting is turned on.
    app = await launch(dir, [a, b])
    let win = await app.firstWindow()
    await expect(win.locator('.tabs [role=tab]')).toHaveCount(2)
    await win.getByRole('button', { name: 'Settings' }).click()
    const settings = win.getByRole('dialog', { name: 'Settings' })
    await settings.getByRole('checkbox', { name: /Reopen the documents/ }).check()
    await settings.getByRole('button', { name: 'Close' }).click()
    await expect.poll(() => savedSession(dir)).toEqual([a, b])
    await app.close()

    // Run 2: nothing on the command line; both come back.
    app = await launch(dir)
    win = await app.firstWindow()
    await expect(win.locator('.tabs [role=tab]')).toHaveCount(2)
    expect(await tabNames(app)).toEqual(['alpha.pdf', 'beta.pdf'])
    // Close one tab: the saved list follows.
    await win.getByRole('button', { name: 'Close beta.pdf' }).click()
    await expect.poll(() => savedSession(dir)).toEqual([a])
    await win.getByRole('button', { name: 'Settings' }).click()
    await win.getByRole('dialog', { name: 'Settings' }).getByRole('checkbox', { name: /Reopen the documents/ }).uncheck()
    await win.getByRole('dialog', { name: 'Settings' }).getByRole('button', { name: 'Close' }).click()
    await app.close()

    // Run 3: setting off, so nothing opens by itself, but the File command and the welcome button reopen it.
    app = await launch(dir)
    win = await app.firstWindow()
    await expect(win.getByRole('button', { name: 'Open a PDF…' })).toBeVisible()
    await expect(win.locator('.tabs [role=tab]')).toHaveCount(0)
    await win.getByRole('button', { name: 'Reopen last session' }).click()
    await expect(win.locator('.tabs [role=tab]')).toHaveCount(1)
    expect(await tabNames(app)).toEqual(['alpha.pdf'])
    await win.getByRole('tab', { name: 'File', exact: true }).click()
    await win.getByRole('button', { name: 'Reopen last session' }).click()
    await expect(win.getByRole('alert')).toContainText('already open')
    await expect(win.locator('.tabs [role=tab]')).toHaveCount(1)
    await app.close()

    // A file that has gone is left out with a message.
    rmSync(a)
    app = await launch(dir)
    win = await app.firstWindow()
    await win.getByRole('button', { name: 'Reopen last session' }).click()
    await expect(win.getByRole('alert')).toContainText('could not be found')
    await expect(win.locator('.tabs [role=tab]')).toHaveCount(0)
  } finally {
    await app?.close().catch(() => undefined)
    rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 })
  }
})

test('Open from URL takes https only, shows clear errors and opens the download unsaved', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'openpdf-e2e-'))
  const web = join(dir, 'web')
  mkdirSync(web)
  const small = await PDFDocument.create()
  small.addPage([200, 200])
  writeFileSync(join(web, 'small.pdf'), await small.save({ useObjectStreams: false }))
  execFileSync('python', [join(root, 'scripts', 'make-test-pdf.py'), join(web, 'big.pdf')])
  writeFileSync(join(web, 'page.pdf'), '<html>please sign in</html>')
  let app: ElectronApplication | null = null
  try {
    app = await launch(dir, [], { OPENPDF_E2E_URL_ROOT: web, OPENPDF_E2E_URL_MAX: '2000' })
    const win = await app.firstWindow()
    await win.getByRole('button', { name: 'Open from URL…' }).click()
    const dialog = win.getByRole('dialog', { name: 'Open from URL' })
    const address = dialog.getByRole('textbox', { name: 'Web address' })
    const tryOpen = async (text: string) => {
      await address.fill(text)
      await dialog.getByRole('button', { name: 'Open', exact: true }).click()
    }
    await tryOpen('http://example.test/small.pdf')
    await expect(dialog.getByRole('alert')).toContainText('Only https://')
    await tryOpen('ftp://example.test/small.pdf')
    await expect(dialog.getByRole('alert')).toContainText('Only https://')
    await tryOpen('https://example.test/none.pdf')
    await expect(dialog.getByRole('alert')).toContainText('no file at that address')
    await tryOpen('https://example.test/page.pdf')
    await expect(dialog.getByRole('alert')).toContainText('did not return a PDF')
    await tryOpen('https://example.test/big.pdf')
    await expect(dialog.getByRole('alert')).toContainText('larger than')
    await expect(win.locator('.tabs [role=tab]')).toHaveCount(0)

    await tryOpen('https://example.test/small.pdf')
    await expect(dialog).toHaveCount(0)
    await expect(win.locator('.tabs [role=tab]')).toHaveCount(1)
    expect(await tabNames(app)).toEqual(['small.pdf'])
    await expect(win.locator('.page')).toHaveCount(1)
    // It has no file yet, so it shows as unsaved.
    await expect(win.locator('.tab-dirty')).toHaveCount(1)
  } finally {
    await app?.close().catch(() => undefined)
    rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 })
  }
})

test('Send by e-mail saves, then offers what can honestly be done', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'openpdf-e2e-'))
  const a = join(dir, 'letter.pdf')
  const log = join(dir, 'mail.log')
  execFileSync('python', [join(root, 'scripts', 'make-test-pdf.py'), a])
  let app: ElectronApplication | null = null
  try {
    app = await launch(dir, [a], { OPENPDF_E2E_MAIL_LOG: log })
    const win = await app.firstWindow()
    await expect(win.locator('.page')).toHaveCount(6)
    await win.getByRole('tab', { name: 'File', exact: true }).click()
    await win.getByRole('button', { name: 'Send by e-mail' }).click()
    const dialog = win.getByRole('dialog', { name: 'Send by e-mail' })
    await expect(dialog).toContainText('cannot attach a file')
    await dialog.getByRole('button', { name: 'Show in Explorer' }).click()
    await expect(dialog.getByRole('status')).toContainText('has not been attached')
    await expect.poll(() => (existsSync(log) ? readFileSync(log, 'utf8') : '')).toBe(`reveal|${a}`)
    await dialog.getByRole('button', { name: 'Start a message without the file' }).click()
    await expect(dialog.getByRole('status')).toContainText('The file is not attached')
    await expect.poll(() => readFileSync(log, 'utf8')).toBe(`compose|${a}`)
  } finally {
    await app?.close().catch(() => undefined)
    rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 })
  }
})
