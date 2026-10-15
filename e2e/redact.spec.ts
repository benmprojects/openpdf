import { _electron as electron, expect, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(__dirname, '..')

/** One page with a secret line, a public line, a line that shares an operator-free position, and a link. */
function make(path: string): void {
  const py = `
import sys, pymupdf
d = pymupdf.open()
p = d.new_page(width=400, height=300)
p.insert_text((50, 80), "Account SECRET-4471 balance", fontsize=14)
p.insert_text((50, 140), "Public paragraph stays", fontsize=14)
p.draw_rect(pymupdf.Rect(50, 200, 150, 230), color=None, fill=(1, 0, 0))
p.insert_link({"kind": pymupdf.LINK_URI, "from": pymupdf.Rect(50, 66, 300, 86), "uri": "https://example.com/secret"})
d.save(sys.argv[1])
`
  execFileSync('python', ['-c', py, path])
}

function inspect(path: string): { text: string; links: number; drawings: number } {
  const py = `
import sys, json, pymupdf
d = pymupdf.open(sys.argv[1])
p = d[0]
print(json.dumps({"text": p.get_text(), "links": len(p.get_links()), "drawings": len(p.get_drawings())}))
`
  return JSON.parse(execFileSync('python', ['-c', py, path]).toString())
}

test('marked text is removed from the file, not just covered', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'openpdf-e2e-'))
  const pdfPath = join(dir, 'redact.pdf')
  make(pdfPath)
  const app = await electron.launch({ args: ['.', pdfPath], cwd: root, env: { ...process.env, OPENPDF_E2E: '1', OPENPDF_E2E_USERDATA: join(dir, 'ud'), OPENPDF_E2E_DISCARD: '1' } })
  try {
    const win = await app.firstWindow()
    const problems: string[] = []
    win.on('pageerror', (e) => problems.push(e.message))
    await expect(win.locator('.page')).toHaveCount(1)

    await win.keyboard.press('Control+f')
    await win.getByRole('searchbox', { name: 'Find in document' }).fill('SECRET-4471')
    await expect(win.getByText('1 of 1')).toBeVisible()

    await win.getByRole('tab', { name: 'Redact', exact: true }).click()
    await win.getByRole('button', { name: 'Mark search' }).click()
    await expect(win.locator('.redact-mark')).toHaveCount(1)
    await win.getByRole('button', { name: 'Apply', exact: true }).click()
    await win.getByRole('dialog', { name: 'Apply redactions' }).getByRole('button', { name: 'Redact' }).click()
    await expect(win.getByText(/Redacted: .*removed/)).toBeVisible()
    await expect(win.locator('.redact-mark')).toHaveCount(0)

    await win.keyboard.press('Control+s')
    await expect(win.locator('.tab-dirty')).toHaveCount(0)
    const out = inspect(pdfPath)
    // Nowhere in the file, in any stream, not only on the page.
    const leaked = execFileSync('python', ['-c', `import sys, pymupdf
d = pymupdf.open(sys.argv[1])
print(sum(1 for x in range(1, d.xref_length()) if d.xref_is_stream(x) and b'SECRET' in (d.xref_stream(x) or b'')))`, pdfPath]).toString().trim()
    expect(leaked).toBe('0')
    expect(out.text).not.toContain('SECRET')
    expect(out.text).not.toContain('4471')
    expect(out.text).toContain('Public paragraph stays')
    // The link under the mark is gone; the red box outside it stays; the black box is added.
    expect(out.links).toBe(0)
    expect(out.drawings).toBe(2)
    expect(problems).toEqual([])
  } finally {
    await app.close()
    rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 })
  }
})

test('a dragged area removes the picture and text under it and leaves the rest', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'openpdf-e2e-'))
  const pdfPath = join(dir, 'area.pdf')
  const py = `
import sys, pymupdf
d = pymupdf.open()
p = d.new_page(width=400, height=300)
pix = pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, 40, 40), False)
pix.set_rect(pix.irect, (10, 120, 200))
p.insert_image(pymupdf.Rect(50, 100, 150, 200), pixmap=pix)
p.insert_text((200, 150), "Hidden words", fontsize=14)
p.insert_text((50, 260), "Footer stays", fontsize=14)
d.save(sys.argv[1])
`
  execFileSync('python', ['-c', py, pdfPath])
  const app = await electron.launch({ args: ['.', pdfPath], cwd: root, env: { ...process.env, OPENPDF_E2E: '1', OPENPDF_E2E_USERDATA: join(dir, 'ud'), OPENPDF_E2E_DISCARD: '1' } })
  try {
    const win = await app.firstWindow()
    const problems: string[] = []
    win.on('pageerror', (e) => problems.push(e.message))
    await expect(win.locator('.page')).toHaveCount(1)
    await win.getByRole('tab', { name: 'Redact', exact: true }).click()
    await win.getByRole('button', { name: 'Mark area' }).click()
    const box = (await win.locator('.page').first().boundingBox())!
    const k = box.width / 400
    // From the top-left of the picture to past the end of the text line (PDF points 40,90 to 330,210).
    await win.mouse.move(box.x + 40 * k, box.y + 90 * k)
    await win.mouse.down()
    await win.mouse.move(box.x + 200 * k, box.y + 150 * k, { steps: 5 })
    await win.mouse.move(box.x + 330 * k, box.y + 210 * k, { steps: 5 })
    await win.mouse.up()
    await expect(win.locator('.redact-mark')).toHaveCount(1)
    await win.getByRole('button', { name: 'Apply', exact: true }).click()
    await win.getByRole('dialog', { name: 'Apply redactions' }).getByRole('button', { name: 'Redact' }).click()
    await expect(win.getByText(/Redacted: .*1 image.*removed/)).toBeVisible()
    await win.keyboard.press('Control+s')
    await expect(win.locator('.tab-dirty')).toHaveCount(0)
    const res = JSON.parse(
      execFileSync('python', ['-c', `import sys, json, pymupdf\nd = pymupdf.open(sys.argv[1])\nprint(json.dumps({"text": d[0].get_text(), "images": len(d[0].get_images())}))`, pdfPath]).toString()
    )
    expect(res.images).toBe(0)
    expect(res.text).not.toContain('Hidden')
    expect(res.text).toContain('Footer stays')
    expect(problems).toEqual([])
  } finally {
    await app.close()
    rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 })
  }
})

test('Hidden information: metadata, attachments and scripts are found and removed from the saved file', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'openpdf-e2e-'))
  const pdfPath = join(dir, 'hidden.pdf')
  execFileSync('python', [
    '-c',
    `import sys, pymupdf
d = pymupdf.open()
p = d.new_page(width=300, height=300)
p.insert_text((50, 100), "Visible page", fontsize=14)
d.set_metadata({"title": "Internal draft", "author": "Someone Private"})
d.embfile_add("notes.txt", b"private attachment bytes ZZTOP")
d.set_toc([[1, "Chapter", 1]])
d.save(sys.argv[1])`,
    pdfPath
  ])
  const app = await electron.launch({ args: ['.', pdfPath], cwd: root, env: { ...process.env, OPENPDF_E2E: '1', OPENPDF_E2E_USERDATA: join(dir, 'ud'), OPENPDF_E2E_DISCARD: '1' } })
  try {
    const win = await app.firstWindow()
    const problems: string[] = []
    win.on('pageerror', (e) => problems.push(e.message))
    await expect(win.locator('.page')).toHaveCount(1)
    await win.getByRole('tab', { name: 'Redact', exact: true }).click()
    await win.getByRole('button', { name: 'Hidden information' }).click()
    const d = win.getByRole('dialog', { name: 'Remove hidden information' })
    await expect(d.getByText(/1 file/)).toBeVisible()
    await d.getByRole('checkbox', { name: /Bookmarks/ }).check()
    await d.getByRole('button', { name: 'Remove' }).click()
    await expect(win.getByText(/Removed hidden information/)).toBeVisible()
    await win.keyboard.press('Control+s')
    await expect(win.locator('.tab-dirty')).toHaveCount(0)
    const res = JSON.parse(
      execFileSync('python', [
        '-c',
        `import sys, json, pymupdf
d = pymupdf.open(sys.argv[1])
leak = sum(1 for x in range(1, d.xref_length()) if d.xref_is_stream(x) and b'ZZTOP' in (d.xref_stream(x) or b''))
print(json.dumps({"title": d.metadata.get("title"), "author": d.metadata.get("author"), "emb": d.embfile_count(), "toc": len(d.get_toc()), "leak": leak, "text": d[0].get_text()}))`,
        pdfPath
      ]).toString()
    )
    expect(res).toMatchObject({ emb: 0, toc: 0, leak: 0 })
    expect(res.title || '').toBe('')
    expect(res.author || '').toBe('')
    expect(res.text).toContain('Visible page')
    expect(problems).toEqual([])
  } finally {
    await app.close()
    rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 })
  }
})
