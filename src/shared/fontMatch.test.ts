import { describe, expect, it } from 'vitest'
import { fontKey, matchFont, parseFontRegistry } from './fontMatch'

describe('fontKey', () => {
  it('reduces PDF base font names to family and style', () => {
    expect(fontKey('ABCDEF+Arial-BoldMT')).toEqual({ family: 'arial', bold: true, italic: false })
    expect(fontKey('ArialMT')).toEqual({ family: 'arial', bold: false, italic: false })
    expect(fontKey('TimesNewRomanPS-BoldItalicMT')).toEqual({ family: 'timesnewroman', bold: true, italic: true })
    expect(fontKey('Calibri-Light')).toEqual({ family: 'calibrilight', bold: false, italic: false })
    expect(fontKey('SegoeUI-Italic')).toEqual({ family: 'segoeui', bold: false, italic: true })
    expect(fontKey('Times-Roman').family).toBe('times')
    expect(fontKey('CourierNewPSMT').family).toBe('couriernew')
  })

  it('reduces Windows display names to the same keys', () => {
    expect(fontKey('Arial Bold (TrueType)')).toEqual({ family: 'arial', bold: true, italic: false })
    expect(fontKey('Times New Roman Bold Italic (TrueType)')).toEqual({ family: 'timesnewroman', bold: true, italic: true })
    expect(fontKey('Segoe UI Italic (TrueType)')).toEqual({ family: 'segoeui', bold: false, italic: true })
    expect(fontKey('Calibri Light (TrueType)').family).toBe('calibrilight')
  })
})

describe('matchFont', () => {
  const reg = `
HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts
    Arial (TrueType)    REG_SZ    arial.ttf
    Arial Bold (TrueType)    REG_SZ    arialbd.ttf
    Arial Bold Italic (TrueType)    REG_SZ    arialbi.ttf
    Cambria & Cambria Math (TrueType)    REG_SZ    cambria.ttc
    Verdana (TrueType)    REG_SZ    C:\\Users\\x\\AppData\\Local\\Microsoft\\Windows\\Fonts\\verdana.ttf
`
  const fonts = parseFontRegistry(reg)
  it('lists ttf and otf files only', () => {
    expect(fonts.map((f) => f.file)).toEqual(['arial.ttf', 'arialbd.ttf', 'arialbi.ttf', 'C:\\Users\\x\\AppData\\Local\\Microsoft\\Windows\\Fonts\\verdana.ttf'])
  })
  it('finds the face with the same weight and slant, else nothing', () => {
    expect(matchFont(fonts, 'ABCDEF+Arial-BoldMT', false, false)?.file).toBe('arialbd.ttf')
    expect(matchFont(fonts, 'ArialMT', true, true)?.file).toBe('arialbi.ttf')
    expect(matchFont(fonts, 'ArialMT', false, true)).toBeUndefined()
    expect(matchFont(fonts, 'Montserrat-ExtraBold', false, false)).toBeUndefined()
  })
})
