import { describe, expect, it } from 'vitest'
import { ALL_ALLOWED, describeRestrictions, encryptArgs, parseEncryptionJson, restrictsEditing } from './pdfSecurity'

/** What `qpdf --json=latest --json-key=encrypt` writes for a file opened with its user password. */
const json = (over: Record<string, unknown> = {}, caps: Record<string, boolean> = {}, params: Record<string, unknown> = {}) =>
  JSON.stringify({
    version: 2,
    encrypt: {
      capabilities: { accessibility: true, extract: false, modify: false, modifyannotations: false, modifyassembly: false, modifyforms: false, modifyother: false, printhigh: false, printlow: true, ...caps },
      encrypted: true,
      ownerpasswordmatched: false,
      parameters: { P: -3388, R: 6, V: 5, bits: 256, method: 'AESv3', streammethod: 'AESv3' , ...params },
      userpasswordmatched: true,
      ...over
    }
  })

describe('encryptArgs', () => {
  it('turns the options into qpdf arguments', () => {
    expect(encryptArgs({ userPassword: 'u', ownerPassword: 'o', keyLength: 256, permissions: ALL_ALLOWED })).toEqual([
      '--encrypt', 'u', 'o', '256', '--print=full', '--extract=y', '--accessibility=y', '--annotate=y', '--form=y', '--assemble=y', '--modify-other=y', '--'
    ])
    const a = encryptArgs({ userPassword: '', ownerPassword: 'o', keyLength: 128, permissions: { ...ALL_ALLOWED, print: 'none', extract: false, modifyOther: false } })
    expect(a).toContain('--print=none')
    expect(a).toContain('--extract=n')
    expect(a).toContain('--modify-other=n')
    expect(a).toContain('--use-aes=y')
    expect(a.slice(0, 4)).toEqual(['--encrypt', '', 'o', '128'])
  })
})

describe('parseEncryptionJson', () => {
  it('reads what a user password allows', () => {
    const i = parseEncryptionJson(json(), 0)
    expect(i).toMatchObject({ state: 'open', revision: 6, method: 'AES-256', ownerPassword: false })
    expect(i.permissions).toEqual({ print: 'low', extract: false, accessibility: true, annotate: false, form: false, assemble: false, modifyOther: false })
  })

  it('notices the owner password and full permissions', () => {
    const i = parseEncryptionJson(json({ ownerpasswordmatched: true }, { printhigh: true, extract: true, modifyannotations: true, modifyforms: true, modifyassembly: true, modifyother: true }), 0)
    expect(i.ownerPassword).toBe(true)
    expect(i.permissions).toEqual({ ...ALL_ALLOWED })
    expect(restrictsEditing(i.permissions!)).toBe(false)
  })

  it('says when a file is not encrypted or needs a password', () => {
    expect(parseEncryptionJson(json({ encrypted: false }), 0).state).toBe('none')
    expect(parseEncryptionJson(undefined, 2).state).toBe('password')
    expect(parseEncryptionJson('', 0).state).toBe('password')
    expect(parseEncryptionJson('not json', 0).state).toBe('password')
    expect(parseEncryptionJson(json(), 2).state).toBe('password')
  })

  it('knows older encryption methods', () => {
    expect(parseEncryptionJson(json({}, {}, { method: 'AESv2', R: 4 }), 0)).toMatchObject({ method: 'AES-128', revision: 4 })
    expect(parseEncryptionJson(json({}, {}, { method: 'RC4' }), 0).method).toBe('RC4')
  })

  it('treats no printing capability as no printing', () => {
    expect(parseEncryptionJson(json({}, { printlow: false, printhigh: false }), 0).permissions?.print).toBe('none')
  })
})

describe('restrictions', () => {
  it('says whether editing is stopped, and describes what is forbidden', () => {
    expect(restrictsEditing(ALL_ALLOWED)).toBe(false)
    expect(restrictsEditing({ ...ALL_ALLOWED, form: false })).toBe(true)
    expect(restrictsEditing({ ...ALL_ALLOWED, print: 'none', extract: false })).toBe(false)
    expect(describeRestrictions(ALL_ALLOWED)).toBe('')
    expect(describeRestrictions({ ...ALL_ALLOWED, print: 'low', extract: false, assemble: false })).toBe('high quality printing, copying text and images, changing pages')
  })
})
