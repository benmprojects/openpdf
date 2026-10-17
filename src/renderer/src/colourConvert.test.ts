import { deflateSync } from 'node:zlib'
import { PDFDict, PDFDocument, PDFName, PDFNumber, PDFRawStream, PDFRef } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import { convertColours, convertContent, convertSamples, convertValue, describeColourReport } from './colourConvert'
import { pageContent } from './pageContent'

const noSpace = () => null

describe('convertValue', () => {
  it('makes grey from the usual weights and keeps pure colours sensible', () => {
    expect(convertValue('rgb', 'gray', [1, 0, 0])[0]).toBeCloseTo(0.3)
    expect(convertValue('rgb', 'gray', [1, 1, 1])[0]).toBeCloseTo(1)
    expect(convertValue('cmyk', 'gray', [0, 0, 0, 1])[0]).toBeCloseTo(0)
    expect(convertValue('rgb', 'cmyk', [1, 0, 0]).map((x) => Math.round(x * 100) / 100)).toEqual([0, 1, 1, 0])
    expect(convertValue('rgb', 'cmyk', [0, 0, 0])).toEqual([0, 0, 0, 1])
    expect(convertValue('cmyk', 'rgb', [0, 1, 1, 0])).toEqual([1, 0, 0])
    expect(convertValue('gray', 'cmyk', [0.25])).toEqual([0, 0, 0, 0.75])
  })
})

describe('convertContent', () => {
  it('rewrites device colour operators and leaves the rest byte for byte', () => {
    const src = 'q 1 0 0 rg 0 0 1 RG 10 10 50 50 re B Q 0.5 g 0 0 5 5 re f'
    const r = convertContent(src, 'gray', noSpace)
    expect(r.src).toBe('q 0.3 g 0.11 G 10 10 50 50 re B Q 0.5 g 0 0 5 5 re f')
    expect(r.changed).toBe(2)
  })
  it('follows colour spaces set with cs and converts the sc operands', () => {
    const r = convertContent('/CS0 cs 0.2 0.4 0.6 sc 0 0 9 9 re f', 'gray', (n) => (n === 'CS0' ? 'rgb' : null))
    expect(r.src).toBe('/DeviceGray cs 0.362 sc 0 0 9 9 re f')
  })
  it('counts spot colours, patterns, shadings and inline pictures it cannot convert', () => {
    const r = convertContent('/Sep cs 1 scn /Pattern cs /P0 scn /Sh0 sh BI /W 1 /H 1 ID x EI', 'gray', noSpace)
    expect(r.changed).toBe(0)
    expect(r.spot).toBeGreaterThanOrEqual(2)
    expect(r.shadings).toBe(1)
    expect(r.inlineImages).toBe(1)
  })
  it('restores the colour space with Q', () => {
    const r = convertContent('q /CS0 cs Q 1 sc', 'gray', (n) => (n === 'CS0' ? 'rgb' : null))
    expect(r.src).toBe('q /DeviceGray cs Q 1 sc')
  })
  it('converts to CMYK and to RGB', () => {
    expect(convertContent('1 0 0 rg', 'cmyk', noSpace).src).toBe('0 1 1 0 k')
    expect(convertContent('0 0 0 1 k 0 0 0 0 K', 'rgb', noSpace).src).toBe('0 0 0 rg 1 1 1 RG')
  })
})

describe('convertSamples', () => {
  it('converts between spaces', () => {
    expect([...convertSamples(Uint8Array.of(255, 0, 0, 0, 0, 255), 'rgb', 'gray', 2)]).toEqual([76, 27])
    expect([...convertSamples(Uint8Array.of(10), 'gray', 'rgb', 1)]).toEqual([10, 10, 10])
    expect([...convertSamples(Uint8Array.of(0, 0, 0, 255), 'cmyk', 'gray', 1)]).toEqual([0])
    expect([...convertSamples(Uint8Array.of(0, 0, 0), 'rgb', 'cmyk', 1)]).toEqual([0, 0, 0, 255])
  })
})

describe('convertColours', () => {
  it('converts page colours and Flate pictures in a document', async () => {
    const doc = await PDFDocument.create()
    const page = doc.addPage([100, 100])
    const ctx = doc.context
    const rgb = Uint8Array.of(255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255)
    const img = ctx.register(ctx.stream(deflateSync(rgb), { Type: 'XObject', Subtype: 'Image', Width: 2, Height: 2, ColorSpace: 'DeviceRGB', BitsPerComponent: 8, Filter: 'FlateDecode' }))
    page.node.setXObject(PDFName.of('Im0'), img)
    page.node.set(PDFName.of('Contents'), ctx.register(ctx.flateStream('1 0 0 rg 0 0 50 50 re f q 50 0 0 50 0 0 cm /Im0 Do Q')))
    const out = await convertColours(await doc.save(), 'gray')
    expect(out.report.operators).toBe(1)
    expect(out.report.pictures).toBe(1)
    const back = await PDFDocument.load(out.bytes)
    expect(pageContent(back.getPage(0))).toContain('0.3 g')
    const xo = back.getPage(0).node.Resources()!.lookup(PDFName.of('XObject'), PDFDict)
    const im = back.context.lookup(xo.get(PDFName.of('Im0')) as PDFRef) as PDFRawStream
    expect(im.dict.lookup(PDFName.of('ColorSpace'))).toBe(PDFName.of('DeviceGray'))
    expect(im.dict.lookupMaybe(PDFName.of('Width'), PDFNumber)?.asNumber()).toBe(2)
    expect(describeColourReport(out.report)[0]).toContain('greyscale')
  })
})
