/** Comment summary (a PDF) and CSV export, built from the annotations in memory. */
import { PDFDocument, rgb, StandardFonts, type PDFFont } from 'pdf-lib'
import { annotLabel, formatWhen, reviewState, type Annot } from './annotations'
import { commentText } from './CommentsPane'

const pageOf = (a: Annot, labels: string[] | null) => (labels?.[a.page] ? labels[a.page] : String(a.page + 1))

/** Comments as CSV (UTF-8, comma separated, quoted), one row per comment and one per reply. */
export function commentsCsv(annots: Annot[], labels: string[] | null): string {
  const q = (s: string) => `"${s.replace(/"/g, '""')}"`
  const rows = [['Page', 'Type', 'Author', 'Date', 'Status', 'Comment', 'In reply to'].map(q).join(',')]
  const sorted = [...annots].sort((x, y) => x.page - y.page || (x.rects[0]?.y ?? 0) - (y.rects[0]?.y ?? 0))
  sorted.forEach((a, i) => {
    const ref = `#${i + 1}`
    rows.push([pageOf(a, labels), annotLabel(a.kind), a.author ?? '', formatWhen(a.modified ?? a.created), reviewState(a), commentText(a), ''].map(q).join(','))
    for (const r of a.replies ?? []) {
      rows.push([pageOf(a, labels), r.mark ? (r.mark === 'Marked' ? 'Checked' : 'Unchecked') : r.state ? 'Status' : 'Reply', r.author, formatWhen(r.date), r.state ?? '', r.text, ref].map(q).join(','))
    }
  })
  return rows.join('\r\n') + '\r\n'
}

function wrap(font: PDFFont, text: string, size: number, width: number): string[] {
  const out: string[] = []
  for (const para of text.split(/\r\n|\r|\n/)) {
    let line = ''
    for (const word of para.split(' ')) {
      const next = line ? `${line} ${word}` : word
      if (!line || font.widthOfTextAtSize(next, size) <= width) line = next
      else {
        out.push(line)
        line = word
      }
    }
    out.push(line)
  }
  return out
}

/** Characters Helvetica cannot draw become '?', so an unusual character does not stop the summary. */
function safe(font: PDFFont, s: string): string {
  let out = ''
  for (const ch of s.replace('²', '2')) {
    try {
      font.encodeText(ch)
      out += ch
    } catch {
      out += '?'
    }
  }
  return out
}

/** A summary of every comment, page by page, as a new A4 PDF. */
export async function commentSummaryPdf(annots: Annot[], labels: string[] | null, docName: string): Promise<Uint8Array> {
  const pdf = await PDFDocument.create()
  pdf.setTitle(`Comment summary: ${docName}`)
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)
  const W = 595
  const H = 842
  const M = 50
  let page = pdf.addPage([W, H])
  let y = H - M
  const need = (h: number) => {
    if (y - h < M) {
      page = pdf.addPage([W, H])
      y = H - M
    }
  }
  const text = (s: string, f: PDFFont, size: number, x: number, colour = rgb(0.1, 0.12, 0.15)) => {
    page.drawText(safe(f, s), { x, y, size, font: f, color: colour })
  }

  text('Comment summary', bold, 18, M)
  y -= 22
  text(`${docName} · ${annots.length} comment${annots.length === 1 ? '' : 's'} · ${formatWhen(new Date().toISOString())}`, font, 10, M, rgb(0.4, 0.42, 0.47))
  y -= 26

  const sorted = [...annots].sort((x, z) => x.page - z.page || (x.rects[0]?.y ?? 0) - (z.rects[0]?.y ?? 0))
  let lastPage = -1
  for (const a of sorted) {
    if (a.page !== lastPage) {
      need(40)
      lastPage = a.page
      y -= 6
      text(`Page ${pageOf(a, labels)}`, bold, 13, M)
      y -= 6
      page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.6, color: rgb(0.8, 0.82, 0.86) })
      y -= 16
    }
    const head = `${annotLabel(a.kind)}${a.author ? ` · ${a.author}` : ''}${a.modified || a.created ? ` · ${formatWhen(a.modified ?? a.created)}` : ''}${reviewState(a) !== 'None' ? ` · ${reviewState(a)}` : ''}`
    const body = wrap(font, safe(font, commentText(a)), 10, W - 2 * M - 14)
    need(16 + body.length * 13)
    page.drawRectangle({ x: M, y: y - 2, width: 8, height: 8, color: rgb(...(hex(a.color) as [number, number, number])) })
    text(head, bold, 10, M + 14)
    y -= 14
    for (const line of body.filter((l, i) => l || i === 0)) {
      if (!line) break
      text(line, font, 10, M + 14)
      y -= 13
    }
    for (const r of a.replies ?? []) {
      const lines = wrap(font, safe(font, r.mark ? (r.mark === 'Marked' ? 'Marked as checked' : 'Check removed') : r.state ? `Status set to ${r.state}` : r.text), 9, W - 2 * M - 40)
      need(14 + lines.length * 12)
      text(`${r.author || '(no author)'} · ${formatWhen(r.date)}`, bold, 8.5, M + 30, rgb(0.4, 0.42, 0.47))
      y -= 12
      for (const line of lines) {
        text(line, font, 9, M + 30)
        y -= 12
      }
    }
    y -= 8
  }
  return pdf.save()
}

function hex(c: string): number[] {
  const n = parseInt(c.replace('#', ''), 16)
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
}
