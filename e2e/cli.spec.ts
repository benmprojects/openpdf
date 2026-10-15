import { expect, test } from '@playwright/test'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(__dirname, '..')
const electronPath = createRequire(__filename)('electron') as unknown as string

function run(dir: string, args: string[]) {
  return spawnSync(electronPath, ['.', ...args], { cwd: root, env: { ...process.env, OPENPDF_E2E: '1', OPENPDF_E2E_USERDATA: join(dir, 'ud') }, encoding: 'utf8', timeout: 180000 })
}

test('the command line runs an action over a folder, writes a report, and exits with a code', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'openpdf-e2e-'))
  try {
    mkdirSync(join(dir, 'in'))
    execFileSync('python', ['-c', `import sys, pymupdf\nfor n in ("one", "two"):\n    d = pymupdf.open()\n    d.new_page(width=300, height=300).insert_text((50, 100), "Document " + n, fontsize=14)\n    d.save(sys.argv[1] + "/" + n + ".pdf")`, join(dir, 'in')])
    const action = join(dir, 'stamp.json')
    writeFileSync(action, JSON.stringify({ name: 'Stamp', steps: [{ kind: 'watermark', text: 'FROM CLI', fontSize: 50, color: '#0000ff', opacity: 0.3, angle: 30, behind: false }, { kind: 'properties', author: 'Command line' }] }))
    const report = join(dir, 'report.json')

    const ok = run(dir, ['--batch', action, '--out', join(dir, 'out'), '--suffix', '_cli', '--report', report, join(dir, 'in')])
    expect(ok.status).toBe(0)
    expect(readdirSync(join(dir, 'out')).sort()).toEqual(['one_cli.pdf', 'two_cli.pdf'])
    const rep = JSON.parse(readFileSync(report, 'utf8'))
    expect(rep).toMatchObject({ processed: 2, failed: 0 })
    const info = JSON.parse(execFileSync('python', ['-c', `import sys, json, pymupdf\nd = pymupdf.open(sys.argv[1])\nprint(json.dumps({"author": d.metadata.get("author"), "text": d[0].get_text()}))`, join(dir, 'out', 'one_cli.pdf')]).toString())
    expect(info.author).toBe('Command line')
    expect(info.text).toContain('FROM CLI')
    expect(info.text).toContain('Document one')

    // A file that is not a PDF makes the exit code 1 but the others are still done.
    writeFileSync(join(dir, 'in', 'broken.pdf'), 'nope')
    const some = run(dir, ['--batch', action, '--out', join(dir, 'out2'), '--report', report, join(dir, 'in')])
    expect(some.status).toBe(1)
    expect(JSON.parse(readFileSync(report, 'utf8'))).toMatchObject({ processed: 2, failed: 1 })
    expect(readdirSync(join(dir, 'out2')).length).toBe(2)
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 })
  }
})

test('the command line explains a mistake and does not start the app', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'openpdf-e2e-'))
  try {
    const noAction = run(dir, ['--batch', 'No such action', join(dir, 'x.pdf')])
    expect(noAction.status).toBe(2)
    expect(noAction.stdout + noAction.stderr).toContain('no saved action called "No such action"')
    const noFiles = run(dir, ['--batch', 'x.json'])
    expect(noFiles.status).toBe(2)
    expect(noFiles.stdout).toContain('Give at least one file or folder')
    const help = run(dir, ['--help'])
    expect(help.status).toBe(0)
    expect(help.stdout).toContain('OpenPDF command line')
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 })
  }
})
