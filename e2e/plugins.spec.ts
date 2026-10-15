import { _electron as electron, expect, test } from '@playwright/test'
import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(__dirname, '..')
const electronPath = createRequire(__filename)('electron') as unknown as string

const manifest = {
  apiVersion: 1,
  id: 'example.job-stamp',
  name: 'Job stamp',
  version: '1.0.0',
  author: 'Example Constructions',
  description: 'Stamps the job number found on the first page.',
  permits: ['watermark', 'properties'],
  actions: [{ id: 'stamp', label: 'Stamp the job number', script: 'stamp.js', params: [{ id: 'prefix', label: 'Prefix', default: 'JOB-' }] }]
}
const script = `function run(doc, params) {
  var m = /Job (\\d+)/.exec(doc.pages[0].text);
  if (!m) return { error: 'No job number found on the first page.' };
  return {
    message: 'Stamped ' + params.prefix + m[1],
    steps: [
      { kind: 'watermark', text: params.prefix + m[1], fontSize: 50, color: '#0000ff', opacity: 0.3, angle: 30 },
      { kind: 'properties', subject: 'Job ' + m[1] },
      { kind: 'flatten' }
    ]
  };
}`

function makePlugin(dir: string): string {
  const folder = join(dir, 'job-stamp')
  mkdirSync(folder, { recursive: true })
  writeFileSync(join(folder, 'plugin.json'), JSON.stringify(manifest))
  writeFileSync(join(folder, 'stamp.js'), script)
  return folder
}

function makePdf(path: string, text = 'Job 4471 Brisbane road upgrade'): void {
  execFileSync('python', ['-c', `import sys, pymupdf\nd = pymupdf.open()\nd.new_page(width=300, height=300).insert_text((50, 100), sys.argv[2], fontsize=14)\nd.save(sys.argv[1])`, path, text])
}

test('a plugin is installed from a folder, shows what it may do, and runs on the open document within those limits', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'openpdf-e2e-'))
  const plugin = makePlugin(dir)
  const pdf = join(dir, 'tender.pdf')
  makePdf(pdf)
  const app = await electron.launch({ args: ['.', pdf], cwd: root, env: { ...process.env, OPENPDF_E2E: '1', OPENPDF_E2E_USERDATA: join(dir, 'ud'), OPENPDF_E2E_DISCARD: '1', OPENPDF_E2E_PLUGIN_PICK: plugin } })
  try {
    const win = await app.firstWindow()
    const problems: string[] = []
    win.on('pageerror', (e) => problems.push(e.message))
    await expect(win.locator('.page')).toHaveCount(1)
    await win.getByRole('tab', { name: 'File', exact: true }).click()
    await win.getByRole('button', { name: 'Plugins' }).click()
    const d = win.getByRole('dialog', { name: 'Plugins' })
    await expect(d.getByText('No plugins are installed.')).toBeVisible()
    await d.getByRole('button', { name: 'From a folder…' }).click()
    const card = d.getByRole('group', { name: 'Job stamp' })
    await expect(card).toBeVisible()
    await expect(card.getByText('It can: add watermarks, change the document properties.')).toBeVisible()
    await card.getByRole('textbox', { name: 'Stamp the job number: Prefix' }).fill('TENDER-')
    await card.getByRole('button', { name: 'Run on this document' }).click()
    await expect(d.getByRole('status')).toContainText('Stamped TENDER-4471')
    // The flatten step is not in the manifest's permissions, so it was dropped and said so.
    await expect(d.getByRole('status')).toContainText('1 request was not allowed')
    await d.getByRole('button', { name: 'Close', exact: true }).first().click()
    await win.keyboard.press('Control+s')
    await expect(win.locator('.tab-dirty')).toHaveCount(0)
    const info = JSON.parse(execFileSync('python', ['-c', `import sys, json, pymupdf\nd = pymupdf.open(sys.argv[1])\nprint(json.dumps({"text": d[0].get_text(), "subject": d.metadata.get("subject")}))`, pdf]).toString())
    expect(info.text).toContain('TENDER-4471')
    expect(info.subject).toBe('Job 4471')
    expect(problems).toEqual([])
  } finally {
    await app.close()
    rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 })
  }
})

test('a plugin that finds nothing says so and leaves the document alone', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'openpdf-e2e-'))
  const plugin = makePlugin(dir)
  const pdf = join(dir, 'other.pdf')
  makePdf(pdf, 'No number in here')
  const app = await electron.launch({ args: ['.', pdf], cwd: root, env: { ...process.env, OPENPDF_E2E: '1', OPENPDF_E2E_USERDATA: join(dir, 'ud'), OPENPDF_E2E_DISCARD: '1', OPENPDF_E2E_PLUGIN_PICK: plugin } })
  try {
    const win = await app.firstWindow()
    await win.getByRole('tab', { name: 'File', exact: true }).click()
    await win.getByRole('button', { name: 'Plugins' }).click()
    const d = win.getByRole('dialog', { name: 'Plugins' })
    await d.getByRole('button', { name: 'From a folder…' }).click()
    await d.getByRole('button', { name: 'Run on this document' }).click()
    await expect(d.getByRole('alert')).toContainText('No job number found on the first page.')
    await expect(win.locator('.tab-dirty')).toHaveCount(0)
  } finally {
    await app.close()
    rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 })
  }
})

test('a plugin catalogue lists plugins, installs one after checking its checksum, and refuses a bad one', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'openpdf-e2e-'))
  const plugin = makePlugin(dir)
  const zipPath = join(dir, 'job-stamp.zip')
  execFileSync('python', ['-c', `import sys, zipfile\nz = zipfile.ZipFile(sys.argv[1], "w")\nz.write(sys.argv[2] + "/plugin.json", "plugin.json")\nz.write(sys.argv[2] + "/stamp.js", "stamp.js")\nz.close()`, zipPath, plugin])
  const zip = readFileSync(zipPath)
  const sum = createHash('sha256').update(zip).digest('hex')
  const server = createServer((req, res) => {
    if (req.url === '/catalogue.json') {
      const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ plugins: [{ ...manifest, url: `${base}/good.zip`, sha256: sum }, { ...manifest, id: 'example.bad-one', name: 'Tampered', url: `${base}/good.zip`, sha256: 'f'.repeat(64) }] }))
    } else if (req.url === '/good.zip') res.end(zip)
    else {
      res.statusCode = 404
      res.end()
    }
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const port = (server.address() as { port: number }).port
  const pdf = join(dir, 'a.pdf')
  makePdf(pdf)
  const app = await electron.launch({ args: ['.', pdf], cwd: root, env: { ...process.env, OPENPDF_E2E: '1', OPENPDF_E2E_USERDATA: join(dir, 'ud'), OPENPDF_E2E_DISCARD: '1' } })
  try {
    const win = await app.firstWindow()
    await win.getByRole('tab', { name: 'File', exact: true }).click()
    await win.getByRole('button', { name: 'Plugins' }).click()
    const d = win.getByRole('dialog', { name: 'Plugins' })
    await d.getByRole('textbox', { name: 'Catalogue address' }).fill(`http://127.0.0.1:${port}/catalogue.json`)
    await d.getByRole('button', { name: 'Browse catalogue' }).click()
    const cat = d.getByRole('list', { name: 'Catalogue' })
    await expect(cat.getByText('Tampered')).toBeVisible()
    await cat.locator('li', { hasText: 'Tampered' }).getByRole('button', { name: 'Install' }).click()
    await expect(d.getByRole('alert')).toContainText('does not match its checksum')
    await expect(d.getByText('No plugins are installed.')).toBeVisible()
    await cat.locator('li', { hasText: 'Job stamp' }).getByRole('button', { name: 'Install' }).click()
    await expect(d.getByRole('status')).toContainText('Installed Job stamp')
    await expect(d.getByRole('group', { name: 'Job stamp' })).toBeVisible()
    await d.getByRole('group', { name: 'Job stamp' }).getByRole('button', { name: 'Uninstall' }).click()
    await expect(d.getByText('No plugins are installed.')).toBeVisible()
  } finally {
    await app.close()
    server.close()
    rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 })
  }
})

test('a plugin action can be a step in a batch run from the command line', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'openpdf-e2e-'))
  const plugin = makePlugin(dir)
  mkdirSync(join(dir, 'ud', 'plugins'), { recursive: true })
  cpSync(plugin, join(dir, 'ud', 'plugins', manifest.id), { recursive: true })
  mkdirSync(join(dir, 'in'))
  makePdf(join(dir, 'in', 'job.pdf'))
  const action = join(dir, 'a.json')
  writeFileSync(action, JSON.stringify({ name: 'Plugin run', steps: [{ kind: 'plugin', plugin: manifest.id, action: 'stamp', params: { prefix: 'CLI-' } }] }))
  try {
    const r = spawnSync(electronPath, ['.', '--batch', action, '--out', join(dir, 'out'), join(dir, 'in')], { cwd: root, env: { ...process.env, OPENPDF_E2E: '1', OPENPDF_E2E_USERDATA: join(dir, 'ud') }, encoding: 'utf8', timeout: 120000 })
    expect(r.status).toBe(0)
    expect(readdirSync(join(dir, 'out'))).toEqual(['job_processed.pdf'])
    const text = execFileSync('python', ['-c', 'import sys, pymupdf\nprint(pymupdf.open(sys.argv[1])[0].get_text())', join(dir, 'out', 'job_processed.pdf')]).toString()
    expect(text).toContain('CLI-4471')
    expect(r.stdout).toContain('Stamped CLI-4471')
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 })
  }
})
