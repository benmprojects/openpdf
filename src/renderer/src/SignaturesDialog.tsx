import { Modal } from './AppDialogs'
import { describeSignature, type ChainInfo, type SignatureCheck, type SignatureInfo } from './sign'
import { t } from './i18n'

export interface SignatureRow {
  info: SignatureInfo
  check: SignatureCheck
  chain?: ChainInfo
  /** Another signature was added to the file after this one. */
  later: boolean
}

const MARK = { ok: '✔', warn: '⚠', bad: '✖' } as const
const CERTIFY_TEXT = { 1: 'Certified: no changes allowed', 2: 'Certified: form filling and signing allowed', 3: 'Certified: form filling, signing and comments allowed' } as const

export const signatureState = (r: SignatureRow) => describeSignature(r.check, r.chain, r.later)

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </>
  )
}

/** What each signature in the document says, and whether it can be trusted. */
export function SignaturesDialog({ rows, onClose }: { rows: SignatureRow[]; onClose: () => void }) {
  return (
    <Modal title={t('Signatures')} onClose={onClose}>
      <div className="marks-form">
        {rows.length === 0 && <p>This document has no signatures.</p>}
        {rows.map((r) => {
          const s = signatureState(r)
          const who = r.check.signer?.commonName ?? r.info.name ?? 'Unknown signer'
          const sg = r.check.signer
          return (
            <section key={r.info.fieldName} className={`sig-row sig-${s.level}`} aria-label={`${r.info.fieldName}: ${who}`}>
              <h3>
                <span aria-hidden>{MARK[s.level]}</span> {who} <span className="muted">({r.info.fieldName})</span>
              </h3>
              <p>{s.text}</p>
              <dl className="sig-details">
                {r.info.certify && <Row label="Certification">{CERTIFY_TEXT[r.info.certify]}</Row>}
                {sg?.organisation && <Row label="Organisation">{sg.organisation}</Row>}
                {sg?.issuer && <Row label="Issued by">{sg.issuer}</Row>}
                {sg?.notBefore && sg.notAfter && (
                  <Row label="Certificate valid">
                    {sg.notBefore.toLocaleDateString('en-AU')} to {sg.notAfter.toLocaleDateString('en-AU')}
                  </Row>
                )}
                {r.check.signingTime && <Row label="Signed">{r.check.signingTime.toLocaleString('en-AU')}</Row>}
                {r.info.reason && <Row label="Reason">{r.info.reason}</Row>}
                {r.info.location && <Row label="Location">{r.info.location}</Row>}
                {r.info.contact && <Row label="Contact">{r.info.contact}</Row>}
                {r.check.hash && <Row label="Digest">{r.check.hash}</Row>}
                {r.check.timestamp && (
                  <Row label="Time-stamp">
                    {r.check.timestamp.time.toLocaleString('en-AU')}
                    {r.check.timestamp.authority ? ` by ${r.check.timestamp.authority}` : ''}
                    {r.check.timestamp.valid ? '' : ' (this time-stamp could not be verified)'}
                  </Row>
                )}
              </dl>
            </section>
          )
        })}
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
