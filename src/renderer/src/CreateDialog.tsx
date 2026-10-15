import { useState } from 'react'
import { Modal } from './AppDialogs'
import type { PageSizeChoice, TextOptions } from './createPdf'

export type CreateRequest = { kind: 'images'; size: PageSizeChoice } | { kind: 'text'; font: TextOptions['font']; fontSize: number }

/** Options for a PDF made from pictures or from a text file. */
export function CreateDialog({ kind, files, onCreate, onClose }: { kind: 'images' | 'text'; files: string[]; onCreate: (r: CreateRequest) => void; onClose: () => void }) {
  const [size, setSize] = useState<PageSizeChoice>('image')
  const [font, setFont] = useState<TextOptions['font']>('Helvetica')
  const [fontSize, setFontSize] = useState(11)
  return (
    <Modal title={kind === 'images' ? 'Create PDF from pictures' : 'Create PDF from text'} onClose={onClose}>
      <form
        className="marks-form props-form"
        onSubmit={(e) => {
          e.preventDefault()
          onCreate(kind === 'images' ? { kind: 'images', size } : { kind: 'text', font, fontSize })
        }}
      >
        <p className="muted">
          {files.length === 1 ? files[0] : `${files.length} files: ${files.slice(0, 4).join(', ')}${files.length > 4 ? '…' : ''}`}
          {kind === 'images' && files.length > 1 ? ' (one page each, in this order)' : ''}
        </p>
        {kind === 'images' ? (
          <label className="props-row">
            <span>Page size</span>
            <select aria-label="Page size" value={size} onChange={(e) => setSize(e.target.value as PageSizeChoice)}>
              <option value="image">Same as the picture</option>
              <option value="a4">A4, picture fitted</option>
              <option value="letter">Letter, picture fitted</option>
            </select>
          </label>
        ) : (
          <>
            <label className="props-row">
              <span>Font</span>
              <select aria-label="Font" value={font} onChange={(e) => setFont(e.target.value as TextOptions['font'])}>
                <option value="Helvetica">Helvetica</option>
                <option value="Times">Times</option>
                <option value="Courier">Courier</option>
              </select>
            </label>
            <label className="props-row">
              <span>Size</span>
              <input aria-label="Font size" type="number" min={6} max={36} value={fontSize} onChange={(e) => setFontSize(Math.max(6, Math.min(36, Number(e.target.value) || 11)))} />
            </label>
          </>
        )}
        <div className="marks-actions">
          <span style={{ flex: 1 }} />
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="primary" type="submit">
            Create
          </button>
        </div>
      </form>
    </Modal>
  )
}
