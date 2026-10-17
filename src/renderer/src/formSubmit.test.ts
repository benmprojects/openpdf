import { describe, expect, it } from 'vitest'
import { htmlFormBody, submitPayload, submitUrl } from './formSubmit'

const entries = [
  { name: 'client', value: 'Smith & Sons' },
  { name: 'agree', value: 'Yes' },
  { name: 'newsletter', value: 'Off' },
  { name: 'sites', value: ['North', 'South depot'] },
  { name: 'note', value: 'caf\u00e9 100%' }
]

describe('submit form', () => {
  it('accepts web addresses only', () => {
    expect(submitUrl('https://example.org/form')?.hostname).toBe('example.org')
    expect(submitUrl(' http://example.org ')?.protocol).toBe('http:')
    expect(submitUrl('file:///C:/secret.txt')).toBeNull()
    expect(submitUrl('mailto:a@example.org')).toBeNull()
    expect(submitUrl('not a url')).toBeNull()
  })

  it('encodes an HTML form body and leaves out unticked boxes', () => {
    expect(htmlFormBody(entries)).toBe('client=Smith+%26+Sons&agree=Yes&sites=North&sites=South+depot&note=caf%C3%A9+100%25')
  })

  it('builds each format with its content type', () => {
    const x = submitPayload('xfdf', entries, 'form.pdf')
    expect(x.contentType).toBe('application/vnd.adobe.xfdf')
    expect(new TextDecoder().decode(x.body)).toContain('<field name="client"><value>Smith &amp; Sons</value></field>')
    const f = submitPayload('fdf', entries, 'form.pdf')
    expect(f.contentType).toBe('application/vnd.fdf')
    expect(new TextDecoder().decode(f.body).startsWith('%FDF-1.2')).toBe(true)
    const h = submitPayload('html', entries, 'form.pdf')
    expect(h.contentType).toMatch(/^application\/x-www-form-urlencoded/)
    const pdf = new Uint8Array([37, 80, 68, 70])
    expect(submitPayload('pdf', entries, 'form.pdf', pdf)).toEqual({ contentType: 'application/pdf', body: pdf })
    expect(() => submitPayload('pdf', entries, 'form.pdf')).toThrow()
  })
})
