import { describe, expect, it } from 'vitest'
import { ALL_ALLOWED } from './pdfSecurity'
import { cleanSecurityPolicies, describePolicy, savePolicy, type SecurityPolicy } from './securityPolicy'

const policy = (over: Partial<SecurityPolicy> = {}): SecurityPolicy => ({ id: 'a', name: 'No copying', needOpen: false, restrict: true, permissions: { ...ALL_ALLOWED, extract: false }, level: 256, ...over })

describe('security policies', () => {
  it('keeps valid ones and drops the rest', () => {
    const out = cleanSecurityPolicies([policy(), { id: '', name: 'x' }, { id: 'b', name: '  ' }, null, 4, policy({ id: 'a', name: 'Duplicate id' }), { id: 'c', name: 'Plain' }])
    expect(out.map((p) => p.id)).toEqual(['a', 'c'])
    expect(out[1]).toMatchObject({ needOpen: false, restrict: false, level: 256, permissions: ALL_ALLOWED })
  })

  it('never carries a password through, even one that was added to the data', () => {
    const out = cleanSecurityPolicies([{ ...policy(), userPassword: 'secret', ownerPassword: 'secret2', password: 'x' }])
    expect(JSON.stringify(out)).not.toMatch(/secret|password/i)
    expect(Object.keys(out[0]).sort()).toEqual(['id', 'level', 'name', 'needOpen', 'permissions', 'restrict'])
  })

  it('cleans odd values', () => {
    const [p] = cleanSecurityPolicies([{ id: 'a', name: 'n'.repeat(200), needOpen: 'yes', level: 64, permissions: { print: 'maybe', extract: 'no', annotate: false } }])
    expect(p.name).toHaveLength(80)
    expect(p.needOpen).toBe(false)
    expect(p.level).toBe(256)
    expect(p.permissions).toEqual({ ...ALL_ALLOWED, annotate: false })
    expect(cleanSecurityPolicies('x')).toEqual([])
  })

  it('limits how many are kept', () => {
    const many = Array.from({ length: 80 }, (_, i) => policy({ id: `p${i}`, name: `P${i}` }))
    expect(cleanSecurityPolicies(many)).toHaveLength(50)
  })

  it('saving under an existing name replaces it', () => {
    let n = 0
    const first = savePolicy([], { ...policy(), name: 'Tender' }, () => `id${++n}`)
    expect(first).toHaveLength(1)
    const second = savePolicy(first, { ...policy({ restrict: false }), name: ' tender ' }, () => `id${++n}`)
    expect(second).toHaveLength(1)
    expect(second[0]).toMatchObject({ id: 'id1', name: 'tender', restrict: false })
    expect(savePolicy(second, { ...policy(), name: 'Other' }, () => `id${++n}`).map((p) => p.id)).toEqual(['id1', 'id2'])
  })

  it('describes what a policy does', () => {
    expect(describePolicy(policy())).toBe('no copying; AES-256')
    expect(describePolicy(policy({ needOpen: true, restrict: false, level: 128 }))).toBe('password to open; AES-128')
    expect(describePolicy(policy({ needOpen: false, restrict: false }))).toBe('no protection; AES-256')
    expect(describePolicy(policy({ permissions: { ...ALL_ALLOWED, print: 'none', modifyOther: false } }))).toBe('no printing, no editing; AES-256')
  })
})
