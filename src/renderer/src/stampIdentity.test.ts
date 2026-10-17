import { describe, expect, it } from 'vitest'
import { expandFields, hasFields } from './stampLogic'

describe('identity fields in stamps', () => {
  const now = new Date(2026, 9, 17)
  it('fills initials, organisation, email and title from the identity', () => {
    const out = expandFields('{initials} / {organisation} / {title} / {email}', { author: 'Test User', now, identity: { initials: 'TU', organisation: 'Example Pty Ltd', title: 'Engineer', email: 'a@example.com' } })
    expect(out).toBe('TU / Example Pty Ltd / Engineer / a@example.com')
  })
  it('gives nothing for an identity field that is not set', () => {
    expect(expandFields('[{initials}]', { author: 'A', now })).toBe('[]')
    expect(expandFields('[{organisation}]', { author: 'A', now, identity: { initials: 'A' } })).toBe('[]')
  })
  it('counts them as fields, so the stamp is filled in when placed', () => {
    expect(hasFields('Checked {initials}')).toBe(true)
    expect(hasFields('Checked')).toBe(false)
  })
})
