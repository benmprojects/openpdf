import { useEffect, useState } from 'react'
import { Modal } from './AppDialogs'
import type { PdfClient } from './pdfClient'
import { countDocument, readAllText, type WordCount } from './proofing'
import { currentLanguage, t } from './i18n'

const formatNumber = (n: number) => n.toLocaleString(currentLanguage())

/** Words, characters, lines and pages of the document, counted from the text of each page. */
export function WordCountDialog({ client, pageCount, labels, onClose }: { client: PdfClient; pageCount: number; labels: string[] | null; onClose: () => void }) {
  const [count, setCount] = useState<WordCount | null>(null)
  const [done, setDone] = useState(0)
  const [problem, setProblem] = useState<string | null>(null)

  useEffect(() => {
    const signal = { cancelled: false }
    readAllText(client, pageCount, setDone, signal).then(
      (texts) => !signal.cancelled && setCount(countDocument(texts)),
      (e) => !signal.cancelled && setProblem(e instanceof Error ? e.message : String(e))
    )
    return () => {
      signal.cancelled = true
    }
  }, [client, pageCount])

  return (
    <Modal title={t('Word count')} onClose={onClose}>
      <div className="marks-form">
        {problem && (
          <p role="alert" className="error-text">
            {problem}
          </p>
        )}
        {!count && !problem && (
          <p className="muted" role="status">
            {t('Counting… {done} of {total} pages', { done, total: pageCount })}
          </p>
        )}
        {count && (
          <>
            <table className="labels-table wc-table" aria-label={t('Totals')}>
              <tbody>
                <tr>
                  <th scope="row">{t('Words')}</th>
                  <td>{formatNumber(count.words)}</td>
                </tr>
                <tr>
                  <th scope="row">{t('Characters (with spaces)')}</th>
                  <td>{formatNumber(count.characters)}</td>
                </tr>
                <tr>
                  <th scope="row">{t('Characters (no spaces)')}</th>
                  <td>{formatNumber(count.charactersNoSpaces)}</td>
                </tr>
                <tr>
                  <th scope="row">{t('Lines')}</th>
                  <td>{formatNumber(count.lines)}</td>
                </tr>
                <tr>
                  <th scope="row">{t('Pages')}</th>
                  <td>{formatNumber(count.pages)}</td>
                </tr>
                <tr>
                  <th scope="row">{t('Pages with text')}</th>
                  <td>{formatNumber(count.pagesWithText)}</td>
                </tr>
              </tbody>
            </table>
            {count.pagesWithText < count.pages && <p className="muted small">{t('Pages with no text are pictures only (a scan, for example). Recognise text (OCR) adds a text layer that can be counted.')}</p>}
            <details>
              <summary>{t('Words on each page')}</summary>
              <div className="wc-pages">
                <table className="labels-table" aria-label={t('Words on each page')}>
                  <thead>
                    <tr>
                      <th scope="col">{t('Page')}</th>
                      <th scope="col">{t('Words')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {count.perPage.map((p, i) => (
                      <tr key={i}>
                        <td>{labels?.[i] || i + 1}</td>
                        <td>{formatNumber(p.words)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          </>
        )}
        <div className="marks-actions">
          <span style={{ flex: 1 }} />
          <button className="primary" type="button" onClick={onClose}>
            {t('Close')}
          </button>
        </div>
      </div>
    </Modal>
  )
}
