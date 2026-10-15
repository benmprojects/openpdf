import { _electron as electron, expect, test, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(__dirname, '..')

const MAKE = `
import sys, pymupdf
doc = pymupdf.open()
for i in range(5):
    p = doc.new_page(width=595, height=842)
    p.insert_text((60, 80), f"Nav page {i + 1}", fontsize=20)
doc.set_toc([[1, "Intro", 1], [1, "Body", 2], [1, "End", 5]])
p = doc[0]
p.insert_link({"kind": pymupdf.LINK_GOTO, "from": pymupdf.Rect(55, 125, 200, 145), "page": 2})
p.insert_link({"kind": pymupdf.LINK_URI, "from": pymupdf.Rect(55, 175, 200, 195), "uri": "https://example.com/old"})
doc.save(sys.argv[1])
`

/** Bookmarks, page labels and first-page links, read with PyMuPDF. */
function inspect(path: string): { toc: [number, string, number][]; labels: string[]; links: [number, number, string, number[]][] } {
  const py = `
import sys, json, pymupdf
d = pymupdf.open(sys.argv[1])
print(json.dumps({
  "toc": d.get_toc(),
  "labels": [p.get_label() for p in d],
  "links": [[l["kind"], l.get("page", -1), l.get("uri", ""), [round(v) for v in l["from"]]] for l in d[0].get_links()],
}))
`
  return JSON.parse(execFileSync('python', ['-c', py, path]).toString())
}

async function save(win: Page) {
  await win.keyboard.press('Control+s')
  await expect(win.locator('.tab-dirty')).toHaveCount(0)
}

test('bookmarks, page labels and links can be edited', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'openpdf-e2e-'))
  const pdfPath = join(dir, 'nav.pdf')
  execFileSync('python', ['-c', MAKE, pdfPath])
  const app = await electron.launch({ args: ['.', pdfPath], cwd: root, env: { ...process.env, OPENPDF_E2E: '1', OPENPDF_E2E_USERDATA: join(dir, 'ud'), OPENPDF_E2E_DISCARD: '1' } })
  try {
    const win = await app.firstWindow()
    const problems: string[] = []
    win.on('pageerror', (e) => problems.push(e.message))
    await expect(win.locator('.page')).toHaveCount(5)

    // ---- Bookmarks: add one after "Body" on page 3, rename it, nest it under "Body", delete "End".
    await win.getByRole('tab', { name: 'Bookmarks' }).click()
    const tree = win.getByRole('tree')
    await expect(tree.getByRole('button', { name: 'Body' })).toBeVisible()
    await tree.getByRole('button', { name: 'Body' }).click()
    await win.getByRole('textbox', { name: 'Page number' }).fill('3')
    await win.getByRole('textbox', { name: 'Page number' }).press('Enter')
    await win.getByRole('button', { name: 'Add bookmark' }).click()
    const title = win.getByRole('textbox', { name: 'Bookmark title' })
    await expect(title).toBeVisible()
    await title.fill('Details')
    await title.press('Enter')
    await expect(tree.getByRole('button', { name: 'Details' })).toBeVisible()
    await tree.getByRole('button', { name: 'Details' }).click()
    await win.getByRole('button', { name: 'Indent' }).click()
    await tree.getByRole('button', { name: 'End' }).click()
    await win.getByRole('button', { name: 'Delete bookmark' }).click()
    await expect(tree.getByRole('button', { name: 'End' })).toHaveCount(0)
    await save(win)
    let info = inspect(pdfPath)
    expect(info.toc).toEqual([
      [1, 'Intro', 1],
      [1, 'Body', 2],
      [2, 'Details', 3]
    ])

    // ---- Page labels: i, ii for the first two pages, then 1, 2, 3.
    await win.getByRole('tab', { name: 'Organise', exact: true }).click()
    await win.getByRole('button', { name: 'Page labels' }).click()
    const dialog = win.getByRole('dialog', { name: 'Page labels' })
    await dialog.getByRole('combobox', { name: 'Range 1 style' }).selectOption('r')
    await dialog.getByRole('button', { name: /Add range/ }).click()
    await dialog.getByRole('spinbutton', { name: 'Range 2 first page' }).fill('3')
    await expect(dialog.getByLabel('Preview')).toContainText('i, ii, 1, 2, 3')
    await dialog.getByRole('button', { name: 'Apply' }).click()
    await expect(win.getByText('Page labels updated')).toBeVisible()
    await save(win)
    info = inspect(pdfPath)
    expect(info.labels).toEqual(['i', 'ii', '1', '2', '3'])
    // The bookmarks survive a page label edit.
    expect(info.toc.length).toBe(3)

    // ---- Links: the Link tool shows the file's links; retarget one, move the other.
    await win.getByRole('textbox', { name: 'Page number' }).fill('i')
    await win.getByRole('textbox', { name: 'Page number' }).press('Enter')
    await win.locator('.scroller').evaluate((el) => (el.scrollTop = 0))
    const page = win.locator('.page').first()
    await expect(page.locator('.annot-link')).toHaveCount(0)
    await win.getByRole('tab', { name: 'Comment', exact: true }).click()
    await win.getByRole('button', { name: 'Link', exact: true }).click()
    await expect(page.locator('.annot-link')).toHaveCount(2)
    const web = page.getByRole('button', { name: 'Link to https://example.com/old' })
    await web.dblclick()
    const form = win.getByRole('form', { name: 'Link target' })
    await form.getByRole('textbox', { name: 'Web address' }).fill('https://example.com/new')
    await form.getByRole('button', { name: 'Save link' }).click()
    await expect(page.getByRole('button', { name: 'Link to https://example.com/new' })).toBeVisible()
    const z = Number((await win.locator('.zoom-now').textContent())!.replace('%', '')) / 100
    const box = (await page.getByRole('button', { name: 'Link to page 3' }).boundingBox())!
    await win.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await win.mouse.down()
    await win.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + 100 * z, { steps: 5 })
    await win.mouse.up()
    await save(win)
    info = inspect(pdfPath)
    const goto = info.links.find((l) => l[0] === 1)!
    const uri = info.links.find((l) => l[0] === 2)!
    expect(info.links.length).toBe(2)
    expect(goto[1]).toBe(2)
    expect(goto[3][1]).toBeGreaterThan(215)
    expect(goto[3][1]).toBeLessThan(235)
    expect(uri[2]).toBe('https://example.com/new')
    expect(uri[3]).toEqual([55, 175, 200, 195])

    // Delete the web link.
    await page.getByRole('button', { name: 'Link to https://example.com/new' }).click()
    await win.keyboard.press('Delete')
    await save(win)
    info = inspect(pdfPath)
    expect(info.links.map((l) => l[0])).toEqual([1])
    expect(problems).toEqual([])
  } finally {
    await app.close()
    rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 })
  }
})
