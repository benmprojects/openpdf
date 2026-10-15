import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadAction, parseCli } from './cli'

describe('parseCli', () => {
  it('is not a command-line run without --batch, --help or --list-actions', () => {
    expect(parseCli([])).toBeNull()
    expect(parseCli(['C:\\docs\\a.pdf'])).toBeNull()
  })

  it('reads a batch run', () => {
    expect(parseCli(['--batch', 'Stamp and number', '--out', 'C:\\out', '--suffix', '_x', '-r', '--report', 'r.json', 'a.pdf', 'C:\\folder'])).toEqual({
      kind: 'batch',
      action: 'Stamp and number',
      out: 'C:\\out',
      suffix: '_x',
      recursive: true,
      report: 'r.json',
      inputs: ['a.pdf', 'C:\\folder']
    })
    expect(parseCli(['a.pdf', '--batch', 'act.json', 'b.pdf'])).toMatchObject({ kind: 'batch', action: 'act.json', out: null, suffix: '_processed', recursive: false, inputs: ['a.pdf', 'b.pdf'] })
  })

  it('allows an empty suffix', () => {
    expect(parseCli(['--batch', 'x', '--suffix', '', 'a.pdf'])).toMatchObject({ suffix: '' })
  })

  it('explains what is wrong', () => {
    expect(parseCli(['--batch'])).toMatchObject({ kind: 'error' })
    expect(parseCli(['--batch', 'x'])).toEqual({ kind: 'error', message: 'Give at least one file or folder to process.' })
    expect(parseCli(['--batch', 'x', '--out', 'a.pdf'])).toMatchObject({ kind: 'error' })
    expect(parseCli(['--batch', 'x', '--bogus', 'a.pdf'])).toEqual({ kind: 'error', message: 'Unknown option --bogus.' })
  })

  it('knows help and list', () => {
    expect(parseCli(['--help'])).toEqual({ kind: 'help' })
    expect(parseCli(['--list-actions'])).toEqual({ kind: 'list' })
  })
})

describe('loadAction', () => {
  it('finds a saved action by name, ignoring case, and reads action files', async () => {
    const saved = [{ name: 'Flatten', steps: [{ kind: 'flatten' as const }] }]
    expect((await loadAction('flatten', saved)).steps).toHaveLength(1)
    await expect(loadAction('nope', saved)).rejects.toThrow(/no saved action called "nope"/)
    const dir = mkdtempSync(join(tmpdir(), 'openpdf-cli-'))
    try {
      writeFileSync(join(dir, 'a.json'), JSON.stringify({ name: 'From file', steps: [{ kind: 'pdfa' }] }))
      expect((await loadAction('a.json', [], dir)).name).toBe('From file')
      writeFileSync(join(dir, 'b.json'), JSON.stringify({ steps: [] }))
      await expect(loadAction('b.json', [], dir)).rejects.toThrow(/not a batch action/)
      await expect(loadAction('missing.json', [], dir)).rejects.toThrow(/could not be read/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
