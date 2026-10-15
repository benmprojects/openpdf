import { _electron as electron, expect, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(__dirname, '..')

test('attach a file and a sound to a page: saved in the PDF and readable again', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'openpdf-e2e-'))
  const pdfPath = join(dir, 'attach.pdf')
  const txt = join(dir, 'site notes.txt')
  const wav = join(dir, 'memo.wav')
  const out = join(dir, 'out')
  mkdirSync(out)
  execFileSync('python', [join(root, 'scripts', 'make-test-pdf.py'), pdfPath])
  writeFileSync(txt, 'Pour scheduled for Monday.\n')
  execFileSync('python', [
    '-c',
    'import sys, wave, struct, math\nw = wave.open(sys.argv[1], "wb")\nw.setnchannels(1); w.setsampwidth(2); w.setframerate(8000)\nw.writeframes(b"".join(struct.pack("<h", int(8000 * math.sin(i / 8))) for i in range(4000)))\nw.close()',
    wav
  ])
  const launch = (pick: string) =>
    electron.launch({
      args: ['.', pdfPath],
      cwd: root,
      env: { ...process.env, OPENPDF_E2E: '1', OPENPDF_E2E_USERDATA: join(dir, 'ud'), OPENPDF_E2E_PICK: pick, OPENPDF_E2E_DIR: out, OPENPDF_E2E_DISCARD: '1' }
    })
  let app = await launch(txt)
  try {
    let win = await app.firstWindow()
    await expect(win.locator('.page')).toHaveCount(6)
    const p = (await win.locator('.page').first().boundingBox())!
    await win.getByRole('tab', { name: 'Comment', exact: true }).click()
    await win.getByRole('button', { name: 'Attach file' }).click()
    await win.mouse.click(p.x + 450, p.y + 150)
    await expect(win.locator('.annot-icon')).toHaveCount(1)
    await win.keyboard.press('Control+s')
    await expect(win.locator('.tab-dirty')).toHaveCount(0)
    await app.close()

    // Second run picks the WAV for a sound.
    app = await launch(wav)
    win = await app.firstWindow()
    await expect(win.locator('.page')).toHaveCount(6)
    await win.getByRole('tab', { name: 'Comment', exact: true }).click()
    await win.getByRole('button', { name: 'Sound', exact: true }).click()
    await win.mouse.click(p.x + 450, p.y + 250)
    await expect(win.locator('.annot-icon')).toHaveCount(1)
    await win.keyboard.press('Control+s')
    await expect(win.locator('.tab-dirty')).toHaveCount(0)

    const py = `
import sys, json, pymupdf
d = pymupdf.open(sys.argv[1])
out = []
for a in d[0].annots():
    item = {"type": a.type[1]}
    if a.type[1] == "FileAttachment":
        item["file"] = a.get_file().decode()
    if a.type[1] == "Sound":
        s = a.get_sound()
        item["rate"] = s["rate"]
        item["bytes"] = len(s["stream"])
    out.append(item)
print(json.dumps(out))
`
    const saved = JSON.parse(execFileSync('python', ['-c', py, pdfPath]).toString())
    expect(saved).toContainEqual({ type: 'FileAttachment', file: 'Pour scheduled for Monday.\n' })
    expect(saved).toContainEqual({ type: 'Sound', rate: 8000, bytes: 8000 })

    // The attached file is listed (after the save reload) and can be saved out again.
    await win.getByRole('tab', { name: 'Attachments' }).click()
    const item = win.locator('.side-list li', { hasText: 'site notes.txt' })
    await expect(item).toContainText('on page 1')
    await item.getByRole('button', { name: /Save site notes\.txt/ }).click()
    await expect.poll(() => existsSync(join(out, 'site notes.txt'))).toBe(true)
    expect(readFileSync(join(out, 'site notes.txt'), 'utf8')).toBe('Pour scheduled for Monday.\n')
  } finally {
    await app.close()
    rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 })
  }
})
