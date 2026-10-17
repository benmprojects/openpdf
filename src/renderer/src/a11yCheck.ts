/**
 * An accessibility checker for PDF, modelled on the public requirements: PDF/UA-1 (ISO 14289-1), the PDF Association's
 * Matterhorn Protocol of failure conditions, and the WCAG 2.x success criteria that apply to documents. It tests what can
 * be tested from the file alone; what needs a person (reading order that makes sense, colour contrast, the quality of
 * alternative text) is listed as "check by hand". It is not a validator: a file that passes here has not been proved
 * conformant, and the report says so.
 */
import { PDFArray, PDFBool, PDFDict, PDFDocument, PDFHexString, PDFName, PDFNumber, PDFRawStream, PDFString, decodePDFRawStream, type PDFObject } from 'pdf-lib'
import { bytesToString, parseContent } from './content'
import { pageContent } from './pageContent'
import { fontIsEmbedded, fontName, fontsOf } from './standards'
import { flattenTags, isStandardType, readTagTreeFrom, standardRole, type TagNode, type TagTree } from './structTree'

const N = PDFName.of

/** Marks a string for translation (the dialog translates it where it is shown); this file stays free of the browser-only i18n module so scripts and tests can use it. */
const msg = (text: string): string => text

export type Severity = 'fail' | 'warn' | 'manual'

export interface A11yIssue {
  rule: string
  severity: Severity
  /** What is wrong, in a sentence. */
  title: string
  /** Where, or how many (for example the element or the font). */
  detail: string
  /** 0-based page, or -1 when the issue is about the whole document. */
  page: number
  /** The element in the Tags pane (its id), when the issue is about one. */
  tag?: string
  /** What to do about it. */
  fix: string
  /** The requirements it comes from. */
  refs: string[]
}

export interface A11yReport {
  issues: A11yIssue[]
  /** Titles of the checks that found nothing wrong. */
  passed: string[]
  pages: number
  tagged: boolean
  counts: { fail: number; warn: number; manual: number; passed: number }
}

const text = (o: PDFObject | undefined): string => (o instanceof PDFString || o instanceof PDFHexString ? o.decodeText() : '')

const PER_RULE_LIMIT = 100

interface Rule {
  id: string
  title: string
  fix: string
  refs: string[]
}

const R = {
  tagged: { id: 'tagged', title: msg('The document is a tagged PDF'), fix: msg('Tags describe the structure that screen readers follow. Make the tags where the document was written (export to PDF with tags on), or run an accessibility tool that adds them. This program can edit tags but cannot make them from nothing.'), refs: ['PDF/UA-1 7.1', 'Matterhorn 01-003, 06-001', 'WCAG 1.3.1'] },
  title: { id: 'title', title: msg('The document has a title'), fix: msg('Tags pane, Document: type a title. It goes in the document properties and the XMP metadata.'), refs: ['PDF/UA-1 7.1', 'WCAG 2.4.2'] },
  titleShown: { id: 'title-shown', title: msg('The title bar shows the title, not the file name'), fix: msg('Tags pane, Document: setting a title also turns this on.'), refs: ['PDF/UA-1 7.1', 'WCAG 2.4.2'] },
  lang: { id: 'lang', title: msg('The document language is set'), fix: msg('Tags pane, Document: choose or type a language such as en-AU.'), refs: ['PDF/UA-1 7.2', 'WCAG 3.1.1'] },
  langBad: { id: 'lang-valid', title: msg('Language codes are valid'), fix: msg('Write the language as a code such as en, en-AU or fr.'), refs: ['PDF/UA-1 7.2', 'WCAG 3.1.1, 3.1.2'] },
  ua: { id: 'pdfua-id', title: msg('The file identifies itself as PDF/UA'), fix: msg('Only add this once the other checks pass: it is a claim that the file conforms.'), refs: ['PDF/UA-1 5'] },
  figure: { id: 'figure-alt', title: msg('Figures have alternative text'), fix: msg('Tags pane: select the figure and type a short description of what it shows. If it is only decoration, use Mark as artefact.'), refs: ['PDF/UA-1 7.3', 'Matterhorn 13-004', 'WCAG 1.1.1'] },
  formula: { id: 'formula-alt', title: msg('Formulas have alternative text'), fix: msg('Tags pane: select the formula and type how it is read aloud.'), refs: ['PDF/UA-1 7.7', 'WCAG 1.1.1'] },
  headFirst: { id: 'heading-first', title: msg('The first heading is level 1'), fix: msg('Tags pane: change the type of the first heading to H1.'), refs: ['PDF/UA-1 7.4', 'WCAG 1.3.1, 2.4.6'] },
  headSkip: { id: 'heading-order', title: msg('Heading levels do not skip'), fix: msg('Tags pane: change the type of the heading to the next level down from the one before it.'), refs: ['PDF/UA-1 7.4.2', 'Matterhorn 14-002', 'WCAG 1.3.1'] },
  headMix: { id: 'heading-mixed', title: msg('Headings are either all numbered (H1 to H6) or all plain (H)'), fix: msg('Tags pane: change the type of the plain H elements to numbered levels.'), refs: ['PDF/UA-1 7.4.4', 'Matterhorn 14-007'] },
  tableRows: { id: 'table-structure', title: msg('Tables are built of rows and cells'), fix: msg('A table must hold rows (TR), and rows must hold header (TH) or data (TD) cells. Fix the types in the Tags pane.'), refs: ['PDF/UA-1 7.5', 'WCAG 1.3.1'] },
  tableHead: { id: 'table-header', title: msg('Tables have header cells'), fix: msg('Tags pane: change the type of the cells in the header row to TH.'), refs: ['PDF/UA-1 7.5', 'Matterhorn 15-003', 'WCAG 1.3.1'] },
  list: { id: 'list-structure', title: msg('Lists are built of list items'), fix: msg('A list (L) must hold items (LI), and an item holds a label (Lbl) and a body (LBody). Fix the types in the Tags pane.'), refs: ['PDF/UA-1 7.6', 'WCAG 1.3.1'] },
  roleMap: { id: 'role-map', title: msg('Every tag type is standard or mapped to one'), fix: msg('Change the tag type to a standard one in the Tags pane.'), refs: ['PDF/UA-1 7.1', 'Matterhorn 02-001, 02-003'] },
  roleRemap: { id: 'role-remap', title: msg('Standard tag types are not given other meanings'), fix: msg('A role map should not change what a standard type means.'), refs: ['PDF/UA-1 7.1', 'Matterhorn 02-004'] },
  linkTag: { id: 'link-tagged', title: msg('Links are tagged'), fix: msg('Each link needs a Link element holding the link text and the link itself. Re-export the document with tags, or add the Link element where it was made.'), refs: ['PDF/UA-1 7.18.5', 'Matterhorn 28-002', 'WCAG 2.4.4'] },
  linkName: { id: 'link-name', title: msg('Links say where they go'), fix: msg('Give the link a description (its Contents), or make the text around it explain the purpose.'), refs: ['PDF/UA-1 7.18.5', 'WCAG 2.4.4'] },
  widgetTag: { id: 'form-tagged', title: msg('Form fields are tagged'), fix: msg('Each field needs a Form element. Re-export the document with tags on, or tag the form where it was made.'), refs: ['PDF/UA-1 7.18.4', 'Matterhorn 28-005', 'WCAG 4.1.2'] },
  widgetName: { id: 'form-names', title: msg('Form fields have a name for screen readers'), fix: msg('Fields pane: give the field a tooltip (its Contents) that says what to enter.'), refs: ['PDF/UA-1 7.18.1', 'Matterhorn 28-009', 'WCAG 1.3.1, 4.1.2'] },
  annotTag: { id: 'annot-tagged', title: msg('Comments and other annotations are tagged'), fix: msg('Annotations other than pop-ups are part of the content and need an Annot element. Flatten or remove them if they should not be read.'), refs: ['PDF/UA-1 7.18.1', 'Matterhorn 28-002'] },
  tabs: { id: 'tab-order', title: msg('Pages with links or fields follow the structure for the Tab key'), fix: msg('Set the page tab order to "Use document structure" (Tabs /S) on each page with annotations.'), refs: ['PDF/UA-1 7.18.3', 'Matterhorn 28-011', 'WCAG 2.4.3'] },
  untagged: { id: 'untagged-content', title: msg('All content is tagged or marked as an artefact'), fix: msg('Content that is neither is invisible to a screen reader or read in the wrong place. Tag it where the document was made, or (for decoration) mark it as an artefact.'), refs: ['PDF/UA-1 7.1', 'Matterhorn 01-005', 'WCAG 1.3.1'] },
  orphan: { id: 'orphan-content', title: msg('Tagged content belongs to an element in the tree'), fix: msg('Marked content that no element points to is not read. The tags need repair where the document was made.'), refs: ['PDF/UA-1 7.1', 'Matterhorn 09-001'] },
  scanned: { id: 'scanned', title: msg('Pages have real text, not only pictures'), fix: msg('A page that is only a picture has no text to read. Run Convert, OCR to add a text layer, then tag the result.'), refs: ['WCAG 1.4.5', 'WCAG 1.1.1'] },
  fontsEmbedded: { id: 'fonts-embedded', title: msg('All fonts are embedded'), fix: msg('Edit, Properties, Fonts shows them. Re-export the document with fonts embedded.'), refs: ['PDF/UA-1 7.21.4', 'Matterhorn 31-001'] },
  toUnicode: { id: 'fonts-unicode', title: msg('Fonts map their characters to text'), fix: msg('Without a character map the text may be read as the wrong letters. Re-export the document, or run OCR over the affected pages.'), refs: ['PDF/UA-1 7.2', 'Matterhorn 31-008', 'WCAG 1.3.1'] },
  bookmarks: { id: 'bookmarks', title: msg('A long document has bookmarks'), fix: msg('Bookmarks tab: Generate bookmarks from the headings.'), refs: ['PDF/UA-1 7.17', 'WCAG 2.4.5'] }
} satisfies Record<string, Rule>

const MANUAL: Rule[] = [
  { id: 'm-order', title: msg('The reading order is logical'), fix: msg('Read the tree in the Tags pane from the top: it should follow how the page is read. Use Move up and Move down to correct it.'), refs: ['PDF/UA-1 7.1', 'WCAG 1.3.2'] },
  { id: 'm-alt', title: msg('Alternative text says what the picture means'), fix: msg('Check each description: it should give the purpose of the picture, not "image" or the file name.'), refs: ['PDF/UA-1 7.3', 'WCAG 1.1.1'] },
  { id: 'm-contrast', title: msg('Text has enough contrast with its background'), fix: msg('Measure it with a contrast tool: 4.5 to 1 for body text, 3 to 1 for large text.'), refs: ['WCAG 1.4.3'] },
  { id: 'm-colour', title: msg('Colour is not the only way to carry meaning'), fix: msg('Look for statements such as "the red items" that rely on colour alone.'), refs: ['WCAG 1.4.1'] },
  { id: 'm-parts', title: msg('Passages in another language are marked'), fix: msg('Tags pane: set the Language of a passage in a different language.'), refs: ['PDF/UA-1 7.2', 'WCAG 3.1.2'] },
  { id: 'm-reflow', title: msg('The document reads sensibly when its text is reflowed'), fix: msg('Use Read aloud, or a reader that reflows text, and listen for mistakes.'), refs: ['WCAG 1.4.10'] }
]

/** Whether a name is one of the content-painting operators. */
const PAINT = new Set(['Tj', 'TJ', "'", '"', 'S', 's', 'f', 'F', 'f*', 'B', 'B*', 'b', 'b*', 'sh', 'Do', 'BI'])

interface PageScan {
  untagged: number
  mcids: Set<number>
  hasText: boolean
  hasImage: boolean
}

function scanPage(doc: PDFDocument, pageIndex: number): PageScan {
  const page = doc.getPage(pageIndex)
  const src = pageContent(page)
  const ops = parseContent(src)
  const props = (() => {
    let node: PDFDict | undefined = page.node
    for (let i = 0; node && i < 32; i++) {
      const res = node.lookupMaybe(N('Resources'), PDFDict)
      if (res) return res.lookupMaybe(N('Properties'), PDFDict)
      node = node.lookupMaybe(N('Parent'), PDFDict)
    }
    return undefined
  })()
  const xo = (() => {
    let node: PDFDict | undefined = page.node
    for (let i = 0; node && i < 32; i++) {
      const res = node.lookupMaybe(N('Resources'), PDFDict)
      if (res) return res.lookupMaybe(N('XObject'), PDFDict)
      node = node.lookupMaybe(N('Parent'), PDFDict)
    }
    return undefined
  })()
  const out: PageScan = { untagged: 0, mcids: new Set(), hasText: false, hasImage: false }
  const stack: ('real' | 'artifact' | 'other')[] = []
  let covered = 0
  for (const o of ops) {
    if (o.op === 'BMC' || o.op === 'BDC') {
      const tag = o.operands[0]
      const prop = o.operands[1]
      let mcid: number | undefined
      if (o.op === 'BDC' && prop) {
        if (prop.t === 'dict') {
          for (let i = 0; i + 1 < prop.v.length; i++) {
            const k = prop.v[i]
            const v = prop.v[i + 1]
            if (k.t === 'name' && k.v === 'MCID' && v.t === 'num') mcid = v.v
          }
        } else if (prop.t === 'name') mcid = props?.lookupMaybe(N(prop.v), PDFDict)?.lookupMaybe(N('MCID'), PDFNumber)?.asNumber()
      }
      const kind = tag?.t === 'name' && tag.v === 'Artifact' ? 'artifact' : mcid !== undefined ? 'real' : 'other'
      if (mcid !== undefined) out.mcids.add(mcid)
      stack.push(kind)
      if (kind !== 'other') covered++
    } else if (o.op === 'EMC') {
      const k = stack.pop()
      if (k && k !== 'other') covered--
    } else if (PAINT.has(o.op)) {
      if (o.op === 'Tj' || o.op === 'TJ' || o.op === "'" || o.op === '"') out.hasText = true
      if (o.op === 'BI') out.hasImage = true
      if (o.op === 'Do') {
        const n = o.operands[0]
        const x = n?.t === 'name' ? xo?.lookup(N(n.v)) : undefined
        if (x instanceof PDFRawStream && x.dict.lookup(N('Subtype')) === N('Image')) out.hasImage = true
        else if (x instanceof PDFRawStream) out.hasText = true // a form may hold the text: do not call the page scanned
      }
      if (covered <= 0) out.untagged++
    }
  }
  return out
}

/** The annotations of a page as dictionaries, in /Annots order. */
function annotsOf(doc: PDFDocument, pageIndex: number): { dict: PDFDict; index: number }[] {
  const arr = doc.getPage(pageIndex).node.lookupMaybe(N('Annots'), PDFArray)
  const out: { dict: PDFDict; index: number }[] = []
  if (arr) for (let i = 0; i < arr.size(); i++) {
    const d = arr.lookupMaybe(i, PDFDict)
    if (d) out.push({ dict: d, index: i })
  }
  return out
}

/** A form field's tooltip, looked for up the chain of parents. */
function tooltip(f: PDFDict): string {
  let node: PDFDict | undefined = f
  for (let i = 0; node && i < 16; i++) {
    const tu = text(node.lookup(N('TU')))
    if (tu) return tu
    node = node.lookupMaybe(N('Parent'), PDFDict)
  }
  return ''
}

const xmpHas = (xmp: string, re: RegExp) => re.test(xmp)

function xmpOf(doc: PDFDocument): string {
  const m = doc.catalog.lookup(N('Metadata'))
  if (!(m instanceof PDFRawStream)) return ''
  try {
    return bytesToString(decodePDFRawStream(m).decode())
  } catch {
    return ''
  }
}

function headingLevel(n: TagNode, roleMap: Record<string, string>): number | 'H' | 0 {
  const r = isStandardType(n.type) ? n.type : standardRole(n.type, roleMap)
  if (r === 'H') return 'H'
  const m = /^H([1-6])$/.exec(r)
  return m ? Number(m[1]) : 0
}

export async function checkAccessibility(bytes: Uint8Array): Promise<A11yReport> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false })
  const cat = doc.catalog
  const issues: A11yIssue[] = []
  const passed: string[] = []
  const counts = new Map<string, number>()
  const found = new Set<string>()
  const add = (rule: Rule, severity: Severity, detail: string, page = -1, tag?: string, title = rule.title) => {
    found.add(rule.id)
    const n = (counts.get(rule.id) ?? 0) + 1
    counts.set(rule.id, n)
    if (n > PER_RULE_LIMIT) return
    issues.push({ rule: rule.id, severity, title, detail, page, tag, fix: rule.fix, refs: rule.refs })
  }
  const done = (rule: Rule) => {
    if (!found.has(rule.id)) passed.push(rule.title)
  }
  const pages = doc.getPageCount()
  const xmp = xmpOf(doc)

  // ---- Tagging ----
  const marked = cat.lookupMaybe(N('MarkInfo'), PDFDict)?.lookup(N('Marked'))
  const isMarked = marked instanceof PDFBool && marked.asBoolean()
  const hasTree = cat.has(N('StructTreeRoot'))
  const tagged = isMarked && hasTree
  if (!hasTree) add(R.tagged, 'fail', 'There is no structure tree.')
  else if (!isMarked) add(R.tagged, 'fail', 'The document is not marked as tagged (MarkInfo).')
  done(R.tagged)

  // ---- Title and language ----
  const info = doc.context.lookupMaybe(doc.context.trailerInfo.Info, PDFDict)
  const xmpTitle = /<dc:title>[\s\S]*?<rdf:li[^>]*>([^<]+)</.exec(xmp)?.[1]?.trim()
  const title = text(info?.lookup(N('Title'))).trim() || xmpTitle || ''
  if (!title) add(R.title, 'fail', 'No title.')
  done(R.title)
  const display = cat.lookupMaybe(N('ViewerPreferences'), PDFDict)?.lookup(N('DisplayDocTitle'))
  if (title && !(display instanceof PDFBool && display.asBoolean())) add(R.titleShown, 'fail', title)
  done(R.titleShown)
  const lang = text(cat.lookup(N('Lang'))).trim()
  if (!lang) add(R.lang, 'fail', 'No language.')
  done(R.lang)
  const validLang = (s: string) => /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(s)
  if (lang && !validLang(lang)) add(R.langBad, 'fail', `Document language "${lang}".`)
  const uaId = xmpHas(xmp, /pdfuaid:part/)
  if (!uaId) add(R.ua, 'warn', 'The XMP metadata has no PDF/UA identification.')
  done(R.ua)

  // ---- Structure ----
  let tree: TagTree = { roots: [], count: 0, truncated: false, roleMap: {} }
  const taggedAnnots = new Set<string>()
  if (hasTree) {
    tree = readTagTreeFrom(doc)
    const all = flattenTags(tree.roots)
    for (const n of all) {
      for (const a of n.annots) taggedAnnots.add(`${a.page}:${a.index}`)
    }
    const role = (n: TagNode) => (isStandardType(n.type) ? n.type : standardRole(n.type, tree.roleMap))
    const where = (n: TagNode) => `${n.type}${n.title ? ` "${n.title}"` : ''}`

    for (const n of all) {
      const r = role(n)
      if (!r) add(R.roleMap, 'fail', `Tag type ${n.type}.`, n.page, n.id)
      if (r === 'Figure' && !n.alt.trim() && !n.actualText.trim()) add(R.figure, 'fail', where(n), n.page, n.id)
      if (r === 'Formula' && !n.alt.trim() && !n.actualText.trim()) add(R.formula, 'fail', where(n), n.page, n.id)
      if (n.lang && !validLang(n.lang)) add(R.langBad, 'fail', `${where(n)} has the language "${n.lang}".`, n.page, n.id)
      if (r === 'L') {
        const okKids = n.children.every((c) => ['LI', 'Caption', 'L'].includes(role(c)))
        if (!okKids || !n.children.some((c) => role(c) === 'LI')) add(R.list, 'fail', 'A list does not hold list items (LI).', n.page, n.id)
      }
      if (r === 'LI') {
        const okKids = n.children.every((c) => ['Lbl', 'LBody', 'L'].includes(role(c)))
        if (!okKids) add(R.list, 'fail', 'A list item holds something other than a label (Lbl) and a body (LBody).', n.page, n.id)
      }
      if (r === 'Table') {
        const rows: TagNode[] = []
        const collect = (c: TagNode) => {
          const cr = role(c)
          if (cr === 'TR') rows.push(c)
          else if (cr === 'THead' || cr === 'TBody' || cr === 'TFoot') c.children.forEach(collect)
        }
        n.children.forEach(collect)
        const badKids = n.children.filter((c) => !['TR', 'THead', 'TBody', 'TFoot', 'Caption'].includes(role(c)))
        if (!rows.length || badKids.length) add(R.tableRows, 'fail', rows.length ? 'A table holds something other than rows.' : 'A table has no rows.', n.page, n.id)
        else {
          const badCells = rows.some((row) => row.children.some((c) => !['TH', 'TD'].includes(role(c))))
          if (badCells) add(R.tableRows, 'fail', 'A row holds something other than header or data cells.', n.page, n.id)
          else if (!rows.some((row) => row.children.some((c) => role(c) === 'TH'))) add(R.tableHead, 'fail', 'No header cells (TH).', n.page, n.id)
        }
      }
    }
    for (const k of Object.keys(tree.roleMap)) {
      if (isStandardType(k) && tree.roleMap[k] !== k) add(R.roleRemap, 'warn', `${k} is mapped to ${tree.roleMap[k]}.`)
    }
    // Heading order, in reading order.
    const heads = all.map((n) => ({ n, level: headingLevel(n, tree.roleMap) })).filter((h) => h.level !== 0)
    if (heads.length) {
      const first = heads[0]
      if (first.level !== 1 && first.level !== 'H') add(R.headFirst, 'warn', `The first heading is ${first.n.type}.`, first.n.page, first.n.id)
      let prev = 0
      for (const h of heads) {
        if (typeof h.level === 'number') {
          if (prev && h.level > prev + 1) add(R.headSkip, 'fail', `${h.n.type} follows H${prev}.`, h.n.page, h.n.id)
          prev = h.level
        }
      }
      if (heads.some((h) => h.level === 'H') && heads.some((h) => typeof h.level === 'number')) add(R.headMix, 'fail', 'Both H and numbered headings are used.', heads[0].n.page, heads[0].n.id)
    }
    for (const rule of [R.roleMap, R.roleRemap, R.figure, R.formula, R.list, R.tableRows, R.tableHead, R.headFirst, R.headSkip, R.headMix]) done(rule)
  } else {
    // Without a tree these cannot be tested: say so once rather than pass them.
  }

  // ---- Pages: content and annotations ----
  const treeContent = new Map<number, Set<number>>()
  if (hasTree) for (const n of flattenTags(tree.roots)) for (const c of n.content) if (c.page >= 0) treeContent.set(c.page, (treeContent.get(c.page) ?? new Set()).add(c.mcid))
  const noTabs: number[] = []
  for (let p = 0; p < pages; p++) {
    let scan: PageScan | null
    try {
      scan = scanPage(doc, p)
    } catch {
      scan = null
    }
    if (scan) {
      if (hasTree && scan.untagged > 0) add(R.untagged, 'fail', `${scan.untagged} piece${scan.untagged === 1 ? '' : 's'} of content outside any tag or artefact.`, p)
      if (hasTree) {
        const inTree = treeContent.get(p) ?? new Set<number>()
        const orphans = [...scan.mcids].filter((m) => !inTree.has(m))
        if (orphans.length) add(R.orphan, 'warn', `${orphans.length} marked-content item${orphans.length === 1 ? '' : 's'} (${orphans.slice(0, 5).join(', ')}${orphans.length > 5 ? ', …' : ''}) not in the tree.`, p)
      }
      if (scan.hasImage && !scan.hasText) add(R.scanned, 'warn', 'The page holds a picture and no text.', p)
    }
    const annots = annotsOf(doc, p)
    const visible = annots.filter((a) => a.dict.lookup(N('Subtype')) !== N('Popup') && !((a.dict.lookupMaybe(N('F'), PDFNumber)?.asNumber() ?? 0) & 2))
    if (visible.length && !(page(doc, p).lookup(N('Tabs')) === N('S'))) noTabs.push(p)
    for (const a of visible) {
      const sub = (a.dict.lookup(N('Subtype')) as PDFName | undefined)?.decodeText() ?? ''
      const isTagged = taggedAnnots.has(`${p}:${a.index}`)
      if (sub === 'Link') {
        if (hasTree && !isTagged) add(R.linkTag, 'fail', 'A link is not in the structure tree.', p)
        if (!text(a.dict.lookup(N('Contents'))).trim()) add(R.linkName, 'warn', 'A link has no description (Contents).', p)
      } else if (sub === 'Widget') {
        if (hasTree && !isTagged) add(R.widgetTag, 'fail', 'A form field is not in the structure tree.', p)
        if (!tooltip(a.dict).trim()) add(R.widgetName, 'fail', `A form field has no tooltip${text(a.dict.lookup(N('T'))) ? ` (${text(a.dict.lookup(N('T')))})` : ''}.`, p)
      } else if (hasTree && !isTagged && sub !== 'PrinterMark' && sub !== 'TrapNet') add(R.annotTag, 'warn', `A ${sub || 'markup'} annotation is not in the structure tree.`, p)
    }
  }
  for (const p of noTabs) add(R.tabs, 'fail', 'No tab order set.', p)
  for (const rule of [R.untagged, R.orphan, R.scanned, R.linkTag, R.linkName, R.widgetTag, R.widgetName, R.annotTag, R.tabs]) {
    if (!hasTree && [R.untagged, R.orphan, R.linkTag, R.widgetTag, R.annotTag].includes(rule)) continue
    done(rule)
  }

  // ---- Fonts and navigation ----
  const fonts = fontsOf(doc)
  const loose = [...new Set(fonts.filter((f) => !fontIsEmbedded(f)).map(fontName))]
  if (loose.length) add(R.fontsEmbedded, 'fail', `Not embedded: ${loose.slice(0, 8).join(', ')}${loose.length > 8 ? ` and ${loose.length - 8} more` : ''}.`)
  done(R.fontsEmbedded)
  const noMap = [
    ...new Set(
      fonts
        .filter((f) => {
          const sub = f.lookup(N('Subtype'))
          return (sub === N('Type0') || sub === N('TrueType') || sub === N('Type1')) && fontIsEmbedded(f) && !f.has(N('ToUnicode')) && !(sub === N('Type1') && f.lookup(N('Encoding')) instanceof PDFName)
        })
        .map(fontName)
    )
  ]
  if (noMap.length) add(R.toUnicode, 'warn', `${noMap.slice(0, 8).join(', ')}${noMap.length > 8 ? ` and ${noMap.length - 8} more` : ''}.`)
  done(R.toUnicode)
  if (pages > 20 && !cat.has(N('Outlines'))) add(R.bookmarks, 'warn', `${pages} pages and no bookmarks.`)
  done(R.bookmarks)

  for (const m of MANUAL) add(m, 'manual', '', -1, undefined)
  const fail = issues.filter((i) => i.severity === 'fail').length
  const warn = issues.filter((i) => i.severity === 'warn').length
  return { issues, passed, pages, tagged, counts: { fail, warn, manual: MANUAL.length, passed: passed.length } }
}

const page = (doc: PDFDocument, i: number) => doc.getPage(i).node

// ---- Saved report -------------------------------------------------------------------------------------------------------------

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const SEVERITY_WORD: Record<Severity, string> = { fail: 'Failed', warn: 'Worth a look', manual: 'Check by hand' }

const pad = (n: number) => String(n).padStart(2, '0')
/** DD/MM/YYYY. */
export const reportDate = (d: Date): string => `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`

const DISCLAIMER = 'This is a quick check of what can be tested from the file alone, modelled on PDF/UA-1, the Matterhorn Protocol and WCAG. It is not a validator: a file with no failures here has not been shown to conform, and the items marked "check by hand" need a person.'

/** A self-contained HTML report, one table row per finding. */
export function reportHtml(report: A11yReport, docName: string, when = new Date()): string {
  const rows = report.issues
    .map(
      (i) =>
        `<tr class="${i.severity}"><td>${SEVERITY_WORD[i.severity]}</td><td>${i.page >= 0 ? i.page + 1 : ''}</td><td>${esc(i.title)}${i.detail ? `<br><span class="d">${esc(i.detail)}</span>` : ''}</td><td>${esc(i.fix)}</td><td>${esc(i.refs.join('; '))}</td></tr>`
    )
    .join('\n')
  const passed = report.passed.map((p) => `<li>${esc(p)}</li>`).join('')
  return `<!DOCTYPE html>
<html lang="en-AU"><head><meta charset="utf-8"><title>Accessibility report: ${esc(docName)}</title>
<style>body{font:14px/1.4 Segoe UI,Arial,sans-serif;margin:2em;color:#1b1b1b}h1{font-size:1.5em}table{border-collapse:collapse;width:100%}th,td{border:1px solid #888;padding:4px 8px;vertical-align:top;text-align:left}th{background:#e8e8e8}tr.fail td:first-child{color:#8a1010;font-weight:600}tr.warn td:first-child{color:#6b4a00;font-weight:600}.d{color:#444}.note{color:#333;max-width:60em}</style></head>
<body><h1>Accessibility report</h1>
<p><strong>Document:</strong> ${esc(docName)}<br><strong>Date:</strong> ${reportDate(when)}<br><strong>Pages:</strong> ${report.pages}<br><strong>Tagged:</strong> ${report.tagged ? 'yes' : 'no'}</p>
<p><strong>${report.counts.fail}</strong> failed, <strong>${report.counts.warn}</strong> worth a look, <strong>${report.counts.manual}</strong> to check by hand, <strong>${report.counts.passed}</strong> passed.</p>
<p class="note">${esc(DISCLAIMER)}</p>
<table><thead><tr><th scope="col">Result</th><th scope="col">Page</th><th scope="col">Finding</th><th scope="col">How to fix it</th><th scope="col">Requirement</th></tr></thead><tbody>
${rows}
</tbody></table>
<h2>Passed</h2><ul>${passed || '<li>None</li>'}</ul>
</body></html>
`
}

/** A cell that a spreadsheet will not run as a formula. */
const cell = (s: string) => {
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}

/** CSV with a header row: result, page, finding, detail, how to fix, requirement. */
export function reportCsv(report: A11yReport): string {
  const lines = [['Result', 'Page', 'Finding', 'Detail', 'How to fix', 'Requirement'].join(',')]
  for (const i of report.issues) lines.push([SEVERITY_WORD[i.severity], i.page >= 0 ? String(i.page + 1) : '', i.title, i.detail, i.fix, i.refs.join('; ')].map(cell).join(','))
  return lines.join('\r\n') + '\r\n'
}
