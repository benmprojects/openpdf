import { useEffect, useState } from 'react'
import { Modal } from './AppDialogs'
import type { MediaItem } from './media'

/** Plays an audio or video file from the document in the browser's own player. */
export function MediaPlayerDialog({ item, onClose }: { item: MediaItem; onClose: () => void }) {
  const [url, setUrl] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    const u = URL.createObjectURL(new Blob([new Uint8Array(item.read())], { type: item.mime }))
    setUrl(u)
    return () => URL.revokeObjectURL(u)
  }, [item])
  return (
    <Modal title={item.name} onClose={onClose}>
      <div className="marks-form">
        {url && item.kind === 'video' && <video aria-label={item.name} src={url} controls autoPlay style={{ width: '100%', maxHeight: '60vh' }} onError={() => setFailed(true)} />}
        {url && item.kind === 'audio' && <audio aria-label={item.name} src={url} controls autoPlay style={{ width: '100%' }} onError={() => setFailed(true)} />}
        {failed && (
          <p role="alert" className="error-text">
            This file could not be played here (its format or codec is not supported). Save a copy to open it in another program.
          </p>
        )}
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
