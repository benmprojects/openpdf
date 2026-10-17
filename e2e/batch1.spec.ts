import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(__dirname, '..')

async function launch(pdf: string, dir: string, env: Record<string, string> = {}): Promise<{ app: ElectronApplication; win: Page; problems: string[] }> {
  const app = await electron.launch({
    args: ['.', pdf],
    cwd: root,
    env: { ...process.env, OPENPDF_E2E: '1', OPENPDF_E2E_USERDATA: join(dir, 'ud'), OPENPDF_E2E_DISCARD: '1', ...env }
  })
  const win = await app.firstWindow()
  const problems: string[] = []
  win.on('pageerror', (e) => problems.push(e.message))
  return { app, win, problems }
}

const cleanup = (dir: string) => rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 })

/** Drags across part of the first text line of page 1 to select it. */
async function selectWords(win: Page, from: number, to: number) {
  const p = (await win.locator('.page').first().boundingBox())!
  const z = Number((await win.locator('.zoom-now').textContent())!.replace('%', '')) / 100
  const y = p.y + 103 * z
  await win.mouse.move(p.x + from * z, y)
  await win.mouse.down()
  await win.mouse.move(p.x + to * z, y, { steps: 6 })
  await win.mouse.up()
}

function python(script: string, ...args: string[]): unknown {
  return JSON.parse(execFileSync('python', ['-c', script, ...args]).toString())
}

test('checked flag, subject, note icon and review history: listed, filtered, grouped, saved and read back', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'openpdf-e2e-'))
  const pdf = join(dir, 'review.pdf')
  execFileSync('python', [join(root, 'scripts', 'make-test-pdf.py'), pdf])
  const { app, win, problems } = await launch(pdf, dir)
  try {
    await expect(win.locator('.page')).toHaveCount(6)
    const p = (await win.locator('.page').first().boundingBox())!
    await win.getByRole('tab', { name: 'Comment', exact: true }).click()
    await win.getByRole('button', { name: 'Note', exact: true }).click()
    await win.mouse.click(p.x + 450, p.y + 120)
    await win.getByRole('textbox', { name: 'Note text' }).fill('Pit lid cracked')
    await win.getByRole('textbox', { name: 'Note text' }).press('Control+Enter')
    await win.getByRole('tab', { name: 'Home' }).click()
    await win.getByRole('button', { name: 'Select', exact: true }).click()

    // Properties: a Help icon and a subject.
    await win.keyboard.press('Control+e')
    await win.locator('.annot-box.note').click()
    const panel = win.getByRole('complementary', { name: 'Properties' })
    await panel.getByRole('combobox', { name: 'Icon' }).selectOption('Help')
    await panel.getByRole('textbox', { name: 'Subject' }).fill('Drainage')
    await expect(win.locator('.annot-box.note .note-glyph')).toHaveCount(1)

    // Comments list: tick it as checked, filter on that, group by subject.
    await win.getByRole('tab', { name: 'Comments', exact: true }).click()
    const list = win.getByRole('list', { name: 'Comments', exact: true })
    await expect(list.locator('li.comment')).toHaveCount(1)
    await expect(list.getByText('Drainage')).toBeVisible()
    await win.getByRole('combobox', { name: 'Filter by checked' }).selectOption('yes')
    await expect(list.locator('li.comment')).toHaveCount(0)
    await win.getByRole('combobox', { name: 'Filter by checked' }).selectOption('')
    await list.getByRole('button', { name: 'Not checked: click to mark as checked' }).click()
    await expect(list.getByRole('button', { name: 'Checked: click to uncheck' })).toBeVisible()
    await win.getByRole('combobox', { name: 'Filter by checked' }).selectOption('yes')
    await expect(list.locator('li.comment')).toHaveCount(1)
    await win.getByRole('combobox', { name: 'Filter by checked' }).selectOption('no')
    await expect(list.locator('li.comment')).toHaveCount(0)
    await win.getByRole('combobox', { name: 'Filter by checked' }).selectOption('')
    await win.getByRole('combobox', { name: 'Group comments' }).selectOption('subject')
    await expect(list.locator('li.comment-group')).toHaveText([/Drainage/])

    // The review history in Properties shows when it was made and ticked.
    const history = panel.getByRole('list', { name: 'Review history' })
    await expect(history.locator('li')).toHaveCount(2)
    await expect(history).toContainText('Created')
    await expect(history).toContainText('Checked')

    // Saved: /Name, /Subj, and a reply in the Marked state model.
    await win.keyboard.press('Control+s')
    await expect(win.locator('.tab-dirty')).toHaveCount(0)
    const saved = python(
      `
import sys, json, pymupdf
d = pymupdf.open(sys.argv[1])
out = []
for a in d[0].annots():
    x = a.xref
    out.append({"type": a.type[1], "name": d.xref_get_key(x, "Name")[1], "subj": d.xref_get_key(x, "Subj")[1], "state": d.xref_get_key(x, "State")[1], "model": d.xref_get_key(x, "StateModel")[1], "irt": d.xref_get_key(x, "IRT")[0]})
print(json.dumps(out))
`,
      pdf
    ) as { type: string; name: string; subj: string; state: string; model: string; irt: string }[]
    const note = saved.find((s) => s.name === '/Help')
    expect(note?.subj).toBe('Drainage')
    const mark = saved.find((s) => s.state === 'Marked')
    expect(mark?.model).toBe('Marked')
    expect(mark?.irt).toBe('xref')
    expect(problems).toEqual([])
  } finally {
    await app.close()
    cleanup(dir)
  }
})

test('text correction marks the selected text, its replacement and one comment as a linked set', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'openpdf-e2e-'))
  const pdf = join(dir, 'correct.pdf')
  execFileSync('python', [join(root, 'scripts', 'make-test-pdf.py'), pdf])
  const { app, win, problems } = await launch(pdf, dir)
  try {
    await expect(win.locator('.page')).toHaveCount(6)
    await win.getByRole('tab', { name: 'Comment', exact: true }).click()
    await expect(win.getByRole('button', { name: 'Text correction' })).toBeDisabled()
    await selectWords(win, 200, 260)
    await win.getByRole('button', { name: 'Text correction' }).click()
    const dialog = win.getByRole('dialog', { name: 'Text correction' })
    await dialog.getByRole('textbox', { name: 'Replacement text' }).fill('swift')
    await dialog.getByRole('textbox', { name: 'Comment' }).fill('Wrong word')
    await dialog.getByRole('button', { name: 'Mark correction' }).click()
    await expect(win.locator('.annot-caret-mark')).toHaveCount(1)

    await win.keyboard.press('Control+s')
    await expect(win.locator('.tab-dirty')).toHaveCount(0)
    const saved = python(
      `
import sys, json, pymupdf
d = pymupdf.open(sys.argv[1])
out = []
for a in d[0].annots():
    out.append({"type": a.type[1], "content": a.info.get("content", ""), "irt": d.xref_get_key(a.xref, "IRT")[0] == "xref", "rt": d.xref_get_key(a.xref, "RT")[1]})
print(json.dumps(out))
`,
      pdf
    ) as { type: string; content: string; irt: boolean; rt: string }[]
    expect(saved.map((s) => s.type).sort()).toEqual(['Caret', 'StrikeOut', 'Text'])
    // The strikeout is grouped with the caret, and the comment replies to the strikeout.
    expect(saved.find((s) => s.type === 'StrikeOut')).toMatchObject({ irt: true, rt: '/Group' })
    expect(saved.find((s) => s.type === 'Caret')).toMatchObject({ content: 'swift' })
    expect(saved.find((s) => s.type === 'Text')).toMatchObject({ content: 'Wrong word', irt: true })

    // Deleting only: a strikeout with no caret.
    await selectWords(win, 75, 150)
    await win.getByRole('button', { name: 'Text correction' }).click()
    await win.getByRole('dialog', { name: 'Text correction' }).getByRole('radio', { name: 'Delete it' }).check()
    await expect(win.getByRole('textbox', { name: 'Replacement text' })).toBeDisabled()
    await win.getByRole('button', { name: 'Mark correction' }).click()
    await expect(win.locator('.tab-dirty')).toHaveCount(1)
    await expect(win.locator('.annot-caret-mark')).toHaveCount(0)
    expect(problems).toEqual([])
  } finally {
    await app.close()
    cleanup(dir)
  }
})

test('angle measurement: three points, degrees, a 15 degree Shift step, a label on the page, saved and listed', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'openpdf-e2e-'))
  const pdf = join(dir, 'angle.pdf')
  writeFileSync(join(dir, 'make.py'), ['import sys, pymupdf', 'd = pymupdf.open()', 'd.new_page(width=595, height=842)', 'd.save(sys.argv[1])'].join('\n'))
  execFileSync('python', [join(dir, 'make.py'), pdf])
  const csv = join(dir, 'measurements.csv')
  const { app, win, problems } = await launch(pdf, dir, { OPENPDF_E2E_SAVE_TEXT: csv })
  try {
    await expect(win.locator('.page')).toHaveCount(1)
    await win.getByRole('tab', { name: 'Measure', exact: true }).click()
    const p = (await win.locator('.page').first().boundingBox())!
    const z = p.width / 595
    const at = (x: number, y: number) => ({ x: p.x + x * z, y: p.y + y * z })

    // A right angle: one arm up, one arm along.
    await win.getByRole('button', { name: 'Angle', exact: true }).click()
    // (Points stay near the top of the page: the test window is short, and clicks below it never arrive.)
    const [a, v, b] = [at(250, 150), at(250, 210), at(310, 210)]
    await win.mouse.click(a.x, a.y)
    await win.mouse.click(v.x, v.y)
    await win.mouse.click(b.x, b.y)
    const label = win.locator('.measure-annot-label')
    await expect(label).toHaveCount(1)
    await expect(label).toHaveText(/^(89\.9|90\.0|90\.1)°$/)

    // With Shift at 15 degree steps: the third point about 12 degrees below the horizontal lands on 15.
    await win.getByRole('combobox', { name: 'Shift angle step' }).selectOption('15')
    const [a2, v2, c2] = [at(250, 280), at(250, 320), at(290, 328.5)]
    await win.mouse.click(a2.x, a2.y)
    await win.mouse.click(v2.x, v2.y)
    await win.keyboard.down('Shift')
    await win.mouse.click(c2.x, c2.y)
    await win.keyboard.up('Shift')
    await expect(label).toHaveCount(2)
    await expect(label.nth(1)).toHaveText(/^(104\.9|105\.0|105\.1)°$/)

    // The Measurements pane lists them, and a label is drawn beside the result.
    await win.getByRole('button', { name: 'Measurements', exact: true }).click()
    const pane = win.getByLabel('Measurements', { exact: true })
    await expect(pane.locator('tr.mp-row')).toHaveCount(2)
    await expect(pane.locator('tr.mp-row').first()).toContainText('Angle')
    await expect(pane.getByText('Totals')).toBeVisible()
    const name = pane.locator('tr.mp-row').first().getByRole('textbox')
    await name.fill('Kerb return')
    await name.press('Enter')
    await expect(label.first()).toContainText('Kerb return: ')

    // CSV: angles are rows but not totalled.
    await win.getByRole('button', { name: 'Export CSV' }).first().click()
    await expect.poll(() => (existsSync(csv) ? readFileSync(csv, 'utf8') : '')).toContain('"Angle","Kerb return"')
    expect(readFileSync(csv, 'utf8')).not.toContain('"Totals","Angle"')

    // Saved: PolyLine with /OPAngle, no /Measure; read back it is still an angle.
    await win.keyboard.press('Control+s')
    await expect(win.locator('.tab-dirty')).toHaveCount(0)
    const saved = python(
      `
import sys, json, pymupdf
d = pymupdf.open(sys.argv[1])
out = []
for a in d[0].annots():
    x = a.xref
    out.append({"type": a.type[1], "subj": d.xref_get_key(x, "Subj")[1], "angle": d.xref_get_key(x, "OPAngle")[1], "measure": d.xref_get_key(x, "Measure")[0]})
print(json.dumps(out))
`,
      pdf
    ) as { type: string; subj: string; angle: string; measure: string }[]
    expect(saved).toHaveLength(2)
    expect(saved.every((s) => s.type === 'PolyLine' && s.subj === 'Angle' && s.measure === 'null')).toBe(true)
    expect(Number(saved[0].angle)).toBeGreaterThan(89)
    expect(problems).toEqual([])
  } finally {
    await app.close()
    cleanup(dir)
  }
})

test('cut, copy and paste of annotations, next and previous comment from the keyboard, and the docked stamp palette', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'openpdf-e2e-'))
  const pdf = join(dir, 'clip.pdf')
  execFileSync('python', [join(root, 'scripts', 'make-test-pdf.py'), pdf])
  const { app, win, problems } = await launch(pdf, dir)
  try {
    await expect(win.locator('.page')).toHaveCount(6)
    const p = (await win.locator('.page').first().boundingBox())!
    await win.getByRole('tab', { name: 'Draw' }).click()
    await win.getByRole('button', { name: 'Rectangle', exact: true }).click()
    for (const y of [100, 220]) {
      await win.mouse.move(p.x + 100, p.y + y)
      await win.mouse.down()
      await win.mouse.move(p.x + 220, p.y + y + 60, { steps: 4 })
      await win.mouse.up()
    }
    await win.getByRole('tab', { name: 'Comments', exact: true }).click()
    const list = win.getByRole('list', { name: 'Comments', exact: true })
    await expect(list.locator('li.comment')).toHaveCount(2)

    // Next and previous comment with Alt+Down and Alt+Up, whatever has the focus.
    await win.getByRole('tab', { name: 'Home' }).click()
    await win.getByRole('button', { name: 'Select', exact: true }).click()
    await win.locator('.page').first().click({ position: { x: 5, y: 5 } })
    await win.keyboard.press('Alt+ArrowDown')
    await expect(list.locator('li.comment.on')).toHaveCount(1)
    const selectedId = () => list.locator('li.comment.on [data-comment-head]').getAttribute('data-comment-head')
    const first = await selectedId()
    await win.keyboard.press('Alt+ArrowDown')
    await expect.poll(selectedId).not.toBe(first)
    const second = await selectedId()
    await win.keyboard.press('Alt+ArrowUp')
    await expect.poll(selectedId).toBe(first)
    expect(second).not.toBe(first)

    // Copy and paste: a copy joins the page (nudged); cut and paste moves it.
    await win.keyboard.press('Control+c')
    await win.keyboard.press('Control+v')
    await expect(list.locator('li.comment')).toHaveCount(3)
    await win.keyboard.press('Control+x')
    await expect(list.locator('li.comment')).toHaveCount(2)
    await win.keyboard.press('Control+v')
    await expect(list.locator('li.comment')).toHaveCount(3)

    // The docked stamp palette stays open when a stamp is picked.
    await win.getByRole('tab', { name: 'Comment', exact: true }).click()
    await win.getByRole('button', { name: 'Dock palette' }).click()
    const dock = win.getByRole('complementary', { name: 'Stamp palette' })
    await expect(dock).toBeVisible()
    await dock.getByRole('button', { name: 'APPROVED', exact: true }).click()
    await expect(dock).toBeVisible()
    await expect(win.getByRole('button', { name: 'Dock palette' })).toHaveAttribute('aria-pressed', 'true')
    expect(problems).toEqual([])
  } finally {
    await app.close()
    cleanup(dir)
  }
})

test('annotations from other tools can be hidden and shown, and styles and scales go to a file and back', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'openpdf-e2e-'))
  const pdf = join(dir, 'foreign.pdf')
  writeFileSync(
    join(dir, 'make.py'),
    [
      'import sys, pymupdf',
      'd = pymupdf.open()',
      'p = d.new_page(width=595, height=842)',
      'p.add_stamp_annot(pymupdf.Rect(100, 100, 400, 220), stamp=0)',
      'd.save(sys.argv[1])'
    ].join('\n')
  )
  execFileSync('python', [join(dir, 'make.py'), pdf])
  const styles = join(dir, 'styles.json')
  const { app, win, problems } = await launch(pdf, dir, { OPENPDF_E2E_SAVE_TEXT: styles, OPENPDF_E2E_PICK: styles })
  try {
    await expect(win.locator('.page')).toHaveCount(1)
    const pageBox = (await win.locator('.page').first().boundingBox())!
    const clip = { x: pageBox.x + 60, y: pageBox.y + 60, width: pageBox.width * 0.6, height: pageBox.height * 0.2 }
    await expect(win.locator('.page canvas').first()).toBeVisible()
    await win.waitForTimeout(800)
    const shown = await win.screenshot({ clip })

    await win.getByRole('tab', { name: 'Comments', exact: true }).click()
    const list = win.getByRole('list', { name: 'Comments', exact: true })
    await expect(list.locator('li.comment')).toHaveCount(1)
    await list.getByRole('button', { name: 'Hide this comment on the page' }).click()
    await expect(win.getByText('1 hidden')).toBeVisible()
    await win.waitForTimeout(1200)
    const hidden = await win.screenshot({ clip })
    expect(Buffer.compare(shown, hidden)).not.toBe(0)
    await list.getByRole('button', { name: 'Show this comment on the page' }).click()
    await win.waitForTimeout(1200)
    const again = await win.screenshot({ clip })
    expect(Buffer.compare(hidden, again)).not.toBe(0)

    // Styles: save one, send the styles to a file, delete it, bring it back.
    await win.getByRole('tab', { name: 'Draw' }).click()
    await win.keyboard.press('Control+e')
    const panel = win.getByRole('complementary', { name: 'Properties' })
    await panel.getByRole('textbox', { name: 'Preset name' }).fill('Site red')
    await panel.getByRole('button', { name: 'Save preset' }).click()
    await expect(panel.locator('.props-preset', { hasText: 'Site red' })).toBeVisible()
    await panel.getByRole('button', { name: 'Export styles' }).click()
    await expect.poll(() => (existsSync(styles) ? readFileSync(styles, 'utf8') : '')).toContain('Site red')
    await panel.getByRole('button', { name: 'Delete preset Site red' }).click()
    await expect(panel.locator('.props-preset', { hasText: 'Site red' })).toHaveCount(0)
    await panel.getByRole('button', { name: 'Import styles' }).click()
    await expect(panel.locator('.props-preset', { hasText: 'Site red' })).toBeVisible()

    // Scales: the same way, from the Scale dialog.
    await win.getByRole('tab', { name: 'Measure', exact: true }).click()
    await win.getByRole('button', { name: 'Scale…', exact: true }).click()
    await win.getByRole('textbox', { name: 'Name for this scale' }).fill('Site 1:500')
    await win.getByRole('combobox', { name: 'Drawing scale' }).selectOption('500')
    await win.getByRole('button', { name: 'Save scale' }).click()
    rmSync(styles, { force: true })
    await win.getByRole('button', { name: 'Export saved scales…' }).click()
    await expect.poll(() => (existsSync(styles) ? readFileSync(styles, 'utf8') : '')).toContain('Site 1:500')
    expect(JSON.parse(readFileSync(styles, 'utf8').replace(/^\uFEFF/, '')).scales[0]).toMatchObject({ name: 'Site 1:500', ratio: 500 })
    await win.getByRole('button', { name: 'Import saved scales…' }).click()
    await expect(win.getByRole('combobox', { name: 'Saved scale' }).locator('option', { hasText: 'Site 1:500' })).toHaveCount(1)
    expect(problems).toEqual([])
  } finally {
    await app.close()
    cleanup(dir)
  }
})
