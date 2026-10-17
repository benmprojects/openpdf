/**
 * Form data files: export the values of a form's fields as XFDF, FDF, CSV or XML, and read them back. Field names are
 * the fully qualified (dotted) names; XFDF and FDF nest them as the specifications describe.
 */
import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFString } from 'pdf-lib'
import type { FormField, FormValue } from './forms'

export type DataFormat = 'fdf' | 'xfdf' | 'csv' | 'xml'

/** One exported field: text, or several values for a list box. */
export interface DataEntry {
  name: string
  value: string | string[]
}

/** The fields' current values as text. Buttons and signatures carry no data and are left out. */
export function entriesFor(fields: FormField[], values: ReadonlyMap<string, FormValue>): DataEntry[] {
  const out: DataEntry[] = []
  for (const f of fields) {
    if (f.type === 'button' || f.type === 'signature') continue
    const v = values.get(f.name) ?? f.value
    if (f.type === 'checkbox') out.push({ name: f.name, value: v === true ? (f.widgets.find((w) => w.onValue)?.onValue ?? 'Yes') : 'Off' })
    else if (f.type === 'list') out.push({ name: f.name, value: Array.isArray(v) ? v : v ? [String(v)] : [] })
    else out.push({ name: f.name, value: Array.isArray(v) ? (v[0] ?? '') : typeof v === 'string' ? v : v ? 'Yes' : 'Off' })
  }
  return out
}

/**
 * Turns imported text back into values of the matching fields. Unknown names and read-only fields are skipped.
 * Checkboxes accept their on-value, Yes/true/1/on; radio buttons their option text or its index.
 */
export function valuesFromImport(fields: FormField[], raw: ReadonlyMap<string, string | string[]>): Map<string, FormValue> {
  const out = new Map<string, FormValue>()
  for (const f of fields) {
    if (f.readOnly || f.type === 'button' || f.type === 'signature' || !raw.has(f.name)) continue
    const r = raw.get(f.name)!
    const text = Array.isArray(r) ? (r[0] ?? '') : r
    if (f.type === 'checkbox') {
      const on = f.widgets.find((w) => w.onValue)?.onValue
      out.set(f.name, text !== '' && !/^(off|false|no|0|n)$/i.test(text.trim()) && (on === undefined || text === on || /^(yes|true|1|on|y|x)$/i.test(text.trim())))
    } else if (f.type === 'radio') {
      const opts = f.options ?? []
      out.set(f.name, opts.includes(text) ? text : /^\d+$/.test(text) && opts[Number(text)] !== undefined ? opts[Number(text)] : text === 'Off' ? '' : '')
    } else if (f.type === 'list') {
      // A CSV cell holds the choices joined with "; ".
      const items = Array.isArray(r) ? r : text.split(/\s*;\s*/).filter(Boolean)
      out.set(f.name, items.filter((x) => (f.options ?? []).includes(x)))
    }
    else if (f.type === 'dropdown') out.set(f.name, text)
    else out.set(f.name, f.maxLength !== undefined ? text.slice(0, f.maxLength) : text)
  }
  return out
}

// ---- XML (XFDF and a plain form) ---------------------------------------------------------------------------

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const unesc = (s: string) =>
  s
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')

interface Node {
  name: string
  attrs: Record<string, string>
  children: Node[]
  text: string
}

/** A small XML reader: elements, attributes, text and CDATA; comments, declarations and processing instructions are skipped. */
function parseXml(xml: string): Node {
  const root: Node = { name: '#root', attrs: {}, children: [], text: '' }
  const stack: Node[] = [root]
  const re = /<!\[CDATA\[([\s\S]*?)\]\]>|<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!DOCTYPE[^>]*>|<\/\s*([^\s>]+)\s*>|<([^\s/>!?]+)((?:\s+[^\s=/>]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(xml))) {
    const top = stack[stack.length - 1]
    if (m[1] !== undefined) top.text += m[1]
    else if (m[2] !== undefined) {
      if (stack.length > 1) stack.pop()
    } else if (m[3] !== undefined) {
      const node: Node = { name: m[3].replace(/^.*:/, ''), attrs: {}, children: [], text: '' }
      for (const a of m[4].matchAll(/([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) node.attrs[a[1].replace(/^.*:/, '')] = unesc(a[2] ?? a[3] ?? '')
      top.children.push(node)
      if (m[5] !== '/') stack.push(node)
    } else if (m[6] !== undefined) top.text += unesc(m[6])
  }
  if (stack.length > 1 || root.children.length !== 1) throw new Error('This is not a readable XML file.')
  return root.children[0]
}

interface Tree {
  name: string
  value?: string | string[]
  kids: Tree[]
}

/** Dotted names as a tree, so XFDF can nest them (a.b and a.c share the parent field a). */
function tree(entries: DataEntry[]): Tree[] {
  const roots: Tree[] = []
  for (const e of entries) {
    let level = roots
    const parts = e.name.split('.')
    parts.forEach((part, i) => {
      let node = level.find((n) => n.name === part)
      if (!node) {
        node = { name: part, kids: [] }
        level.push(node)
      }
      if (i === parts.length - 1) node.value = e.value
      level = node.kids
    })
  }
  return roots
}

export function toXfdfData(entries: DataEntry[], fileName: string): string {
  const field = (n: Tree): string => {
    const inner = n.kids.map(field).join('')
    const vals = n.value === undefined ? '' : (Array.isArray(n.value) ? n.value : [n.value]).map((v) => `<value>${esc(v)}</value>`).join('')
    return `<field name="${esc(n.name)}">${vals}${inner}</field>`
  }
  return ['<?xml version="1.0" encoding="UTF-8"?>', '<xfdf xmlns="http://ns.adobe.com/xfdf/" xml:space="preserve">', `<f href="${esc(fileName)}"/>`, `<fields>${tree(entries).map(field).join('')}</fields>`, '</xfdf>'].join('\n')
}

export function fromXfdfData(xml: string): Map<string, string | string[]> {
  const root = parseXml(xml)
  if (root.name !== 'xfdf') throw new Error('This is not an XFDF file.')
  const out = new Map<string, string | string[]>()
  const walk = (n: Node, prefix: string) => {
    for (const c of n.children) {
      if (c.name !== 'field') continue
      const full = prefix ? `${prefix}.${c.attrs.name ?? ''}` : (c.attrs.name ?? '')
      const vals = c.children.filter((k) => k.name === 'value').map((k) => k.text)
      if (vals.length === 1) out.set(full, vals[0])
      else if (vals.length > 1) out.set(full, vals)
      walk(c, full)
    }
  }
  const fields = root.children.find((c) => c.name === 'fields')
  if (fields) walk(fields, '')
  return out
}

/** A plain XML export: `<form><field name="x">value</field>...</form>` (several `<value>` for a list box). */
export function toXml(entries: DataEntry[]): string {
  const rows = entries.map((e) => (Array.isArray(e.value) ? `  <field name="${esc(e.name)}">${e.value.map((v) => `<value>${esc(v)}</value>`).join('')}</field>` : `  <field name="${esc(e.name)}">${esc(e.value)}</field>`))
  return `<?xml version="1.0" encoding="UTF-8"?>\n<form>\n${rows.join('\n')}\n</form>`
}

export function fromXml(xml: string): Map<string, string | string[]> {
  const root = parseXml(xml)
  if (root.name === 'xfdf') return fromXfdfData(xml)
  const out = new Map<string, string | string[]>()
  for (const c of root.children) {
    const name = c.attrs.name ?? c.name
    const vals = c.children.filter((k) => k.name === 'value').map((k) => k.text)
    out.set(name, vals.length > 1 ? vals : vals.length === 1 ? vals[0] : c.text)
  }
  return out
}

// ---- CSV -----------------------------------------------------------------------------------------------------

const csvCell = (s: string) => (/[",\r\n]/.test(s) || /^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s)

/** A header row of field names and one row of values (list box choices joined with "; "). */
export function toCsv(entries: DataEntry[]): string {
  return [entries.map((e) => csvCell(e.name)).join(','), entries.map((e) => csvCell(Array.isArray(e.value) ? e.value.join('; ') : e.value)).join(',')].join('\r\n') + '\r\n'
}

/** Rows of cells, with quoted cells, doubled quotes and line breaks inside quotes handled. */
function csvRows(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  // A byte order mark (added so Excel reads UTF-8) is not part of the first name.
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  for (let i = 0; i < src.length; i++) {
    const c = src[i]
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') {
        cell += '"'
        i++
      } else if (c === '"') quoted = false
      else cell += c
    } else if (c === '"') quoted = true
    else if (c === ',') {
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
  return rows.filter((r) => r.some((x) => x !== ''))
}

/** The header row names the fields; the first data row holds the values. */
export function fromCsv(text: string): Map<string, string | string[]> {
  const rows = csvRows(text)
  if (rows.length < 2) throw new Error('The CSV needs a row of field names and a row of values.')
  const out = new Map<string, string | string[]>()
  rows[0].forEach((name, i) => {
    if (name) out.set(name, rows[1][i] ?? '')
  })
  return out
}

// ---- FDF -----------------------------------------------------------------------------------------------------

/** A PDF text string as UTF-16BE hex (safe for any text). */
function hexText(s: string): string {
  let hex = 'FEFF'
  for (const ch of s) {
    const cp = ch.codePointAt(0)!
    if (cp > 0xffff) {
      const v = cp - 0x10000
      hex += (0xd800 + (v >> 10)).toString(16).padStart(4, '0') + (0xdc00 + (v & 0x3ff)).toString(16).padStart(4, '0')
    } else hex += cp.toString(16).padStart(4, '0')
  }
  return `<${hex.toUpperCase()}>`
}

export function toFdfData(entries: DataEntry[], fileName: string): Uint8Array {
  const field = (n: Tree): string => {
    const parts = [`/T ${hexText(n.name)}`]
    if (n.value !== undefined) parts.push(Array.isArray(n.value) ? `/V [${n.value.map(hexText).join(' ')}]` : `/V ${hexText(n.value)}`)
    if (n.kids.length) parts.push(`/Kids [${n.kids.map(field).join(' ')}]`)
    return `<< ${parts.join(' ')} >>`
  }
  const body = `%FDF-1.2\n1 0 obj\n<< /FDF << /Fields [${tree(entries).map(field).join(' ')}] /F ${hexText(fileName)} >> >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n`
  return new TextEncoder().encode(body)
}

export async function fromFdfData(bytes: Uint8Array): Promise<Map<string, string | string[]>> {
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 8))
  if (!head.startsWith('%FDF-')) throw new Error('This is not an FDF file.')
  const copy = new Uint8Array(bytes)
  copy.set(new TextEncoder().encode('%PDF-'), 0)
  const doc = await PDFDocument.load(copy, { updateMetadata: false, throwOnInvalidObject: false })
  const root = doc.context.lookup(doc.context.trailerInfo.Root) as PDFDict | undefined
  const fdf = root?.lookupMaybe(PDFName.of('FDF'), PDFDict)
  const fields = fdf?.lookupMaybe(PDFName.of('Fields'), PDFArray)
  const out = new Map<string, string | string[]>()
  const text = (o: unknown): string | undefined => (o instanceof PDFString || o instanceof PDFHexString ? o.decodeText() : o instanceof PDFName ? o.decodeText() : undefined)
  const walk = (list: PDFArray | undefined, prefix: string, depth: number) => {
    if (!list || depth > 20) return
    for (let i = 0; i < list.size(); i++) {
      const d = list.lookupMaybe(i, PDFDict)
      if (!d) continue
      const t = text(d.lookup(PDFName.of('T'))) ?? ''
      const full = prefix ? `${prefix}.${t}` : t
      const v = d.lookup(PDFName.of('V'))
      if (v instanceof PDFArray) out.set(full, Array.from({ length: v.size() }, (_, k) => text(v.lookup(k)) ?? ''))
      else if (v !== undefined) out.set(full, text(v) ?? '')
      walk(d.lookupMaybe(PDFName.of('Kids'), PDFArray), full, depth + 1)
    }
  }
  walk(fields, '', 0)
  return out
}

/** Reads form data in any of the formats, by the file's extension. */
export async function readDataFile(name: string, data: Uint8Array): Promise<Map<string, string | string[]>> {
  const ext = /\.([a-z]+)$/i.exec(name)?.[1].toLowerCase()
  if (ext === 'fdf') return fromFdfData(data)
  const text = new TextDecoder('utf-8').decode(data)
  if (ext === 'csv') return fromCsv(text)
  if (ext === 'xfdf') return fromXfdfData(text)
  if (ext === 'xml') return fromXml(text)
  throw new Error('Choose an FDF, XFDF, CSV or XML file.')
}

// ---- Populate from a CSV: one filled copy of the form per row -----------------------------------------------

export interface CsvTable {
  header: string[]
  rows: string[][]
}

/** A header row of field names, then one row per record. Rows with nothing in them are skipped. */
export function csvTable(text: string): CsvTable {
  const rows = csvRows(text)
  if (rows.length < 2) throw new Error('The CSV needs a row of field names and at least one row of values.')
  return { header: rows[0].map((h) => h.trim()), rows: rows.slice(1) }
}

/** One record as the name-to-text map the importer reads. A blank column name is ignored. */
export function recordOf(table: CsvTable, row: string[]): Map<string, string> {
  const out = new Map<string, string>()
  table.header.forEach((name, i) => {
    if (name) out.set(name, row[i] ?? '')
  })
  return out
}

/** Header names that match no field (so their columns are left out) and fields no column fills. */
export function populateMatch(fields: FormField[], header: string[]): { unknownColumns: string[]; unfilledFields: string[] } {
  const fillable = fields.filter((f) => !f.readOnly && f.type !== 'button' && f.type !== 'signature')
  const names = new Set(fillable.map((f) => f.name))
  const cols = header.filter(Boolean)
  return { unknownColumns: cols.filter((c) => !names.has(c)), unfilledFields: fillable.filter((f) => !cols.includes(f.name)).map((f) => f.name) }
}

/** Characters Windows does not allow in a file name, and control characters, are replaced; the result is not empty. */
export function safeFileStem(raw: string, fallback: string): string {
  const s = [...raw]
    .map((c) => (c.charCodeAt(0) < 32 || '\\/:*?"<>|'.includes(c) ? '-' : c))
    .join('')
    .replace(/\s+/g, ' ')
    .replace(/^[\s.]+|[\s.]+$/g, '')
    .slice(0, 100)
    .trim()
  const reserved = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(s)
  return s && !reserved ? s : fallback
}

/**
 * The output file names for the rows: from the chosen column (or `stem 1`, `stem 2` ... when there is none or the cell
 * is empty). Repeated names get ` (2)`, ` (3)`; the names carry no extension.
 */
export function populateNames(table: CsvTable, nameColumn: string | null, stem: string): string[] {
  const col = nameColumn ? table.header.indexOf(nameColumn) : -1
  const used = new Set<string>()
  return table.rows.map((row, i) => {
    const base = safeFileStem(col >= 0 ? (row[col] ?? '') : '', `${stem} ${i + 1}`)
    let name = base
    for (let n = 2; used.has(name.toLowerCase()); n++) name = `${base} (${n})`
    used.add(name.toLowerCase())
    return name
  })
}
