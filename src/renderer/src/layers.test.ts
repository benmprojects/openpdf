import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { printHiddenLayers, readLayers, withHiddenLayers } from './layers'

const dir = mkdtempSync(join(tmpdir(), 'openpdf-layers-'))
const file = join(dir, 'feature.pdf')
execFileSync('npx', ['tsx', 'scripts/make-feature-pdf.mts', file], { shell: true })
const bytes = new Uint8Array(readFileSync(file))

describe('layers', () => {
  it('reads names and default visibility', async () => {
    const layers = await readLayers(bytes)
    expect(layers.map((l) => [l.name, l.defaultOn])).toEqual([
      ['Notes layer', true],
      ['Hidden layer', false]
    ])
  })
  it('writes a copy with the chosen layers hidden', async () => {
    const [notes, hidden] = await readLayers(bytes)
    const copy = await withHiddenLayers(bytes, new Set([notes.key]))
    const again = await readLayers(copy)
    expect(again.map((l) => l.defaultOn)).toEqual([false, true])
    expect(again.map((l) => l.key)).toEqual([notes.key, hidden.key])
  })
  it('returns no layers for a document without optional content', async () => {
    const plain = join(dir, 'plain.pdf')
    execFileSync('python', ['scripts/make-test-pdf.py', plain])
    expect(await readLayers(new Uint8Array(readFileSync(plain)))).toEqual([])
  })
})

describe('printHiddenLayers', () => {
  it('prints the view, every layer, or the file as it opens', () => {
    const hidden = new Set(['5 0'])
    expect(printHiddenLayers('visible', hidden)).toBe(hidden)
    expect(printHiddenLayers('visible', null)).toBeNull()
    expect([...(printHiddenLayers('all', hidden) ?? ['x'])]).toEqual([])
    expect(printHiddenLayers('file', hidden)).toBeNull()
  })
})
