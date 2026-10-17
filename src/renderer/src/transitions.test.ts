import { PDFDocument, PDFName } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import { advanceDelay, effectForStyle, keyframesFor, readPageTransitions, stepPage, transitionFor } from './transitions'

describe('effects', () => {
  it('maps PDF styles to the effects drawn', () => {
    expect(effectForStyle('Dissolve')).toBe('fade')
    expect(effectForStyle('Wipe')).toBe('wipe')
    expect(effectForStyle('Push')).toBe('push')
    expect(effectForStyle('R')).toBe('none')
    expect(effectForStyle('Whatever')).toBe('none')
  })
  it('has keyframes for each moving effect and none for a plain replace', () => {
    expect(keyframesFor('none', 1)).toEqual([])
    expect(keyframesFor('fade', 1)).toHaveLength(2)
    expect(keyframesFor('push', 1)[0]).toEqual({ transform: 'translateX(100%)' })
    expect(keyframesFor('push', -1)[0]).toEqual({ transform: 'translateX(-100%)' })
  })
})

describe('stepPage', () => {
  it('stops at the ends unless looping', () => {
    expect(stepPage(2, 3, 1, false)).toBeNull()
    expect(stepPage(0, 3, -1, false)).toBeNull()
    expect(stepPage(1, 3, 1, false)).toBe(2)
  })
  it('wraps when looping', () => {
    expect(stepPage(2, 3, 1, true)).toBe(0)
    expect(stepPage(0, 3, -1, true)).toBe(2)
    expect(stepPage(0, 0, 1, true)).toBeNull()
  })
})

describe('choices and delays', () => {
  const file = new Map([[1, { effect: 'wipe' as const, seconds: 2, display: 7 }]])
  it('uses the page setting when the choice is the document', () => {
    expect(transitionFor('document', 1, file)).toEqual({ effect: 'wipe', seconds: 2 })
    expect(transitionFor('document', 0, file)).toEqual({ effect: 'none', seconds: 1 })
    expect(transitionFor('fade', 1, file).effect).toBe('fade')
    expect(transitionFor('none', 1, file).effect).toBe('none')
  })
  it('advances by the page time, else the interval, else not at all', () => {
    expect(advanceDelay('document', 5, 1, file)).toBe(7)
    expect(advanceDelay('document', 5, 0, file)).toBe(5)
    expect(advanceDelay('fade', 5, 1, file)).toBe(5)
    expect(advanceDelay('fade', 0, 1, file)).toBeNull()
  })
})

describe('readPageTransitions', () => {
  it('reads /Trans and /Dur from pages', async () => {
    const doc = await PDFDocument.create()
    const a = doc.addPage()
    doc.addPage()
    const c = doc.addPage()
    a.node.set(PDFName.of('Trans'), doc.context.obj({ S: 'Fade', D: 2 }))
    c.node.set(PDFName.of('Dur'), doc.context.obj(4))
    const got = await readPageTransitions(await doc.save())
    expect(got.get(0)).toEqual({ effect: 'fade', seconds: 2, display: null })
    expect(got.has(1)).toBe(false)
    expect(got.get(2)).toEqual({ effect: 'none', seconds: 1, display: 4 })
  })
})
