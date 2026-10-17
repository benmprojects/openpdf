import { useEffect, useMemo, useRef, useState } from 'react'
import type { PdfClient } from './pdfClient'
import { groupBlocks, type TextBlock } from './textBlocks'
import type { TextObject } from './pdfiumRaw'
import type { PageFontInfo } from './embeddedFont'
import { AlignCenter, AlignJustify, AlignLeft, AlignRight } from 'lucide-react'
import { formatIsEmpty, weightAndSlant, type StandardFamily, type TextFormat } from './textEdit'
import { msg, t } from './i18n'

const FAMILY_LABEL: Record<StandardFamily, string> = {
  helvetica: msg('Helvetica (sans serif)'),
  times: msg('Times Roman (serif)'),
  courier: msg('Courier (fixed width)'),
  symbol: msg('Symbol'),
  zapf: msg('Zapf Dingbats')
}

/**
 * Edit Text tool: outlines the text of a page, a paragraph at a time where lines belong together and a run at a time
 * otherwise; click one to change its text in place. Enter commits, Shift+Enter starts a new line, Escape cancels.
 */
export function TextEditLayer({
  client,
  page,
  zoom,
  onCommit,
  loadFonts
}: {
  client: PdfClient
  page: number
  zoom: number
  /** `total` is how many text objects the page has, so the writer can check it is editing the right ones. */
  onCommit: (page: number, block: TextBlock, total: number, text: string, format?: TextFormat) => void
  /** The fonts the page already uses, for the font list. */
  loadFonts?: (page: number) => Promise<PageFontInfo[]>
}) {
  const [data, setData] = useState<{ objects: TextObject[]; total: number; rotation: number } | null>(null)
  const [editing, setEditing] = useState<number | null>(null)
  const area = useRef<HTMLTextAreaElement>(null)
  const done = useRef(false)
  const bar = useRef<HTMLDivElement>(null)
  const [format, setFormat] = useState<TextFormat>({})
  const omit = (f: TextFormat, key: keyof TextFormat): TextFormat => {
    const rest = { ...f }
    delete rest[key]
    return rest
  }
  /** Sets or clears a number in the format from what was typed (empty clears it; anything that is not a number is ignored). */
  const [spText, setSpText] = useState({ charSpacing: '', wordSpacing: '', horizontalScale: '' })
  const setNumber = (key: 'charSpacing' | 'wordSpacing' | 'horizontalScale', text: string) => {
    setSpText((o) => ({ ...o, [key]: text }))
    setFormat((f) => {
      if (text.trim() === '' || text === '-') return omit(f, key)
      const v = Number(text)
      if (!Number.isFinite(v)) return f
      if (key === 'horizontalScale' && !(v >= 10 && v <= 400)) return f
      return { ...f, [key]: v }
    })
  }
  const [fonts, setFonts] = useState<PageFontInfo[]>([])
  const [sizeText, setSizeText] = useState('')

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

  useEffect(() => {
    setFormat({})
    setSpText({ charSpacing: '', wordSpacing: '', horizontalScale: '' })
    setSizeText('')
    if (editing === null || !loadFonts) return
    let live = true
    loadFonts(page)
      .then((f) => live && setFonts(f))
      .catch(() => live && setFonts([]))
    return () => {
      live = false
    }
  }, [editing, page, loadFonts])

  const blocks = useMemo(() => (data ? groupBlocks(data.objects, data.rotation) : []), [data])
  if (!data) return null
  const block = editing === null ? undefined : blocks.find((b) => b.ordinals[0] === editing)

  const finish = (save: boolean) => {
    if (done.current || !block) return
    done.current = true
    const text = area.current?.value ?? block.text
    setEditing(null)
    if (save && (text !== block.text || !formatIsEmpty(format))) onCommit(page, block, data.total, text, formatIsEmpty(format) ? undefined : format)
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
        <div
          ref={bar}
          className="textedit-format"
          role="toolbar"
          aria-label={t('Text format')}
          style={{ left: block.rect.x * zoom - 3, top: Math.max(0, block.rect.y * zoom - 44) }}
          onMouseDown={(e) => {
            e.stopPropagation()
            if (!(e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.target instanceof HTMLButtonElement)) e.preventDefault()
          }}
          onBlur={(e) => {
            const to = e.relatedTarget as Node | null
            if (!bar.current?.contains(to) && to !== area.current) finish(true)
          }}
          onKeyDown={(e) => {
            e.stopPropagation()
            if (e.key === 'Escape') finish(false)
            else if (e.key === 'Enter' && !(e.target instanceof HTMLSelectElement)) {
              e.preventDefault()
              finish(true)
            }
          }}
        >
          {(() => {
            const base = weightAndSlant(block)
            const bold = format.bold ?? base.bold
            const italic = format.italic ?? base.italic
            const scale = Math.hypot(block.matrix[0], block.matrix[1]) || 1
            const effective = Math.round(block.size * scale * 10) / 10
            const fontValue = format.pageFont ? `page:${format.pageFont}` : format.family ? `std:${format.family}` : 'auto'
            const picked = fonts.find((f) => f.resource === format.pageFont)
            const noStyles = !!format.pageFont || format.family === 'symbol' || format.family === 'zapf'
            const noStylesHint = t('This font has no bold or italic version here; choose a standard font.')
            return (
              <>
                <label>
                  <span>{t('Font')}</span>
                  <select
                    aria-label={t('Font')}
                    value={fontValue}
                    onChange={(e) => {
                      const v = e.target.value
                      const rest: TextFormat = { ...format }
                      delete rest.family
                      delete rest.pageFont
                      if (v === 'auto') setFormat(rest)
                      else if (v.startsWith('page:')) setFormat({ ...rest, pageFont: v.slice(5) })
                      else setFormat({ ...rest, family: v.slice(4) as StandardFamily })
                    }}
                  >
                    <option value="auto">{t('Matched to the original ({font})', { font: block.font || '?' })}</option>
                    {(Object.keys(FAMILY_LABEL) as StandardFamily[]).map((f) => (
                      <option key={f} value={`std:${f}`}>
                        {t(FAMILY_LABEL[f])}
                      </option>
                    ))}
                    {fonts.map((f) => (
                      <option key={f.resource} value={`page:${f.resource}`}>
                        {f.subset ? t('In this file: {font} (subset)', { font: f.baseFont }) : t('In this file: {font}', { font: f.baseFont })}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>{t('Size')}</span>
                  <input
                    aria-label={t('Font size (points)')}
                    inputMode="decimal"
                    size={4}
                    value={sizeText || String(effective)}
                    onChange={(e) => {
                      setSizeText(e.target.value)
                      const v = Number(e.target.value)
                      setFormat((f) => {
                        const rest: TextFormat = { ...f }
                        delete rest.size
                        return v > 0 && Number.isFinite(v) && Math.abs(v - effective) > 0.04 ? { ...rest, size: v } : rest
                      })
                    }}
                  />
                </label>
                <label>
                  <span>{t('Colour')}</span>
                  <input type="color" aria-label={t('Text colour')} value={format.color ?? block.color} onChange={(e) => setFormat({ ...format, color: e.target.value })} />
                </label>
                <button type="button" aria-label={t('Bold')} aria-pressed={bold} disabled={noStyles} title={noStyles ? noStylesHint : t('Bold')} onClick={() => setFormat({ ...format, bold: !bold })}>
                  <b>B</b>
                </button>
                <button type="button" aria-label={t('Italic')} aria-pressed={italic} disabled={noStyles} title={noStyles ? noStylesHint : t('Italic')} onClick={() => setFormat({ ...format, italic: !italic })}>
                  <i>I</i>
                </button>
                <span className="textedit-spacing" role="group" aria-label={t('Spacing and alignment')}>
                  <label>
                    <span>{t('Letter gap')}</span>
                    <input aria-label={t('Character spacing (points)')} inputMode="decimal" size={3} placeholder="0" value={spText.charSpacing} onChange={(e) => setNumber('charSpacing', e.target.value)} />
                  </label>
                  <label>
                    <span>{t('Word gap')}</span>
                    <input aria-label={t('Word spacing (points)')} inputMode="decimal" size={3} placeholder="0" value={spText.wordSpacing} onChange={(e) => setNumber('wordSpacing', e.target.value)} />
                  </label>
                  <label>
                    <span>{t('Width %')}</span>
                    <input aria-label={t('Letter width (percent)')} inputMode="numeric" size={3} placeholder="100" value={spText.horizontalScale} onChange={(e) => setNumber('horizontalScale', e.target.value)} />
                  </label>
                  {(
                    [
                      ['left', AlignLeft, t('Align left')],
                      ['centre', AlignCenter, t('Align centre')],
                      ['right', AlignRight, t('Align right')],
                      ['justify', AlignJustify, t('Justify')]
                    ] as const
                  ).map(([value, Icon, label]) => (
                    <button key={value} type="button" aria-label={label} title={label} aria-pressed={(format.align ?? 'left') === value} onClick={() => setFormat((f) => (value === 'left' ? omit(f, 'align') : { ...f, align: value }))}>
                      <Icon size={14} aria-hidden />
                    </button>
                  ))}
                </span>
                {picked?.subset && <p className="hint muted">{t('A subset font only holds the characters the file already uses. If the text needs others, the change is refused.')}</p>}
              </>
            )
          })()}
        </div>
      )}
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
          onBlur={(e) => {
            // Moving to the format bar is not leaving the edit.
            if (bar.current?.contains(e.relatedTarget as Node | null)) return
            finish(true)
          }}
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
