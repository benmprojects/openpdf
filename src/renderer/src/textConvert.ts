/**
 * Turning other text formats into plain text for the text-to-PDF path: Rich Text Format, Markdown and CSV. These are
 * deliberately plain readings (what the words say, not how they were styled): fonts, colours, pictures and tables in
 * an RTF file are not carried over, and Markdown markers are removed rather than drawn as bold or italic.
 */

/** The file kinds the text path understands. */
export type TextKind = 'txt' | 'rtf' | 'md' | 'csv'

export function textKindOf(name: string): TextKind {
  const ext = /\.([A-Za-z0-9]+)$/.exec(name)?.[1].toLowerCase()
  return ext === 'rtf' ? 'rtf' : ext === 'md' || ext === 'markdown' ? 'md' : ext === 'csv' || ext === 'tsv' ? 'csv' : 'txt'
}

// Characters 0x80 to 0x9F in Windows-1252 (RTF \'hh escapes use the document's ANSI code page; this is the usual one).
const CP1252_HIGH = '€\u0081‚ƒ„…†‡ˆ‰Š‹Œ\u008dŽ\u008f\u0090‘’“”•–—˜™š›œ\u009džŸ'
const cp1252 = (n: number): string => (n >= 0x80 && n <= 0x9f ? CP1252_HIGH[n - 0x80] : String.fromCharCode(n))

/** Groups that hold settings or objects, not text. */
const SKIP_GROUPS = new Set(['fonttbl', 'colortbl', 'stylesheet', 'info', 'pict', 'object', 'header', 'footer', 'headerl', 'headerr', 'footerl', 'footerr', 'footnote', 'themedata', 'colorschememapping', 'latentstyles', 'datastore', 'listtable', 'listoverridetable', 'rsidtbl', 'generator', 'xmlnstbl', 'fldinst', 'bkmkstart', 'bkmkend'])

const SYMBOLS: Record<string, string> = {
  par: '\n',
  line: '\n',
  sect: '\n\n',
  page: '\n\n',
  tab: '\t',
  emdash: '—',
  endash: '–',
  emspace: ' ',
  enspace: ' ',
  qmspace: ' ',
  bullet: '•',
  lquote: '‘',
  rquote: '’',
  ldblquote: '“',
  rdblquote: '”'
}

/** The text of an RTF document. Cells and rows end with a tab and a line break, so simple tables stay readable. */
export function rtfToText(rtf: string): string {
  if (!/^\s*\{\\rtf/.test(rtf)) return rtf
  let out = ''
  let i = 0
  const n = rtf.length
  // Each open group: whether its text is dropped, and the number of fallback characters after a \u escape (\ucN).
  const stack: { skip: boolean; uc: number }[] = []
  let cur = { skip: false, uc: 1 }
  let skipFallback = 0
  while (i < n) {
    const c = rtf[i]
    if (c === '{') {
      stack.push({ ...cur })
      i++
      // \* marks an optional destination: drop it. Known setting groups are dropped too.
      const m = /^\\(\*?)\\?([a-z]+)?/.exec(rtf.slice(i, i + 40))
      if (m && (m[1] === '*' || (m[2] && SKIP_GROUPS.has(m[2])))) cur.skip = true
      continue
    }
    if (c === '}') {
      cur = stack.pop() ?? { skip: false, uc: 1 }
      i++
      continue
    }
    if (c === '\r' || c === '\n') {
      i++
      continue
    }
    if (c === '\\') {
      const next = rtf[i + 1]
      if (next === undefined) break
      if (next === "'") {
        const hex = rtf.slice(i + 2, i + 4)
        i += 4
        if (skipFallback > 0) skipFallback--
        else if (!cur.skip && /^[0-9A-Fa-f]{2}$/.test(hex)) out += cp1252(parseInt(hex, 16))
        continue
      }
      if (!/[A-Za-z]/.test(next)) {
        i += 2
        if (cur.skip) continue
        if (next === '~') out += '\u00a0'
        else if (next === '_') out += '-'
        else if (next === '\\' || next === '{' || next === '}') out += next
        else if (next === '\n' || next === '\r') out += '\n'
        continue
      }
      const m = /^\\([A-Za-z]+)(-?\d+)? ?/.exec(rtf.slice(i, i + 40))
      if (!m) {
        i++
        continue
      }
      i += m[0].length
      const word = m[1]
      const arg = m[2] === undefined ? undefined : parseInt(m[2], 10)
      if (word === 'uc' && arg !== undefined) cur.uc = arg
      else if (word === 'u' && arg !== undefined) {
        if (!cur.skip) out += String.fromCharCode(arg < 0 ? arg + 65536 : arg)
        skipFallback = cur.uc
      } else if (word === 'cell' || word === 'nestcell') {
        if (!cur.skip) out += '\t'
      } else if (word === 'row' || word === 'nestrow') {
        if (!cur.skip) out += '\n'
      } else if (!cur.skip && word in SYMBOLS) out += SYMBOLS[word]
      continue
    }
    i++
    if (skipFallback > 0) {
      skipFallback--
      continue
    }
    if (!cur.skip) out += c
  }
  return out
    .replace(/\t+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** Markdown as readable plain text: markers removed, bullets kept, links shown with their address, code kept as written. */
export function markdownToText(md: string): string {
  const lines = md.replace(/\r\n?/g, '\n').split('\n')
  const out: string[] = []
  let fence = false
  for (const raw of lines) {
    if (/^\s*(```|~~~)/.test(raw)) {
      fence = !fence
      continue
    }
    if (fence) {
      out.push(`    ${raw}`)
      continue
    }
    let l = raw
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(l)) {
      out.push('----------------------------------------')
      continue
    }
    if (/^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l) && l.includes('|')) continue // table rule
    const h = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/.exec(l)
    if (h) {
      const text = stripInline(h[2])
      if (out.length && out[out.length - 1] !== '') out.push('')
      out.push(h[1].length <= 2 ? text.toUpperCase() : text)
      continue
    }
    l = l.replace(/^(\s*)>\s?/, '$1  ')
    l = l.replace(/^(\s*)[-*+]\s+\[( |x|X)\]\s+/, (_m, sp: string, x: string) => `${sp}${x === ' ' ? '[ ]' : '[x]'} `)
    l = l.replace(/^(\s*)[-*+]\s+/, '$1• ')
    if (/^\s*\|.*\|\s*$/.test(l)) l = l.replace(/^\s*\||\|\s*$/g, '').split('|').map((c) => stripInline(c.trim())).join('   ')
    else l = stripInline(l)
    out.push(l)
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

function stripInline(s: string): string {
  return s
    .replace(/!\[([^\]]*)\]\(([^)]*)\)/g, (_m, alt: string) => (alt ? `[${alt}]` : '[picture]'))
    .replace(/\[([^\]]+)\]\(([^)\s]+)[^)]*\)/g, (_m, text: string, url: string) => (text === url ? text : `${text} (${url})`))
    .replace(/`([^`]+)`/g, '$1')
    .replace(/(\*\*|__)(.+?)\1/g, '$2')
    .replace(/(^|[\s(])([*_])([^*_\s][^*_]*?)\2(?=[\s).,;:!?]|$)/g, '$1$3')
    .replace(/~~(.+?)~~/g, '$1')
    .replace(/<\/?[A-Za-z][^>]*>/g, '')
}

/** Splits CSV text into rows of cells: quotes, doubled quotes, and commas, semicolons or tabs (found from the first line). */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^\ufeff/, '')
  const first = src.split(/\r?\n/, 1)[0]
  const count = (ch: string) => (first.match(new RegExp(`\\${ch}`, 'g')) ?? []).length
  const delim = [',', ';', '\t'].reduce((best, d) => (count(d) > count(best) ? d : best), ',')
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < src.length; i++) {
    const c = src[i]
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          cell += '"'
          i++
        } else quoted = false
      } else cell += c
    } else if (c === '"' && cell === '') quoted = true
    else if (c === delim) {
      row.push(cell)
      cell = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
    } else cell += c
  }
  if (cell !== '' || row.length) {
    row.push(cell)
    rows.push(row)
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''))
}

/**
 * CSV as an aligned table in a fixed-width font. Columns are padded to their widest cell (long cells are cut at
 * `maxCell` characters with an ellipsis); the font size is reduced, down to `minSize`, until the widest line fits.
 */
export function csvToTable(csv: string, o: { fitWidth: number; size: number; minSize?: number; maxCell?: number }): { text: string; size: number; cut: number } {
  const rows = parseCsv(csv)
  const maxCell = o.maxCell ?? 40
  let cut = 0
  const clean = rows.map((r) =>
    r.map((c) => {
      const one = c.replace(/\s+/g, ' ').trim()
      if (one.length <= maxCell) return one
      cut++
      return `${one.slice(0, maxCell - 1)}…`
    })
  )
  const cols = Math.max(0, ...clean.map((r) => r.length))
  const widths = Array.from({ length: cols }, (_, k) => Math.max(...clean.map((r) => [...(r[k] ?? '')].length)))
  const gap = 2
  const lines = clean.map((r) => r.map((c, k) => (k === r.length - 1 ? c : c.padEnd(widths[k] + gap - ([...c].length - c.length)))).join('').trimEnd())
  const longest = Math.max(1, ...lines.map((l) => [...l].length))
  // Courier is 0.6 em wide.
  const fits = o.fitWidth / (0.6 * longest)
  const size = Math.max(o.minSize ?? 6, Math.min(o.size, Math.floor(fits * 2) / 2))
  return { text: lines.join('\n'), size, cut }
}
