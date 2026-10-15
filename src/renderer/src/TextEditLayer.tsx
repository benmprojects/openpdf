import { useEffect, useMemo, useRef, useState } from 'react'
import type { PdfClient } from './pdfClient'
import { groupBlocks, type TextBlock } from './textBlocks'
import type { TextObject } from './pdfiumRaw'

/**
 * Edit Text tool: outlines the text of a page, a paragraph at a time where lines belong together and a run at a time
 * otherwise; click one to change its text in place. Enter commits, Shift+Enter starts a new line, Escape cancels.
 */
export function TextEditLayer({
  client,
  page,
  zoom,
  onCommit
}: {
  client: PdfClient
  page: number
  zoom: number
  /** `total` is how many text objects the page has, so the writer can check it is editing the right ones. */
  onCommit: (page: number, block: TextBlock, total: number, text: string) => void
}) {
  const [data, setData] = useState<{ objects: TextObject[]; total: number; rotation: number } | null>(null)
  const [editing, setEditing] = useState<number | null>(null)
  const area = useRef<HTMLTextAreaElement>(null)
  const done = useRef(false)

  useEffect(() => {
    let cancelled = false
    client
      .textObjects(page)
      .then((d) => !cancelled && setData(d))
      .catch(() => !cancelled && setData({ objects: [], total: 0, rotation: 0 }))
    return () => {
      cancelled = true
    }
  }, [client, page])

  const blocks = useMemo(() => (data ? groupBlocks(data.objects, data.rotation) : []), [data])
  if (!data) return null
  const block = editing === null ? undefined : blocks.find((b) => b.ordinals[0] === editing)

  const finish = (save: boolean) => {
    if (done.current || !block) return
    done.current = true
    const text = area.current?.value ?? block.text
    setEditing(null)
    if (save && text !== block.text) onCommit(page, block, data.total, text)
  }

  const name = block?.font ?? ''
  const family = /courier|mono|consolas/i.test(name) ? 'monospace' : /times|serif|georgia|garamond|cambria/i.test(name) && !/sans/i.test(name) ? 'serif' : 'sans-serif'
  const multi = !!block && block.layout.leading > 0
  const grow = (el: HTMLTextAreaElement) => {
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }

  return (
    <div
      className="textedit-layer"
      onMouseDown={(e) => {
        // The tool owns the page: no text selection or other gestures underneath.
        e.stopPropagation()
        if (e.target === e.currentTarget) finish(true)
      }}
    >
      {blocks.map((b) => {
        if (block && b.ordinals[0] === block.ordinals[0]) return null
        return (
          <button
            key={b.ordinals[0]}
            type="button"
            className={`textedit-box${b.reflow ? ' block' : ''}`}
            aria-label={`Edit text: ${b.text}`}
            title={b.reflow && b.layout.leading > 0 ? `${b.text}\n(a paragraph: it is rewrapped when edited)` : b.text}
            style={{ left: b.rect.x * zoom - 1, top: b.rect.y * zoom - 1, width: b.rect.w * zoom + 2, height: b.rect.h * zoom + 2 }}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={() => {
              done.current = false
              setEditing(b.ordinals[0])
            }}
          />
        )
      })}
      {block && (
        <textarea
          ref={area}
          className="textedit-input"
          aria-label="Edit text"
          autoFocus
          defaultValue={block.text}
          rows={1}
          spellCheck
          onFocus={(e) => {
            e.currentTarget.select()
            if (multi) grow(e.currentTarget)
          }}
          onInput={(e) => multi && grow(e.currentTarget)}
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
            left: block.rect.x * zoom - 3,
            top: block.rect.y * zoom - 3,
            ...(multi ? { width: block.rect.w * zoom + 8, whiteSpace: 'pre-wrap' as const, lineHeight: `${block.layout.leading * zoom}px` } : { minWidth: block.rect.w * zoom + 8, height: block.rect.h * zoom + 6 }),
            fontSize: Math.max(8, block.size * zoom * Math.hypot(block.matrix[0], block.matrix[1])),
            fontFamily: family,
            color: block.color,
            fontWeight: /bold|black|heavy/i.test(name) || block.weight >= 600 ? 700 : 400,
            fontStyle: block.italic || /italic|oblique/i.test(name) ? 'italic' : 'normal'
          }}
        />
      )}
    </div>
  )
}
