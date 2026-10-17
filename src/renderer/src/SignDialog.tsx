import { useEffect, useState } from 'react'
import { Modal } from './AppDialogs'
import type { CertInfo, SignSource } from '../../main/signing'
import type { CertifyLevel } from './sign'
import { t } from './i18n'

export interface SignRequest {
  source: SignSource
  signerName: string
  reason: string
  location: string
  contact: string
  visible: boolean
  certify?: CertifyLevel
  /** A time-stamping server to ask for a trusted time, or empty for none. */
  tsaUrl: string
  /** Keep the certificates and their revocation answers (OCSP, CRL) in the file, so the signature can be checked long after. */
  ltv: boolean
}

const TSA_PRESETS: [string, string][] = [
  ['', 'None'],
  ['http://timestamp.digicert.com', 'DigiCert'],
  ['http://timestamp.sectigo.com', 'Sectigo'],
  ['https://freetsa.org/tsr', 'FreeTSA']
]

const TSA_KEY = 'openpdf.tsa'
const savedTsa = (): string => {
  try {
    return localStorage.getItem(TSA_KEY) ?? ''
  } catch {
    return ''
  }
}

const REASONS = ['I am the author of this document', 'I have reviewed this document', 'I approve this document', 'I agree to the terms of this document']

/** Choose a certificate and how the signature looks, then sign. */
export function SignDialog({ canCertify, onSign, onClose }: { canCertify: boolean; onSign: (r: SignRequest) => void; onClose: () => void }) {
  const [certs, setCerts] = useState<CertInfo[] | null>(null)
  const [thumb, setThumb] = useState('')
  const [pfx, setPfx] = useState<{ name: string; data: Uint8Array } | null>(null)
  const [pfxPw, setPfxPw] = useState('')
  const [pfxCert, setPfxCert] = useState<CertInfo | null>(null)
  const [reason, setReason] = useState('')
  const [location, setLocation] = useState('')
  const [contact, setContact] = useState('')
  const [visible, setVisible] = useState(false)
  const [certify, setCertify] = useState<'' | '1' | '2' | '3'>('')
  const [tsa, setTsa] = useState(savedTsa)
  const [ltv, setLtv] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let live = true
    window.openpdf
      .signCertificates()
      .then((c) => live && setCerts(c))
      .catch(() => live && setCerts([]))
    return () => {
      live = false
    }
  }, [])

  const choosePfx = async () => {
    const f = await window.openpdf.pickFile({ name: 'Certificates', ext: ['pfx', 'p12'] })
    if (!f) return
    setPfx(f)
    setPfxCert(null)
    setThumb('')
    setError('')
  }
  const unlockPfx = async () => {
    if (!pfx) return
    try {
      setPfxCert(await window.openpdf.pfxInfo(pfx.data, pfxPw))
      setError('')
    } catch {
      setPfxCert(null)
      setError('That password did not open the certificate file.')
    }
  }

  const chosen = pfx && pfxCert ? pfxCert : certs?.find((c) => c.thumbprint === thumb)
  const submit = () => {
    if (!chosen) return setError('Choose a certificate to sign with.')
    try {
      localStorage.setItem(TSA_KEY, tsa)
    } catch {
      // not remembered
    }
    onSign({
      tsaUrl: tsa.trim(),
      ltv,
      source: pfx && pfxCert ? { kind: 'pfx', data: pfx.data, password: pfxPw } : { kind: 'store', thumbprint: chosen.thumbprint },
      signerName: chosen.name || chosen.subject,
      reason,
      location,
      contact,
      visible,
      certify: certify ? (Number(certify) as CertifyLevel) : undefined
    })
  }

  return (
    <Modal title={t('Sign document')} onClose={onClose}>
      <form
        className="marks-form props-form"
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        <div role="radiogroup" aria-label="Certificate" className="marks-remove">
          {certs === null && <p className="muted">Looking for your certificates…</p>}
          {certs?.length === 0 && !pfx && <p className="muted">No certificates with a private key were found in your Windows certificate store. You can use a certificate file instead.</p>}
          {certs?.map((c) => (
            <label key={c.thumbprint} className="inline">
              <input
                type="radio"
                name="cert"
                checked={!pfxCert && thumb === c.thumbprint}
                onChange={() => {
                  setThumb(c.thumbprint)
                  setPfxCert(null)
                }}
              />{' '}
              {c.name || c.subject} <span className="muted">(issued by {c.issuer}, expires {new Date(c.notAfter).toLocaleDateString('en-AU')})</span>
            </label>
          ))}
        </div>
        <div className="marks-actions">
          <button type="button" onClick={() => void choosePfx()}>
            Use a certificate file…
          </button>
          {pfx && <span className="muted">{pfx.name}</span>}
        </div>
        {pfx && (
          <label className="props-row">
            <span>File password</span>
            <input
              aria-label="Certificate file password"
              type="password"
              value={pfxPw}
              onChange={(e) => {
                setPfxPw(e.target.value)
                setPfxCert(null)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  void unlockPfx()
                }
              }}
            />
            <button type="button" onClick={() => void unlockPfx()}>
              Open
            </button>
          </label>
        )}
        {pfxCert && <p className="muted">Using {pfxCert.name || pfxCert.subject}.</p>}

        <label className="props-row">
          <span>Reason</span>
          <input aria-label="Reason" list="sign-reasons" value={reason} onChange={(e) => setReason(e.target.value)} />
          <datalist id="sign-reasons">
            {REASONS.map((r) => (
              <option key={r} value={r} />
            ))}
          </datalist>
        </label>
        <label className="props-row">
          <span>Location</span>
          <input aria-label="Location" value={location} onChange={(e) => setLocation(e.target.value)} />
        </label>
        <label className="props-row">
          <span>Contact</span>
          <input aria-label="Contact" value={contact} onChange={(e) => setContact(e.target.value)} />
        </label>
        <label className="props-row">
          <span>Appearance</span>
          <select aria-label="Appearance" value={visible ? 'visible' : 'invisible'} onChange={(e) => setVisible(e.target.value === 'visible')}>
            <option value="invisible">Invisible (listed in the signatures panel)</option>
            <option value="visible">Visible: draw a box on the page</option>
          </select>
        </label>
        <label className="props-row">
          <span>Time-stamp</span>
          <select aria-label="Time-stamp server" value={TSA_PRESETS.some(([u]) => u === tsa) ? tsa : 'other'} onChange={(e) => setTsa(e.target.value === 'other' ? 'https://' : e.target.value)}>
            {TSA_PRESETS.map(([u, n]) => (
              <option key={u} value={u}>
                {n}
                {u ? ` (${u})` : ' (the signing time is taken from this computer)'}
              </option>
            ))}
            <option value="other">Another server…</option>
          </select>
        </label>
        {!TSA_PRESETS.some(([u]) => u === tsa) && (
          <label className="props-row">
            <span>Server address</span>
            <input aria-label="Time-stamp server address" value={tsa} onChange={(e) => setTsa(e.target.value)} />
          </label>
        )}
        <label className="inline">
          <input type="checkbox" checked={ltv} onChange={(e) => setLtv(e.target.checked)} /> {t('Keep the proof that the certificates were valid in the file (long-term validation)')}
        </label>
        {ltv && <p className="muted small">{t('This asks the certificate authorities named in the certificates (over the internet) whether each certificate was valid, and stores their answers with the certificates. It works best with a time-stamp. Answers that cannot be fetched are skipped, and the document is signed either way.')}</p>}
        {canCertify && (
          <label className="props-row">
            <span>Certify</span>
            <select aria-label="Certify" value={certify} onChange={(e) => setCertify(e.target.value as typeof certify)}>
              <option value="">No: an ordinary approval signature</option>
              <option value="1">Certify: no changes allowed</option>
              <option value="2">Certify: form filling and signing allowed</option>
              <option value="3">Certify: also comments allowed</option>
            </select>
          </label>
        )}
        {error && (
          <p className="error-text" role="alert">
            {error}
          </p>
        )}
        <div className="marks-actions">
          <span style={{ flex: 1 }} />
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="primary" type="submit" disabled={!chosen}>
            {visible ? 'Next: draw the box' : 'Sign'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
