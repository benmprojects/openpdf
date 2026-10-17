import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(__dirname, '..')

interface PageInfo {
  text: string
  media: number[]
  crop: number[]
}
interface Info {
  pages: PageInfo[]
  toc: [number, string, number][]
  /** /A of each bookmark by title. */
  actions: Record<string, string>
}

function inspect(path: string): Info {
  const py = `
import sys, json, pymupdf
d = pymupdf.open(sys.argv[1])
acts = {}
for x in range(1, d.xref_length()):
    t = d.xref_get_key(x, "Title")
    if t[0] == "null" or t[0] == "xref":
        continue
    acts[t[1]] = d.xref_get_key(x, "A")[1]
print(json.dumps({
  "pages": [{"text": p.get_text(), "media": [round(v, 1) for v in p.mediabox], "crop": [round(v, 1) for v in p.cropbox]} for p in d],
  "toc": d.get_toc(),
  "actions": acts,
}))
`
  return JSON.parse(execFileSync('python', ['-c', py, path]).toString())
}

async function save(win: Page) {
  await win.keyboard.press('Control+s')
  await expect(win.locator('.tab-dirty')).toHaveCount(0)
}

async function launch(dir: string, extra: Record<string, string> = {}): Promise<{ app: ElectronApplication; win: Page; pdfPath: string; problems: string[] }> {
  const pdfPath = join(dir, 'pages.pdf')
  execFileSync('python', [join(root, 'scripts', 'make-test-pdf.py'), pdfPath])
  const app = await electron.launch({
    args: ['.', pdfPath],
    cwd: root,
    env: { ...process.env, OPENPDF_E2E: '1', OPENPDF_E2E_USERDATA: join(dir, 'ud'), OPENPDF_E2E_DISCARD: '1', ...extra }
  })
  const win = await app.firstWindow()
  const problems: string[] = []
  win.on('pageerror', (e) => problems.push(e.message))
  await expect(win.locator('.page')).toHaveCount(6)
  return { app, win, pdfPath, problems }
}

const cleanup = async (app: ElectronApplication, dir: string) => {
  await app.close()
  rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 })
}

test('Insert: odd or even source pages, bookmarks of the inserted pages brought in', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'openpdf-e2e-'))
  const source = join(dir, 'source.pdf')
  execFileSync('python', [join(root, 'scripts', 'make-test-pdf.py'), source])
  const { app, win, pdfPath, problems } = await launch(dir, { OPENPDF_E2E_PICK: source })
  try {
    await win.getByRole('tab', { name: 'Organise' }).click()
    await win.locator('.thumb').nth(5).click()
    await win.getByRole('button', { name: 'Insert', exact: true }).click()
    const ins = win.getByRole('dialog', { name: 'Insert pages' })
    // Nothing to choose for comments, fields or bookmarks of blank pages.
    await ins.getByRole('radio', { name: 'Blank pages' }).check()
    await expect(ins.getByRole('combobox', { name: 'Bookmarks of the inserted pages' })).toHaveCount(0)
    await ins.getByRole('radio', { name: 'From a PDF file' }).check()
    await ins.getByRole('button', { name: 'Add files…' }).click()
    await expect(ins.getByRole('list', { name: 'Files' }).getByRole('listitem')).toHaveCount(1)
    // Even page numbers of the source: pages 2, 4 and 6.
    await ins.getByRole('combobox', { name: /Which pages of/ }).selectOption('even')
    await expect(ins.locator('.pod-summary')).toContainText('3 pages will be inserted after page 6')
    // The comments, fields and bookmarks choices.
    await expect(ins.getByRole('combobox', { name: 'Comments on the inserted pages' })).toHaveValue('keep')
    await expect(ins.getByRole('combobox', { name: 'Form fields on the inserted pages' })).toHaveValue('keep')
    await expect(ins.getByRole('combobox', { name: 'Bookmarks of the inserted pages' })).toHaveValue('remove')
    await ins.getByRole('combobox', { name: 'Bookmarks of the inserted pages' }).selectOption('keep')
    await ins.getByRole('button', { name: 'Insert', exact: true }).click()
    await expect(win.locator('.page')).toHaveCount(9)
    await save(win)
    const r = inspect(pdfPath)
    expect(r.pages).toHaveLength(9)
    // Inserted pages are the source's pages 2, 4 and 6 (landscape, landscape... page 2 is landscape).
    expect(r.pages[6].text).toContain('Chapter page 2')
    expect(r.pages[7].text).toContain('Chapter page 4')
    expect(r.pages[8].text).toContain('Chapter page 6')
    const titles = r.toc.map(([, t, p]) => `${t}@${p}`)
    // The document's own bookmarks stay; the source's Part 2 (page 4) and Part 3 (page 6) arrive on pages 8 and 9.
    expect(titles).toEqual(expect.arrayContaining(['Part 1@1', 'Part 2@4', 'Part 3@6', 'Part 2@8', 'Part 3@9', 'Section 1.1@7']))
    expect(problems).toEqual([])
  } finally {
    await cleanup(app, dir)
  }
})

test('Insert: the odd pages only, with the bookmarks left out', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'openpdf-e2e-'))
  const source = join(dir, 'source.pdf')
  execFileSync('python', [join(root, 'scripts', 'make-test-pdf.py'), source])
  const { app, win, pdfPath, problems } = await launch(dir, { OPENPDF_E2E_PICK: source })
  try {
    await win.getByRole('tab', { name: 'Organise' }).click()
    await win.getByRole('button', { name: 'Insert', exact: true }).click()
    const ins = win.getByRole('dialog', { name: 'Insert pages' })
    await ins.getByRole('button', { name: 'Add files…' }).click()
    await ins.getByRole('textbox', { name: /Pages to take from/ }).fill('2-5')
    await ins.getByRole('combobox', { name: /Which pages of/ }).selectOption('odd')
    await expect(ins.locator('.pod-summary')).toContainText('2 pages will be inserted') // pages 3 and 5
    await ins.getByRole('combobox', { name: 'Before or after' }).selectOption('before')
    await ins.getByRole('combobox', { name: 'Page to insert next to' }).selectOption('first')
    await ins.getByRole('button', { name: 'Insert', exact: true }).click()
    await expect(win.locator('.page')).toHaveCount(8)
    await save(win)
    const r = inspect(pdfPath)
    expect(r.pages[0].text).toContain('Chapter page 3')
    expect(r.pages[1].text).toContain('Chapter page 5')
    expect(r.toc.map(([, t]) => t)).toEqual(['Part 1', 'Section 1.1', 'Section 1.2', 'Part 2', 'Part 3'])
    expect(problems).toEqual([])
  } finally {
    await cleanup(app, dir)
  }
})

test('Join pages: two half pages become one, side by side or stacked', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'openpdf-e2e-'))
  const { app, win, pdfPath, problems } = await launch(dir)
  try {
    await win.getByRole('tab', { name: 'Organise' }).click()
    await win.getByRole('button', { name: 'Join pages' }).click()
    const dlg = win.getByRole('dialog', { name: 'Join pages' })
    await dlg.getByRole('combobox', { name: 'Pages', exact: true }).selectOption('custom')
    await dlg.getByRole('textbox', { name: 'Custom pages' }).fill('1')
    await expect(dlg.getByRole('alert')).toHaveText('Choose at least two pages to join.')
    await dlg.getByRole('textbox', { name: 'Custom pages' }).fill('1-4')
    await expect(dlg.locator('.pod-summary')).toContainText('2 pages will be made from 4 pages')
    await dlg.getByRole('combobox', { name: 'How to join the pages' }).selectOption('side')
    await dlg.getByRole('button', { name: 'Join', exact: true }).click()
    await expect(win.locator('.page')).toHaveCount(4)
    await save(win)
    const r = inspect(pdfPath)
    // Page 1 is portrait 595 x 842 and page 2 landscape 842 x 595: side by side they make 1437 x 842.
    expect(r.pages[0].media.slice(2)).toEqual([1437, 842])
    expect(r.pages[0].text).toContain('Chapter page 1')
    expect(r.pages[0].text).toContain('Chapter page 2')
    expect(r.pages[1].text).toContain('Chapter page 3')
    expect(r.pages[1].text).toContain('Chapter page 4')
    expect(r.pages[2].text).toContain('Chapter page 5')
    expect(r.pages[3].text).toContain('Chapter page 6')
    expect(problems).toEqual([])
  } finally {
    await cleanup(app, dir)
  }
})

test('Crop: odd and even pages apart, trim white margins, and remove the cropped area for good', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'openpdf-e2e-'))
  const { app, win, pdfPath, problems } = await launch(dir)
  try {
    await win.getByRole('tab', { name: 'Layout', exact: true }).click()
    const dlg = win.getByRole('dialog', { name: 'Crop pages' })
    // Different margins for odd and even pages: 10 mm all round on odd pages, 30 mm on the left of even ones.
    await win.getByRole('button', { name: 'Crop…' }).click()
    await dlg.getByRole('checkbox', { name: 'Different margins for even pages' }).check()
    await dlg.getByRole('spinbutton', { name: 'Even pages: left' }).fill('30')
    await dlg.getByRole('spinbutton', { name: 'Even pages: top' }).fill('10')
    await dlg.getByRole('spinbutton', { name: 'Even pages: right' }).fill('10')
    await dlg.getByRole('spinbutton', { name: 'Even pages: bottom' }).fill('10')
    await dlg.getByRole('button', { name: 'Apply', exact: true }).click()
    await expect(win.getByText(/Cropped 6 pages/)).toBeVisible()
    await save(win)
    let r = inspect(pdfPath)
    const mm = (n: number) => (n * 72) / 25.4
    // Page 1 (odd): 10 mm each side of 595 x 842. Page 2 (even, landscape 842 x 595): 30 mm left, 10 mm right.
    expect(r.pages[0].crop[0]).toBeCloseTo(mm(10), 0)
    expect(r.pages[1].crop[0]).toBeCloseTo(mm(30), 0)
    expect(r.pages[1].crop[2]).toBeCloseTo(842 - mm(10), 0)

    // Remove the cropping, then trim each page to its content.
    await win.getByRole('button', { name: 'Crop…' }).click()
    await dlg.getByRole('button', { name: 'Remove cropping' }).click()
    await expect(win.getByText(/Removed cropping/)).toBeVisible()
    await win.getByRole('button', { name: 'Crop…' }).click()
    await dlg.getByRole('button', { name: 'Trim white margins' }).click()
    await expect(win.getByText(/Cropped 6 pages/)).toBeVisible()
    await save(win)
    r = inspect(pdfPath)
    const trimmedWidth = r.pages[0].crop[2] - r.pages[0].crop[0]
    for (const p of r.pages) {
      // The test pages hold text near the top left and a red box: white space is trimmed on at least the right and bottom.
      expect(p.crop[2] - p.crop[0]).toBeLessThan(p.media[2] - p.media[0] - 20)
      expect(p.crop[3] - p.crop[1]).toBeLessThan(p.media[3] - p.media[1] - 20)
    }

    // Remove the cropped area for good on page 1: the page itself becomes the cropped size.
    await win.getByRole('button', { name: 'Crop…' }).click()
    await dlg.getByRole('combobox', { name: 'Pages' }).selectOption('current')
    await dlg.getByRole('checkbox', { name: 'Remove the cropped area for good' }).check()
    for (const side of ['Top', 'Bottom', 'Left', 'Right']) await dlg.getByRole('spinbutton', { name: side, exact: true }).fill('20')
    await dlg.getByRole('button', { name: 'Apply', exact: true }).click()
    await expect(win.getByText(/removed the cropped area/)).toBeVisible()
    await save(win)
    r = inspect(pdfPath)
    const size = (b: number[]) => [Math.round(b[2] - b[0]), Math.round(b[3] - b[1])]
    expect(size(r.pages[0].media)).toEqual(size(r.pages[0].crop)) // the page itself is the cropped size now
    expect(r.pages[0].media[2] - r.pages[0].media[0]).toBeCloseTo(trimmedWidth - 2 * mm(20), 0)
    expect(r.pages[1].media).toEqual([0, 0, 842, 595]) // other pages are untouched
    expect(problems).toEqual([])
  } finally {
    await cleanup(app, dir)
  }
})

test('Header and footer: a different first page, per-side margins, and saved settings that last', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'openpdf-e2e-'))
  const { app, win, pdfPath, problems } = await launch(dir)
  try {
    await win.getByRole('tab', { name: 'Layout', exact: true }).click()
    const dlg = win.getByRole('dialog', { name: 'Header and footer' })
    await win.getByRole('button', { name: 'Header & footer' }).click()
    await dlg.getByRole('checkbox', { name: 'Different text on the first page' }).check()
    await dlg.getByRole('textbox', { name: 'First page: top centre' }).fill('COVER')
    await dlg.getByRole('checkbox', { name: 'Set each side' }).check()
    await dlg.getByRole('spinbutton', { name: 'Top margin (mm)' }).fill('15')
    // Keep these settings.
    await dlg.getByRole('textbox', { name: 'Name for these settings' }).fill('Cover and footer')
    await dlg.getByRole('button', { name: 'Save settings' }).click()
    await expect(dlg.getByRole('combobox', { name: 'Saved settings' }).locator('option')).toHaveCount(2)
    await dlg.getByRole('button', { name: 'Apply', exact: true }).click()
    await expect(win.getByText(/Added a header and footer to 6 pages/)).toBeVisible()
    await save(win)
    const r = inspect(pdfPath)
    expect(r.pages[0].text).toContain('COVER')
    expect(r.pages[0].text).not.toContain('Page 1 of 6') // the first page has only what its own text says
    expect(r.pages[0].text).not.toContain('pages.pdf')
    expect(r.pages[1].text).toContain('pages.pdf')
    expect(r.pages[1].text).toContain('Page 2 of 6')

    // The saved settings are in the program's settings file and come back in a new dialog.
    await expect
      .poll(() => (existsSync(join(dir, 'ud', 'settings.json')) ? readFileSync(join(dir, 'ud', 'settings.json'), 'utf8') : ''))
      .toContain('Cover and footer')
    await win.getByRole('button', { name: 'Header & footer' }).click()
    await dlg.getByRole('combobox', { name: 'Saved settings' }).selectOption({ label: 'Cover and footer' })
    await expect(dlg.getByRole('checkbox', { name: 'Different text on the first page' })).toBeChecked()
    await expect(dlg.getByRole('textbox', { name: 'First page: top centre' })).toHaveValue('COVER')
    await expect(dlg.getByRole('textbox', { name: 'Bottom right', exact: true })).toHaveValue('Page <<page>> of <<pages>>')
    await dlg.getByRole('button', { name: 'Delete settings' }).click()
    await expect(dlg.getByRole('combobox', { name: 'Saved settings' }).locator('option')).toHaveCount(1)
    expect(problems).toEqual([])
  } finally {
    await cleanup(app, dir)
  }
})

test('Watermark: tiled across the page, placed and shrunk to fit', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'openpdf-e2e-'))
  const { app, win, pdfPath, problems } = await launch(dir)
  try {
    await win.getByRole('tab', { name: 'Layout', exact: true }).click()
    const dlg = win.getByRole('dialog', { name: 'Watermark' })
    await win.getByRole('button', { name: 'Watermark', exact: true }).click()
    await dlg.getByRole('textbox', { name: 'Text', exact: true }).fill('DRAFT')
    await dlg.getByRole('combobox', { name: 'Angle' }).selectOption('0')
    await dlg.getByRole('spinbutton', { name: 'Font size' }).fill('40')
    await dlg.getByRole('checkbox', { name: 'Tile across the page' }).check()
    await dlg.getByRole('combobox', { name: 'Pages' }).selectOption('current')
    await dlg.getByRole('button', { name: 'Apply', exact: true }).click()
    await expect(win.getByText(/Added a watermark to 1 page/)).toBeVisible()
    // Shrunk to fit: a huge mark in the top left corner, on page 2.
    await win.getByRole('button', { name: 'Watermark', exact: true }).click()
    await dlg.getByRole('textbox', { name: 'Text', exact: true }).fill('SHRUNKTOFIT')
    await dlg.getByRole('spinbutton', { name: 'Font size' }).fill('300')
    await dlg.getByRole('combobox', { name: 'Angle' }).selectOption('0')
    await dlg.getByRole('combobox', { name: 'Position' }).selectOption('tl')
    await dlg.getByRole('checkbox', { name: 'Shrink to fit the page' }).check()
    await dlg.getByRole('combobox', { name: 'Pages' }).selectOption('custom')
    await dlg.getByRole('textbox', { name: 'Page range' }).fill('2')
    await dlg.getByRole('button', { name: 'Apply', exact: true }).click()
    await expect(win.getByText(/Added a watermark to 1 page/)).toBeVisible()
    await save(win)
    const r = inspect(pdfPath)
    expect((r.pages[0].text.match(/DRAFT/g) ?? []).length).toBeGreaterThan(4)
    expect(r.pages[1].text).toContain('SHRUNKTOFIT')
    expect(r.pages[1].text).not.toContain('DRAFT')
    expect(problems).toEqual([])
  } finally {
    await cleanup(app, dir)
  }
})

test('Bookmarks: copy, cut and paste, the pages of a bookmark, check for bookmarks that lead nowhere, named destinations', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'openpdf-e2e-'))
  const outline = join(dir, 'outline.txt')
  const extract = join(dir, 'part1.pdf')
  writeFileSync(outline, 'Broken one\t99\nBroken two\t\n')
  const { app, win, pdfPath, problems } = await launch(dir, { OPENPDF_E2E_PICK: outline, OPENPDF_E2E_SAVE: extract })
  try {
    await win.getByRole('tab', { name: 'Bookmarks' }).click()
    const titles = win.locator('.outline-title')
    const titleOf = (name: string) => win.locator('.outline-title', { hasText: new RegExp(`^${name}$`) })
    await expect(titles).toHaveCount(5)

    // Copy "Part 1" (with its two sections) and paste it after "Part 3".
    await titleOf('Part 1').click()
    await win.getByRole('button', { name: 'Copy bookmark' }).click()
    await titleOf('Part 3').click()
    await win.getByRole('button', { name: 'Paste bookmark' }).click()
    await expect(titleOf('Part 1')).toHaveCount(2)
    await expect(titles).toHaveCount(8)

    // Cut "Part 2" and paste it back after the first "Part 1" group.
    await titleOf('Part 2').click()
    await win.getByRole('button', { name: 'Cut bookmark' }).click()
    await expect(titleOf('Part 2')).toHaveCount(0)
    await titleOf('Part 1').first().click()
    await win.getByRole('button', { name: 'Paste bookmark' }).click()
    await expect(titleOf('Part 2')).toHaveCount(1)

    // The pages a bookmark covers: "Part 1" runs to the page before "Part 2" (page 4): pages 1 to 3.
    await titleOf('Part 1').first().click()
    await win.getByRole('button', { name: 'Extract the pages of this bookmark' }).click()
    await expect(win.getByText(/Extracted 3 pages \(1-3\)/)).toBeVisible()
    const part1 = inspect(extract)
    expect(part1.pages).toHaveLength(3)
    expect(part1.pages[0].text).toContain('Chapter page 1')
    expect(part1.pages[2].text).toContain('Chapter page 3')
    await win.getByRole('button', { name: 'Print the pages of this bookmark' }).click()
    const print = win.getByRole('dialog', { name: 'Print' })
    await expect(print.getByRole('combobox', { name: 'Page range' })).toHaveValue('custom')
    await expect(print.getByRole('textbox', { name: 'Page range, for example 1-3, 5' })).toHaveValue('1-3')
    await win.keyboard.press('Escape')

    // Import two bookmarks with no usable page, then check and delete them.
    await win.getByRole('button', { name: 'Import bookmarks' }).click()
    await expect(titleOf('Broken one')).toHaveCount(1)
    await win.getByRole('button', { name: 'Check bookmarks' }).click()
    const check = win.getByRole('dialog', { name: 'Check bookmarks' })
    await expect(check.getByRole('list', { name: 'Bookmarks that lead nowhere' }).getByRole('listitem')).toHaveCount(2)
    await check.getByRole('button', { name: 'Delete these bookmarks' }).click()
    await expect(titleOf('Broken one')).toHaveCount(0)
    await expect(titleOf('Broken two')).toHaveCount(0)
    await win.getByRole('button', { name: 'Check bookmarks' }).click()
    await expect(check.getByRole('status')).toHaveText('Every bookmark leads somewhere.')
    await check.locator('.pod-actions').getByRole('button', { name: 'Close' }).click()
    await save(win)
    const saved = inspect(pdfPath)
    expect(saved.toc.map(([, t]) => t).filter((t) => t === 'Part 1')).toHaveLength(2)
    expect(saved.toc.map(([, t]) => t)).not.toContain('Broken one')
    expect(problems).toEqual([])
  } finally {
    await cleanup(app, dir)
  }
})

test('Bookmarks: a named destination as the action of a bookmark', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'openpdf-e2e-'))
  const base = join(dir, 'base.pdf')
  execFileSync('python', [join(root, 'scripts', 'make-test-pdf.py'), base])
  // A copy with one named destination, "chapter2", on page 2.
  const pdfPath = join(dir, 'pages.pdf')
  execFileSync('python', ['-c', 'import sys, pymupdf\nd = pymupdf.open(sys.argv[1])\nd.xref_set_key(d.pdf_catalog(), "Names", "<</Dests <</Names [(chapter2) [%d 0 R /Fit]]>>>>" % d[1].xref)\nd.save(sys.argv[2])', base, pdfPath])
  copyFileSync(pdfPath, join(dir, 'copy.pdf'))
  const app = await electron.launch({ args: ['.', pdfPath], cwd: root, env: { ...process.env, OPENPDF_E2E: '1', OPENPDF_E2E_USERDATA: join(dir, 'ud'), OPENPDF_E2E_DISCARD: '1' } })
  try {
    const win = await app.firstWindow()
    const problems: string[] = []
    win.on('pageerror', (e) => problems.push(e.message))
    await expect(win.locator('.page')).toHaveCount(6)
    await win.getByRole('tab', { name: 'Bookmarks' }).click()
    await win.locator('.outline-title', { hasText: /^Part 3$/ }).click()
    await win.getByRole('button', { name: 'Bookmark action' }).click()
    const dlg = win.getByRole('dialog', { name: 'Bookmark action' })
    await dlg.getByRole('radio', { name: 'Go to a named destination' }).check()
    await expect(dlg.getByRole('combobox', { name: 'Named destination' }).locator('option')).toHaveText(['chapter2 (page 2)'])
    await dlg.getByRole('button', { name: 'OK' }).click()
    await expect(win.getByText('Bookmarks updated')).toBeVisible()
    await save(win)
    const r = inspect(pdfPath)
    expect(r.actions['Part 3']).toContain('chapter2')
    // The named destination leads to page 2, and the bookmark follows it.
    expect(r.toc.find(([, t]) => t === 'Part 3')?.[2]).toBe(2)

    // A named destination that is not defined is found by the check.
    await win.getByRole('button', { name: 'Check bookmarks' }).click()
    await expect(win.getByRole('dialog', { name: 'Check bookmarks' }).getByRole('status')).toHaveText('Every bookmark leads somewhere.')
    expect(problems).toEqual([])
  } finally {
    await app.close()
    rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 })
  }
})
