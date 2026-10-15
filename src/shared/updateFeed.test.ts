import { describe, expect, it } from 'vitest'
import { feedAllowed } from './updateFeed'

describe('feedAllowed', () => {
  it('allows https, and http only on this computer', () => {
    expect(feedAllowed('https://updates.example.com/openpdf')).toBe(true)
    expect(feedAllowed('http://127.0.0.1:8080/feed')).toBe(true)
    expect(feedAllowed('http://localhost/feed')).toBe(true)
    expect(feedAllowed('http://updates.example.com/openpdf')).toBe(false)
  })
  it('refuses other schemes, addresses with a user name or password, and nonsense', () => {
    expect(feedAllowed('file:///C:/feed')).toBe(false)
    expect(feedAllowed('ftp://example.com/feed')).toBe(false)
    expect(feedAllowed('https://user:pass@example.com/feed')).toBe(false)
    expect(feedAllowed('not an address')).toBe(false)
    expect(feedAllowed('')).toBe(false)
  })
})
