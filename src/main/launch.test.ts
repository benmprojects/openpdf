import { existsSync, readFileSync, rmSync } from 'node:fs'
import { dirname } from 'node:path'
import { describe, expect, it } from 'vitest'
import { launchWith, safeFileName } from './launch'

describe('safeFileName', () => {
  it('drops folders and reserved characters', () => {
    expect(safeFileName('..\\..\\evil.exe')).toBe('evil.exe')
    expect(safeFileName('a/b/c.docx')).toBe('c.docx')
    expect(safeFileName('re:port?.xlsx')).toBe('re_port_.xlsx')
    expect(safeFileName('  ')).toBe('file')
    expect(safeFileName('name. ')).toBe('name')
  })
})

describe('launchWith', () => {
  const data = new Uint8Array([1, 2, 3])
  it('refuses a file type with no program', async () => {
    const r = await launchWith([], 'a.docx', data)
    expect(r.ok).toBe(false)
  })
  it('refuses a program that is not where it was saved', async () => {
    const r = await launchWith([{ id: 'x', name: 'X', extensions: ['docx'], path: 'C:\\no-such-folder-openpdf\\x.exe' }], 'a.docx', data)
    expect(r).toMatchObject({ ok: false })
  })
  it('writes the file to a temporary folder and hands it to the program', async () => {
    // Any existing .exe will do: it is never run, the test replaces the launcher.
    const exe = process.execPath
    const calls: [string, string][] = []
    const r = await launchWith([{ id: 'n', name: 'Node', extensions: ['bin'], path: exe }], 'dir\\part.bin', data, (e, f) => void calls.push([e, f]))
    expect(r.ok).toBe(true)
    expect(calls).toHaveLength(1)
    expect(calls[0][0]).toBe(exe)
    expect(calls[0][1]).toMatch(/part\.bin$/)
    expect([...readFileSync(calls[0][1])]).toEqual([1, 2, 3])
    rmSync(dirname(calls[0][1]), { recursive: true, force: true })
    expect(existsSync(calls[0][1])).toBe(false)
  })
})
