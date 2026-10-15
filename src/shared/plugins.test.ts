import { describe, expect, it } from 'vitest'
import { normaliseResult, normaliseStep, validateManifest } from './plugins'

const good = {
  apiVersion: 1,
  id: 'example.job-stamp',
  name: 'Job stamp',
  version: '1.0.0',
  author: 'Example',
  permits: ['watermark', 'properties'],
  actions: [{ id: 'stamp', label: 'Stamp the job number', script: 'stamp.js', params: [{ id: 'prefix', label: 'Prefix', default: 'JOB-' }] }]
}

describe('validateManifest', () => {
  it('accepts a good manifest', () => {
    const r = validateManifest(good)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.manifest.actions[0].params).toEqual([{ id: 'prefix', label: 'Prefix', default: 'JOB-' }])
  })

  it('says what is wrong, in words', () => {
    const bad = (over: Record<string, unknown>) => {
      const r = validateManifest({ ...good, ...over })
      return r.ok ? 'ok' : r.error
    }
    expect(bad({ apiVersion: 2 })).toMatch(/API version 2/)
    expect(bad({ id: 'Bad Id' })).toMatch(/plugin id/)
    expect(bad({ permits: [] })).toMatch(/permits/)
    expect(bad({ permits: ['security'] })).toMatch(/permits/)
    expect(bad({ actions: [] })).toMatch(/1 and 20/)
    expect(bad({ actions: [{ id: 'a', label: 'A', script: '../evil.js' }] })).toMatch(/no folders/)
    expect(bad({ actions: [{ id: 'a', label: 'A', script: 'a.js' }, { id: 'a', label: 'B', script: 'b.js' }] })).toMatch(/same id/)
    expect(validateManifest(null).ok).toBe(false)
  })
})

describe('normaliseStep', () => {
  it('only lets through steps the manifest permits', () => {
    expect(normaliseStep({ kind: 'watermark', text: 'DRAFT' }, ['watermark'])).toMatchObject({ kind: 'watermark', text: 'DRAFT' })
    expect(normaliseStep({ kind: 'watermark', text: 'DRAFT' }, ['properties'])).toBeNull()
    // Steps that could harm or leak are never available to plugins, even if a manifest lists them.
    expect(normaliseStep({ kind: 'security', userPassword: 'x' }, ['security'])).toBeNull()
    expect(normaliseStep({ kind: 'plugin' }, ['plugin'])).toBeNull()
    expect(normaliseStep({ kind: 'ocr' }, ['ocr'])).toBeNull()
  })

  it('limits numbers and colours and drops empty marks', () => {
    expect(normaliseStep({ kind: 'watermark', text: 'X', fontSize: 99999, opacity: 7, angle: 500, color: 'red' }, ['watermark'])).toMatchObject({ fontSize: 300, opacity: 1, angle: 90, color: '#cc0000' })
    expect(normaliseStep({ kind: 'watermark', text: '   ' }, ['watermark'])).toBeNull()
    expect(normaliseStep({ kind: 'headerFooter', slots: { bc: '' } }, ['headerFooter'])).toBeNull()
    expect(normaliseStep({ kind: 'headerFooter', slots: { bc: 'Page <<page>>', zz: 'ignored' } }, ['headerFooter'])).toMatchObject({ slots: { bc: 'Page <<page>>' } })
    expect(normaliseStep({ kind: 'rotate', degrees: 45 }, ['rotate'])).toBeNull()
  })

  it('keeps only string properties', () => {
    expect(normaliseStep({ kind: 'properties', title: 'T', author: 5, extra: 'x' }, ['properties'])).toEqual({ kind: 'properties', title: 'T' })
  })
})

describe('normaliseResult', () => {
  it('collects the allowed steps, counts the dropped ones, and carries the message', () => {
    const r = normaliseResult({ message: 'Stamped JOB-12', steps: [{ kind: 'watermark', text: 'JOB-12' }, { kind: 'flatten' }, { kind: 'bogus' }] }, ['watermark'])
    expect(r.steps).toHaveLength(1)
    expect(r.dropped).toBe(2)
    expect(r.message).toBe('Stamped JOB-12')
  })
  it('passes on a plugin error and rejects nonsense', () => {
    expect(normaliseResult({ error: 'No job number found' }, ['watermark']).error).toBe('No job number found')
    expect(normaliseResult('hello', ['watermark']).error).toBeTruthy()
    expect(normaliseResult({ steps: Array.from({ length: 50 }, () => ({ kind: 'flatten' })) }, ['flatten']).steps).toHaveLength(20)
  })
})
