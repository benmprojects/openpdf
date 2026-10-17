import { _electron as electron, expect, test, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(__dirname, '..')

const MAKE = `
import sys, pymupdf
d = pymupdf.open()
d.new_page(width=595, height=842)
d.new_page(width=595, height=842)
p = d[0]
q = d[1]
p.insert_text((60, 100), "Plans at https://example.org/plans and www.example.com/spec, see Section 4 and section 4.", fontsize=11)
p.insert_text((60, 200), "Notes, script and chapter links go below", fontsize=11)
q.insert_text((60, 100), "Page two", fontsize=20)
cat = d.pdf_catalog()
d.xref_set_key(cat, "Dests", "<</Chapter [" + str(q.xref) + " 0 R /Fit]>>")
d.save(sys.argv[1])
`

/** What PyMuPDF sees of page 1's links: kind, target page, address and file. */
function links(path: string): { kind: number; page: number; uri: string; file: string }[] {
  const py = `
import sys, json, pymupdf
out = []
for l in pymupdf.open(sys.argv[1])[0].get_links():
    out.append({"kind": l["kind"], "page": l.get("page", -1), "uri": l.get("uri", ""), "file": l.get("file", "")})
print(json.dumps(out))
`
  return JSON.parse(execFileSync('python', ['-c', py, path]).toString())
}

/** The action type of every link annotation in the file (Launch, JavaScript, GoTo, URI), read from the raw objects. */
function linkActions(path: string): string[] {
  const py = `
import sys, json, re, pymupdf
d = pymupdf.open(sys.argv[1])
out = []
for x in range(1, d.xref_length()):
    try:
        s = d.xref_object(x, compressed=False)
    except Exception:
        continue
    if '/Subtype/Link' in s.replace(' ', '') or '/Subtype /Link' in s:
        m = re.search(r'/S\\s*/(\\w+)', s)
        out.append(m.group(1) if m else 'Dest')
print(json.dumps(sorted(out)))
`
  return JSON.parse(execFileSync('python', ['-c', py, path]).toString())
}

test('links: file, script and named destination actions, links made from text, and removing web links', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'openpdf-e2e-'))
  const pdf = join(dir, 'links.pdf')
  const opened = join(dir, 'opened.txt')
  execFileSync('python', ['-c', MAKE, pdf])
  writeFileSync(join(dir, 'notes.txt'), 'site notes')
  const app = await electron.launch({ args: ['.', pdf], cwd: root, env: { ...process.env, OPENPDF_E2E: '1', OPENPDF_E2E_USERDATA: join(dir, 'ud'), OPENPDF_E2E_LINKS: opened, OPENPDF_E2E_DISCARD: '1' } })
  try {
    const win = await app.firstWindow()
    const problems: string[] = []
    win.on('pageerror', (e) => problems.push(e.message))
    await expect(win.locator('.page')).toHaveCount(2)
    const z = Number((await win.locator('.zoom-now').textContent())!.replace('%', '')) / 100
    const press = async (name: string) => {
      await win.getByRole('button', { name, exact: true }).focus()
      await win.keyboard.press('Enter')
    }
    const onPage = async (x0: number, y0: number, x1: number, y1: number) => {
      const pb = (await win.locator('.page').first().boundingBox())!
      await win.mouse.move(pb.x + x0 * z, pb.y + y0 * z)
      await win.mouse.down()
      await win.mouse.move(pb.x + x1 * z, pb.y + y1 * z, { steps: 4 })
      await win.mouse.up()
    }
    const clickAt = async (x: number, y: number) => {
      const pb = (await win.locator('.page').first().boundingBox())!
      await win.mouse.click(pb.x + x * z, pb.y + y * z)
    }
    const form = win.getByRole('form', { name: 'Link target' })
    const addLink = async (box: [number, number, number, number], choose: (f: ReturnType<Page['getByRole']>) => Promise<void>) => {
      await press('Link')
      await onPage(...box)
      await expect(form).toBeVisible()
      await choose(form)
      await form.getByRole('button', { name: 'Add link' }).click()
    }
    await win.getByRole('tab', { name: 'Comment', exact: true }).click()

    // A file that runs programs is refused, with the reason; an ordinary file is accepted.
    await press('Link')
    await onPage(60, 230, 200, 250)
    await form.getByRole('radio', { name: 'File' }).check()
    await form.getByRole('textbox', { name: 'File to open' }).fill('setup.exe')
    await form.getByRole('button', { name: 'Add link' }).click()
    await expect(win.getByText(/can run programs, so they are never opened/)).toBeVisible()
    await form.getByRole('textbox', { name: 'File to open' }).fill('notes.txt')
    await form.getByRole('button', { name: 'Add link' }).click()
    await expect(form).toHaveCount(0)

    // A script link and a named destination link.
    await addLink([60, 270, 200, 290], async (f) => {
      await f.getByRole('radio', { name: 'JavaScript' }).check()
      await f.getByRole('textbox', { name: 'JavaScript to run' }).fill('console.println("link ran"); app.alert("hello from the link");')
    })
    await addLink([60, 310, 200, 330], async (f) => {
      await f.getByRole('radio', { name: 'Named destination' }).check()
      await f.getByRole('combobox', { name: 'Named destination' }).fill('Chapter')
    })
    await win.keyboard.press('Control+s')
    await expect(win.locator('.tab-dirty')).toHaveCount(0)
    const saved = links(pdf)
    expect(saved.filter((l) => l.file === 'notes.txt')).toHaveLength(1)
    expect(linkActions(pdf)).toEqual(['GoTo', 'JavaScript', 'Launch'])

    // Following them: the file after the user is asked (the test hook records it), the script in the sandbox.
    await clickAt(130, 240)
    await expect.poll(() => (existsSync(opened) ? readFileSync(opened, 'utf8') : '')).toBe(`file:${join(dir, 'notes.txt')}`)
    await clickAt(130, 280)
    await expect(win.getByText('hello from the link')).toBeVisible()
    await win.getByRole('tab', { name: 'Forms', exact: true }).click()
    await win.getByRole('button', { name: 'Script console' }).click()
    const consoleLog = win.getByRole('log', { name: 'Console output' })
    await expect(consoleLog).toContainText('[Link] link ran')
    await expect(consoleLog).toContainText('Message: hello from the link')
    await win.getByRole('dialog', { name: 'Script console' }).getByRole('button', { name: 'Close', exact: true }).last().click()
    await clickAt(130, 320)
    await expect(win.getByRole('textbox', { name: 'Page number' })).toHaveValue('2')

    // Web addresses in the text become links; then they can all be removed.
    await win.getByRole('tab', { name: 'Comment', exact: true }).click()
    await win.locator('.scroller').evaluate((el) => (el.scrollTop = 0))
    await press('Auto-link')
    const auto = win.getByRole('dialog', { name: 'Make links from web addresses' })
    await auto.getByRole('button', { name: 'Make links' }).click()
    await expect(win.getByText(/Made 2 links from web addresses/)).toBeVisible()
    await win.keyboard.press('Control+s')
    await expect(win.locator('.tab-dirty')).toHaveCount(0)
    expect(links(pdf).filter((l) => l.uri).map((l) => l.uri).sort()).toEqual(['https://example.org/plans', 'https://www.example.com/spec'])

    // Every place a phrase appears, to one page.
    await press('Link text')
    const batch = win.getByRole('dialog', { name: 'Link every match of some text' })
    await batch.getByRole('button', { name: 'Make links' }).click()
    await expect(batch.getByRole('alert')).toContainText('Enter the text')
    await batch.getByRole('textbox', { name: 'Text to link' }).fill('section 4')
    await batch.getByRole('combobox', { name: 'Kind of link' }).selectOption('page')
    await batch.getByRole('textbox', { name: 'Link page' }).fill('2')
    await batch.getByRole('button', { name: 'Make links' }).click()
    await expect(win.getByText(/Made 2 links\./)).toBeVisible()

    await press('Remove web links')
    const gone = win.getByRole('dialog', { name: 'Remove web links' })
    await expect(gone).toContainText('Remove all 2 web links')
    await gone.getByRole('button', { name: 'Remove', exact: true }).click()
    await expect(win.getByText(/Removed 2 web links/)).toBeVisible()
    await win.keyboard.press('Control+s')
    await expect(win.locator('.tab-dirty')).toHaveCount(0)
    const after = links(pdf)
    expect(after.filter((l) => l.uri)).toEqual([])
    // The phrase links went to page 2 and the file link is still there.
    expect(after.filter((l) => l.kind === 1 && l.page === 1).length).toBeGreaterThanOrEqual(2)
    expect(after.filter((l) => l.file === 'notes.txt')).toHaveLength(1)
    expect(problems).toEqual([])
  } finally {
    await app.close()
    rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 })
  }
})

test('links: a barcode holding a web address can also be a link', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'openpdf-e2e-'))
  const pdf = join(dir, 'bar.pdf')
  execFileSync('python', ['-c', 'import sys, pymupdf\nd = pymupdf.open()\nd.new_page(width=595, height=842)\nd.save(sys.argv[1])', pdf])
  const app = await electron.launch({ args: ['.', pdf], cwd: root, env: { ...process.env, OPENPDF_E2E: '1', OPENPDF_E2E_USERDATA: join(dir, 'ud'), OPENPDF_E2E_DISCARD: '1' } })
  try {
    const win = await app.firstWindow()
    const problems: string[] = []
    win.on('pageerror', (e) => problems.push(e.message))
    await expect(win.locator('.page')).toHaveCount(1)
    await win.getByRole('tab', { name: 'Edit', exact: true }).click()
    await win.getByRole('button', { name: 'QR / barcode' }).click()
    const d = win.getByRole('dialog', { name: 'Add a QR code or barcode' })
    await d.getByRole('textbox', { name: 'Barcode text' }).fill('https://example.org/drawing/101')
    await d.getByRole('checkbox', { name: 'Make the barcode a link when its text is a web address' }).check()
    await d.getByRole('button', { name: 'Add barcode' }).click()
    await expect(win.getByText('Barcode added')).toBeVisible()
    await win.keyboard.press('Control+s')
    await expect(win.locator('.tab-dirty')).toHaveCount(0)
    expect(links(pdf).map((l) => l.uri)).toEqual(['https://example.org/drawing/101'])
    expect(problems).toEqual([])
  } finally {
    await app.close()
    rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 })
  }
})
