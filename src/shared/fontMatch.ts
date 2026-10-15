/**
 * Matching a PDF's font name to an installed font. PDF base font names ("ABCDEF+Arial-BoldMT") and Windows font
 * display names ("Arial Bold") are reduced to the same family key plus bold and italic flags.
 */

export interface FontKey {
  /** Lower-case family without spaces or style words. */
  family: string
  bold: boolean
  italic: boolean
}

const NOISE = new Set(['mt', 'ps', 'psmt', 'regular', 'std', 'normal', 'truetype', 'opentype'])
const BOLD = new Set(['bold', 'bd', 'bol'])
const ITALIC = new Set(['italic', 'it', 'oblique', 'ital', 'obl'])
const BOTH = new Set(['bolditalic', 'boldoblique', 'bi', 'z'])

export function fontKey(name: string): FontKey {
  const base = name
    .replace(/^[A-Z]{6}\+/, '')
    .replace(/\((truetype|opentype|type 1)\)/gi, ' ')
    .replace(/[,\-_]/g, ' ')
    // Split camel case: "TimesNewRomanPS" to "Times New Roman PS", "BoldItalicMT" to "Bold Italic MT".
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
  let bold = false
  let italic = false
  const words = base
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .filter((w) => {
      if (NOISE.has(w)) return false
      if (BOLD.has(w)) return (bold = true), false
      if (ITALIC.has(w)) return (italic = true), false
      if (BOTH.has(w)) return (bold = italic = true), false
      return true
    })
  // "Times-Roman" is the regular face of Times, but "Times New Roman" keeps its Roman.
  if (words.length > 1 && words[words.length - 1] === 'roman' && words[words.length - 2] !== 'new') words.pop()
  return { family: words.join(''), bold, italic }
}

export interface InstalledFont {
  key: FontKey
  /** File name, or a full path for fonts installed for one user. */
  file: string
}

/** Parses `reg query` output for a Fonts key: lines like `    Arial Bold (TrueType)    REG_SZ    arialbd.ttf`. */
export function parseFontRegistry(text: string): InstalledFont[] {
  const out: InstalledFont[] = []
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s+(.+?)\s+REG_SZ\s+(.+?)\s*$/.exec(line)
    if (!m || !/\.(ttf|otf)$/i.test(m[2])) continue
    out.push({ key: fontKey(m[1]), file: m[2] })
  }
  return out
}

/** The installed font for a PDF font name, with exactly the wanted weight and slant, or undefined. */
export function matchFont(fonts: InstalledFont[], pdfName: string, wantBold: boolean, wantItalic: boolean): InstalledFont | undefined {
  const k = fontKey(pdfName)
  const bold = wantBold || k.bold
  const italic = wantItalic || k.italic
  return fonts.find((f) => f.key.family === k.family && f.key.bold === bold && f.key.italic === italic)
}
