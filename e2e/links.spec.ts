import { _electron as electron, expect, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(__dirname, '..')

const MAKE = `
import sys, pymupdf
doc = pymupdf.open()
for i in range(3):
    p = doc.new_page(width=595, height=842)
    p.insert_text((60, 80), f"Links page {i + 1}", fontsize=20)
p = doc[0]
p.insert_text((60, 140), "Go to page three", fontsize=14)
p.insert_link({"kind": pymupdf.LINK_GOTO, "from": pymupdf.Rect(55, 125, 200, 145), "page": 2})
p.insert_text((60, 190), "Website button", fontsize=14)
p.insert_link({"kind": pymupdf.LINK_URI, "from": pymupdf.Rect(55, 175, 200, 195), "uri": "https://example.com/site"})
p.insert_text((60, 240), "Plans at https://example.org/plans today", fontsize=14)
doc.save(sys.argv[1])
`

test('links: follow page and web links (and web addresses in the text), and add a new link', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'openpdf-e2e-'))
  const pdfPath = join(dir, 'links.pdf')
  const opened = join(dir, 'opened.txt')
  execFileSync('python', ['-c', MAKE, pdfPath])
  const app = await electron.launch({
    args: ['.', pdfPath],
    cwd: root,
    env: { ...process.env, OPENPDF_E2E: '1', OPENPDF_E2E_USERDATA: join(dir, 'ud'), OPENPDF_E2E_LINKS: opened, OPENPDF_E2E_DISCARD: '1' }
  })
  try {
    const win = await app.firstWindow()
    const problems: string[] = []
    win.on('pageerror', (e) => problems.push(e.message))
    await expect(win.locator('.page')).toHaveCount(3)
    const page = win.locator('.page').first()
    await expect(page.locator('.link-hit')).toHaveCount(3)
    const z = Number((await win.locator('.zoom-now').textContent())!.replace('%', '')) / 100
    const pb = (await page.boundingBox())!
    const at = (x: number, y: number) => win.mouse.click(pb.x + x * z, pb.y + y * z)

    // A web link asks the main process to open it (the test hook records it instead).
    await at(100, 185)
    await expect.poll(() => (existsSync(opened) ? readFileSync(opened, 'utf8') : '')).toBe('https://example.com/site')
    // A web address written in the text.
    await at(150, 236)
    await expect.poll(() => readFileSync(opened, 'utf8')).toBe('https://example.org/plans')
    // A page link.
    await at(100, 135)
    await expect(win.getByRole('textbox', { name: 'Page number' })).toHaveValue('3')

    // Add a link to page 2 with the Link tool.
    await win.locator('.scroller').evaluate((el) => (el.scrollTop = 0))
    await win.waitForTimeout(200)
    const pb2 = (await page.boundingBox())!
    await win.getByRole('tab', { name: 'Comment', exact: true }).click()
    await win.getByRole('button', { name: 'Link', exact: true }).click()
    await win.mouse.move(pb2.x + 300 * z, pb2.y + 300 * z)
    await win.mouse.down()
    await win.mouse.move(pb2.x + 450 * z, pb2.y + 330 * z, { steps: 4 })
    await win.mouse.up()
    const form = win.getByRole('form', { name: 'Link target' })
    await form.getByRole('radio', { name: 'Page' }).check()
    await form.getByRole('textbox', { name: 'Target page' }).fill('2')
    await form.getByRole('button', { name: 'Add link' }).click()
    await expect(page.locator('.annot-link')).toHaveCount(1)
    await win.keyboard.press('Control+s')
    await expect(win.locator('.tab-dirty')).toHaveCount(0)
    const links = JSON.parse(
      execFileSync('python', ['-c', 'import sys, json, pymupdf\nprint(json.dumps([[l["kind"], l.get("page", -1), l.get("uri", "")] for l in pymupdf.open(sys.argv[1])[0].get_links()]))', pdfPath]).toString()
    )
    expect(links).toContainEqual([1, 1, ''])
    // The saved link works straight away (PDFium reads it after the reload).
    await expect(page.locator('.link-hit')).toHaveCount(4)
    expect(problems).toEqual([])
  } finally {
    await app.close()
    rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 })
  }
})
