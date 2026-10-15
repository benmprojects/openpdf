import { Modal } from './AppDialogs'
import type { PdfAReport } from './pdfa'
import type { CheckStatus, StandardsReport } from './standards'
import { t } from './i18n'

const MARK: Record<CheckStatus, string> = { pass: '✔', warn: '⚠', fail: '✖' }
const WORD: Record<CheckStatus, string> = { pass: 'Passed', warn: 'Worth a look', fail: 'Failed' }

function Section({ title, claim, report, standard }: { title: string; claim?: string; report: StandardsReport; standard: 'PDF/A' | 'PDF/UA' }) {
  const rows = report.checks.filter((c) => c.standard === standard)
  const failed = rows.filter((c) => c.status === 'fail').length
  return (
    <section aria-label={title}>
      <h3>{title}</h3>
      <p className="muted">
        {claim ? `This file declares ${claim}.` : 'This file does not declare it.'} {failed === 0 ? 'The basic checks found nothing wrong.' : `The basic checks found ${failed} problem${failed === 1 ? '' : 's'}.`}
      </p>
      <ul className="std-list">
        {rows.map((c) => (
          <li key={c.label} className={`std-${c.status}`}>
            <span aria-label={WORD[c.status]}>{MARK[c.status]}</span> {c.label}
            {c.detail && <span className="muted"> ({c.detail})</span>}
          </li>
        ))}
      </ul>
    </section>
  )
}

/** What the file says about PDF/A and PDF/UA, and basic checks against each. */
export function StandardsDialog({ report, conversion, onClose }: { report: StandardsReport; conversion?: PdfAReport; onClose: () => void }) {
  const a = report.claims.pdfa
  const ua = report.claims.pdfua
  return (
    <Modal title={t('PDF standards')} onClose={onClose}>
      <div className="marks-form">
        <p className="muted">These are quick checks of things that can be tested from the file alone. They are not a full validator: passing them does not make a file conformant.</p>
        {conversion && (
          <section aria-label="What the conversion did">
            <h3>Conversion to PDF/A-2b</h3>
            <ul className="std-list">
              {conversion.fixed.map((t) => (
                <li key={t} className="std-pass">
                  <span aria-hidden>✔</span> {t}
                </li>
              ))}
              {conversion.remaining.map((t) => (
                <li key={t} className="std-warn">
                  <span aria-hidden>⚠</span> {t}
                </li>
              ))}
            </ul>
          </section>
        )}
        <Section title="PDF/A (archiving)" standard="PDF/A" report={report} claim={a ? `PDF/A-${a.part}${a.conformance ? a.conformance.toLowerCase() : ''}` : undefined} />
        <Section title="PDF/UA (accessibility)" standard="PDF/UA" report={report} claim={ua ? `PDF/UA-${ua.part}` : undefined} />
        <div className="marks-actions">
          <span style={{ flex: 1 }} />
          <button className="primary" type="button" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </Modal>
  )
}
