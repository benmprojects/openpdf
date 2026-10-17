import { useEffect, useMemo, useRef, useState } from 'react'
import { Modal } from './AppDialogs'
import { normalisePicture } from './createPdf'
import { t } from './i18n'
import { encodeRotatedPng } from './print'
import {
  CAT_INITIALS,
  CAT_SIGNATURES,
  initialsOf,
  INK_COLOURS,
  installedFonts,
  smoothStroke,
  strokeWidths,
  TYPED_FONTS,
  type InkPoint
} from './signatureLogic'
import { trimTransparent, whiteToAlpha } from './stampImage'
import type { StampDef } from './stampLogic'

// ---- Making a signature --------------------------------------------------------------------------------------

export interface NewSignature {
  name: string
  category: string
  png: Uint8Array
}

type Way = 'draw' | 'type' | 'image'

const DRAW_W = 840
const DRAW_H = 270
const MAX_PICTURE = 1600

/** Draws smoothed strokes (pen width varies with speed or pressure) onto a canvas context. */
function paintStrokes(ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D, strokes: InkPoint[][], colour: string) {
  ctx.strokeStyle = colour
  ctx.fillStyle = colour
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  for (const raw of strokes) {
    const pts = smoothStroke(raw)
    const w = strokeWidths(pts, 4.5)
    if (pts.length === 1) {
      ctx.beginPath()
      ctx.arc(pts[0].x, pts[0].y, w[0] / 2, 0, Math.PI * 2)
      ctx.fill()
      continue
    }
    for (let i = 1; i < pts.length; i++) {
      ctx.lineWidth = (w[i - 1] + w[i]) / 2
      ctx.beginPath()
      ctx.moveTo(pts[i - 1].x, pts[i - 1].y)
      ctx.lineTo(pts[i].x, pts[i].y)
      ctx.stroke()
    }
  }
}

/** A transparent PNG, trimmed of empty space, of whatever `paint` draws on a canvas of the given size. */
async function renderPng(w: number, h: number, paint: (ctx: OffscreenCanvasRenderingContext2D) => void): Promise<Uint8Array | null> {
  const canvas = new OffscreenCanvas(w, h)
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  paint(ctx)
  const rgba = new Uint8Array(ctx.getImageData(0, 0, w, h).data.buffer.slice(0))
  const cut = trimTransparent(rgba, w, h, 6)
  if (cut.w === w && cut.h === h && !rgba.some((v, i) => i % 4 === 3 && v > 8)) return null // nothing drawn
  return encodeRotatedPng(cut.w, cut.h, cut.data, 0)
}

/** The person's picture, decoded to RGBA and no larger than MAX_PICTURE along its longer side. */
async function decodePicture(data: Uint8Array): Promise<{ rgba: Uint8Array; w: number; h: number }> {
  const pic = await normalisePicture(data)
  const bmp = await createImageBitmap(new Blob([pic.data as BlobPart]))
  const k = Math.min(1, MAX_PICTURE / Math.max(bmp.width, bmp.height))
  const w = Math.max(1, Math.round(bmp.width * k))
  const h = Math.max(1, Math.round(bmp.height * k))
  const canvas = new OffscreenCanvas(w, h)
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(bmp, 0, 0, w, h)
  bmp.close()
  return { rgba: new Uint8Array(ctx.getImageData(0, 0, w, h).data.buffer.slice(0)), w, h }
}

function useInstalledFonts() {
  return useMemo(() => {
    const ctx = document.createElement('canvas').getContext('2d')!
    const sample = 'Wxyzgqj Sample 0123'
    const width = (family: string) => {
      ctx.font = `64px ${family}, monospace`
      return ctx.measureText(sample).width
    }
    ctx.font = '64px monospace'
    return installedFonts(TYPED_FONTS, width, ctx.measureText(sample).width)
  }, [])
}

/** Draw, type or import a signature or initials, and save it to the library. */
export function SignatureMaker({ initialKind, author, existing, onSave, onCancel }: { initialKind: 'signature' | 'initials'; author: string; existing: StampDef[]; onSave: (s: NewSignature) => void; onCancel: () => void }) {
  const [way, setWay] = useState<Way>('draw')
  const [kind, setKind] = useState(initialKind)
  const [colour, setColour] = useState<string>(INK_COLOURS[0].value)
  const [name, setName] = useState('')
  const [text, setText] = useState(initialKind === 'initials' ? initialsOf(author) : author)
  const fonts = useInstalledFonts()
  const [fontId, setFontId] = useState(fonts[0].id)
  const [strokes, setStrokes] = useState<InkPoint[][]>([])
  const [whiteOut, setWhiteOut] = useState(true)
  const [trim, setTrim] = useState(true)
  const [picture, setPicture] = useState<{ rgba: Uint8Array; w: number; h: number; file: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const canvas = useRef<HTMLCanvasElement>(null)
  const preview = useRef<HTMLCanvasElement>(null)
  const live = useRef<InkPoint[] | null>(null)

  const category = kind === 'initials' ? CAT_INITIALS : CAT_SIGNATURES
  const font = fonts.find((f) => f.id === fontId) ?? fonts[0]
  const defaultName = useMemo(() => {
    const base = kind === 'initials' ? t('My initials') : t('My signature')
    const taken = existing.filter((s) => s.category === category).map((s) => s.name)
    let n = base
    for (let i = 2; taken.includes(n); i++) n = `${base} ${i}`
    return n
  }, [kind, existing, category])

  // The drawing area is repainted from the strokes.
  useEffect(() => {
    const c = canvas.current
    if (!c || way !== 'draw') return
    const ctx = c.getContext('2d')!
    ctx.clearRect(0, 0, c.width, c.height)
    paintStrokes(ctx, live.current ? [...strokes, live.current] : strokes, colour)
  }, [strokes, colour, way])

  const paintTyped = (ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D, w: number, h: number) => {
    ctx.clearRect(0, 0, w, h)
    ctx.fillStyle = colour
    ctx.textBaseline = 'middle'
    ctx.font = `120px ${font.family}, cursive`
    ctx.fillText(text, 20, h / 2)
  }
  const typedWidth = () => {
    const ctx = document.createElement('canvas').getContext('2d')!
    ctx.font = `120px ${font.family}, cursive`
    return Math.min(2400, Math.ceil(ctx.measureText(text).width) + 40)
  }

  // Previews for typing and pictures.
  useEffect(() => {
    const c = preview.current
    if (!c) return
    const ctx = c.getContext('2d')!
    if (way === 'type') {
      c.width = typedWidth()
      c.height = 190
      paintTyped(ctx, c.width, c.height)
    } else if (way === 'image' && picture) {
      c.width = picture.w
      c.height = picture.h
      const px = whiteOut ? whiteToAlpha(picture.rgba) : picture.rgba
      ctx.putImageData(new ImageData(new Uint8ClampedArray(px.buffer.slice(px.byteOffset, px.byteOffset + px.byteLength) as ArrayBuffer), picture.w, picture.h), 0, 0)
    }
  }) // eslint-disable-line react-hooks/exhaustive-deps

  const point = (e: React.PointerEvent<HTMLCanvasElement>): InkPoint => {
    const r = e.currentTarget.getBoundingClientRect()
    return { x: ((e.clientX - r.left) * DRAW_W) / r.width, y: ((e.clientY - r.top) * DRAW_H) / r.height, t: e.timeStamp, p: e.pointerType === 'mouse' ? undefined : e.pressure }
  }

  const choosePicture = async () => {
    setError(null)
    const file = await window.openpdf.pickFile({ name: 'Pictures', ext: ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'tif', 'tiff'] })
    if (!file) return
    try {
      setPicture({ ...(await decodePicture(file.data)), file: file.name })
      setName((n) => n || file.name.replace(/\.[^.]+$/, ''))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const save = async () => {
    setBusy(true)
    setError(null)
    try {
      let png: Uint8Array | null = null
      if (way === 'draw') png = await renderPng(DRAW_W, DRAW_H, (ctx) => paintStrokes(ctx, strokes, colour))
      else if (way === 'type') {
        const w = typedWidth()
        png = await renderPng(w, 190, (ctx) => paintTyped(ctx, w, 190))
      } else if (picture) {
        const px = whiteOut ? whiteToAlpha(picture.rgba) : picture.rgba
        const cut = trim ? trimTransparent(px, picture.w, picture.h, 4) : { data: px, w: picture.w, h: picture.h }
        png = await encodeRotatedPng(cut.w, cut.h, cut.data, 0)
      }
      if (!png) {
        setError(way === 'draw' ? t('Draw your signature in the box first.') : way === 'type' ? t('Type something first.') : t('Choose a picture first.'))
        return
      }
      onSave({ name: name.trim() || defaultName, category, png })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const inkName = { black: t('Black'), blue: t('Blue'), red: t('Red') }
  const tabs: [Way, string][] = [
    ['draw', t('Draw')],
    ['type', t('Type')],
    ['image', t('Picture')]
  ]

  return (
    <Modal title={t('New signature or initials')} onClose={onCancel} wide>
      <form
        className="pod"
        onSubmit={(e) => {
          e.preventDefault()
          void save()
        }}
      >
        <div className="pod-field">
          <span>{t('Make')}</span>
          <label className="pod-radio">
            <input type="radio" name="sig-kind" checked={kind === 'signature'} onChange={() => setKind('signature')} /> {t('Signature')}
          </label>
          <label className="pod-radio">
            <input type="radio" name="sig-kind" checked={kind === 'initials'} onChange={() => setKind('initials')} /> {t('Initials')}
          </label>
        </div>
        <div role="tablist" aria-label={t('How to make it')} className="sig-tabs">
          {tabs.map(([id, label]) => (
            <button key={id} type="button" role="tab" aria-selected={way === id} className={way === id ? 'primary' : ''} onClick={() => setWay(id)}>
              {label}
            </button>
          ))}
        </div>

        {way === 'draw' && (
          <>
            <canvas
              ref={canvas}
              className="sig-canvas"
              width={DRAW_W}
              height={DRAW_H}
              role="img"
              aria-label={t('Signature drawing area')}
              onPointerDown={(e) => {
                e.currentTarget.setPointerCapture(e.pointerId)
                live.current = [point(e)]
                setStrokes((s) => [...s])
              }}
              onPointerMove={(e) => {
                if (!live.current) return
                live.current.push(point(e))
                setStrokes((s) => [...s])
              }}
              onPointerUp={() => {
                const done = live.current
                live.current = null
                if (done) setStrokes((s) => [...s, done])
              }}
              onPointerCancel={() => {
                live.current = null
                setStrokes((s) => [...s])
              }}
            />
            <div className="pod-field">
              <span className="pod-hint">{t('Draw with the mouse, a pen or a finger. Strokes are smoothed.')}</span>
              <button type="button" disabled={!strokes.length} onClick={() => setStrokes((s) => s.slice(0, -1))}>
                {t('Undo stroke')}
              </button>
              <button type="button" disabled={!strokes.length} onClick={() => setStrokes([])}>
                {t('Clear')}
              </button>
            </div>
          </>
        )}

        {way === 'type' && (
          <>
            <label className="pod-field">
              <span>{t('Text')}</span>
              <input aria-label={t('Text to turn into a signature')} value={text} onChange={(e) => setText(e.target.value)} maxLength={60} />
            </label>
            <label className="pod-field">
              <span>{t('Style')}</span>
              <select aria-label={t('Signature style')} value={font.id} onChange={(e) => setFontId(e.target.value)}>
                {fonts.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.label}
                  </option>
                ))}
              </select>
            </label>
            <div className="sig-preview">
              <canvas ref={preview} aria-label={t('Preview')} role="img" />
            </div>
          </>
        )}

        {way === 'image' && (
          <>
            <div className="pod-field">
              <button type="button" onClick={() => void choosePicture()}>
                {t('Choose picture…')}
              </button>
              <span className="pod-hint">{picture ? picture.file : t('PNG, JPEG, GIF, BMP, WebP or TIFF, such as a scan of your signature on white paper.')}</span>
            </div>
            <label className="pod-check">
              <input type="checkbox" checked={whiteOut} onChange={(e) => setWhiteOut(e.target.checked)} /> {t('Make white transparent')}
            </label>
            <label className="pod-check">
              <input type="checkbox" checked={trim} onChange={(e) => setTrim(e.target.checked)} /> {t('Trim empty space around it')}
            </label>
            {picture && (
              <div className="sig-preview">
                <canvas ref={preview} aria-label={t('Preview')} role="img" />
              </div>
            )}
          </>
        )}

        {way !== 'image' && (
          <div className="pod-field">
            <span>{t('Ink')}</span>
            {INK_COLOURS.map((c) => (
              <label key={c.id} className="pod-radio">
                <input type="radio" name="sig-ink" checked={colour === c.value} onChange={() => setColour(c.value)} />
                <span className="sig-swatch" style={{ background: c.value }} aria-hidden /> {inkName[c.id]}
              </label>
            ))}
          </div>
        )}
        <label className="pod-field">
          <span>{t('Name')}</span>
          <input aria-label={t('Signature name')} value={name} placeholder={defaultName} onChange={(e) => setName(e.target.value)} maxLength={80} />
        </label>
        {error && (
          <p className="pod-error" role="alert">
            {error}
          </p>
        )}
        <div className="pod-actions">
          <button type="submit" className="primary" disabled={busy}>
            {t('Save')}
          </button>
          <button type="button" onClick={onCancel}>
            {t('Cancel')}
          </button>
        </div>
      </form>
    </Modal>
  )
}

// ---- The library ---------------------------------------------------------------------------------------------

/** The saved signatures and initials: choose one to place, rename it, delete it, or make a new one. */
export function SignatureLibrary({
  items,
  onPlace,
  onPlaceMany,
  onNew,
  onRename,
  onDelete,
  onClose
}: {
  items: StampDef[]
  onPlace: (s: StampDef) => void
  onPlaceMany: (s: StampDef) => void
  onNew: (kind: 'signature' | 'initials') => void
  onRename: (s: StampDef) => void
  onDelete: (s: StampDef) => void
  onClose: () => void
}) {
  const [pickedId, setPickedId] = useState<string | null>(null)
  const picked = items.find((s) => s.id === pickedId) ?? null
  const group = (category: string, heading: string) => {
    const list = items.filter((s) => s.category === category)
    return (
      <section>
        <h3 className="sig-heading">{heading}</h3>
        {list.length ? (
          <ul className="sig-grid" aria-label={heading}>
            {list.map((s) => (
              <li key={s.id}>
                <button type="button" className={`sig-item${s.id === pickedId ? ' selected' : ''}`} aria-pressed={s.id === pickedId} aria-label={`${category === CAT_INITIALS ? t('Initials') : t('Signature')} ${s.name}`} onClick={() => setPickedId(s.id)} onDoubleClick={() => onPlace(s)}>
                  <img src={s.image?.dataUrl} alt="" />
                  <span>{s.name}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="pod-hint">{category === CAT_INITIALS ? t('No initials saved yet.') : t('No signatures saved yet.')}</p>
        )}
      </section>
    )
  }
  return (
    <Modal title={t('Signatures and initials')} onClose={onClose} wide>
      <div className="pod">
        <p className="pod-hint">{t('These are pictures of your signature or initials that you place on a page. They are not digital signatures: to sign with a certificate, use Sign document.')}</p>
        {group(CAT_SIGNATURES, t('Signatures'))}
        {group(CAT_INITIALS, t('Initials'))}
        <div className="combine-bar">
          <button type="button" onClick={() => onNew('signature')}>
            {t('New signature…')}
          </button>
          <button type="button" onClick={() => onNew('initials')}>
            {t('New initials…')}
          </button>
          <button type="button" disabled={!picked} onClick={() => picked && onRename(picked)}>
            {t('Rename…')}
          </button>
          <button type="button" disabled={!picked} onClick={() => picked && onDelete(picked)}>
            {t('Delete')}
          </button>
        </div>
        <div className="pod-actions">
          <button type="button" className="primary" disabled={!picked} onClick={() => picked && onPlace(picked)}>
            {t('Place on the page')}
          </button>
          <button type="button" disabled={!picked} onClick={() => picked && onPlaceMany(picked)}>
            {t('Place on several pages…')}
          </button>
          <button type="button" onClick={onClose}>
            {t('Close')}
          </button>
        </div>
      </div>
    </Modal>
  )
}
