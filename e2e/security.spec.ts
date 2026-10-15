import { _electron as electron, expect, test, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(__dirname, '..')

/** A one-page PDF, optionally encrypted with AES-256. */
function make(path: string, userPw = '', ownerPw = '', permissions = -1): void {
  const py = `
import sys, pymupdf
d = pymupdf.open()
d.new_page(width=300, height=300).insert_text((50, 100), "Secret page", fontsize=14)
user, owner, perms = sys.argv[2], sys.argv[3], int(sys.argv[4])
if user or owner:
    d.save(sys.argv[1], encryption=pymupdf.PDF_ENCRYPT_AES_256, user_pw=user, owner_pw=owner, permissions=perms)
else:
    d.save(sys.argv[1])
`
  execFileSync('python', ['-c', py, path, userPw, ownerPw, String(permissions)])
}

/** Encryption state of a saved file, read with PyMuPDF. */
function inspect(path: string, password = ''): { encrypted: boolean; needsPass: boolean; opened: boolean; rotation: number; canModify: boolean; canCopy: boolean; text: string } {
  const py = `
import sys, json, pymupdf
d = pymupdf.open(sys.argv[1])
needs = d.needs_pass
enc = d.is_encrypted
ok = True
if needs:
    ok = d.authenticate(sys.argv[2]) > 0
print(json.dumps({"encrypted": bool(enc), "needsPass": bool(needs), "opened": ok, "rotation": d[0].rotation if ok else -1,
  "canModify": bool(d.permissions & pymupdf.PDF_PERM_MODIFY) if ok else False,
  "canCopy": bool(d.permissions & pymupdf.PDF_PERM_COPY) if ok else False,
  "text": d[0].get_text() if ok else ""}))
`
  return JSON.parse(execFileSync('python', ['-c', py, path, password]).toString())
}

async function rotateRight(win: Page) {
  await win.getByRole('tab', { name: 'Organise', exact: true }).click()
  await win.getByRole('button', { name: 'Rotate right' }).click()
  await expect(win.locator('.tab-dirty')).toHaveCount(1)
}

test('a file with an open password: wrong password refused, right one opens it, and it is encrypted again on save', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'openpdf-e2e-'))
  const pdfPath = join(dir, 'secret.pdf')
  make(pdfPath, 'userpw', 'ownerpw')
  const app = await electron.launch({ args: ['.', pdfPath], cwd: root, env: { ...process.env, OPENPDF_E2E: '1', OPENPDF_E2E_USERDATA: join(dir, 'ud'), OPENPDF_E2E_DISCARD: '1' } })
  try {
    const win = await app.firstWindow()
    const problems: string[] = []
    win.on('pageerror', (e) => problems.push(e.message))
    const box = win.getByRole('textbox', { name: 'Document password' })
    await expect(box).toBeVisible()
    await box.fill('nope')
    await box.press('Enter')
    await expect(win.getByText('That password is incorrect.')).toBeVisible()
    await box.fill('userpw')
    await box.press('Enter')
    await expect(win.locator('.page')).toHaveCount(1)
    // It can be edited like any other file.
    await rotateRight(win)
    await win.keyboard.press('Control+s')
    await expect(win.locator('.tab-dirty')).toHaveCount(0)
    const out = inspect(pdfPath, 'userpw')
    expect(out).toMatchObject({ encrypted: true, needsPass: true, opened: true, rotation: 90 })
    expect(out.text).toContain('Secret page')
    expect(inspect(pdfPath, 'wrong').opened).toBe(false)
    expect(problems).toEqual([])
  } finally {
    await app.close()
    rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 })
  }
})

test('a file whose owner forbids editing opens read-only until the permissions password is entered', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'openpdf-e2e-'))
  const pdfPath = join(dir, 'restricted.pdf')
  // Printing and copying allowed; modifying, commenting, forms and page changes are not.
  make(pdfPath, '', 'ownerpw', 4 | 16)
  const app = await electron.launch({ args: ['.', pdfPath], cwd: root, env: { ...process.env, OPENPDF_E2E: '1', OPENPDF_E2E_USERDATA: join(dir, 'ud'), OPENPDF_E2E_DISCARD: '1' } })
  try {
    const win = await app.firstWindow()
    const problems: string[] = []
    win.on('pageerror', (e) => problems.push(e.message))
    await expect(win.locator('.page')).toHaveCount(1)
    await expect(win.getByText(/does not allow: .*editing/)).toBeVisible()
    await win.getByRole('tab', { name: 'Organise', exact: true }).click()
    await expect(win.getByRole('button', { name: 'Rotate right' })).toBeDisabled()

    // The wrong password does nothing; the right one unlocks editing.
    await win.getByRole('button', { name: /Enter the permissions password/ }).click()
    const pw = win.getByRole('dialog', { name: 'Permissions password' }).getByRole('textbox', { name: 'Permissions password' })
    await pw.fill('guess')
    await pw.press('Enter')
    await expect(win.getByText('That is not the permissions password.')).toBeVisible()
    await pw.fill('ownerpw')
    await pw.press('Enter')
    await expect(win.getByText(/does not allow: .*editing/)).toHaveCount(0)
    await expect(win.getByRole('button', { name: 'Rotate right' })).toBeEnabled()
    await rotateRight(win)
    await win.keyboard.press('Control+s')
    await expect(win.locator('.tab-dirty')).toHaveCount(0)

    // Saved with the same restrictions: opens without a password, rotated, but still not editable.
    const out = inspect(pdfPath)
    // (PyMuPDF reports an empty user password as opened, so the proof of encryption is the permissions still in force.)
    expect(out).toMatchObject({ needsPass: false, rotation: 90, canModify: false, canCopy: true })
    expect(problems).toEqual([])
  } finally {
    await app.close()
    rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 })
  }
})

test('the Security dialog adds and removes passwords and permissions when the file is saved', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'openpdf-e2e-'))
  const pdfPath = join(dir, 'plain.pdf')
  make(pdfPath)
  const app = await electron.launch({ args: ['.', pdfPath], cwd: root, env: { ...process.env, OPENPDF_E2E: '1', OPENPDF_E2E_USERDATA: join(dir, 'ud'), OPENPDF_E2E_DISCARD: '1' } })
  try {
    const win = await app.firstWindow()
    const problems: string[] = []
    win.on('pageerror', (e) => problems.push(e.message))
    await expect(win.locator('.page')).toHaveCount(1)
    await win.getByRole('tab', { name: 'File', exact: true }).click()
    await win.getByRole('button', { name: 'Security' }).click()
    const d = win.getByRole('dialog', { name: 'Security' })
    await d.getByRole('button', { name: 'Apply' }).click()
    await expect(d.getByRole('alert')).toContainText('Choose a password')
    await d.getByRole('checkbox', { name: /Require a password to open/ }).check()
    await d.getByRole('textbox', { name: 'Open password', exact: true }).fill('abc')
    await d.getByRole('textbox', { name: 'Confirm open password' }).fill('abd')
    await d.getByRole('button', { name: 'Apply' }).click()
    await expect(d.getByRole('alert')).toContainText('not the same')
    await d.getByRole('textbox', { name: 'Confirm open password' }).fill('abc')
    await d.getByRole('checkbox', { name: /Restrict printing/ }).check()
    await d.getByRole('textbox', { name: 'Permissions password' }).fill('own')
    await d.getByRole('checkbox', { name: 'Copying text and images' }).uncheck()
    await d.getByRole('button', { name: 'Apply' }).click()
    await expect(win.getByText('Security set. Save to write the protected file.')).toBeVisible()
    // The change alone makes the document unsaved.
    await expect(win.locator('.tab-dirty')).toHaveCount(1)
    await win.keyboard.press('Control+s')
    await expect(win.locator('.tab-dirty')).toHaveCount(0)
    let out = inspect(pdfPath, 'abc')
    expect(out).toMatchObject({ encrypted: true, needsPass: true, opened: true, canCopy: false })
    expect(out.text).toContain('Secret page')
    expect(inspect(pdfPath, 'zzz').opened).toBe(false)

    // Take it all off again.
    await win.getByRole('tab', { name: 'File', exact: true }).click()
    await win.getByRole('button', { name: 'Security' }).click()
    await d.getByRole('button', { name: 'Remove security' }).click()
    await win.keyboard.press('Control+s')
    await expect(win.locator('.tab-dirty')).toHaveCount(0)
    out = inspect(pdfPath)
    expect(out).toMatchObject({ encrypted: false, needsPass: false })
    expect(out.text).toContain('Secret page')
    expect(problems).toEqual([])
  } finally {
    await app.close()
    rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 })
  }
})
