import { describe, expect, it } from 'vitest'
import type { PathDraw } from './content'
import { detectFields, nameFromLabel, nameSuggestions, type DetectPage, type Glyph } from './formDetect'

/** Glyphs for a string whose baseline is at `y` (display space, y down), each 0.5 x size wide. */
function text(s: string, x: number, y: number, size = 10): Glyph[] {
  return Array.from(s).map((ch, i) => ({ ch, x0: x + i * size * 0.5, x1: x + (i + 1) * size * 0.5, y0: y - size * 0.8, y1: y + size * 0.2 }))
}

const base = { clips: false, ctm: [1, 0, 0, 1, 0, 0] as PathDraw['ctm'], first: 0, paint: 1, fill: null, lineWidth: 1 }
const rect = (x: number, y: number, w: number, h: number, over: Partial<PathDraw> = {}): PathDraw => ({ ...base, bbox: { x0: x, y0: y, x1: x + w, y1: y + h }, shape: 'rect', stroked: true, filled: false, ...over })
const line = (x: number, y: number, w: number, over: Partial<PathDraw> = {}): PathDraw => ({ ...base, bbox: { x0: x, y0: y, x1: x + w, y1: y }, shape: 'line', stroked: true, filled: false, ...over })

const page = (over: Partial<DetectPage>): DetectPage => ({ page: 0, draws: [], toDisplay: (x, y) => [x, y], glyphs: [], existing: [], ...over })

describe('detectFields', () => {
  it('finds an underscore blank and labels it from the text to its left', () => {
    const glyphs = [...text('Full name:', 72, 100), ...text('____________', 140, 100)]
    const found = detectFields(page({ glyphs }))
    expect(found).toHaveLength(1)
    expect(found[0]).toMatchObject({ type: 'text', label: 'Full name', source: 'blank' })
    expect(found[0].rect.x).toBeCloseTo(140)
    expect(found[0].rect.w).toBeCloseTo(60)
  })

  it('finds a dotted leader but not a short run of dots', () => {
    const dots = [...text('Date', 72, 100), ...text('..........', 120, 100), ...text('Etc...', 72, 140)]
    const found = detectFields(page({ glyphs: dots }))
    expect(found).toHaveLength(1)
    expect(found[0].label).toBe('Date')
  })

  it('finds a rule with a label to its left or a caption below, and ignores one with no label', () => {
    const glyphs = [...text('Phone', 72, 200), ...text('Signature', 300, 262)]
    const draws = [line(120, 202, 120), line(300, 250, 140), line(72, 40, 450)]
    const found = detectFields(page({ glyphs, draws }))
    expect(found.map((f) => f.label)).toEqual(['Phone', 'Signature'])
    expect(found[0].rect.y).toBeCloseTo(186)
    expect(found[0].rect.h).toBe(17)
    // The long header rule near the top has no label: left alone.
    expect(found.every((f) => f.rect.y > 100)).toBe(true)
  })

  it('finds an empty box with a label to its left or a caption above it, and skips frames, fills and tiny boxes', () => {
    const glyphs = [...text('Address', 72, 322), ...text('Comments', 120, 372)]
    const draws = [
      rect(130, 308, 220, 20),
      rect(120, 380, 300, 60),
      rect(60, 500, 400, 20, { filled: true, fill: [0.2, 0.4, 0.8], stroked: false }),
      rect(130, 600, 20, 8),
      rect(30, 700, 500, 90)
    ]
    const found = detectFields(page({ glyphs, draws }))
    expect(found.map((f) => [f.label, f.source])).toEqual([
      ['Address', 'box'],
      ['Comments', 'box']
    ])
  })

  it('takes a white-filled outlined box, but not one filled with a colour', () => {
    const glyphs = [...text('Name', 72, 122), ...text('Site', 72, 162)]
    const draws = [rect(130, 108, 200, 20, { filled: true, fill: [1, 1, 1] }), rect(130, 148, 200, 20, { filled: true, fill: [0.5, 0.7, 1] })]
    expect(detectFields(page({ glyphs, draws })).map((f) => f.label)).toEqual(['Name'])
  })

  it('finds a small square with its label to the right as a check box', () => {
    const glyphs = text('I agree to the terms', 90, 300)
    const found = detectFields(page({ glyphs, draws: [rect(72, 291, 11, 11)] }))
    expect(found).toHaveLength(1)
    expect(found[0]).toMatchObject({ type: 'checkbox', label: 'I agree to the terms', source: 'square' })
    // A small square with no text beside it is a bullet or a mark, not a check box.
    expect(detectFields(page({ glyphs: [], draws: [rect(72, 291, 11, 11)] }))).toEqual([])
  })

  it('does not suggest a second field where a rule runs under an underscore blank, or over an existing field', () => {
    const glyphs = [...text('Name', 72, 100), ...text('____________', 120, 100)]
    const both = detectFields(page({ glyphs, draws: [line(120, 102, 60)] }))
    expect(both).toHaveLength(1)
    const existing = detectFields(page({ glyphs, existing: [{ x: 118, y: 88, w: 64, h: 16 }] }))
    expect(existing).toEqual([])
  })

  it('converts paths from page space to display space', () => {
    // A page 842 tall, y up: a rule at page y 700 is at display y 142.
    const glyphs = text('Email', 72, 142)
    const found = detectFields(page({ glyphs, draws: [line(120, 700, 150)], toDisplay: (x, y) => [x, 842 - y] }))
    expect(found).toHaveLength(1)
    expect(found[0].rect.y).toBeCloseTo(126)
  })
})

describe('names', () => {
  it('makes field names from labels', () => {
    expect(nameFromLabel('First name', 'x')).toBe('First_name')
    expect(nameFromLabel('Date (dd/mm/yyyy)', 'x')).toBe('Date_ddmmyyyy')
    expect(nameFromLabel('2nd contact', 'x')).toBe('f2nd_contact')
    expect(nameFromLabel('  ', 'x')).toBe('x')
    expect(nameFromLabel('Prénom', 'x')).toBe('Prenom')
  })

  it('keeps names unique among the document and each other, and numbers unlabelled ones', () => {
    const found = (label: string, type: 'text' | 'checkbox' = 'text') => ({ type, page: 0, rect: { x: 0, y: 0, w: 10, h: 10 }, label, source: 'blank' as const })
    const named = nameSuggestions([found('Name'), found('Name'), found(''), found(''), found('', 'checkbox'), found('Site')], ['Site'])
    expect(named.map((n) => n.name)).toEqual(['Name', 'Name_2', 'Text1', 'Text2', 'Check1', 'Site_2'])
  })
})
