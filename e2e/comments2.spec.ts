import { _electron as electron, expect, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(__dirname, '..')

test('comment finishing: line ends, cloud, blend, locked, printable, style palette, and printing comments only', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'openpdf-e2e-'))
  const pdfPath = join(dir, 'finish.pdf')
  const printed = join(dir, 'printed.pdf')
  execFileSync('python', [join(root, 'scripts', 'make-test-pdf.py'), pdfPath])
  const app = await electron.launch({
    args: ['.', pdfPath],
    cwd: root,
    env: { ...process.env, OPENPDF_E2E: '1', OPENPDF_E2E_USERDATA: join(dir, 'ud'), OPENPDF_E2E_PRINT: printed, OPENPDF_E2E_DISCARD: '1' }
  })
  try {
    const win = await app.firstWindow()
    const problems: string[] = []
    win.on('pageerror', (e) => problems.push(e.message))
    await expect(win.locator('.page')).toHaveCount(6)
    // The Properties panel narrows the view and the page shrinks with it, so the page is measured at each drag.
    const drag = async (x0: number, y0: number, x1: number, y1: number) => {
      const p = (await win.locator('.page').first().boundingBox())!
      await win.mouse.move(p.x + x0, p.y + y0)
      await win.mouse.down()
      await win.mouse.move(p.x + x1, p.y + y1, { steps: 4 })
      await win.mouse.up()
    }

    // A line with a circle at its start and a diamond at its end.
    await win.keyboard.press('Control+e')
    await win.getByRole('tab', { name: 'Draw' }).click()
    await win.getByRole('button', { name: 'Line', exact: true }).click()
    await drag(60, 420, 230, 420)
    const panel = win.getByRole('complementary', { name: 'Properties' })
    await expect(panel).toBeVisible()
    await panel.getByRole('combobox', { name: 'Line start' }).selectOption('Circle')
    await panel.getByRole('combobox', { name: 'Line end' }).selectOption('Diamond')
    await expect(win.locator('.page').first().locator('.annot-svg g > path')).toHaveCount(2)

    // Locked: it cannot be moved or deleted, and the controls are disabled until it is unlocked.
    await panel.getByRole('checkbox', { name: 'Locked' }).check()
    await expect(panel.getByRole('combobox', { name: 'Line end' })).toBeDisabled()
    // The line tool is still on: switch to Select before trying to move it.
    await win.getByRole('tab', { name: 'Home' }).click()
    await win.getByRole('button', { name: 'Select', exact: true }).click()
    const line = win.locator('.page').first().locator('.annot-svg g > line').first()
    const x1Before = await line.getAttribute('x1')
    await drag(145, 420, 145, 520)
    expect(await line.getAttribute('x1')).toBe(x1Before)
    expect(await line.getAttribute('y1')).toBe(await line.getAttribute('y2'))
    const pg = (await win.locator('.page').first().boundingBox())!
    await win.mouse.click(pg.x + 145, pg.y + 420)
    await win.keyboard.press('Delete')
    await expect(win.locator('.page').first().locator('.annot-svg g > line')).toHaveCount(2) // the line and its hit area
    await panel.getByRole('checkbox', { name: 'Locked' }).uncheck()
    await expect(panel.getByRole('combobox', { name: 'Line end' })).toBeEnabled()

    // Save this look as a named style; a second, plain line takes it from the palette.
    await panel.getByRole('textbox', { name: 'Preset name' }).fill('Dimension line')
    await panel.getByRole('button', { name: 'Save preset' }).click()
    await expect(panel.locator('.props-preset', { hasText: 'Dimension line' })).toBeVisible()
    await win.getByRole('tab', { name: 'Draw' }).click()
    await win.getByRole('button', { name: 'Line', exact: true }).click()
    await drag(60, 470, 230, 470)
    await expect(win.locator('.page').first().locator('.annot-svg g > path')).toHaveCount(2) // only the first line has markers
    await panel.getByRole('button', { name: 'Apply Dimension line to the selected comments' }).click()
    await expect(win.locator('.page').first().locator('.annot-svg g > path')).toHaveCount(4)

    // A cloud-bordered, multiplying rectangle on the left; a second one on the right that does not print.
    await win.getByRole('button', { name: 'Rectangle', exact: true }).click()
    await drag(70, 120, 200, 200)
    await panel.getByRole('combobox', { name: 'Cloud border' }).selectOption('2')
    await panel.getByRole('combobox', { name: 'Blend mode' }).selectOption('Multiply')
    await expect(win.locator('.page').first().locator('.annot-svg g[style*="multiply"]')).toHaveCount(1)
    await drag(380, 120, 510, 200)
    await panel.getByRole('checkbox', { name: 'Printable' }).uncheck()
    await win.screenshot({ path: test.info().outputPath('comments2.png') })

    // Saved: /LE, /BE, /BM and /F as other viewers read them.
    await win.keyboard.press('Control+s')
    await expect(win.locator('.tab-dirty')).toHaveCount(0)
    const py = `
import sys, json, pymupdf
d = pymupdf.open(sys.argv[1])
out = []
for a in d[0].annots():
    out.append([a.type[1], d.xref_get_key(a.xref, "LE")[1], d.xref_get_key(a.xref, "BE")[1], d.xref_get_key(a.xref, "BM")[1], a.flags])
print(json.dumps(out))
`
    const saved: [string, string, string, string, number][] = JSON.parse(execFileSync('python', ['-c', py, pdfPath]).toString())
    const lines = saved.filter((s) => s[0] === 'Line')
    expect(lines).toHaveLength(2)
    for (const l of lines) expect(l[1].replace(/\s+/g, '')).toBe('[/Circle/Diamond]')
    const squares = saved.filter((s) => s[0] === 'Square')
    expect(squares).toHaveLength(2)
    expect(squares[0][2]).toMatch(/\/I 2/)
    expect(squares[0][3]).toBe('/Multiply')
    expect(squares[0][4] & 4).toBe(4)
    expect(squares[1][4] & 4).toBe(0) // not printable

    // Print "Comments only": the page text is gone, the printable box is there and the other is not.
    await win.keyboard.press('Control+p')
    const dialog = win.getByRole('dialog', { name: 'Print' })
    await dialog.getByRole('combobox', { name: 'Page range' }).selectOption('current')
    await dialog.getByRole('combobox', { name: 'Print what' }).selectOption('markup')
    await expect(dialog.getByRole('button', { name: 'Print', exact: true })).toBeEnabled({ timeout: 30_000 })
    await dialog.getByRole('button', { name: 'Print', exact: true }).click()
    await expect.poll(() => existsSync(printed) && statSync(printed).size > 1000, { timeout: 60_000 }).toBe(true)
    const pyPrint = `
import sys, json, pymupdf
d = pymupdf.open(sys.argv[1])
pix = d[0].get_pixmap(dpi=60)
left = right = dark = 0
for y in range(0, pix.height):
    for x in range(0, pix.width):
        r, g, b = pix.pixel(x, y)[:3]
        if r > 140 and g < 150 and b < 150 and r - g > 60:
            if x < pix.width / 2: left += 1
            else: right += 1
        elif r < 100 and g < 100 and b < 100:
            dark += 1
print(json.dumps({"left": left, "right": right, "dark": dark}))
`
    const ink: { left: number; right: number; dark: number } = JSON.parse(execFileSync('python', ['-c', pyPrint, printed]).toString())
    expect(ink.left).toBeGreaterThan(20)
    expect(ink.right).toBe(0)
    expect(ink.dark).toBe(0) // no black page text
    expect(problems).toEqual([])
  } finally {
    await app.close()
    rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 })
  }
})

test('comments list: group, hide, select all, status of several, keyboard stepping, delete with confirm', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'openpdf-e2e-'))
  const pdfPath = join(dir, 'list.pdf')
  execFileSync('python', [join(root, 'scripts', 'make-test-pdf.py'), pdfPath])
  const app = await electron.launch({
    args: ['.', pdfPath],
    cwd: root,
    env: { ...process.env, OPENPDF_E2E: '1', OPENPDF_E2E_USERDATA: join(dir, 'ud'), OPENPDF_E2E_DISCARD: '1' }
  })
  try {
    const win = await app.firstWindow()
    const problems: string[] = []
    win.on('pageerror', (e) => problems.push(e.message))
    await expect(win.locator('.page')).toHaveCount(6)
    const p = (await win.locator('.page').first().boundingBox())!

    // Three comments: two rectangles and a note.
    await win.getByRole('tab', { name: 'Draw' }).click()
    await win.getByRole('button', { name: 'Rectangle', exact: true }).click()
    for (const y of [100, 220]) {
      await win.mouse.move(p.x + 100, p.y + y)
      await win.mouse.down()
      await win.mouse.move(p.x + 260, p.y + y + 60, { steps: 4 })
      await win.mouse.up()
    }
    await win.getByRole('tab', { name: 'Comment', exact: true }).click()
    await win.getByRole('button', { name: 'Note', exact: true }).click()
    await win.mouse.click(p.x + 450, p.y + 120)
    await win.getByRole('textbox', { name: 'Note text' }).fill('Pit lid')
    await win.getByRole('textbox', { name: 'Note text' }).press('Control+Enter')

    await win.getByRole('tab', { name: 'Comments', exact: true }).click()
    const list = win.getByRole('list', { name: 'Comments', exact: true })
    await expect(list.locator('li.comment')).toHaveCount(3)

    // Group by type: a heading per type, with a count.
    await win.getByRole('combobox', { name: 'Group comments' }).selectOption('type')
    await expect(list.locator('li.comment-group')).toHaveText([/Note/, /Rectangle/])
    await expect(list.locator('li.comment-group').nth(1)).toContainText('(2)')
    await win.getByRole('combobox', { name: 'Group comments' }).selectOption('none')

    // Hide a comment on the page (the view only): the box goes, the list keeps it and says so.
    const shapes = win.locator('.page').first().locator('.annot-svg g[opacity], .annot-svg > g')
    const before = await shapes.count()
    const rectRow = list.locator('li.comment', { hasText: 'Rectangle' }).first()
    await rectRow.getByRole('button', { name: 'Hide this comment on the page' }).click()
    await expect(shapes).toHaveCount(before - 1)
    await expect(win.getByText('1 hidden')).toBeVisible()
    await rectRow.getByRole('button', { name: 'Show this comment on the page' }).click()
    await expect(shapes).toHaveCount(before)

    // Select all, then give all of them a status at once.
    await win.getByRole('checkbox', { name: 'Select all comments' }).check()
    await win.getByRole('combobox', { name: 'Set status of selected comments' }).selectOption('Accepted')
    await expect(list.locator('.comment-state')).toHaveCount(3)
    await expect(list.locator('.comment-state').first()).toHaveText('Accepted')

    // Next and previous comment, with the buttons and the arrow keys.
    await win.getByRole('checkbox', { name: 'Select all comments' }).uncheck()
    await win.getByRole('button', { name: 'Next comment' }).click()
    await expect(list.locator('li.comment.on')).toHaveCount(1)
    const first = await list.locator('li.comment.on').innerText()
    await win.getByRole('button', { name: 'Next comment' }).click()
    expect(await list.locator('li.comment.on').innerText()).not.toBe(first)
    await win.getByRole('button', { name: 'Previous comment' }).click()
    expect(await list.locator('li.comment.on').innerText()).toBe(first)
    await list.locator('li.comment.on .comment-head').focus()
    await win.keyboard.press('ArrowDown')
    expect(await list.locator('li.comment.on').innerText()).not.toBe(first)

    // Delete visible: asks first; Cancel keeps everything, Delete removes what the filter shows.
    await win.getByRole('combobox', { name: 'Filter by type' }).selectOption('rectangle')
    await win.getByRole('button', { name: 'Delete visible' }).click()
    const confirm = win.getByRole('alertdialog', { name: 'Confirm delete' })
    await expect(confirm).toContainText('Delete 2 comments')
    await confirm.getByRole('button', { name: 'Cancel' }).click()
    await expect(list.locator('li.comment')).toHaveCount(2)
    await win.getByRole('button', { name: 'Delete visible' }).click()
    await confirm.getByRole('button', { name: 'Delete', exact: true }).click()
    await win.getByRole('combobox', { name: 'Filter by type' }).selectOption('')
    await expect(list.locator('li.comment')).toHaveCount(1)
    await win.getByRole('button', { name: 'Delete all' }).click()
    await confirm.getByRole('button', { name: 'Delete', exact: true }).click()
    await expect(win.getByText('No comments in this document yet.')).toBeVisible()
    expect(problems).toEqual([])
  } finally {
    await app.close()
    rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 })
  }
})
