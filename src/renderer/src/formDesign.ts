/**
 * Form field design: add fields of every type to a page, change a field's properties, move or resize a widget, delete a
 * field, and set the tab order. pdf-lib writes; positions come in as display-space boxes (points from the top-left of the
 * page as shown) and are converted to the page's own coordinates.
 */
import { PDFArray, PDFButton, PDFCheckBox, PDFDict, PDFDocument, PDFDropdown, PDFHexString, PDFName, PDFOptionList, PDFRadioGroup, PDFRef, PDFString, PDFTextField, StandardFonts, TextAlignment, rgb, type PDFField, type PDFPage } from 'pdf-lib'
import { frameFor } from './annotWrite'
import type { ButtonAction, FieldScripts, FieldType, FormValue } from './forms'

export type { ButtonAction }
import type { Rect } from './textLogic'

export interface FieldSpec {
  type: FieldType
  name: string
  /** Zero-based page and display-space box of the widget. */
  page: number
  rect: Rect
  tooltip?: string
  required?: boolean
  readOnly?: boolean
  /** The starting value: text, on/off for a checkbox, the chosen option for a radio group or dropdown, choices for a list. */
  value?: FormValue
  options?: string[]
  multiline?: boolean
  password?: boolean
  maxLength?: number
  multiSelect?: boolean
  editable?: boolean
  fontSize?: number
  align?: 0 | 1 | 2
  /** Push button caption. */
  caption?: string
  action?: ButtonAction
  /** #rrggbb, or null for none. */
  border?: string | null
  background?: string | null
  borderWidth?: number
  textColor?: string
  /** For radio buttons: the option this widget stands for (the group is `name`). */
  option?: string
  /** Scripts for the field's format, keystrokes, validation and calculation. */
  scripts?: FieldScripts
}

const colour = (hex: string | null | undefined) => {
  if (!hex) return undefined
  const n = parseInt(hex.slice(1), 16)
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255)
}

/** A display-space box as an unrotated user-space box on the page. */
function userBox(page: PDFPage, r: Rect): { x: number; y: number; width: number; height: number } {
  const cb = page.getCropBox()
  const m = frameFor(cb.x, cb.y, cb.x + cb.width, cb.y + cb.height, page.getRotation().angle).m
  const at = (x: number, y: number): [number, number] => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]
  const [x1, y1] = at(r.x, r.y)
  const [x2, y2] = at(r.x + r.w, r.y + r.h)
  return { x: Math.min(x1, x2), y: Math.min(y1, y2), width: Math.abs(x2 - x1), height: Math.abs(y2 - y1) }
}

function checkName(name: string, others: string[], allowShared = false): void {
  if (!name.trim()) throw new Error('A field needs a name.')
  if (/\./.test(name)) throw new Error('A field name cannot contain a full stop.')
  if (!allowShared && others.includes(name)) throw new Error(`There is already a field called "${name}".`)
}

function actionDict(doc: PDFDocument, a: ButtonAction): PDFDict | null {
  const ctx = doc.context
  if (a.kind === 'reset') return ctx.obj({ S: 'ResetForm' }) as PDFDict
  if (a.kind === 'uri') return ctx.obj({ S: 'URI', URI: PDFString.of(a.url) }) as PDFDict
  if (a.kind === 'javascript') return ctx.obj({ S: 'JavaScript', JS: PDFHexString.fromText(a.code) }) as PDFDict
  if (a.kind === 'submit') {
    // Flags (ISO 32000 12.7.5.2): 4 HTML form, 32 XFDF, 256 whole PDF; none for FDF.
    const flags = a.format === 'html' ? 4 : a.format === 'xfdf' ? 32 : a.format === 'pdf' ? 256 : 0
    return ctx.obj({ S: 'SubmitForm', F: { FS: 'URL', F: PDFString.of(a.url) }, Flags: flags }) as PDFDict
  }
  return null
}

/**
 * Writes a field's scripts as additional actions (/AA: F format, K keystroke, V validate, C calculate) and keeps the
 * form's calculation order (/CO) in step: a field with a calculate script is listed, one without is not.
 */
function writeScripts(doc: PDFDocument, f: PDFField, scripts: FieldScripts | undefined): void {
  const ctx = doc.context
  const dict = f.acroField.dict
  let aa = dict.lookupMaybe(PDFName.of('AA'), PDFDict)
  const keys: [keyof FieldScripts, string][] = [['format', 'F'], ['keystroke', 'K'], ['validate', 'V'], ['calculate', 'C']]
  for (const [k, key] of keys) {
    const code = scripts?.[k]
    if (code) {
      aa ??= ctx.obj({}) as PDFDict
      aa.set(PDFName.of(key), ctx.obj({ S: 'JavaScript', JS: PDFHexString.fromText(code) }))
    } else aa?.delete(PDFName.of(key))
  }
  if (aa && aa.keys().length) dict.set(PDFName.of('AA'), aa)
  else dict.delete(PDFName.of('AA'))

  const acro = doc.getForm().acroForm.dict
  let co = acro.lookupMaybe(PDFName.of('CO'), PDFArray)
  let at = -1
  for (let i = 0; co && i < co.size(); i++) if (co.get(i)?.toString() === f.ref.toString()) at = i
  if (scripts?.calculate && at < 0) {
    co ??= ctx.obj([]) as PDFArray
    co.push(f.ref)
    acro.set(PDFName.of('CO'), co)
  } else if (!scripts?.calculate && at >= 0 && co) co.remove(at)
}

/** Sets the options shared by every kind of field. */
function common(field: PDFField, spec: FieldSpec): void {
  if (spec.required) field.enableRequired()
  else field.disableRequired()
  if (spec.readOnly) field.enableReadOnly()
  else field.disableReadOnly()
  if (spec.tooltip) field.acroField.dict.set(PDFName.of('TU'), PDFHexString.fromText(spec.tooltip))
  else field.acroField.dict.delete(PDFName.of('TU'))
}

/** Adds a field (or, for a radio group that exists, one more button) to a page. Returns the new file. */
export async function addField(bytes: Uint8Array, spec: FieldSpec): Promise<Uint8Array> {
  return addFields(bytes, [spec])
}

/** Adds several fields in one go (one load and one save). */
export async function addFields(bytes: Uint8Array, specs: FieldSpec[]): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false })
  for (const spec of specs) await addOne(doc, spec)
  return doc.save({ updateFieldAppearances: false })
}

async function addOne(doc: PDFDocument, spec: FieldSpec): Promise<void> {
  const form = doc.getForm()
  const page = doc.getPage(spec.page)
  const names = form.getFields().map((f) => f.getName())
  const box = userBox(page, spec.rect)
  if (box.width < 4 || box.height < 4) throw new Error('Draw the field a little larger.')
  const bw = spec.border === null ? 0 : (spec.borderWidth ?? 1)
  // pdf-lib grows a widget by its border width: shrink the box so the field ends up exactly where it was drawn.
  const look = {
    x: box.x + bw / 2,
    y: box.y + bw / 2,
    width: box.width - bw,
    height: box.height - bw,
    borderColor: spec.border === null ? undefined : colour(spec.border ?? '#000000'),
    backgroundColor: spec.background === null ? undefined : colour(spec.background),
    borderWidth: bw,
    textColor: colour(spec.textColor ?? '#000000')
  }
  const font = await doc.embedFont(StandardFonts.Helvetica)

  if (spec.type === 'text') {
    checkName(spec.name, names)
    const f = form.createTextField(spec.name)
    if (spec.multiline) f.enableMultiline()
    if (spec.password) f.enablePassword()
    if (spec.maxLength) f.setMaxLength(spec.maxLength)
    f.setAlignment(spec.align === 1 ? TextAlignment.Center : spec.align === 2 ? TextAlignment.Right : TextAlignment.Left)
    if (typeof spec.value === 'string' && spec.value) f.setText(spec.value)
    f.addToPage(page, { ...look, font })
    if (spec.fontSize !== undefined) f.setFontSize(spec.fontSize)
    common(f, spec)
    if (spec.scripts) writeScripts(doc, f, spec.scripts)
  } else if (spec.type === 'checkbox') {
    checkName(spec.name, names)
    const f = form.createCheckBox(spec.name)
    f.addToPage(page, look)
    if (spec.value === true) f.check()
    common(f, spec)
  } else if (spec.type === 'radio') {
    const option = (spec.option ?? '').trim()
    if (!option) throw new Error('A radio button needs a choice name.')
    const existing = form.getFieldMaybe(spec.name)
    if (existing && !(existing instanceof PDFRadioGroup)) throw new Error(`There is already a field called "${spec.name}".`)
    checkName(spec.name, names, true)
    const group = existing instanceof PDFRadioGroup ? existing : form.createRadioGroup(spec.name)
    if (group.getOptions().includes(option)) throw new Error(`"${spec.name}" already has a button called "${option}".`)
    group.addOptionToPage(option, page, look)
    if (spec.value === option) group.select(option)
    common(group, spec)
  } else if (spec.type === 'dropdown' || spec.type === 'list') {
    checkName(spec.name, names)
    const f = spec.type === 'dropdown' ? form.createDropdown(spec.name) : form.createOptionList(spec.name)
    f.addOptions(spec.options?.length ? spec.options : ['Option 1'])
    if (f instanceof PDFDropdown && spec.editable) f.enableEditing()
    if (f instanceof PDFOptionList && spec.multiSelect) f.enableMultiselect()
    const v = Array.isArray(spec.value) ? spec.value : spec.value ? [String(spec.value)] : []
    if (v.length) f.select(v)
    f.addToPage(page, { ...look, font })
    if (spec.fontSize !== undefined) f.setFontSize(spec.fontSize)
    common(f, spec)
  } else if (spec.type === 'button') {
    checkName(spec.name, names)
    const f = form.createButton(spec.name)
    f.addToPage(spec.caption ?? spec.name, page, { ...look, font, backgroundColor: spec.background === null ? undefined : colour(spec.background ?? '#dddddd') })
    const action = spec.action ? actionDict(doc, spec.action) : null
    if (action) f.acroField.getWidgets()[0].dict.set(PDFName.of('A'), action)
    common(f, spec)
  } else {
    // A signature field: pdf-lib cannot create one, so the field and its widget are one dictionary written here.
    checkName(spec.name, names)
    const ctx = doc.context
    const dict = ctx.obj({
      Type: 'Annot',
      Subtype: 'Widget',
      FT: 'Sig',
      T: PDFHexString.fromText(spec.name),
      Rect: [box.x, box.y, box.x + box.width, box.y + box.height],
      F: 4,
      P: page.ref,
      ...(spec.tooltip ? { TU: PDFHexString.fromText(spec.tooltip) } : {})
    } as never)
    const ref = ctx.register(dict)
    page.node.addAnnot(ref)
    const fields = form.acroForm.dict.lookupMaybe(PDFName.of('Fields'), PDFArray) ?? (ctx.obj([]) as PDFArray)
    fields.push(ref)
    form.acroForm.dict.set(PDFName.of('Fields'), fields)
  }
  // On a rotated page the content of the widget turns with the page (/MK /R), the box itself stays in page space.
  const angle = page.getRotation().angle
  if (angle) {
    const f = form.getFieldMaybe(spec.name)
    const font2 = await doc.embedFont(StandardFonts.Helvetica)
    for (const w of f?.acroField.getWidgets() ?? []) w.getOrCreateAppearanceCharacteristics().setRotation(angle)
    if (f instanceof PDFTextField || f instanceof PDFDropdown || f instanceof PDFOptionList || f instanceof PDFButton) f.updateAppearances(font2)
    else if (f instanceof PDFCheckBox || f instanceof PDFRadioGroup) f.updateAppearances()
  }
}

export interface FieldPatch {
  name?: string
  tooltip?: string
  required?: boolean
  readOnly?: boolean
  value?: FormValue
  options?: string[]
  multiline?: boolean
  password?: boolean
  maxLength?: number
  multiSelect?: boolean
  editable?: boolean
  fontSize?: number
  align?: 0 | 1 | 2
  caption?: string
  action?: ButtonAction
  /** Replaces the field's scripts (an empty object removes them). */
  scripts?: FieldScripts
}

/** Changes a field's properties. Returns the new file. */
export async function updateField(bytes: Uint8Array, name: string, patch: FieldPatch): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false })
  const form = doc.getForm()
  const f = form.getFieldMaybe(name)
  if (!f) throw new Error(`There is no field called "${name}".`)
  const font = await doc.embedFont(StandardFonts.Helvetica)
  if (patch.required !== undefined) {
    if (patch.required) f.enableRequired()
    else f.disableRequired()
  }
  if (patch.readOnly !== undefined) {
    if (patch.readOnly) f.enableReadOnly()
    else f.disableReadOnly()
  }
  if (patch.tooltip !== undefined) {
    if (patch.tooltip) f.acroField.dict.set(PDFName.of('TU'), PDFHexString.fromText(patch.tooltip))
    else f.acroField.dict.delete(PDFName.of('TU'))
  }
  if (f instanceof PDFTextField) {
    if (patch.multiline !== undefined) {
      if (patch.multiline) f.enableMultiline()
      else f.disableMultiline()
    }
    if (patch.password !== undefined) {
      if (patch.password) f.enablePassword()
      else f.disablePassword()
    }
    if (patch.maxLength !== undefined) {
      if (patch.maxLength > 0) f.setMaxLength(patch.maxLength)
      else f.removeMaxLength()
    }
    if (patch.align !== undefined) f.setAlignment(patch.align === 1 ? TextAlignment.Center : patch.align === 2 ? TextAlignment.Right : TextAlignment.Left)
    if (patch.fontSize !== undefined) f.setFontSize(patch.fontSize)
    if (typeof patch.value === 'string') f.setText(patch.value || undefined)
    f.updateAppearances(font)
  } else if (f instanceof PDFCheckBox) {
    if (patch.value !== undefined) {
      if (patch.value === true) f.check()
      else f.uncheck()
    }
  } else if (f instanceof PDFRadioGroup) {
    if (typeof patch.value === 'string') {
      if (patch.value) f.select(patch.value)
      else f.clear()
    }
  } else if (f instanceof PDFDropdown || f instanceof PDFOptionList) {
    if (patch.options) {
      f.clear()
      f.setOptions(patch.options.length ? patch.options : ['Option 1'])
    }
    if (f instanceof PDFDropdown && patch.editable !== undefined) {
      if (patch.editable) f.enableEditing()
      else f.disableEditing()
    }
    if (f instanceof PDFOptionList && patch.multiSelect !== undefined) {
      if (patch.multiSelect) f.enableMultiselect()
      else f.disableMultiselect()
    }
    if (patch.fontSize !== undefined) f.setFontSize(patch.fontSize)
    if (patch.value !== undefined) {
      const v = Array.isArray(patch.value) ? patch.value : patch.value ? [String(patch.value)] : []
      if (v.length) f.select(v)
      else f.clear()
    }
    f.updateAppearances(font)
  } else if (f instanceof PDFButton) {
    const w = f.acroField.getWidgets()[0]
    if (patch.caption !== undefined) {
      const mk = w.dict.lookupMaybe(PDFName.of('MK'), PDFDict) ?? (doc.context.obj({}) as PDFDict)
      mk.set(PDFName.of('CA'), PDFHexString.fromText(patch.caption))
      w.dict.set(PDFName.of('MK'), mk)
      f.updateAppearances(font)
    }
    if (patch.action) {
      const a = actionDict(doc, patch.action)
      if (a) w.dict.set(PDFName.of('A'), a)
      else w.dict.delete(PDFName.of('A'))
    }
  }
  if (patch.scripts !== undefined) writeScripts(doc, f, patch.scripts)
  if (patch.name !== undefined && patch.name !== name) {
    checkName(patch.name, form.getFields().map((x) => x.getName()))
    f.acroField.setPartialName(patch.name)
  }
  return doc.save({ updateFieldAppearances: false })
}

/** Removes a field and all its widgets. */
export async function deleteField(bytes: Uint8Array, name: string): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false })
  const form = doc.getForm()
  const f = form.getFieldMaybe(name)
  if (!f) throw new Error(`There is no field called "${name}".`)
  form.removeField(f)
  // pdf-lib leaves references to the removed widgets in each page's /Annots.
  for (const page of doc.getPages()) {
    const annots = page.node.lookupMaybe(PDFName.of('Annots'), PDFArray)
    for (let i = (annots?.size() ?? 0) - 1; annots && i >= 0; i--) {
      const entry = annots.get(i)
      if (entry instanceof PDFRef && doc.context.lookup(entry) === undefined) annots.remove(i)
    }
  }
  return doc.save({ updateFieldAppearances: false })
}

/** Moves or resizes one widget of a field to a display-space box. */
export async function placeWidget(bytes: Uint8Array, name: string, widget: number, rect: Rect): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false })
  const form = doc.getForm()
  const f = form.getFieldMaybe(name)
  const w = f?.acroField.getWidgets()[widget]
  if (!f || !w) throw new Error('That field could not be found.')
  const pageRef = w.P()
  const page = doc.getPages().find((p) => p.ref === pageRef) ?? doc.getPages().find((p) => p.node.lookupMaybe(PDFName.of('Annots'), PDFArray)?.asArray().some((r) => doc.context.lookup(r) === w.dict))
  if (!page) throw new Error('That field is not on a page.')
  const box = userBox(page, rect)
  if (box.width < 4 || box.height < 4) throw new Error('The field would be too small.')
  w.setRectangle(box)
  const font = await doc.embedFont(StandardFonts.Helvetica)
  if (f instanceof PDFTextField || f instanceof PDFDropdown || f instanceof PDFOptionList) f.updateAppearances(font)
  else if (f instanceof PDFCheckBox || f instanceof PDFRadioGroup) f.updateAppearances()
  else if (f instanceof PDFButton) f.updateAppearances(font)
  return doc.save({ updateFieldAppearances: false })
}

export type TabOrder = 'rows' | 'columns' | 'structure'

/** Sets how Tab moves through the fields on every page (/Tabs: R rows, C columns, S the order of the page's annotations). */
export async function setTabOrder(bytes: Uint8Array, order: TabOrder): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false })
  const tag = order === 'rows' ? 'R' : order === 'columns' ? 'C' : 'S'
  for (const page of doc.getPages()) page.node.set(PDFName.of('Tabs'), PDFName.of(tag))
  return doc.save({ updateFieldAppearances: false })
}

/** Moves a field's first widget one place earlier or later among the page's annotations (the "structure" tab order). */
export async function moveInTabOrder(bytes: Uint8Array, name: string, dir: -1 | 1): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false })
  const f = doc.getForm().getFieldMaybe(name)
  const w = f?.acroField.getWidgets()[0]
  if (!f || !w) throw new Error('That field could not be found.')
  for (const page of doc.getPages()) {
    const annots = page.node.lookupMaybe(PDFName.of('Annots'), PDFArray)
    if (!annots) continue
    const widgets: number[] = []
    let at = -1
    for (let i = 0; i < annots.size(); i++) {
      const d = annots.lookupMaybe(i, PDFDict)
      if (d?.lookup(PDFName.of('Subtype')) === PDFName.of('Widget')) {
        if (d === w.dict) at = widgets.length
        widgets.push(i)
      }
    }
    if (at < 0) continue
    const to = at + dir
    if (to < 0 || to >= widgets.length) return bytes
    const a = widgets[at]
    const b = widgets[to]
    const ea = annots.get(a)
    const eb = annots.get(b)
    annots.set(a, eb)
    annots.set(b, ea)
    page.node.set(PDFName.of('Tabs'), PDFName.of('S'))
    return doc.save({ updateFieldAppearances: false })
  }
  return bytes
}

