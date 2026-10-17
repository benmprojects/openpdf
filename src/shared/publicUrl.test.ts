import { describe, expect, it } from 'vitest'
import { isPrivateHost, publicHttpUrl } from './publicUrl'

describe('addresses taken from a certificate', () => {
  it('accepts public http and https addresses', () => {
    expect(publicHttpUrl('http://ocsp.example.com/ocsp')?.href).toBe('http://ocsp.example.com/ocsp')
    expect(publicHttpUrl('https://crl.example.org/a.crl')).not.toBeNull()
    expect(publicHttpUrl('http://93.184.216.34/x')).not.toBeNull()
    expect(publicHttpUrl('http://[2606:2800:220:1:248:1893:25c8:1946]/x')).not.toBeNull()
  })

  it('refuses this computer and private networks', () => {
    for (const h of ['localhost', 'a.localhost', '127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', 'printer', 'nas.local', 'host.internal', '[::1]', '[fe80::1]', '[fd00::1]', '[::ffff:127.0.0.1]', '::', '224.0.0.1']) {
      expect(isPrivateHost(h), h).toBe(true)
    }
    expect(publicHttpUrl('http://127.0.0.1:8080/ocsp')).toBeNull()
    expect(publicHttpUrl('http://169.254.169.254/latest/meta-data')).toBeNull()
    expect(publicHttpUrl('http://localhost/a')).toBeNull()
  })

  it('accepts the edges of the private ranges that are public', () => {
    expect(isPrivateHost('172.15.0.1')).toBe(false)
    expect(isPrivateHost('172.32.0.1')).toBe(false)
    expect(isPrivateHost('100.63.0.1')).toBe(false)
    expect(isPrivateHost('11.0.0.1')).toBe(false)
  })

  it('refuses other schemes, credentials and odd number forms', () => {
    expect(publicHttpUrl('ldap://dir.example.com/cn=x')).toBeNull()
    expect(publicHttpUrl('file:///C:/x')).toBeNull()
    expect(publicHttpUrl('ftp://example.com/x')).toBeNull()
    expect(publicHttpUrl('http://user:pw@example.com/')).toBeNull()
    expect(publicHttpUrl('not a url')).toBeNull()
    expect(publicHttpUrl('http://2130706433/')).toBeNull()
    expect(publicHttpUrl('http://0x7f.1/')).toBeNull()
  })
})
