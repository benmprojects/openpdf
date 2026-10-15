import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import JSZip from 'jszip'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { fetchCatalogue, installFromCatalogue, installFromFolder, installFromZip, listPlugins, uninstallPlugin } from './plugins'

const manifest = { apiVersion: 1, id: 'test.stamp', name: 'Stamp', version: '1.0.0', permits: ['watermark'], actions: [{ id: 'go', label: 'Go', script: 'go.js' }] }
const script = 'function run(doc, params) { return { steps: [{ kind: "watermark", text: doc.fileName }] } }'

let root = ''
beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'openpdf-plugins-'))
})
afterAll(() => rmSync(root, { recursive: true, force: true }))

function makeFolder(name: string, m: unknown = manifest, files: Record<string, string> = { 'go.js': script }): string {
  const dir = join(root, 'src-' + name)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'plugin.json'), JSON.stringify(m))
  for (const [f, c] of Object.entries(files)) writeFileSync(join(dir, f), c)
  return dir
}

async function zipOf(files: Record<string, string>): Promise<Uint8Array> {
  const z = new JSZip()
  for (const [n, c] of Object.entries(files)) z.file(n, c)
  return new Uint8Array(await z.generateAsync({ type: 'uint8array' }))
}

describe('installing', () => {
  it('installs a folder, lists it with its scripts, and uninstalls it', async () => {
    const plugins = join(root, 'plugins-a')
    await installFromFolder(plugins, makeFolder('a'))
    const list = await listPlugins(plugins)
    expect(list.map((p) => p.manifest.id)).toEqual(['test.stamp'])
    expect(list[0].scripts.go).toContain('function run')
    await uninstallPlugin(plugins, 'test.stamp')
    expect(await listPlugins(plugins)).toEqual([])
  })

  it('keeps only the manifest and the scripts it names', async () => {
    const plugins = join(root, 'plugins-b')
    await installFromFolder(plugins, makeFolder('b', manifest, { 'go.js': script, 'junk.exe': 'MZ', 'other.js': 'x' }))
    expect(readdirSync(join(plugins, 'test.stamp')).sort()).toEqual(['go.js', 'plugin.json'])
  })

  it('refuses a plugin with a missing script, a bad manifest or an oversized script', async () => {
    const plugins = join(root, 'plugins-c')
    await expect(installFromFolder(plugins, makeFolder('c1', manifest, {}))).rejects.toThrow(/go\.js .* missing/)
    await expect(installFromFolder(plugins, makeFolder('c2', { ...manifest, id: 'Bad Id' }))).rejects.toThrow(/plugin id/)
    await expect(installFromFolder(plugins, makeFolder('c3', manifest, { 'go.js': 'x'.repeat(300 * 1024) }))).rejects.toThrow(/too large/)
  })

  it('installs from a zip, whether the files are at the top or inside a folder, and refuses unsafe paths', async () => {
    const plugins = join(root, 'plugins-d')
    expect((await installFromZip(plugins, await zipOf({ 'plugin.json': JSON.stringify(manifest), 'go.js': script }))).id).toBe('test.stamp')
    await uninstallPlugin(plugins, 'test.stamp')
    expect((await installFromZip(plugins, await zipOf({ 'stamp/plugin.json': JSON.stringify(manifest), 'stamp/go.js': script }))).id).toBe('test.stamp')
    await expect(installFromZip(plugins, new Uint8Array([1, 2, 3]))).rejects.toThrow(/not a valid zip/)
    await expect(installFromZip(plugins, await zipOf({ 'readme.txt': 'hi' }))).rejects.toThrow(/no plugin\.json/)
  })

  it('replaces an older version', async () => {
    const plugins = join(root, 'plugins-e')
    await installFromFolder(plugins, makeFolder('e1'))
    await installFromFolder(plugins, makeFolder('e2', { ...manifest, version: '2.0.0' }))
    expect((await listPlugins(plugins))[0].manifest.version).toBe('2.0.0')
  })
})

describe('catalogue', () => {
  const entry = (over: Record<string, unknown> = {}) => ({ id: 'test.stamp', name: 'Stamp', version: '1.0.0', url: 'https://example.test/stamp.zip', sha256: 'a'.repeat(64), ...over })
  const respond = (body: unknown) => (async () => new Response(JSON.stringify(body))) as unknown as typeof fetch

  it('reads entries, dropping ones with a bad checksum or address', async () => {
    const list = await fetchCatalogue('https://store.example.test/c.json', respond({ plugins: [entry(), entry({ id: 'x.y', sha256: 'zz' }), entry({ id: 'p.q', url: 'http://remote.example.test/p.zip' })] }))
    expect(list.map((e) => e.id)).toEqual(['test.stamp'])
    await expect(fetchCatalogue('http://remote.example.test/c.json', respond({}))).rejects.toThrow(/https/)
    await expect(fetchCatalogue('https://store.example.test/c.json', respond({ nope: 1 }))).rejects.toThrow(/not a plugin catalogue/)
  })

  it('installs only when the download matches its checksum', async () => {
    const plugins = join(root, 'plugins-f')
    const zip = await zipOf({ 'plugin.json': JSON.stringify(manifest), 'go.js': script })
    const sum = createHash('sha256').update(zip).digest('hex')
    const serve = (async () => new Response(Buffer.from(zip))) as unknown as typeof fetch
    expect((await installFromCatalogue(plugins, entry({ sha256: sum }) as never, serve)).id).toBe('test.stamp')
    await uninstallPlugin(plugins, 'test.stamp')
    await expect(installFromCatalogue(plugins, entry({ sha256: 'b'.repeat(64) }) as never, serve)).rejects.toThrow(/checksum/)
    expect(await listPlugins(plugins)).toEqual([])
    // A catalogue entry for one plugin that downloads another is refused and removed.
    await expect(installFromCatalogue(plugins, entry({ id: 'other.plugin', sha256: sum }) as never, serve)).rejects.toThrow(/not the one/)
    expect(await listPlugins(plugins)).toEqual([])
  })
})
