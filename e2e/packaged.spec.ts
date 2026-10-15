import { _electron as electron, expect, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

/**
 * The installed program is not the same as `electron .`: its code sits inside an app archive, and the OCR engine,
 * language data and WebAssembly files must be reachable from it. This runs the packaged program (build it first with
 * `npx electron-builder --win --dir`; the test is skipped when it has not been built) through the features most likely
 * to break there.
 */
const exe = resolve(__dirname, '..', 'dist', 'win-unpacked', 'OpenPDF.exe')

test.skip(!existsSync(exe), 'the packaged program has not been built (npx electron-builder --win --dir)')

function launch(dir: string, args: string[], env: Record<string, string> = {}) {
  return electron.launch({ executablePath: exe, args, env: { ...process.env, OPENPDF_E2E: '1', OPENPDF_E2E_USERDATA: join(dir, 'ud'), OPENPDF_E2E_DISCARD: '1', ...env } })
}

test('the packaged program runs OCR, exports Word, runs a plugin and signs', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'openpdf-e2e-'))
  const scan = join(dir, 'scan.pdf')
  const pfx = join(dir, 's.pfx')
  execFileSync('python', [
    '-c',
    `import sys, datetime, pymupdf
src = pymupdf.open()
p = src.new_page(width=420, height=300)
p.insert_text((40, 60), "Packaged smoke test 9921", fontsize=24)
p.insert_text((40, 110), "Delivery docket for the site.", fontsize=14)
d = pymupdf.open()
q = d.new_page(width=420, height=300)
q.insert_image(q.rect, pixmap=p.get_pixmap(dpi=200))
d.save(sys.argv[1])
from cryptography import x509
from cryptography.x509.oid import NameOID
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.serialization import pkcs12
from cryptography.hazmat.primitives.asymmetric import rsa
k = rsa.generate_private_key(public_exponent=65537, key_size=2048)
n = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "Packaged Signer")])
c = x509.CertificateBuilder().subject_name(n).issuer_name(n).public_key(k.public_key()).serial_number(x509.random_serial_number()).not_valid_before(datetime.datetime(2026,1,1)).not_valid_after(datetime.datetime(2036,1,1)).sign(k, hashes.SHA256())
open(sys.argv[2], 'wb').write(pkcs12.serialize_key_and_certificates(b"t", k, c, None, serialization.BestAvailableEncryption(b"pw")))`,
    scan,
    pfx
  ])
  const plugin = join(dir, 'plug')
  mkdirSync(plugin)
  writeFileSync(join(plugin, 'plugin.json'), JSON.stringify({ apiVersion: 1, id: 'smoke.plug', name: 'Smoke', version: '1.0.0', permits: ['properties'], actions: [{ id: 'go', label: 'Go', script: 'go.js' }] }))
  writeFileSync(join(plugin, 'go.js'), `function run(doc) { return { message: 'ran on ' + doc.pageCount + ' page', steps: [{ kind: 'properties', title: 'Set by plugin' }] } }`)
  const docx = join(dir, 'out.docx')

  const app = await launch(dir, [scan], { OPENPDF_E2E_PLUGIN_PICK: plugin, OPENPDF_E2E_PICK: pfx, OPENPDF_E2E_SAVE_TEXT: docx })
  try {
    const win = await app.firstWindow()
    const problems: string[] = []
    win.on('pageerror', (e) => problems.push(e.message))
    await expect(win.locator('.page')).toHaveCount(1)

    // OCR: worker threads and language data from the unpacked part of the package.
    await win.getByRole('tab', { name: 'Convert', exact: true }).click()
    await win.getByRole('button', { name: 'OCR' }).click()
    await win.getByRole('dialog', { name: 'Recognise text (OCR)' }).getByRole('button', { name: 'Recognise' }).click()
    await expect(win.getByText(/Recognised \d+ words? on 1 page/)).toBeVisible({ timeout: 120000 })
    await win.keyboard.press('Control+f')
    const find = win.getByRole('searchbox', { name: 'Find in document' })
    await find.fill('Delivery docket')
    await find.press('Enter')
    await expect(win.locator('.search-status')).toHaveText(/1 of 1/)
    await win.keyboard.press('Escape')

    // Word export: the docx library loads on demand as a separate chunk.
    await win.getByRole('button', { name: 'Word' }).click()
    await expect.poll(() => (existsSync(docx) ? readFileSync(docx).subarray(0, 2).toString('latin1') : ''), { timeout: 30000 }).toBe('PK')

    // A plugin: the QuickJS WebAssembly sandbox.
    await win.getByRole('tab', { name: 'File', exact: true }).click()
    await win.getByRole('button', { name: 'Plugins' }).click()
    const d = win.getByRole('dialog', { name: 'Plugins' })
    await d.getByRole('button', { name: 'From a folder…' }).click()
    await d.getByRole('button', { name: 'Run on this document' }).click()
    await expect(d.getByRole('status')).toContainText('ran on 1 page')
    await d.getByRole('button', { name: 'Close', exact: true }).first().click()

    // Signing: PowerShell, .NET and the pkijs bundle.
    await win.getByRole('tab', { name: 'Sign', exact: true }).click()
    await win.getByRole('button', { name: 'Sign document' }).click()
    const s = win.getByRole('dialog', { name: 'Sign document' })
    await s.getByRole('button', { name: 'Use a certificate file…' }).click()
    await s.getByRole('textbox', { name: 'Certificate file password' }).fill('pw')
    await s.getByRole('textbox', { name: 'Certificate file password' }).press('Enter')
    await expect(s.getByText('Using Packaged Signer')).toBeVisible()
    await s.getByRole('button', { name: 'Sign', exact: true }).click()
    await expect(win.getByText(/Signed by Packaged Signer/)).toBeVisible({ timeout: 60000 })
    expect(problems).toEqual([])
  } finally {
    await app.close()
    rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 })
  }
})

test('the packaged program runs a batch from the command line', async () => {
  const { spawnSync } = await import('node:child_process')
  const dir = mkdtempSync(join(tmpdir(), 'openpdf-e2e-'))
  try {
    mkdirSync(join(dir, 'in'))
    execFileSync('python', ['-c', 'import sys, pymupdf\nd = pymupdf.open()\nd.new_page(width=300, height=300).insert_text((50, 100), "Command line", fontsize=14)\nd.save(sys.argv[1])', join(dir, 'in', 'a.pdf')])
    const action = join(dir, 'a.json')
    writeFileSync(action, JSON.stringify({ name: 'x', steps: [{ kind: 'watermark', text: 'PACKAGED', fontSize: 40, color: '#ff0000', opacity: 0.3, angle: 30, behind: false }, { kind: 'optimise', level: 'light' }] }))
    const r = spawnSync(exe, ['--batch', action, '--out', join(dir, 'out'), join(dir, 'in')], { env: { ...process.env, OPENPDF_E2E: '1', OPENPDF_E2E_USERDATA: join(dir, 'ud') }, encoding: 'utf8', timeout: 120000 })
    expect(r.status).toBe(0)
    const text = execFileSync('python', ['-c', 'import sys, pymupdf\nprint(pymupdf.open(sys.argv[1])[0].get_text())', join(dir, 'out', 'a_processed.pdf')]).toString()
    expect(text).toContain('PACKAGED')
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 })
  }
})
