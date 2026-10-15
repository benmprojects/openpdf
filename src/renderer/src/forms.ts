/**
 * AcroForm fields (ISO 32000 12.7): reading them for display as editable controls, and writing filled-in values back.
 * pdf-lib parses and writes; the position of each widget is converted to display space (points from the top-left of the
 * page as shown) like annotations are.
 */
import {
  PDFButton,
  PDFCheckBox,
  PDFDict,
  PDFDocument,
  PDFDropdown,
  PDFField,
  PDFName,
  PDFOptionList,
  PDFRadioGroup,
  PDFSignature,
  PDFTextField,
  PDFArray,
  PDFRef,

  TextAlignment,
  StandardFonts
} from 'pdf-lib'
import fontkit from '@pdf-lib/fontkit'
import { frameFor } from './annotWrite'
import type { Rect } from './textLogic'

export type FieldType = 'text' | 'checkbox' | 'radio' | 'dropdown' | 'list' | 'button' | 'signature'

/** The value of a field: text (also a radio group's chosen export value, a dropdown's choice), on/off, or several choices. */
export type FormValue = string | boolean | string[]

export interface Widget {
  /** Zero-based page, or -1 when the widget is not on any page. */
  page: number
  /** Display-space box. */
  rect: Rect
  /** For radio buttons and checkboxes: the value this widget stands for when on. */
  onValue?: string
  /** Colours from the widget's appearance characteristics (/MK), as #rrggbb. */
  border?: string
  background?: string
  /** Caption of a push button. */
  caption?: string
}

export interface FormField {
  /** Fully qualified field name. */
  name: string
  type: FieldType
  value: FormValue
  /** The value the field started with. */
  initial: FormValue
  options?: string[]
  readOnly: boolean
  required: boolean
  multiline?: boolean
  password?: boolean
  comb?: boolean
  maxLength?: number
  multiSelect?: boolean
  editable?: boolean
  /** 0 left, 1 centre, 2 right. */
  align: 0 | 1 | 2
  /** Font size from the default appearance; 0 means auto. */
  fontSize: number
  /** Text colour from the default appearance. */
  color: string
  widgets: Widget[]
}

/** A colour array from /MK (1 grey, 3 RGB or 4 CMYK numbers, 0 to 1) as #rrggbb; empty or missing means transparent. */
const hex = (c: number[] | undefined): string | undefined => {
  if (!c || !c.length) return undefined
  const to = (v: number) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0')
  if (c.length === 1) return `#${to(c[0]).repeat(3)}`
  if (c.length === 3) return `#${to(c[0])}${to(c[1])}${to(c[2])}`
  if (c.length === 4) return `#${to((1 - c[0]) * (1 - c[3]))}${to((1 - c[1]) * (1 - c[3]))}${to((1 - c[2]) * (1 - c[3]))}`
  return undefined
}

/** The font size in a field's default appearance (0 for automatic). */
function defaultSize(f: PDFField): number {
  return parseFloat(/([\d.]+)\s+Tf/.exec(f.acroField.getDefaultAppearance() ?? '')?.[1] ?? '0') || 0
}

function fieldType(f: PDFField): FieldType | null {
  if (f instanceof PDFTextField) return 'text'
  if (f instanceof PDFCheckBox) return 'checkbox'
  if (f instanceof PDFRadioGroup) return 'radio'
  if (f instanceof PDFDropdown) return 'dropdown'
  if (f instanceof PDFOptionList) return 'list'
  if (f instanceof PDFSignature) return 'signature'
  if (f instanceof PDFButton) return 'button'
  return null
}

/** Reads every form field of a document. Fields of unknown kinds are skipped. */
export async function readForm(bytes: Uint8Array): Promise<FormField[]> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false, ignoreEncryption: true })
  const form = doc.getForm()
  const pageOf = new Map<PDFDict, number>()
  doc.getPages().forEach((p, i) => {
    const annots = p.node.lookupMaybe(PDFName.of('Annots'), PDFArray)
    for (let k = 0; annots && k < annots.size(); k++) {
      const d = annots.lookupMaybe(k, PDFDict)
      if (d) pageOf.set(d, i)
    }
  })
  const fields: FormField[] = []
  for (const f of form.getFields()) {
    const type = fieldType(f)
    if (!type) continue
    const widgets: Widget[] = []
    for (const w of f.acroField.getWidgets()) {
      const page = pageOf.get(w.dict) ?? -1
      const r = w.getRectangle()
      let rect: Rect = { x: r.x, y: r.y, w: r.width, h: r.height }
      if (page >= 0) {
        const p = doc.getPage(page)
        const cb = p.getCropBox()
        const m = frameFor(cb.x, cb.y, cb.x + cb.width, cb.y + cb.height, p.getRotation().angle).m
        // Display space to user space is `m`; go the other way for the two corners.
        const det = m[0] * m[3] - m[1] * m[2]
        const toDisplay = (x: number, y: number): [number, number] => [(m[3] * (x - m[4]) - m[2] * (y - m[5])) / det, (-m[1] * (x - m[4]) + m[0] * (y - m[5])) / det]
        const [x1, y1] = toDisplay(r.x, r.y)
        const [x2, y2] = toDisplay(r.x + r.width, r.y + r.height)
        rect = { x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1) }
      }
      const mk = w.getAppearanceCharacteristics()
      let onValue: string | undefined
      if (type === 'checkbox' || type === 'radio') {
        try {
          const on = w.getOnValue()
          onValue = on ? on.decodeText() : undefined
          // With an /Opt list a radio button's state name is the option's index; the option text is its value.
          if (f instanceof PDFRadioGroup && onValue !== undefined) {
            const opts = f.getOptions()
            if (!opts.includes(onValue) && /^\d+$/.test(onValue) && opts[Number(onValue)] !== undefined) onValue = opts[Number(onValue)]
          }
        } catch {
          onValue = undefined
        }
      }
      widgets.push({ page, rect, onValue, border: hex(mk?.getBorderColor()), background: hex(mk?.getBackgroundColor()), caption: mk?.getCaptions()?.normal })
    }
    const da = f.acroField.getDefaultAppearance() ?? ''
    const size = /([\d.]+)\s+Tf/.exec(da)
    const rgbm = /([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+rg/.exec(da)
    const grey = /([\d.]+)\s+g\b/.exec(da)
    const to = (v: string) => Math.round(parseFloat(v) * 255).toString(16).padStart(2, '0')
    const color = rgbm ? `#${to(rgbm[1])}${to(rgbm[2])}${to(rgbm[3])}` : grey ? `#${to(grey[1]).repeat(3)}` : '#000000'

    let value: FormValue = ''
    let options: string[] | undefined
    const flags: Partial<FormField> = {}
    if (f instanceof PDFTextField) {
      value = f.getText() ?? ''
      flags.multiline = f.isMultiline()
      flags.password = f.isPassword()
      flags.comb = f.isCombed()
      flags.maxLength = f.getMaxLength()
    } else if (f instanceof PDFCheckBox) value = f.isChecked()
    else if (f instanceof PDFRadioGroup) {
      value = f.getSelected() ?? ''
      options = f.getOptions()
    } else if (f instanceof PDFDropdown) {
      value = f.getSelected()[0] ?? ''
      options = f.getOptions()
      flags.editable = f.isEditable()
    } else if (f instanceof PDFOptionList) {
      value = f.getSelected()
      options = f.getOptions()
      flags.multiSelect = f.isMultiselect()
    }
    const align = f instanceof PDFTextField ? f.getAlignment() : TextAlignment.Left
    fields.push({
      name: f.getName(),
      type,
      value,
      initial: Array.isArray(value) ? [...value] : value,
      options,
      readOnly: f.isReadOnly(),
      required: f.isRequired(),
      align: align === TextAlignment.Center ? 1 : align === TextAlignment.Right ? 2 : 0,
      fontSize: size ? parseFloat(size[1]) : 0,
      color,
      widgets,
      ...flags
    })
  }
  return fields
}

/** Writes values into the named fields and regenerates their appearances. Unknown names are ignored. */
export async function applyFormValues(
  bytes: Uint8Array,
  values: ReadonlyMap<string, FormValue>,
  /** An installed font to draw values the standard font cannot show (accented and non-Latin text). */
  unicodeFont?: Uint8Array | null
): Promise<Uint8Array> {
  if (!values.size) return bytes
  const doc = await PDFDocument.load(bytes, { updateMetadata: false })
  const form = doc.getForm()
  const helvetica = await doc.embedFont(StandardFonts.Helvetica)
  let unicode: Awaited<ReturnType<PDFDocument['embedFont']>> | null = null
  /** The font to draw `text` with: Helvetica when it can show it, else the installed font (embedded once). */
  const fontFor = async (text: string) => {
    try {
      helvetica.encodeText(text)
      return helvetica
    } catch {
      if (!unicodeFont) return helvetica
      if (!unicode) {
        doc.registerFontkit(fontkit)
        unicode = await doc.embedFont(unicodeFont, { subset: false })
      }
      return unicode
    }
  }
  for (const [name, value] of values) {
    const f = form.getFieldMaybe(name)
    if (!f) continue
    // Characters the standard font cannot show: the value is stored, the old appearance stays.
    const refresh = (fn: () => void) => {
      try {
        fn()
      } catch {
        /* keep the stored value */
      }
    }
    if (f instanceof PDFTextField && typeof value === 'string') {
      const max = f.getMaxLength()
      // Automatic size on a multiline field is 12 pt, as in Acrobat (pdf-lib would size it to the box).
      if (f.isMultiline() && defaultSize(f) === 0) refresh(() => f.setFontSize(12))
      f.setText(value ? (max !== undefined ? value.slice(0, max) : value) : undefined)
      const font = await fontFor(value)
      refresh(() => f.updateAppearances(font))
    } else if (f instanceof PDFCheckBox && typeof value === 'boolean') {
      if (value) f.check()
      else f.uncheck()
    } else if (f instanceof PDFRadioGroup && typeof value === 'string') {
      if (value) f.select(value)
      else f.clear()
    } else if (f instanceof PDFDropdown) {
      const v = Array.isArray(value) ? value : value ? [String(value)] : []
      if (v.length) f.select(v)
      else f.clear()
      const font = await fontFor(v.join(''))
      refresh(() => f.updateAppearances(font))
    } else if (f instanceof PDFOptionList) {
      const v = Array.isArray(value) ? value : value ? [String(value)] : []
      if (v.length) f.select(v)
      else f.clear()
      const font = await fontFor(v.join(''))
      refresh(() => f.updateAppearances(font))
    }
  }
  // Appearances were made above; do not let saving redo (and trip over) them.
  return doc.save({ updateFieldAppearances: false })
}

/** Turns the fields into ordinary page content and removes the form (the values are kept as they look). */
export async function flattenForm(bytes: Uint8Array): Promise<{ bytes: Uint8Array; count: number }> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false })
  const form = doc.getForm()
  const count = form.getFields().length
  if (!count) return { bytes, count: 0 }
  try {
    form.flatten()
  } catch {
    // A value the standard font cannot draw: flatten with the appearances the fields already have.
    form.flatten({ updateFieldAppearances: false })
  }
  // pdf-lib deletes the widgets but leaves references to them in each page's /Annots: drop the dangling ones.
  for (const page of doc.getPages()) {
    const annots = page.node.lookupMaybe(PDFName.of('Annots'), PDFArray)
    for (let i = (annots?.size() ?? 0) - 1; annots && i >= 0; i--) {
      const entry = annots.get(i)
      if (entry instanceof PDFRef && doc.context.lookup(entry) === undefined) annots.remove(i)
    }
  }
  return { bytes: await doc.save({ updateFieldAppearances: false }), count }
}
