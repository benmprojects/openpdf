import { PDFDocument, PDFName } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import { checkAccessibility, reportCsv, reportDate, reportHtml, type A11yReport } from './a11yCheck'
import { markArtifact, setDocAccess, setTagText, setTagType } from './structTree'
import { buildTaggedPdf } from './tagFixture'

const rules = (r: A11yReport, severity?: string) => r.issues.filter((i) => !severity || i.severity === severity).map((i) => i.rule)

describe('checkAccessibility', () => {
  it('fails an untagged file on tagging, title and language, and says what it could not test', async () => {
    const d = await PDFDocument.create()
    d.addPage()
    const r = await checkAccessibility(await d.save())
    expect(r.tagged).toBe(false)
    expect(rules(r, 'fail')).toEqual(expect.arrayContaining(['tagged', 'title', 'lang']))
    expect(rules(r)).not.toContain('figure-alt')
    expect(r.passed).not.toContain('Figures have alternative text')
  })

  it('finds the figure without alternative text, the skipped heading and the missing language, with pages', async () => {
    const r = await checkAccessibility(await buildTaggedPdf())
    const fig = r.issues.find((i) => i.rule === 'figure-alt')!
    expect(fig).toMatchObject({ severity: 'fail', page: 0, tag: '0/2' })
    const skip = r.issues.find((i) => i.rule === 'heading-order')!
    expect(skip).toMatchObject({ page: 1, tag: '0/3' })
    expect(skip.detail).toContain('H3 follows H1')
    expect(rules(r, 'fail')).toContain('lang')
    // The artefact page number and tagged content leave nothing untagged.
    expect(rules(r)).not.toContain('untagged-content')
    expect(rules(r)).not.toContain('orphan-content')
    expect(r.counts.manual).toBeGreaterThan(0)
  })

  it('clears the findings as they are fixed through the tag edits', async () => {
    let bytes = await buildTaggedPdf({ untaggedLink: true })
    expect(rules(await checkAccessibility(bytes))).toEqual(expect.arrayContaining(['link-tagged', 'link-name', 'tab-order']))
    bytes = await setTagText(bytes, '0/2', { alt: 'A grey box' })
    bytes = await setTagType(bytes, '0/3', 'H2')
    bytes = await setDocAccess(bytes, { title: 'Report', lang: 'en-AU' })
    const r = await checkAccessibility(bytes)
    expect(rules(r)).not.toContain('figure-alt')
    expect(rules(r)).not.toContain('heading-order')
    expect(rules(r)).not.toContain('lang')
    expect(rules(r)).not.toContain('title')
    expect(r.passed).toContain('Figures have alternative text')
  })

  it('notices content that is neither tagged nor an artefact, and content the tree does not know', async () => {
    const doc = await PDFDocument.load(await buildTaggedPdf())
    const page = doc.getPage(0)
    const c = page.node.lookup(PDFName.of('Contents')) as unknown as { contents: Uint8Array }
    const src = new TextDecoder().decode(c.contents) + '\n0 0 50 10 re f\n/P <</MCID 9>> BDC BT /F1 9 Tf 10 10 Td (x) Tj ET EMC'
    page.node.set(PDFName.of('Contents'), doc.context.register(doc.context.stream(src)))
    const r = await checkAccessibility(await doc.save())
    expect(r.issues.find((i) => i.rule === 'untagged-content')).toMatchObject({ severity: 'fail', page: 0 })
    expect(r.issues.find((i) => i.rule === 'orphan-content')).toMatchObject({ severity: 'warn', page: 0 })
  })

  it('treats a marked artefact as acceptable', async () => {
    const r = await checkAccessibility((await markArtifact(await buildTaggedPdf(), '0/2')).bytes)
    expect(rules(r)).not.toContain('untagged-content')
    expect(rules(r)).not.toContain('orphan-content')
    expect(rules(r)).not.toContain('figure-alt')
  })
})

describe('report', () => {
  it('writes HTML and CSV with each finding, its page and how to fix it, and escapes what it prints', async () => {
    const r = await checkAccessibility(await buildTaggedPdf())
    const html = reportHtml(r, 'a <b>&</b> doc.pdf', new Date(2026, 9, 17))
    expect(html).toContain('17/10/2026')
    expect(html).toContain('a &lt;b&gt;&amp;&lt;/b&gt; doc.pdf')
    expect(html).toContain('Figures have alternative text')
    expect(html).toContain('not a validator')
    const csv = reportCsv(r)
    const lines = csv.trim().split('\r\n')
    expect(lines[0]).toBe('Result,Page,Finding,Detail,How to fix,Requirement')
    expect(lines.some((l) => l.startsWith('Failed,1,Figures have alternative text'))).toBe(true)
    expect(reportDate(new Date(2026, 0, 5))).toBe('05/01/2026')
  })

  it('keeps a spreadsheet from running a cell as a formula', () => {
    const csv = reportCsv({ issues: [{ rule: 'x', severity: 'fail', title: '=HYPERLINK("x")', detail: '', page: -1, fix: 'f', refs: [] }], passed: [], pages: 1, tagged: true, counts: { fail: 1, warn: 0, manual: 0, passed: 0 } })
    expect(csv).toContain(`"'=HYPERLINK(""x"")"`)
  })
})
