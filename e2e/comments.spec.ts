import { _electron as electron, expect, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(__dirname, '..')

test('comment list: filter, reply, status, save, read back, summarise and export', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'openpdf-e2e-'))
  const pdfPath = join(dir, 'comments.pdf')
  const csvPath = join(dir, 'comments.csv')
  const summaryPath = join(dir, 'summary.pdf')
  execFileSync('python', [join(root, 'scripts', 'make-test-pdf.py'), pdfPath])
  const launch = () =>
    electron.launch({
      args: ['.', pdfPath],
      cwd: root,
      env: {
        ...process.env,
        OPENPDF_E2E: '1',
        OPENPDF_E2E_USERDATA: join(dir, 'ud'),
        OPENPDF_E2E_SAVE_TEXT: csvPath,
        OPENPDF_E2E_SAVE: summaryPath,
        OPENPDF_E2E_DISCARD: '1'
      }
    })
  let app = await launch()
  try {
    let win = await app.firstWindow()
    const problems: string[] = []
    win.on('pageerror', (e) => problems.push(e.message))
    await expect(win.locator('.page')).toHaveCount(6)
    const p = (await win.locator('.page').first().boundingBox())!

    // Two comments: a note and a rectangle.
    await win.getByRole('tab', { name: 'Comment', exact: true }).click()
    await win.getByRole('button', { name: 'Note', exact: true }).click()
    await win.mouse.click(p.x + 500, p.y + 120)
    await win.getByRole('textbox', { name: 'Note text' }).fill('Check the kerb height here')
    await win.getByRole('textbox', { name: 'Note text' }).press('Control+Enter')
    await win.getByRole('tab', { name: 'Draw' }).click()
    await win.getByRole('button', { name: 'Rectangle', exact: true }).click()
    await win.mouse.move(p.x + 100, p.y + 450)
    await win.mouse.down()
    await win.mouse.move(p.x + 300, p.y + 520, { steps: 4 })
    await win.mouse.up()

    // The Comments pane lists both, with the author from settings.
    await win.getByRole('tab', { name: 'Comments', exact: true }).click()
    const list = win.getByRole('list', { name: 'Comments' })
    await expect(list.locator('li.comment')).toHaveCount(2)
    await win.getByRole('combobox', { name: 'Filter by type' }).selectOption('note')
    await expect(list.locator('li.comment')).toHaveCount(1)
    await win.getByRole('combobox', { name: 'Filter by type' }).selectOption('')

    // Reply to the note and accept it.
    const note = list.locator('li.comment', { hasText: 'Check the kerb height here' })
    await note.getByRole('button', { name: /Reply/ }).click()
    await note.getByRole('textbox', { name: 'Reply' }).fill('Measured at 150 mm, fine.')
    await note.getByRole('textbox', { name: 'Reply' }).press('Enter')
    await expect(note.locator('.comment-reply')).toHaveCount(1)
    await note.getByRole('combobox', { name: 'Set status' }).selectOption('Accepted')
    await expect(note.locator('.comment-state')).toHaveText('Accepted')
    await win.getByRole('combobox', { name: 'Filter by status' }).selectOption('Accepted')
    await expect(list.locator('li.comment')).toHaveCount(1)
    await win.getByRole('combobox', { name: 'Filter by status' }).selectOption('')
    await win.screenshot({ path: test.info().outputPath('comments.png') })

    // Export CSV and a summary PDF.
    await win.getByRole('button', { name: 'Export comments to CSV' }).click()
    await expect.poll(() => existsSync(csvPath)).toBe(true)
    const csv = readFileSync(csvPath, 'utf8')
    expect(csv).toContain('Check the kerb height here')
    expect(csv).toContain('Measured at 150 mm, fine.')
    expect(csv.split('\r\n').filter(Boolean)).toHaveLength(1 + 2 + 2) // header, two comments, a reply and a status
    await win.getByRole('button', { name: 'Summarise comments' }).click()
    await expect.poll(() => existsSync(summaryPath)).toBe(true)
    const summaryText = execFileSync('python', ['-c', 'import sys, pymupdf\nprint("".join(p.get_text() for p in pymupdf.open(sys.argv[1])))', summaryPath]).toString()
    expect(summaryText).toContain('Comment summary')
    expect(summaryText).toContain('Measured at 150 mm, fine.')

    // Save; the reply and status are Text annotations in reply to the note.
    await win.keyboard.press('Control+s')
    await expect(win.locator('.tab-dirty')).toHaveCount(0)
    const py = `
import sys, json, pymupdf
d = pymupdf.open(sys.argv[1])
print(json.dumps([[a.type[1], a.info.get("title", ""), d.xref_get_key(a.xref, "IRT")[0], d.xref_get_key(a.xref, "State")[1]] for a in d[0].annots()]))
`
    const saved: string[][] = JSON.parse(execFileSync('python', ['-c', py, pdfPath]).toString())
    expect(saved.filter((s) => s[2] === 'xref')).toHaveLength(2)
    expect(saved.some((s) => s[3].includes('Accepted'))).toBe(true)
    expect(saved.every((s) => s[1] !== '')).toBe(true) // every annotation has an author
    expect(problems).toEqual([])
    await app.close()

    // Reopen: the thread and status come back on the note; replies are not drawn as extra notes.
    app = await launch()
    win = await app.firstWindow()
    await expect(win.locator('.page')).toHaveCount(6)
    await win.getByRole('tab', { name: 'Comments', exact: true }).click()
    const list2 = win.getByRole('list', { name: 'Comments' })
    await expect(list2.locator('li.comment')).toHaveCount(2)
    const note2 = list2.locator('li.comment', { hasText: 'Check the kerb height here' })
    await expect(note2.locator('.comment-state')).toHaveText('Accepted')
    await note2.getByRole('button', { name: /1 reply/ }).click()
    await expect(note2.locator('.comment-reply')).toHaveText(/Measured at 150 mm, fine\./)
  } finally {
    await app.close()
    rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 })
  }
})
