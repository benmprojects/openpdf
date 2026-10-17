import { _electron as electron, expect, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(__dirname, '..')
const python = (code: string, ...args: string[]) => execFileSync('python', ['-c', code, ...args]).toString()

test('signature library: draw, type and import; place on several pages, by drag; Sign here; flatten', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'openpdf-e2e-'))
  const pdfPath = join(dir, 'sig.pdf')
  const scan = join(dir, 'scan.png')
  execFileSync('python', [join(root, 'scripts', 'make-test-pdf.py'), pdfPath])
  // A white picture with a dark stroke, written with the standard library only.
  writeFileSync(
    join(dir, 'mkpng.py'),
    `import zlib, struct, sys
w, h = 120, 50
rows = b''.join(b'\\x00' + b''.join((b'\\x10\\x10\\x10' if 10 < y < 14 and 10 < x < 110 else b'\\xff\\xff\\xff') for x in range(w)) for y in range(h))
def chunk(t, d): return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
open(sys.argv[1], 'wb').write(b'\\x89PNG\\r\\n\\x1a\\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(rows)) + chunk(b'IEND', b''))
`
  )
  execFileSync('python', [join(dir, 'mkpng.py'), scan])
  const app = await electron.launch({
    args: ['.', pdfPath],
    cwd: root,
    env: { ...process.env, OPENPDF_E2E: '1', OPENPDF_E2E_USERDATA: join(dir, 'ud'), OPENPDF_E2E_DISCARD: '1', OPENPDF_E2E_PICK: scan }
  })
  try {
    const win = await app.firstWindow()
    const problems: string[] = []
    win.on('pageerror', (e) => problems.push(e.message))
    await expect(win.locator('.page')).toHaveCount(6)
    await win.getByRole('tab', { name: 'Sign', exact: true }).click()
    await win.getByRole('button', { name: 'Add signature' }).click()
    const lib = win.getByRole('dialog', { name: 'Signatures and initials' })
    await expect(lib).toContainText('not digital signatures')
    await expect(lib).toContainText('No signatures saved yet.')

    // Draw a signature with the mouse.
    await lib.getByRole('button', { name: 'New signature…' }).click()
    const maker = win.getByRole('dialog', { name: 'New signature or initials' })
    await maker.getByRole('button', { name: 'Save' }).click()
    await expect(maker.getByRole('alert')).toContainText('Draw your signature')
    const pad = (await maker.getByRole('img', { name: 'Signature drawing area' }).boundingBox())!
    await win.mouse.move(pad.x + 30, pad.y + 60)
    await win.mouse.down()
    for (let i = 0; i <= 30; i++) await win.mouse.move(pad.x + 30 + i * 12, pad.y + 60 + Math.sin(i / 3) * 30, { steps: 2 })
    await win.mouse.up()
    await maker.getByRole('textbox', { name: 'Signature name' }).fill('Drawn')
    await maker.getByRole('button', { name: 'Save' }).click()
    await expect(maker).toHaveCount(0)
    await expect(lib.getByRole('button', { name: 'Signature Drawn' })).toBeVisible()

    // Type initials.
    await lib.getByRole('button', { name: 'New initials…' }).click()
    await maker.getByRole('tab', { name: 'Type' }).click()
    await maker.getByRole('textbox', { name: 'Text to turn into a signature' }).fill('BM')
    await maker.getByRole('textbox', { name: 'Signature name' }).fill('Typed')
    await maker.getByRole('button', { name: 'Save' }).click()
    await expect(lib.getByRole('button', { name: 'Initials Typed' })).toBeVisible()

    // Import a picture of a signature, white made transparent and trimmed.
    await lib.getByRole('button', { name: 'New signature…' }).click()
    await maker.getByRole('tab', { name: 'Picture' }).click()
    await maker.getByRole('button', { name: 'Choose picture…' }).click()
    await expect(maker.getByRole('img', { name: 'Preview' })).toBeVisible()
    await expect(maker.getByRole('checkbox', { name: 'Make white transparent' })).toBeChecked()
    await maker.getByRole('textbox', { name: 'Signature name' }).fill('Scanned')
    await maker.getByRole('button', { name: 'Save' }).click()
    await expect(lib.getByRole('button', { name: 'Signature Scanned' })).toBeVisible()

    // Rename the typed initials, then put the name back.
    await lib.getByRole('button', { name: 'Initials Typed' }).click()
    await lib.getByRole('button', { name: 'Rename…' }).click()
    const rename = win.getByRole('dialog', { name: 'Rename stamp' })
    await rename.getByRole('textbox').first().fill('Initials BM')
    await rename.getByRole('button', { name: 'Save', exact: true }).click()
    await win.getByRole('button', { name: 'Add signature' }).click()
    await expect(lib.getByRole('button', { name: 'Initials Initials BM' })).toBeVisible()

    // Place the drawn signature on pages 1 and 2 with one click.
    await lib.getByRole('button', { name: 'Signature Drawn' }).click()
    await lib.getByRole('button', { name: 'Place on several pages…' }).click()
    const pages = win.getByRole('dialog', { name: 'Place stamp on several pages' })
    await pages.getByRole('combobox', { name: 'Pages' }).selectOption('custom')
    await pages.getByRole('textbox', { name: 'Custom pages' }).fill('1-2')
    await pages.getByRole('button', { name: 'Apply' }).click()
    const p = (await win.locator('.page').first().boundingBox())!
    await win.mouse.click(p.x + 200, p.y + 300)
    await expect(win.locator('.annot-svg image')).not.toHaveCount(0)

    // Place the scanned one by dragging a box.
    await win.getByRole('button', { name: 'Add signature' }).click()
    await lib.getByRole('button', { name: 'Signature Scanned' }).click()
    await lib.getByRole('button', { name: 'Place on the page' }).click()
    await win.mouse.move(p.x + 100, p.y + 500)
    await win.mouse.down()
    await win.mouse.move(p.x + 250, p.y + 540, { steps: 6 })
    await win.mouse.up()

    // Wait for the dragged picture to land (placing is asynchronous) before choosing the next tool.
    await expect(win.locator('.annot-svg image')).toHaveCount(3)
    // A "Sign here" marker on page 1.
    await win.getByRole('button', { name: 'Sign here', exact: true }).click()
    await win.mouse.click(p.x + 380, p.y + 120)
    await expect(win.locator('.annot-svg').getByText('SIGN HERE')).toBeVisible()

    await win.keyboard.press('Escape')
    await win.keyboard.press('Control+s')
    await expect(win.locator('.tab-dirty')).toHaveCount(0)
    const read = `
import sys, json, pymupdf
d = pymupdf.open(sys.argv[1])
out = []
for n in range(d.page_count):
    for a in d[n].annots():
        out.append({"page": n, "type": a.type[1], "content": a.info.get("content", ""), "subj": a.info.get("subject", ""), "w": round(a.rect.width), "h": round(a.rect.height)})
print(json.dumps({"annots": out, "images": [len(d[n].get_images()) for n in range(d.page_count)]}))
`
    const saved = JSON.parse(python(read, pdfPath))
    const sigs = saved.annots.filter((a: { subj: string }) => a.subj === 'Visual signature')
    // Drawn on pages 1 and 2, scanned on page 1; each a stamp with no /Contents.
    expect(sigs.map((a: { page: number }) => a.page).sort()).toEqual([0, 0, 1])
    for (const a of sigs) {
      expect(a.type).toBe('Stamp')
      expect(a.content).toBe('')
    }
    // The dragged one is about 150 x 40 (aspect kept, so it fits the box).
    expect(Math.max(...sigs.map((a: { w: number }) => a.w))).toBeLessThanOrEqual(155)
    expect(saved.annots.filter((a: { subj: string; page: number }) => a.subj !== 'Visual signature' && a.page === 0)).toHaveLength(1)

    // Flatten: the signature pictures become page content; the "Sign here" marker stays an annotation.
    await win.getByRole('button', { name: 'Flatten signatures' }).click()
    await expect(win.locator('.tab-dirty')).toHaveCount(1)
    await win.keyboard.press('Control+s')
    await expect(win.locator('.tab-dirty')).toHaveCount(0)
    const flat = JSON.parse(python(read, pdfPath))
    expect(flat.annots.filter((a: { subj: string }) => a.subj === 'Visual signature')).toHaveLength(0)
    expect(flat.annots).toHaveLength(1)
    expect(flat.images[0]).toBeGreaterThan(0)
    expect(flat.images[1]).toBeGreaterThan(0)
    expect(problems).toEqual([])
  } finally {
    await app.close()
    rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 })
  }
})
