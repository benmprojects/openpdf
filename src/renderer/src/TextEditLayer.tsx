import { useEffect, useRef, useState } from 'react'
import type { PdfClient, TextObject } from './pdfClient'

/** Edit Text tool: outlines the text runs of a page; click one to change its text in place. */
export function TextEditLayer({
  client,
  page,
  zoom,
  onCommit
}: {
  client: PdfClient
  page: number
  zoom: number
  /** `total` is how many text objects the page has, so the writer can check it is editing the right one. */
  onCommit: (page: number, obj: TextObject, total: number, text: string) => void
}) {
  const [data, setData] = useState<{ objects: TextObject[]; total: number } | null>(null)
  const [editing, setEditing] = useState<number | null>(null)
  const area = useRef<HTMLTextAreaElement>(null)
  const done = useRef(false)

  useEffect(() => {
    let cancelled = false
    client
      .textObjects(page)
      .then((d) => !cancelled && setData(d))
      .catch(() => !cancelled && setData({ objects: [], total: 0 }))
    return () => {
      cancelled = true
    }
  }, [client, page])

  if (!data) return null
  const obj = editing === null ? undefined : data.objects.find((o) => o.ordinal === editing)

  const finish = (save: boolean) => {
    if (done.current || !obj) return
    done.current = true
    const text = area.current?.value ?? obj.text
    setEditing(null)
    if (save && text !== obj.text) onCommit(page, obj, data.total, text)
  }

  const family = /courier|mono|consolas/i.test(obj?.font ?? '') ? 'monospace' : /times|serif|georgia|garamond|cambria/i.test(obj?.font ?? '') && !/sans/i.test(obj?.font ?? '') ? 'serif' : 'sans-serif'

  return (
    <div
      className="textedit-layer"
      onMouseDown={(e) => {
        // The tool owns the page: no text selection or other gestures underneath.
        e.stopPropagation()
        if (e.target === e.currentTarget) finish(true)
      }}
    >
      {data.objects.map((o) => {
        const on = o.ordinal === editing
        if (on) return null
        return (
          <button
            key={o.ordinal}
            type="button"
            className="textedit-box"
            aria-label={`Edit text: ${o.text}`}
            title={o.text}
            style={{ left: o.rect.x * zoom - 1, top: o.rect.y * zoom - 1, width: o.rect.w * zoom + 2, height: o.rect.h * zoom + 2 }}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={() => {
              done.current = false
              setEditing(o.ordinal)
            }}
          />
        )
      })}
      {obj && (
        <textarea
          ref={area}
          className="textedit-input"
          aria-label="Edit text"
          autoFocus
          defaultValue={obj.text}
          rows={1}
          spellCheck
          onFocus={(e) => e.currentTarget.select()}
          onMouseDown={(e) => e.stopPropagation()}
          onBlur={() => finish(true)}
          onKeyDown={(e) => {
            e.stopPropagation()
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              finish(true)
            } else if (e.key === 'Escape') {
              e.preventDefault()
              finish(false)
            }
          }}
          style={{
            left: obj.rect.x * zoom - 3,
            top: obj.rect.y * zoom - 3,
            minWidth: obj.rect.w * zoom + 8,
            height: obj.rect.h * zoom + 6,
            fontSize: Math.max(8, obj.size * zoom * Math.hypot(obj.matrix[0], obj.matrix[1])),
            fontFamily: family,
            color: obj.color,
            fontWeight: /bold|black|heavy/i.test(obj.font) || obj.weight >= 600 ? 700 : 400,
            fontStyle: obj.italic || /italic|oblique/i.test(obj.font) ? 'italic' : 'normal'
          }}
        />
      )}
    </div>
  )
}
