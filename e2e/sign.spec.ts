import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(__dirname, '..')

/** A self-signed signing certificate as a .pfx (password "pw"), and a two-page PDF. */
function makeFiles(dir: string): { pfx: string; pdf: string } {
  const pfx = join(dir, 'signer.pfx')
  const pdf = join(dir, 'contract.pdf')
  execFileSync('python', [
    '-c',
    `import sys, datetime, pymupdf
from cryptography import x509
from cryptography.x509.oid import NameOID
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.serialization import pkcs12
from cryptography.hazmat.primitives.asymmetric import rsa
k = rsa.generate_private_key(public_exponent=65537, key_size=2048)
n = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "OpenPDF Test Signer"), x509.NameAttribute(NameOID.ORGANIZATION_NAME, "Example Test")])
c = x509.CertificateBuilder().subject_name(n).issuer_name(n).public_key(k.public_key()).serial_number(x509.random_serial_number()).not_valid_before(datetime.datetime(2026,1,1)).not_valid_after(datetime.datetime(2036,1,1)).sign(k, hashes.SHA256())
open(sys.argv[1], 'wb').write(pkcs12.serialize_key_and_certificates(b"t", k, c, None, serialization.BestAvailableEncryption(b"pw")))
d = pymupdf.open()
d.new_page(width=400, height=300).insert_text((50, 100), "Contract: both parties agree", fontsize=14)
d.new_page(width=400, height=300).insert_text((50, 100), "Schedule", fontsize=14)
d.save(sys.argv[2])`,
    pfx,
    pdf
  ])
  return { pfx, pdf }
}

/** Checks the first signature of a saved file with OpenSSL, independently of the app. */
function opensslVerifies(dir: string, pdf: string): { ok: boolean; widgets: string[]; pages: number } {
  const py = `
import sys, re, json, subprocess, pymupdf
raw = open(sys.argv[1], 'rb').read()
m = re.search(rb'/ByteRange\\s*\\[\\s*(\\d+)\\s+(\\d+)\\s+(\\d+)\\s+(\\d+)\\s*\\]', raw)
a, b, c, d = (int(x) for x in m.groups())
signed = raw[a:a + b] + raw[c:c + d]
hexs = re.search(rb'/Contents\\s*<([0-9A-Fa-f]+)>', raw).group(1).decode()
sig = bytes.fromhex(hexs)
open(sys.argv[2] + '/signed.bin', 'wb').write(signed)
open(sys.argv[2] + '/sig.der', 'wb').write(sig.rstrip(b'\\x00') if False else sig)
r = subprocess.run(['openssl', 'cms', '-verify', '-binary', '-inform', 'DER', '-in', sys.argv[2] + '/sig.der', '-content', sys.argv[2] + '/signed.bin', '-noverify', '-out', sys.argv[2] + '/out.bin'], capture_output=True)
doc = pymupdf.open(sys.argv[1])
print(json.dumps({"ok": r.returncode == 0, "widgets": [w.field_type_string for w in doc[0].widgets()], "pages": len(doc)}))
`
  return JSON.parse(execFileSync('python', ['-c', py, pdf, dir]).toString())
}

async function launch(dir: string, args: string[], extra: Record<string, string> = {}): Promise<{ app: ElectronApplication; win: Page; problems: string[] }> {
  const app = await electron.launch({ args: ['.', ...args], cwd: root, env: { ...process.env, OPENPDF_E2E: '1', OPENPDF_E2E_USERDATA: join(dir, 'ud'), OPENPDF_E2E_DISCARD: '1', ...extra } })
  const win = await app.firstWindow()
  const problems: string[] = []
  win.on('pageerror', (e) => problems.push(e.message))
  return { app, win, problems }
}

async function chooseCertificateFile(win: Page) {
  await win.getByRole('tab', { name: 'Sign', exact: true }).click()
  await win.getByRole('button', { name: 'Sign document' }).click()
  const d = win.getByRole('dialog', { name: 'Sign document' })
  await d.getByRole('button', { name: 'Use a certificate file…' }).click()
  const pw = d.getByRole('textbox', { name: 'Certificate file password' })
  await pw.fill('wrong')
  await pw.press('Enter')
  await expect(d.getByRole('alert')).toContainText('did not open')
  await pw.fill('pw')
  await pw.press('Enter')
  await expect(d.getByText('Using OpenPDF Test Signer')).toBeVisible()
  return d
}

test('signing with a certificate file writes a signature OpenSSL accepts, and reopening it shows who signed', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'openpdf-e2e-'))
  const { pfx, pdf } = makeFiles(dir)
  const first = await launch(dir, [pdf], { OPENPDF_E2E_PICK: pfx })
  try {
    const { win, problems } = first
    await expect(win.locator('.page')).toHaveCount(2)
    const d = await chooseCertificateFile(win)
    await d.getByRole('combobox', { name: 'Reason' }).fill('I approve this document')
    await d.getByRole('button', { name: 'Sign', exact: true }).click()
    await expect(win.getByText(/Signed\. Save to write/)).toBeVisible()
    await expect(win.getByText(/Signed by OpenPDF Test Signer/)).toBeVisible()
    await win.keyboard.press('Control+s')
    await expect(win.locator('.tab-dirty')).toHaveCount(0)
    expect(problems).toEqual([])
  } finally {
    await first.app.close()
  }
  try {
    const v = opensslVerifies(dir, pdf)
    expect(v).toMatchObject({ ok: true, pages: 2 })
    expect(v.widgets).toContain('Signature')
  } catch (e) {
    rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 })
    throw e
  }

  // Reopen the signed file: the banner names the signer, the panel says the signature is intact but the signer untrusted.
  const second = await launch(dir, [pdf])
  try {
    const { win, problems } = second
    await expect(win.getByText(/Signed by OpenPDF Test Signer/)).toBeVisible()
    await win.getByRole('button', { name: 'Signature details…' }).click()
    const panel = win.getByRole('dialog', { name: 'Signatures' })
    await expect(panel.getByText(/The signature is intact, but the signer cannot be trusted/)).toBeVisible()
    await expect(panel.getByText('I approve this document')).toBeVisible()
    await panel.getByRole('button', { name: 'Close', exact: true }).first().click()

    // Changing a signed document asks first, and afterwards the signature says it no longer matches.
    await win.getByRole('tab', { name: 'Organise', exact: true }).click()
    await win.getByRole('button', { name: 'Rotate right' }).click()
    const ask = win.getByRole('dialog', { name: 'This document is signed' })
    await expect(ask).toBeVisible()
    await ask.getByRole('button', { name: 'Cancel' }).click()
    await expect(win.locator('.tab-dirty')).toHaveCount(0)
    await win.getByRole('button', { name: 'Rotate right' }).click()
    await ask.getByRole('button', { name: 'Change anyway' }).click()
    await expect(win.getByText(/changed after/)).toBeVisible()
    expect(problems).toEqual([])
  } finally {
    await second.app.close()
    rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 })
  }
})

test('a visible certifying signature is drawn where the box was dragged and appears in the file', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'openpdf-e2e-'))
  const { pfx, pdf } = makeFiles(dir)
  const { app, win, problems } = await launch(dir, [pdf], { OPENPDF_E2E_PICK: pfx })
  try {
    await expect(win.locator('.page')).toHaveCount(2)
    const d = await chooseCertificateFile(win)
    await d.getByRole('combobox', { name: 'Appearance' }).selectOption('visible')
    await d.getByRole('combobox', { name: 'Certify' }).selectOption('2')
    await d.getByRole('button', { name: 'Next: draw the box' }).click()
    const box = (await win.locator('.page').first().boundingBox())!
    const k = box.width / 400
    await win.mouse.move(box.x + 40 * k, box.y + 200 * k)
    await win.mouse.down()
    await win.mouse.move(box.x + 200 * k, box.y + 240 * k, { steps: 5 })
    await win.mouse.move(box.x + 240 * k, box.y + 270 * k, { steps: 5 })
    await win.mouse.up()
    await expect(win.getByText(/Signed\. Save to write/)).toBeVisible()
    await win.keyboard.press('Control+s')
    await expect(win.locator('.tab-dirty')).toHaveCount(0)
    const v = opensslVerifies(dir, pdf)
    expect(v.ok).toBe(true)
    expect(v.widgets).toContain('Signature')
    // The visible signature has a size and certifies the document.
    const info = JSON.parse(
      execFileSync('python', ['-c', `import sys, json, pymupdf\nd = pymupdf.open(sys.argv[1])\nw = [x for x in d[0].widgets() if x.field_type_string == 'Signature'][0]\nprint(json.dumps({"w": w.rect.width, "h": w.rect.height, "perms": 'DocMDP' in d.xref_object(d.pdf_catalog())}))`, pdf]).toString()
    )
    expect(info.w).toBeGreaterThan(100)
    expect(info.h).toBeGreaterThan(20)
    expect(info.perms).toBe(true)
    await win.getByRole('button', { name: 'Signature details…' }).click()
    await expect(win.getByRole('dialog', { name: 'Signatures' }).getByText('Certified: form filling and signing allowed')).toBeVisible()
    expect(problems).toEqual([])
  } finally {
    await app.close()
    rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 })
  }
})

