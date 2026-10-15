import { useState } from 'react'
import { Modal } from './AppDialogs'
import { ALL_ALLOWED, type EncryptOptions, type Permissions } from '../../shared/pdfSecurity'

/** Passwords and permissions for the saved file. Applying sets them; "Remove security" clears them. */
export function SecurityDialog({
  protectedNow,
  describe,
  onApply,
  onRemove,
  onClose
}: {
  /** The document is currently protected (as opened, or by an earlier choice here). */
  protectedNow: boolean
  /** One line saying how, e.g. "AES-256, copying not allowed". */
  describe: string
  onApply: (o: EncryptOptions) => void
  onRemove: () => void
  onClose: () => void
}) {
  const [needOpen, setNeedOpen] = useState(false)
  const [userPw, setUserPw] = useState('')
  const [confirmPw, setConfirmPw] = useState('')
  const [restrict, setRestrict] = useState(false)
  const [ownerPw, setOwnerPw] = useState('')
  const [perm, setPerm] = useState<Permissions>({ ...ALL_ALLOWED })
  const [level, setLevel] = useState<128 | 256>(256)
  const [error, setError] = useState('')
  const set = (patch: Partial<Permissions>) => setPerm({ ...perm, ...patch })

  const submit = () => {
    if (!needOpen && !restrict) return setError('Choose a password to open the document, restrictions, or both. To remove protection, use "Remove security".')
    if (needOpen && !userPw) return setError('Enter the password people will need to open the document.')
    if (needOpen && userPw !== confirmPw) return setError('The two passwords are not the same.')
    if (restrict && !ownerPw) return setError('Enter a permissions password: it is what lifts the restrictions.')
    if (restrict && needOpen && ownerPw === userPw) return setError('The permissions password must be different from the open password.')
    onApply({ userPassword: needOpen ? userPw : '', ownerPassword: restrict ? ownerPw : needOpen ? userPw : ownerPw || 'openpdf-owner', keyLength: level, permissions: restrict ? perm : { ...ALL_ALLOWED } })
  }

  return (
    <Modal title="Security" onClose={onClose}>
      <form
        className="marks-form props-form"
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        <p className="muted">{protectedNow ? `This document is protected${describe ? `: ${describe}` : ''}. Choosing new settings replaces them.` : 'This document is not protected.'} The protection is applied when you save.</p>

        <label className="inline">
          <input type="checkbox" checked={needOpen} onChange={(e) => setNeedOpen(e.target.checked)} /> Require a password to open the document
        </label>
        {needOpen && (
          <>
            <label className="props-row">
              <span>Open password</span>
              <input aria-label="Open password" type="password" value={userPw} onChange={(e) => setUserPw(e.target.value)} />
            </label>
            <label className="props-row">
              <span>Confirm</span>
              <input aria-label="Confirm open password" type="password" value={confirmPw} onChange={(e) => setConfirmPw(e.target.value)} />
            </label>
          </>
        )}

        <label className="inline">
          <input type="checkbox" checked={restrict} onChange={(e) => setRestrict(e.target.checked)} /> Restrict printing, editing and copying
        </label>
        {restrict && (
          <>
            <label className="props-row">
              <span>Permissions password</span>
              <input aria-label="Permissions password" type="password" value={ownerPw} onChange={(e) => setOwnerPw(e.target.value)} />
            </label>
            <label className="props-row">
              <span>Printing</span>
              <select aria-label="Printing" value={perm.print} onChange={(e) => set({ print: e.target.value as Permissions['print'] })}>
                <option value="full">Allowed</option>
                <option value="low">Low resolution only</option>
                <option value="none">Not allowed</option>
              </select>
            </label>
            <div className="marks-remove" role="group" aria-label="Allowed">
              <label className="inline">
                <input type="checkbox" checked={perm.extract} onChange={(e) => set({ extract: e.target.checked })} /> Copying text and images
              </label>
              <label className="inline">
                <input type="checkbox" checked={perm.accessibility} onChange={(e) => set({ accessibility: e.target.checked })} /> Screen readers
              </label>
              <label className="inline">
                <input type="checkbox" checked={perm.annotate} onChange={(e) => set({ annotate: e.target.checked })} /> Commenting
              </label>
              <label className="inline">
                <input type="checkbox" checked={perm.form} onChange={(e) => set({ form: e.target.checked })} /> Filling in forms
              </label>
              <label className="inline">
                <input type="checkbox" checked={perm.assemble} onChange={(e) => set({ assemble: e.target.checked })} /> Inserting, deleting and rotating pages
              </label>
              <label className="inline">
                <input type="checkbox" checked={perm.modifyOther} onChange={(e) => set({ modifyOther: e.target.checked })} /> Editing the content
              </label>
            </div>
          </>
        )}

        {(needOpen || restrict) && (
          <label className="props-row">
            <span>Encryption</span>
            <select aria-label="Encryption" value={level} onChange={(e) => setLevel(Number(e.target.value) as 128 | 256)}>
              <option value={256}>AES 256-bit (recommended)</option>
              <option value={128}>AES 128-bit (older readers)</option>
            </select>
          </label>
        )}
        {error && (
          <p className="error-text" role="alert">
            {error}
          </p>
        )}
        <div className="marks-actions">
          {protectedNow && (
            <button type="button" onClick={onRemove}>
              Remove security
            </button>
          )}
          <span style={{ flex: 1 }} />
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="primary" type="submit">
            Apply
          </button>
        </div>
      </form>
    </Modal>
  )
}
