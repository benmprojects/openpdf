import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(__dirname, '..')

async function launch(dir: string, args: string[], extra: Record<string, string> = {}): Promise<{ app: ElectronApplication; win: Page; problems: string[] }> {
  const app = await electron.launch({ args: ['.', ...args], cwd: root, env: { ...process.env, OPENPDF_E2E: '1', OPENPDF_E2E_USERDATA: join(dir, 'ud'), OPENPDF_E2E_DISCARD: '1', ...extra } })
  const win = await app.firstWindow()
  const problems: string[] = []
  win.on('pageerror', (e) => problems.push(e.message))
  return { app, win, problems }
}

const cleanup = (dir: string) => rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 })

/** A self-signed signing certificate as a .pfx (password "pw") and a two-page PDF. */
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

const raw = (path: string) => readFileSync(path, 'latin1')

/** The catalogue and the Info /Trapped entry as PyMuPDF reads them (the file keeps them inside compressed object streams). */
function catalogOf(path: string): { catalog: string; trapped: string } {
  const py = `
import sys, json, pymupdf
d = pymupdf.open(sys.argv[1])
info = d.xref_get_key(-1, "Info")[1].split()[0]
trapped = str(d.xref_get_key(int(info), "Trapped")) if info.isdigit() else ""
print(json.dumps({"catalog": d.xref_object(d.pdf_catalog()), "trapped": trapped}))
`
  return JSON.parse(execFileSync('python', ['-c', py, path]).toString())
}

test('signing with long-term validation data, then clearing all signatures', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'openpdf-e2e-'))
  const { pfx, pdf } = makeFiles(dir)
  const first = await launch(dir, [pdf], { OPENPDF_E2E_PICK: pfx })
  try {
    const { win, problems } = first
    await expect(win.locator('.page')).toHaveCount(2)
    await win.getByRole('tab', { name: 'Sign', exact: true }).click()
    await win.getByRole('button', { name: 'Sign document' }).click()
    const d = win.getByRole('dialog', { name: 'Sign document' })
    await d.getByRole('button', { name: 'Use a certificate file…' }).click()
    const pw = d.getByRole('textbox', { name: 'Certificate file password' })
    await pw.fill('pw')
    await pw.press('Enter')
    await expect(d.getByText('Using OpenPDF Test Signer')).toBeVisible()
    await d.getByRole('checkbox', { name: /long-term validation/ }).check()
    await expect(d).toContainText('asks the certificate authorities')
    await d.getByRole('button', { name: 'Sign', exact: true }).click()
    await expect(win.getByText(/Kept 1 certificate, 0 OCSP answers and 0 revocation lists/)).toBeVisible()
    await win.keyboard.press('Control+s')
    await expect(win.locator('.tab-dirty')).toHaveCount(0)
    // The signature is still valid with the validation data after it.
    await expect(win.getByText(/Signed by OpenPDF Test Signer/)).toBeVisible()
    await expect(win.locator('.banner.error')).toHaveCount(0)
    const text = raw(pdf)
    expect(text).toContain('/DSS')
    expect(text).toContain('/ByteRange')

    // Clear all signatures: asks first, then the file has none.
    await win.getByRole('button', { name: 'Clear all signatures' }).click()
    const clear = win.getByRole('dialog', { name: 'Clear all signatures' })
    await expect(clear).toContainText('Remove the 1 signature')
    await clear.getByRole('button', { name: 'Cancel' }).click()
    await expect(win.getByText(/Signed by OpenPDF Test Signer/)).toBeVisible()
    await win.getByRole('button', { name: 'Clear all signatures' }).click()
    await win.getByRole('dialog', { name: 'Clear all signatures' }).getByRole('button', { name: 'Clear signatures' }).click()
    await expect(win.getByText(/Signatures cleared/)).toBeVisible()
    await expect(win.getByText(/Signed by OpenPDF Test Signer/)).toHaveCount(0)
    await win.keyboard.press('Control+s')
    await expect(win.locator('.tab-dirty')).toHaveCount(0)
    const cleared = raw(pdf)
    expect(cleared).not.toContain('/ByteRange')
    expect(cleared).not.toContain('adbe.pkcs7.detached')
    expect(problems).toEqual([])
  } finally {
    await first.app.close()
  }
  // Opened again: no signatures, and the document can be signed once more.
  const again = await launch(dir, [pdf], { OPENPDF_E2E_PICK: pfx })
  try {
    await expect(again.win.locator('.page')).toHaveCount(2)
    await expect(again.win.getByText(/Signed by/)).toHaveCount(0)
    await again.win.getByRole('tab', { name: 'Sign', exact: true }).click()
    await expect(again.win.getByRole('button', { name: 'Clear all signatures' })).toBeDisabled()
  } finally {
    await again.app.close()
    cleanup(dir)
  }
})

test('document actions run in the sandbox and the script console shows what they print', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'openpdf-e2e-'))
  const pdf = join(dir, 'actions.pdf')
  execFileSync('python', ['-c', 'import sys, pymupdf\nd = pymupdf.open()\nd.new_page(width=300, height=300)\nd.new_page(width=300, height=300)\nd.save(sys.argv[1])', pdf])
  const first = await launch(dir, [pdf])
  try {
    const { win, problems } = first
    await expect(win.locator('.page')).toHaveCount(2)
    await win.getByRole('tab', { name: 'Forms', exact: true }).click()
    await win.getByRole('button', { name: 'Script console' }).click()
    const log = win.getByRole('log', { name: 'Console output' })
    await expect(log).toContainText('Nothing has been printed yet')
    await win.getByRole('dialog', { name: 'Script console' }).getByRole('button', { name: 'Close', exact: true }).last().click()

    await win.getByRole('button', { name: 'Document actions' }).click()
    const d = win.getByRole('dialog', { name: 'Document actions' })
    await d.getByRole('textbox', { name: 'When the document is opened' }).fill('console.println("opened with " + this.numPages + " pages");')
    await d.getByRole('textbox', { name: 'Before the document is saved' }).fill('console.println("about to save");')
    await d.getByRole('textbox', { name: 'After the document is saved' }).fill('console.println("saved");')
    await d.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(win.getByText('Document actions saved')).toBeVisible()
    await win.keyboard.press('Control+s')
    await expect(win.locator('.tab-dirty')).toHaveCount(0)
    // The save events ran, in order.
    await win.getByRole('button', { name: 'Script console' }).click()
    await expect(log).toContainText('[Before save] about to save')
    await expect(log).toContainText('[After save] saved')
    const text = (await log.textContent()) ?? ''
    expect(text.indexOf('about to save')).toBeLessThan(text.indexOf('saved\n') === -1 ? text.length : text.indexOf('saved\n') + 1)
    await win.getByRole('dialog', { name: 'Script console' }).getByRole('button', { name: 'Clear', exact: true }).click()
    await expect(log).toContainText('Nothing has been printed yet')
    const { catalog } = catalogOf(pdf)
    expect(catalog).toContain('/OpenAction')
    expect(catalog).toMatch(/\/DS\b/)
    expect(catalog).toMatch(/\/WS\b/)
    expect(problems).toEqual([])
  } finally {
    await first.app.close()
  }
  // Opened again, the open action runs by itself.
  const again = await launch(dir, [pdf])
  try {
    const { win } = again
    await expect(win.locator('.page')).toHaveCount(2)
    await win.getByRole('tab', { name: 'Forms', exact: true }).click()
    await win.getByRole('button', { name: 'Script console' }).click()
    await expect(win.getByRole('log', { name: 'Console output' })).toContainText('[Document open] opened with 2 pages')
    // Removing the actions takes them out of the file.
    await win.getByRole('dialog', { name: 'Script console' }).getByRole('button', { name: 'Close', exact: true }).last().click()
    await win.getByRole('button', { name: 'Document actions' }).click()
    const d = win.getByRole('dialog', { name: 'Document actions' })
    await expect(d.getByRole('textbox', { name: 'When the document is opened' })).toHaveValue(/opened with/)
    for (const label of ['When the document is opened', 'Before the document is saved', 'After the document is saved']) await d.getByRole('textbox', { name: label }).fill('')
    await d.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(win.getByText('Document actions removed')).toBeVisible()
    await win.keyboard.press('Control+s')
    await expect(win.locator('.tab-dirty')).toHaveCount(0)
    const { catalog } = catalogOf(pdf)
    expect(catalog).not.toContain('/OpenAction')
    expect(catalog).not.toMatch(/\/AA\b/)
  } finally {
    await again.app.close()
    cleanup(dir)
  }
})

test('saved security policies keep the choices and never a password', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'openpdf-e2e-'))
  const pdf = join(dir, 'policy.pdf')
  execFileSync('python', ['-c', 'import sys, pymupdf\nd = pymupdf.open()\nd.new_page(width=300, height=300)\nd.save(sys.argv[1])', pdf])
  const first = await launch(dir, [pdf])
  try {
    const { win, problems } = first
    await expect(win.locator('.page')).toHaveCount(1)
    await win.getByRole('tab', { name: 'File', exact: true }).click()
    await win.getByRole('button', { name: 'Security' }).click()
    const d = win.getByRole('dialog', { name: 'Security' })
    await d.getByRole('button', { name: 'Save as policy' }).click()
    await expect(d.getByRole('alert')).toContainText('Give the policy a name')
    await d.getByRole('textbox', { name: 'Policy name' }).fill('Tender copy')
    await d.getByRole('button', { name: 'Save as policy' }).click()
    await expect(d.getByRole('alert')).toContainText('Choose a password to open the document, restrictions, or both')

    await d.getByRole('checkbox', { name: /Restrict printing, editing and copying/ }).check()
    await d.getByRole('textbox', { name: 'Permissions password' }).fill('top-secret-owner')
    await d.getByRole('combobox', { name: 'Printing' }).selectOption('low')
    await d.getByRole('checkbox', { name: 'Copying text and images' }).uncheck()
    await d.getByRole('button', { name: 'Save as policy' }).click()
    await expect(d.getByRole('combobox', { name: 'Saved policy' })).toContainText('Tender copy')
    await expect(d).toContainText('low-resolution printing, no copying; AES-256')

    // Another start: the choices come back, the password does not.
    await d.getByRole('combobox', { name: 'Saved policy' }).selectOption({ label: '(none chosen)' })
    await d.getByRole('checkbox', { name: /Restrict printing, editing and copying/ }).uncheck()
    await d.getByRole('combobox', { name: 'Saved policy' }).selectOption({ label: 'Tender copy' })
    await expect(d.getByRole('checkbox', { name: /Restrict printing, editing and copying/ })).toBeChecked()
    await expect(d.getByRole('combobox', { name: 'Printing' })).toHaveValue('low')
    await expect(d.getByRole('checkbox', { name: 'Copying text and images' })).not.toBeChecked()
    await expect(d.getByRole('textbox', { name: 'Permissions password' })).toHaveValue('')

    // It is saved in the settings, without any password.
    await expect.poll(() => (existsSync(join(dir, 'ud', 'settings.json')) ? readFileSync(join(dir, 'ud', 'settings.json'), 'utf8') : '')).toContain('Tender copy')
    const settings = readFileSync(join(dir, 'ud', 'settings.json'), 'utf8')
    expect(settings).not.toContain('top-secret-owner')
    expect(JSON.parse(settings).securityPolicies[0]).toMatchObject({ name: 'Tender copy', restrict: true, needOpen: false, level: 256 })
    expect(problems).toEqual([])
  } finally {
    await first.app.close()
  }
  // After a restart the policy is still there, and it can be deleted.
  const again = await launch(dir, [pdf])
  try {
    const { win } = again
    await expect(win.locator('.page')).toHaveCount(1)
    await win.getByRole('tab', { name: 'File', exact: true }).click()
    await win.getByRole('button', { name: 'Security' }).click()
    const d = win.getByRole('dialog', { name: 'Security' })
    await expect(d.getByRole('combobox', { name: 'Saved policy' })).toContainText('Tender copy')
    await d.getByRole('combobox', { name: 'Saved policy' }).selectOption({ label: 'Tender copy' })
    await d.getByRole('button', { name: 'Delete policy' }).click()
    await expect(d.getByRole('combobox', { name: 'Saved policy' })).not.toContainText('Tender copy')
  } finally {
    await again.app.close()
    cleanup(dir)
  }
})

test('document properties: base URL and trapped are written and read back', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'openpdf-e2e-'))
  const pdf = join(dir, 'props.pdf')
  execFileSync('python', ['-c', 'import sys, pymupdf\nd = pymupdf.open()\nd.new_page(width=300, height=300)\nd.save(sys.argv[1])', pdf])
  const first = await launch(dir, [pdf])
  try {
    const { win, problems } = first
    await expect(win.locator('.page')).toHaveCount(1)
    await win.getByRole('tab', { name: 'File', exact: true }).click()
    await win.getByRole('button', { name: 'Properties' }).click()
    const d = win.getByRole('dialog', { name: 'Document properties' })
    await d.getByRole('textbox', { name: 'Base URL' }).fill('ftp://example.com')
    await d.getByRole('button', { name: 'Apply' }).click()
    await expect(d.getByRole('alert')).toContainText('http:// or https://')
    await d.getByRole('textbox', { name: 'Base URL' }).fill('https://example.com/docs/')
    await d.getByRole('combobox', { name: 'Trapped' }).selectOption('False')
    await d.getByRole('button', { name: 'Apply' }).click()
    await expect(win.getByText('Document properties updated')).toBeVisible()
    await win.keyboard.press('Control+s')
    await expect(win.locator('.tab-dirty')).toHaveCount(0)
    const { catalog, trapped } = catalogOf(pdf)
    expect(catalog).toContain('/Base')
    expect(catalog).toContain('https://example.com/docs/')
    expect(trapped).toContain('False')
    expect(problems).toEqual([])
  } finally {
    await first.app.close()
  }
  const again = await launch(dir, [pdf])
  try {
    const { win } = again
    await expect(win.locator('.page')).toHaveCount(1)
    await win.getByRole('tab', { name: 'File', exact: true }).click()
    await win.getByRole('button', { name: 'Properties' }).click()
    const d = win.getByRole('dialog', { name: 'Document properties' })
    await expect(d.getByRole('textbox', { name: 'Base URL' })).toHaveValue('https://example.com/docs/')
    await expect(d.getByRole('combobox', { name: 'Trapped' })).toHaveValue('False')
  } finally {
    await again.app.close()
    cleanup(dir)
  }
})
