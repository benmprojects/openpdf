import { _electron as electron, expect, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(__dirname, '..')

test('the Standards dialog shows what a file declares and the basic checks', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'openpdf-e2e-'))
  const pdfPath = join(dir, 'std.pdf')
  execFileSync('python', [
    '-c',
    `import sys, pymupdf
d = pymupdf.open()
d.new_page(width=300, height=300).insert_text((50, 100), "Archive me", fontsize=14)
d.set_xml_metadata('<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?><x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:pdfaid="http://www.aiim.org/pdfa/ns/id/" pdfaid:part="1" pdfaid:conformance="B"/></rdf:RDF></x:xmpmeta><?xpacket end="w"?>')
d.save(sys.argv[1])`,
    pdfPath
  ])
  const app = await electron.launch({ args: ['.', pdfPath], cwd: root, env: { ...process.env, OPENPDF_E2E: '1', OPENPDF_E2E_USERDATA: join(dir, 'ud'), OPENPDF_E2E_DISCARD: '1' } })
  try {
    const win = await app.firstWindow()
    const problems: string[] = []
    win.on('pageerror', (e) => problems.push(e.message))
    await expect(win.locator('.page')).toHaveCount(1)
    await win.getByRole('tab', { name: 'File', exact: true }).click()
    await win.getByRole('button', { name: 'Standards' }).click()
    const d = win.getByRole('dialog', { name: 'PDF standards' })
    await expect(d.getByText('This file declares PDF/A-1b.')).toBeVisible()
    await expect(d.getByText('This file does not declare it.')).toBeVisible()
    await expect(d.getByText('Is not encrypted')).toBeVisible()
    await expect(d.getByText('Is marked as a tagged PDF')).toBeVisible()
    expect(problems).toEqual([])
  } finally {
    await app.close()
    rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 })
  }
})

test('Convert to PDF/A embeds the fonts and marks the file, and the text is still there after saving', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'openpdf-e2e-'))
  const pdfPath = join(dir, 'archive.pdf')
  execFileSync('python', [
    '-c',
    `import sys, pymupdf
d = pymupdf.open()
p = d.new_page(width=300, height=300)
p.insert_text((50, 100), "Meeting minutes for the quarter", fontsize=14, fontname="helv")
p.insert_text((50, 140), "Courier text stays too", fontsize=12, fontname="cour")
d.set_metadata({"title": "Minutes", "author": "Secretary"})
d.save(sys.argv[1])`,
    pdfPath
  ])
  const app = await electron.launch({ args: ['.', pdfPath], cwd: root, env: { ...process.env, OPENPDF_E2E: '1', OPENPDF_E2E_USERDATA: join(dir, 'ud'), OPENPDF_E2E_DISCARD: '1' } })
  try {
    const win = await app.firstWindow()
    const problems: string[] = []
    win.on('pageerror', (e) => problems.push(e.message))
    await expect(win.locator('.page')).toHaveCount(1)
    await win.getByRole('tab', { name: 'File', exact: true }).click()
    await win.getByRole('button', { name: 'Convert to PDF/A' }).click()
    const d = win.getByRole('dialog', { name: 'PDF standards' })
    await expect(d.getByText('Embedded 2 fonts')).toBeVisible()
    await expect(d.getByText('This file declares PDF/A-2b.')).toBeVisible()
    await expect(d.getByText('Embeds every font')).toBeVisible()
    await d.getByRole('button', { name: 'Close', exact: true }).first().click()
    await win.keyboard.press('Control+s')
    await expect(win.locator('.tab-dirty')).toHaveCount(0)
    const info = JSON.parse(
      execFileSync('python', ['-c', `import sys, json, pymupdf\nd = pymupdf.open(sys.argv[1])\nfonts = d.get_page_fonts(0)\nprint(json.dumps({"text": d[0].get_text(), "fonts": [[f[1], f[2]] for f in fonts], "title": d.metadata.get("title"), "xmp": d.get_xml_metadata()[:4000]}))`, pdfPath]).toString()
    )
    expect(info.text).toContain('Meeting minutes for the quarter')
    expect(info.text).toContain('Courier text stays too')
    // Embedded TrueType fonts now, not the unembedded base fonts.
    expect(info.fonts.every((f: string[]) => f[0] === 'ttf' && f[1] === 'TrueType')).toBe(true)
    expect(info.title).toBe('Minutes')
    expect(info.xmp).toContain('pdfaid:part')
    expect(problems).toEqual([])
  } finally {
    await app.close()
    rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 })
  }
})
