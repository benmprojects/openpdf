/**
 * Arranging form fields: align, distribute, match size and duplicate. The positions are worked out with the same maths
 * as for annotations (arrange.ts); this module turns the results into new boxes and new field specifications.
 */
import type { Annot } from './annotations'
import { alignAnnots, distributeAnnots, type AlignMode } from './arrange'
import type { FieldSpec } from './formDesign'
import type { FormField } from './forms'
import type { Rect } from './textLogic'

export interface WidgetRef {
  name: string
  /** Index among the field's widgets. */
  widget: number
}

export interface WidgetBox extends WidgetRef {
  page: number
  /** Display-space box. */
  rect: Rect
}

export const widgetKey = (r: WidgetRef): string => `${r.name}#${r.widget}`

/** Every widget that sits on a page, as a box. */
export function boxesOf(fields: FormField[]): WidgetBox[] {
  return fields.flatMap((f) => f.widgets.map((w, i): WidgetBox => ({ name: f.name, widget: i, page: w.page, rect: w.rect })).filter((b) => b.page >= 0))
}

export type ArrangeOp = { kind: 'align'; mode: AlignMode } | { kind: 'distribute'; axis: 'horizontal' | 'vertical' } | { kind: 'match'; dim: 'width' | 'height' | 'both'; primary: WidgetRef }

const same = (a: Rect, b: Rect) => Math.abs(a.x - b.x) < 0.01 && Math.abs(a.y - b.y) < 0.01 && Math.abs(a.w - b.w) < 0.01 && Math.abs(a.h - b.h) < 0.01

/** The widgets of the selection that move or change size, with their new boxes. */
export function arrangeWidgets(boxes: WidgetBox[], selection: WidgetRef[], op: ArrangeOp): WidgetBox[] {
  const keys = new Set(selection.map(widgetKey))
  const chosen = boxes.filter((b) => keys.has(widgetKey(b)))
  let next: Rect[]
  if (op.kind === 'match') {
    const p = boxes.find((b) => widgetKey(b) === widgetKey(op.primary))
    if (!p) return []
    next = chosen.map((b) => ({ ...b.rect, w: op.dim === 'height' ? b.rect.w : p.rect.w, h: op.dim === 'width' ? b.rect.h : p.rect.h }))
  } else {
    // The annotation maths works on a list with ids and rectangles; a field's box is exactly that.
    const fake = chosen.map((b, i) => ({ id: i, page: b.page, rects: [b.rect] }) as unknown as Annot)
    const ids = new Set(fake.map((a) => a.id))
    const moved = op.kind === 'align' ? alignAnnots(fake, ids, op.mode) : distributeAnnots(fake, ids, op.axis)
    next = moved.map((a) => a.rects[0])
  }
  return chosen.map((b, i) => ({ ...b, rect: next[i] })).filter((b, i) => !same(b.rect, chosen[i].rect))
}

export type DuplicateMode = { kind: 'offset'; dx: number; dy: number; copies: number } | { kind: 'pages'; pages: number[] }

/** Where the copies of a widget go. */
export function duplicateTargets(source: WidgetBox, mode: DuplicateMode): { page: number; rect: Rect }[] {
  if (mode.kind === 'pages') return [...new Set(mode.pages)].filter((p) => p !== source.page).sort((a, b) => a - b).map((page) => ({ page, rect: { ...source.rect } }))
  return Array.from({ length: Math.max(0, mode.copies) }, (_, i) => ({ page: source.page, rect: { ...source.rect, x: source.rect.x + mode.dx * (i + 1), y: source.rect.y + mode.dy * (i + 1) } }))
}

/** A name that is not taken: `base_2`, `base_3` and so on. */
export function uniqueName(base: string, taken: Set<string>): string {
  const stem = base.replace(/_\d+$/, '')
  for (let n = 2; ; n++) {
    const name = `${stem}_${n}`
    if (!taken.has(name)) {
      taken.add(name)
      return name
    }
  }
}

/**
 * Specifications for copies of one widget of a field. A copy is a new field with a new name (values are not copied);
 * a copy of a radio button joins the same group as one more choice.
 */
export function duplicateSpecs(field: FormField, widget: number, targets: { page: number; rect: Rect }[], existing: string[]): FieldSpec[] {
  const w = field.widgets[widget]
  if (!w) return []
  const taken = new Set(existing)
  const options = new Set(field.options ?? [])
  return targets.map((t): FieldSpec => {
    const spec: FieldSpec = {
      type: field.type,
      name: field.name,
      page: t.page,
      rect: t.rect,
      tooltip: field.tooltip || undefined,
      required: field.required,
      readOnly: field.readOnly,
      options: field.options ? [...field.options] : undefined,
      multiline: field.multiline,
      password: field.password,
      maxLength: field.maxLength,
      multiSelect: field.multiSelect,
      editable: field.editable,
      fontSize: field.fontSize,
      align: field.align,
      caption: w.caption,
      action: field.action,
      border: w.border ?? null,
      background: w.background ?? null,
      textColor: field.color,
      scripts: field.scripts,
      barcode: field.barcode
    }
    if (field.type === 'radio') {
      const base = w.onValue ?? 'Choice'
      let n = 2
      while (options.has(`${base}_${n}`)) n++
      const option = `${base}_${n}`
      options.add(option)
      spec.option = option
    } else spec.name = uniqueName(field.name, taken)
    return spec
  })
}
