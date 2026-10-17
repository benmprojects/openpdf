import { useState } from 'react'
import { Modal } from './AppDialogs'
import { reportCsv, reportHtml, type A11yIssue, type A11yReport, type Severity } from './a11yCheck'
import { msg, t } from './i18n'

const MARK: Record<Severity, string> = { fail: '✖', warn: '⚠', manual: '☐' }
const WORD: Record<Severity, string> = { fail: msg('Failed'), warn: msg('Worth a look'), manual: msg('Check by hand') }
const ORDER: Severity[] = ['fail', 'warn', 'manual']

interface Props {
  report: A11yReport
  /** The document's name, for the saved report. */
  docName: string
  onGoTo: (issue: A11yIssue) => void
  onRecheck: () => void
  onClose: () => void
}

/** The accessibility check: every finding with its page, how to fix it and the requirement it comes from, and a saved report. */
export function AccessibilityDialog({ report, docName, onGoTo, onRecheck, onClose }: Props) {
  const [saved, setSaved] = useState<string | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [showPassed, setShowPassed] = useState(false)
  const base = docName.replace(/\.pdf$/i, '')

  const save = async (format: 'html' | 'csv') => {
    setSaved(null)
    setProblem(null)
    try {
      const path =
        format === 'html'
          ? await window.openpdf.saveText(`${base} (accessibility report).html`, reportHtml(report, docName), { name: 'HTML report', ext: 'html' })
          : await window.openpdf.saveText(`${base} (accessibility report).csv`, reportCsv(report), { name: 'CSV (comma separated)', ext: 'csv' })
      if (path) setSaved(path)
    } catch (e) {
      setProblem(e instanceof Error ? e.message : String(e))
    }
  }

  const c = report.counts
  return (
    <Modal title={t('Accessibility check')} onClose={onClose} wide>
      <div className="marks-form a11y-report">
        <p className="muted">{t('A quick check of what can be tested from the file alone, modelled on PDF/UA-1, the Matterhorn Protocol and WCAG. It is not a validator: passing it does not make a file conformant, and the items to check by hand need a person.')}</p>
        <p role="status" aria-label={t('Summary')}>
          <strong>{c.fail}</strong> {t('failed')}, <strong>{c.warn}</strong> {t('worth a look')}, <strong>{c.manual}</strong> {t('to check by hand')}, <strong>{c.passed}</strong> {t('passed')}.
          {!report.tagged && ` ${t('This document is not tagged, so the checks that need tags were not run.')}`}
        </p>
        {ORDER.map((sev) => {
          const list = report.issues.filter((i) => i.severity === sev)
          if (!list.length) return null
          return (
            <section key={sev} aria-label={t(WORD[sev])}>
              <h3>
                {t(WORD[sev])} ({list.length})
              </h3>
              <ul className="std-list a11y-list" aria-label={`${t(WORD[sev])}: ${list.length}`}>
                {list.map((i, n) => (
                  <li key={`${i.rule}-${n}`} className={`std-${sev === 'manual' ? 'warn' : sev}`}>
                    <div className="a11y-line">
                      <span aria-hidden>{MARK[sev]}</span>
                      <span className="a11y-title">
                        {t(i.title)}
                        {i.detail && <span className="muted"> ({i.detail})</span>}
                        {i.page >= 0 && <span className="muted"> {t('Page {n}', { n: i.page + 1 })}</span>}
                      </span>
                      {(i.page >= 0 || i.tag !== undefined) && (
                        <button type="button" onClick={() => onGoTo(i)} aria-label={`${t('Go to')}: ${i.title}${i.page >= 0 ? `, ${t('page {n}', { n: i.page + 1 })}` : ''}`}>
                          {t('Go to')}
                        </button>
                      )}
                    </div>
                    <details>
                      <summary>{t('How to fix it')}</summary>
                      <p className="small">{t(i.fix)}</p>
                      <p className="muted small">{i.refs.join('; ')}</p>
                    </details>
                  </li>
                ))}
              </ul>
            </section>
          )
        })}
        <section aria-label={t('Passed')}>
          <button type="button" className="link-btn" aria-expanded={showPassed} onClick={() => setShowPassed(!showPassed)}>
            <h3>{showPassed ? t('Passed ({n}) – hide', { n: report.passed.length }) : t('Passed ({n}) – show', { n: report.passed.length })}</h3>
          </button>
          {showPassed && (
            <ul className="std-list" aria-label={t('Checks that passed')}>
              {report.passed.map((p) => (
                <li key={p} className="std-pass">
                  <span aria-hidden>✔</span> {t(p)}
                </li>
              ))}
            </ul>
          )}
        </section>
        {saved && (
          <p role="status" className="small">
            {t('Report saved to {path}', { path: saved })}
          </p>
        )}
        {problem && (
          <p role="alert" className="error-text small">
            {problem}
          </p>
        )}
        <div className="marks-actions">
          <button type="button" onClick={() => void save('html')}>
            {t('Save report (HTML)')}
          </button>
          <button type="button" onClick={() => void save('csv')}>
            {t('Save report (CSV)')}
          </button>
          <button type="button" onClick={onRecheck}>
            {t('Check again')}
          </button>
          <span style={{ flex: 1 }} />
          <button className="primary" type="button" onClick={onClose}>
            {t('Close')}
          </button>
        </div>
      </div>
    </Modal>
  )
}
