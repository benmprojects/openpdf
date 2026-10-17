import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(__dirname, '..')

const launch = (dir: string, args: string[] = [], env: Record<string, string> = {}) =>
  electron.launch({
    args: ['.', ...args],
    cwd: root,
    env: {
      ...process.env,
      OPENPDF_E2E: '1',
      OPENPDF_E2E_USERDATA: join(dir, 'ud'),
      OPENPDF_E2E_DISCARD: '1',
      ...env
    }
  })

const settingsOf = (dir: string) => JSON.parse(readFileSync(join(dir, 'ud', 'settings.json'), 'utf8')) as Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

async function withDoc(run: (win: Page, app: ElectronApplication, dir: string, pdf: string) => Promise<void>, env: Record<string, string> = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'openpdf-e2e-'))
  const pdf = join(dir, 'work.pdf')
  execFileSync('python', [join(root, 'scripts', 'make-test-pdf.py'), pdf])
  const app = await launch(dir, [pdf], env)
  try {
    const win = await app.firstWindow()
    const problems: string[] = []
    win.on('pageerror', (e) => problems.push(e.message))
    await expect(win.locator('.page')).toHaveCount(6)
    await run(win, app, dir, pdf)
    expect(problems).toEqual([])
  } finally {
    await app.close()
    rmSync(dir, {
      recursive: true,
      force: true,
      maxRetries: 20,
      retryDelay: 250
    })
  }
}

const openSettings = async (win: Page) => {
  await win.getByRole('button', { name: 'Settings', exact: true }).click()
  const d = win.getByRole('dialog', { name: 'Settings' })
  await expect(d).toBeVisible()
  return d
}

test('page display defaults are saved and applied to the documents opened next', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'openpdf-e2e-'))
  const pdf = join(dir, 'work.pdf')
  execFileSync('python', [join(root, 'scripts', 'make-test-pdf.py'), pdf])
  try {
    let app = await launch(dir, [pdf])
    let win = await app.firstWindow()
    await expect(win.locator('.page')).toHaveCount(6)
    const d = await openSettings(win)
    // The categories are listed at the top, in order.
    const nav = d.getByRole('navigation', { name: 'Settings categories' })
    expect(await nav.getByRole('button').allInnerTexts()).toEqual([
      'General',
      'Page display',
      'Search providers',
      'Identity',
      'Launch applications',
      'Performance',
      'Move settings',
      'Updates and privacy'
    ])
    const display = d.getByRole('region', { name: 'Page display' })
    await display.getByLabel('Zoom', { exact: true }).selectOption('actual')
    await display.getByRole('checkbox', { name: /Two pages side by side/ }).check()
    await display.getByRole('checkbox', { name: /Right-to-left/ }).check()
    await display.getByRole('checkbox', { name: /Space between pages/ }).uncheck()
    await display.getByRole('checkbox', { name: /Thin lines/ }).check()
    await expect
      .poll(() => settingsOf(dir).viewDefaults)
      .toEqual({
        twoUp: true,
        continuous: true,
        cover: false,
        rtl: true,
        gaps: false,
        thinLines: true,
        zoom: 'actual'
      })
    await d.getByRole('button', { name: 'Close' }).click()
    await app.close()

    // The next run opens the document that way.
    app = await launch(dir, [pdf])
    win = await app.firstWindow()
    await expect(win.locator('.page')).toHaveCount(6)
    await expect.poll(async () => await win.locator('.zoom-now').innerText()).toBe('100%')
    const box = async (i: number) => (await win.locator(`.scroller [data-page="${i}"]`).boundingBox())!
    await expect.poll(async () => (await box(1)).x < (await box(0)).x).toBe(true) // two across, right to left
    await win.getByRole('tab', { name: 'View', exact: true }).click()
    await expect(win.getByRole('button', { name: 'Right to left' })).toHaveAttribute('aria-pressed', 'true')
    await expect(win.getByRole('button', { name: 'Page gaps' })).toHaveAttribute('aria-pressed', 'false')
    await expect(win.getByRole('button', { name: 'Thin lines' })).toHaveAttribute('aria-pressed', 'true')
    await app.close()
  } finally {
    rmSync(dir, {
      recursive: true,
      force: true,
      maxRetries: 20,
      retryDelay: 250
    })
  }
})

test('search providers: add, refuse a bad address, remove, and search the web for selected text', async () => {
  const dir0 = mkdtempSync(join(tmpdir(), 'openpdf-e2e-'))
  const log = join(dir0, 'link.txt')
  try {
    await withDoc(
      async (win, _app, dir) => {
        const d = await openSettings(win)
        const sec = d.getByRole('region', { name: 'Search providers' })
        await expect(sec.getByRole('list', { name: 'Search providers' }).getByRole('listitem')).toHaveCount(2)
        // An address without {q}, or without https, is refused.
        await sec.getByLabel('Name').fill('Bad')
        await sec.getByLabel('Address').fill('https://example.test/search')
        await sec.getByRole('button', { name: 'Add provider' }).click()
        await expect(sec.getByRole('alert')).toContainText('https://')
        await sec.getByLabel('Address').fill('http://example.test/?q={q}')
        await sec.getByRole('button', { name: 'Add provider' }).click()
        await expect(sec.getByRole('alert')).toBeVisible()
        await expect(sec.getByRole('list', { name: 'Search providers' }).getByRole('listitem')).toHaveCount(2)
        // A good one is added; the standard DuckDuckGo one is removed.
        await sec.getByLabel('Name').fill('Council search')
        await sec.getByLabel('Address').fill('https://council.example.test/find?term={q}')
        await sec.getByRole('button', { name: 'Add provider' }).click()
        await sec.getByRole('button', { name: 'Remove DuckDuckGo' }).click()
        await expect.poll(() => settingsOf(dir).searchProviders.map((p: { name: string }) => p.name)).toEqual(['Wikipedia', 'Council search'])
        await d.getByRole('button', { name: 'Close' }).click()

        // Home tab: the button needs selected text; the provider can be chosen.
        const search = win.getByRole('button', {
          name: 'Search the web',
          exact: true
        })
        await expect(search).toBeDisabled()
        await win.getByLabel('Search provider').selectOption({ label: 'Council search' })
        const p = (await win.locator('.page').first().boundingBox())!
        const z = p.width / 595
        await win.mouse.move(p.x + 62 * z, p.y + 70 * z)
        await win.mouse.down()
        await win.mouse.move(p.x + 250 * z, p.y + 70 * z, { steps: 6 })
        await win.mouse.up()
        await expect(search).toBeEnabled()
        await search.click()
        await expect.poll(() => (existsSync(log) ? readFileSync(log, 'utf8') : '')).toMatch(/^https:\/\/council\.example\.test\/find\?term=Chapter/)
      },
      { OPENPDF_E2E_LINKS: log }
    )
  } finally {
    rmSync(dir0, {
      recursive: true,
      force: true,
      maxRetries: 20,
      retryDelay: 250
    })
  }
})

test('identity details are saved, and a stamp can use the initials', async () => {
  await withDoc(async (win, _app, dir) => {
    const d = await openSettings(win)
    const sec = d.getByRole('region', { name: 'Identity' })
    await sec.getByLabel('Initials').fill('TU')
    await sec.getByLabel('Job title').fill('Site engineer')
    await sec.getByLabel('Organisation').fill('Example Pty Ltd')
    await sec.getByLabel('E-mail address').fill('user@example.test')
    await expect
      .poll(() => settingsOf(dir).identity)
      .toEqual({
        initials: 'TU',
        title: 'Site engineer',
        organisation: 'Example Pty Ltd',
        email: 'user@example.test'
      })
    await expect(sec).toContainText('{initials}')
  })
})

test('launch applications: a program is set for a file type and used to open an attached file', async () => {
  const dir0 = mkdtempSync(join(tmpdir(), 'openpdf-e2e-'))
  const note = join(dir0, 'site notes.txt')
  writeFileSync(note, 'Pour scheduled for Monday.\n')
  const log = join(dir0, 'launch.json')
  try {
    await withDoc(
      async (win, _app, dir) => {
        const d = await openSettings(win)
        const sec = d.getByRole('region', { name: 'Launch applications' })
        // Refused: no full path, or no file types.
        await sec.getByLabel('Name').fill('Notes')
        await sec.getByLabel('File types').fill('txt')
        await sec.getByLabel('Program').fill('notes.exe')
        await sec.getByRole('button', { name: 'Add program' }).click()
        await expect(sec.getByRole('alert')).toContainText('full path')
        await sec.getByLabel('Program').fill(process.execPath)
        await sec.getByRole('button', { name: 'Add program' }).click()
        await expect
          .poll(() => settingsOf(dir).launchApps)
          .toEqual([
            {
              id: 'notes',
              name: 'Notes',
              extensions: ['txt'],
              path: process.execPath
            }
          ])
        await d.getByRole('button', { name: 'Close' }).click()

        // Attach a text file (an attached file is one of the document's attachments), then open it with the program.
        const pane = win.locator('aside.sidebar')
        await pane.getByRole('tab', { name: 'Attachments' }).click()
        await pane.getByRole('button', { name: 'Add files…' }).click()
        await expect(pane.getByRole('list', { name: 'Attached files' })).toContainText('site notes.txt')
        await pane.getByRole('button', { name: 'Open site notes.txt with its program' }).click()
        await expect
          .poll(() =>
            existsSync(log)
              ? (JSON.parse(readFileSync(log, 'utf8')) as {
                  exe: string
                  file: string
                })
              : null
          )
          .toMatchObject({ exe: process.execPath })
        const call = JSON.parse(readFileSync(log, 'utf8')) as {
          exe: string
          file: string
        }
        expect(call.file).toMatch(/site notes\.txt$/)
        expect(readFileSync(call.file, 'utf8')).toBe('Pour scheduled for Monday.\n')
        await expect(win.getByText(/Opened site notes\.txt with Notes/)).toBeVisible()

        // Not part of exported settings: it names programs on this computer.
        const exported = join(dir, 'export.json')
        void exported
      },
      { OPENPDF_E2E_PICK: note, OPENPDF_E2E_LAUNCH_LOG: log }
    )
  } finally {
    rmSync(dir0, {
      recursive: true,
      force: true,
      maxRetries: 20,
      retryDelay: 250
    })
  }
})

test('performance settings are saved and change when a page is drawn in tiles', async () => {
  await withDoc(async (win, _app, dir) => {
    await win.getByRole('tab', { name: 'View', exact: true }).click()
    // At 300 % a page is about 7 megapixels: drawn whole at the standard limit.
    const status = win.getByRole('toolbar', { name: 'Page and zoom' })
    await status.getByLabel('Zoom', { exact: true }).selectOption('3')
    await expect(win.locator('.zoom-now')).toHaveText('300%')
    await expect(win.locator('.scroller canvas.page-tile')).toHaveCount(0)

    const d = await openSettings(win)
    const sec = d.getByRole('region', { name: 'Performance' })
    await sec.getByLabel('Draw a page in tiles above (megapixels)').selectOption('4')
    await sec.getByLabel('Draw pages this far ahead of scrolling (pixels)').selectOption('300')
    await sec.getByLabel('Pages drawn at the same time').selectOption('1')
    await expect.poll(() => settingsOf(dir).performance).toEqual({ tileMegapixels: 4, renderAhead: 300, renderJobs: 1 })
    await d.getByRole('button', { name: 'Close' }).click()
    await expect.poll(() => win.locator('.scroller canvas.page-tile').count()).toBeGreaterThan(0)

    const again = await openSettings(win)
    await again.getByRole('button', { name: 'Use the standard values' }).click()
    await expect.poll(() => settingsOf(dir).performance).toEqual({ tileMegapixels: 16, renderAhead: 600, renderJobs: 2 })
    await again.getByRole('button', { name: 'Close' }).click()
    await expect(win.locator('.scroller canvas.page-tile')).toHaveCount(0)
  })
})

test('reset settings puts the preferences back and keeps the recent files; export leaves out the local ones', async () => {
  const dir0 = mkdtempSync(join(tmpdir(), 'openpdf-e2e-'))
  const exported = join(dir0, 'export.json')
  try {
    await withDoc(
      async (win, _app, dir, pdf) => {
        const d = await openSettings(win)
        await d.getByLabel('Author name for comments').fill('Test Person')
        await d.getByLabel('Theme').selectOption('dark')
        await d.getByRole('region', { name: 'Identity' }).getByLabel('Initials').fill('TP')
        await d.getByRole('region', { name: 'Launch applications' }).getByLabel('Name').fill('Notes')
        await d.getByRole('region', { name: 'Launch applications' }).getByLabel('File types').fill('txt')
        await d.getByRole('region', { name: 'Launch applications' }).getByLabel('Program').fill(process.execPath)
        await d.getByRole('region', { name: 'Launch applications' }).getByRole('button', { name: 'Add program' }).click()
        await expect.poll(() => settingsOf(dir).author).toBe('Test Person')
        expect(settingsOf(dir).recent).toContain(pdf)

        // Export: the portable settings only (no launch applications, no recent files).
        await d.getByRole('button', { name: 'Export settings…' }).click()
        await expect(d.getByText(/Settings saved to/)).toBeVisible()
        const saved = JSON.parse(readFileSync(exported, 'utf8')) as {
          settings: Record<string, unknown>
        }
        expect(saved.settings.identity).toMatchObject({ initials: 'TP' })
        expect(saved.settings).not.toHaveProperty('launchApps')
        expect(saved.settings).not.toHaveProperty('recent')

        // Reset asks first; Cancel leaves everything.
        await d.getByRole('button', { name: 'Reset settings to defaults…' }).click()
        await expect(d.getByRole('alert')).toContainText('Reset every setting')
        await d.getByRole('button', { name: 'Cancel' }).click()
        expect(settingsOf(dir).author).toBe('Test Person')
        await d.getByRole('button', { name: 'Reset settings to defaults…' }).click()
        await d.getByRole('button', { name: 'Reset', exact: true }).click()
        await expect.poll(() => settingsOf(dir).author).not.toBe('Test Person')
        const s = settingsOf(dir)
        expect(s.theme).toBe('system')
        expect(s.identity.initials).toBe('')
        expect(s.launchApps).toEqual([])
        expect(s.quickAccess).toEqual(['open', 'save', 'print', 'undo', 'redo'])
        expect(s.recent).toContain(pdf) // the recent files are not preferences
        await expect(d.getByLabel('Theme')).toHaveValue('system')
        await expect(d.getByLabel('Author name for comments')).not.toHaveValue('Test Person')
      },
      { OPENPDF_E2E_SETTINGS_FILE: exported }
    )
  } finally {
    rmSync(dir0, {
      recursive: true,
      force: true,
      maxRetries: 20,
      retryDelay: 250
    })
  }
})
