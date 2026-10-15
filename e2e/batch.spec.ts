import { _electron as electron, expect, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(__dirname, '..')

function setup(): { dir: string; a: string } {
  const dir = mkdtempSync(join(tmpdir(), 'openpdf-e2e-'))
  mkdirSync(join(dir, 'in', 'sub'), { recursive: true })
  const a = join(dir, 'in', 'a.pdf')
  execFileSync('python', [
    '-c',
    `import sys, pymupdf
for path, text in ((sys.argv[1], "First document"), (sys.argv[2], "Second document")):
    d = pymupdf.open()
    d.new_page(width=300, height=300).insert_text((50, 100), text, fontsize=14)
    d.new_page(width=300, height=300).insert_text((50, 100), text + " page two", fontsize=14)
    d.save(path)`,
    a,
    join(dir, 'in', 'sub', 'b.pdf')
  ])
  writeFileSync(join(dir, 'in', 'broken.pdf'), 'this is not a pdf')
  return { dir, a }
}

const readOrEmpty = (p: string): string => {
  try {
    return readFileSync(p, 'utf8')
  } catch {
    return ''
  }
}

const sha = (p: string) => createHash('sha256').update(readFileSync(p)).digest('hex')

test('a batch runs its steps over a folder, leaves the originals alone, and reports the file that failed', async () => {
  const { dir, a } = setup()
  const beforeA = sha(a)
  const app = await electron.launch({ args: ['.', a], cwd: root, env: { ...process.env, OPENPDF_E2E: '1', OPENPDF_E2E_USERDATA: join(dir, 'ud'), OPENPDF_E2E_DISCARD: '1' } })
  try {
    const win = await app.firstWindow()
    const problems: string[] = []
    win.on('pageerror', (e) => problems.push(e.message))
    await expect(win.locator('.page')).toHaveCount(2)
    await win.getByRole('tab', { name: 'File', exact: true }).click()
    await win.getByRole('button', { name: 'Batch' }).click()
    const d = win.getByRole('dialog', { name: 'Batch processing' })

    // Running with nothing set up says what is missing.
    await d.getByRole('button', { name: 'Run', exact: true }).click()
    await expect(d.getByRole('alert')).toContainText('Add at least one step')

    const add = d.getByRole('combobox', { name: 'Add a step' })
    await add.selectOption('watermark')
    await d.getByRole('textbox', { name: 'Watermark text' }).fill('CHECKED')
    await add.selectOption('properties')
    await d.getByRole('textbox', { name: 'Property author' }).fill('Records Office')
    await add.selectOption('optimise')
    await d.getByRole('textbox', { name: 'Files and folders' }).fill(join(dir, 'in'))
    await d.getByRole('textbox', { name: 'Results folder' }).fill(join(dir, 'out'))
    await d.getByRole('textbox', { name: 'Name suffix' }).fill('_done')
    await d.getByRole('button', { name: 'Run', exact: true }).click()
    await expect(d.getByText('Done: 2 of 3 files processed')).toBeVisible({ timeout: 90000 })
    await expect(d.getByRole('region', { name: 'Outcome' }).getByText(/broken\.pdf/)).toBeVisible()

    expect(readdirSync(join(dir, 'out')).sort()).toEqual(['a_done.pdf', 'b_done.pdf'])
    const info = JSON.parse(
      execFileSync('python', ['-c', `import sys, json, pymupdf\nout = {}\nfor n in ("a_done.pdf", "b_done.pdf"):\n    d = pymupdf.open(sys.argv[1] + "/" + n)\n    out[n] = {"pages": len(d), "author": d.metadata.get("author"), "text": d[0].get_text() + d[1].get_text()}\nprint(json.dumps(out))`, join(dir, 'out')]).toString()
    )
    for (const n of ['a_done.pdf', 'b_done.pdf']) {
      expect(info[n].pages).toBe(2)
      expect(info[n].author).toBe('Records Office')
      expect(info[n].text).toContain('CHECKED')
    }
    expect(info['a_done.pdf'].text).toContain('First document')
    expect(info['b_done.pdf'].text).toContain('Second document')
    // The original is untouched, and running again never overwrites: the results get a number.
    expect(sha(a)).toBe(beforeA)
    await d.getByRole('button', { name: 'Run', exact: true }).click()
    await expect(d.getByText('Done: 2 of 3 files processed')).toBeVisible({ timeout: 90000 })
    expect(readdirSync(join(dir, 'out')).sort()).toEqual(['a_done (2).pdf', 'a_done.pdf', 'b_done (2).pdf', 'b_done.pdf'])
    expect(problems).toEqual([])
  } finally {
    await app.close()
    rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 })
  }
})

test('an action can be saved, found again, and shared as a file', async () => {
  const { dir, a } = setup()
  const exported = join(dir, 'shared.json')
  const app = await electron.launch({ args: ['.', a], cwd: root, env: { ...process.env, OPENPDF_E2E: '1', OPENPDF_E2E_USERDATA: join(dir, 'ud'), OPENPDF_E2E_DISCARD: '1', OPENPDF_E2E_SAVE_TEXT: exported } })
  try {
    const win = await app.firstWindow()
    await win.getByRole('tab', { name: 'File', exact: true }).click()
    await win.getByRole('button', { name: 'Batch' }).click()
    const d = win.getByRole('dialog', { name: 'Batch processing' })
    await d.getByRole('combobox', { name: 'Add a step' }).selectOption('rotate')
    await d.getByRole('combobox', { name: 'Add a step' }).selectOption('flatten')
    await d.getByRole('textbox', { name: 'Action name' }).fill('Turn and flatten')
    await d.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(d.getByRole('combobox', { name: 'Saved actions' }).locator('option', { hasText: 'Turn and flatten' })).toHaveCount(1)
    await d.getByRole('button', { name: 'Save to file…' }).click()
    await expect.poll(() => readOrEmpty(exported)).toContain('"kind": "rotate"')
    const saved = JSON.parse(readFileSync(exported, 'utf8'))
    expect(saved.steps.map((s: { kind: string }) => s.kind)).toEqual(['rotate', 'flatten'])
    // The step order can be changed.
    await d.getByRole('button', { name: 'Move step 2 up' }).click()
    await d.getByRole('button', { name: 'Save to file…' }).click()
    await expect.poll(() => (JSON.parse(readOrEmpty(exported) || '{"steps":[{}]}').steps[0] ?? {}).kind).toBe('flatten')
  } finally {
    await app.close()
    rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 })
  }
})
