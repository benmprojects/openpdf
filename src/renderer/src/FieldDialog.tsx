import { useState } from 'react'
import { Modal } from './AppDialogs'
import type { FieldPatch, FieldSpec } from './formDesign'
import type { ButtonAction, FieldType, FormField } from './forms'
import { buildScripts, parseScripts, type CalcChoice, type FormatChoice, type ScriptUi, type ValidateChoice } from './scriptPresets'

const TYPE_NAME: Record<FieldType, string> = { text: 'Text field', checkbox: 'Check box', radio: 'Radio button', dropdown: 'Drop-down list', list: 'List box', button: 'Button', signature: 'Signature field' }

type ActionKind = ButtonAction['kind']

/**
 * Properties of a form field. In create mode (`field` absent) it returns a complete spec for the box just drawn; when
 * editing a field it returns the changes.
 */
export function FieldDialog({
  type,
  field,
  names,
  sourceNames = [],
  proposedName,
  onCreate,
  onUpdate,
  onClose
}: {
  type: FieldType
  /** The field being edited, or undefined when creating. */
  field?: FormField
  /** Names in use, for the repeat check. */
  names: string[]
  /** Fields a calculation can use (the other text fields). */
  sourceNames?: string[]
  proposedName: string
  onCreate: (s: Omit<FieldSpec, 'page' | 'rect' | 'type'>) => void
  onUpdate: (name: string, p: FieldPatch) => void
  onClose: () => void
}) {
  const editing = !!field
  const [name, setName] = useState(field?.name ?? proposedName)
  const [tooltip, setTooltip] = useState(field?.tooltip ?? '')
  const [required, setRequired] = useState(field?.required ?? false)
  const [readOnly, setReadOnly] = useState(field?.readOnly ?? false)
  const [text, setText] = useState(typeof field?.value === 'string' && type === 'text' ? field.value : '')
  const [multiline, setMultiline] = useState(field?.multiline ?? false)
  const [password, setPassword] = useState(field?.password ?? false)
  const [maxLength, setMaxLength] = useState(field?.maxLength ? String(field.maxLength) : '')
  const [align, setAlign] = useState<0 | 1 | 2>(field?.align ?? 0)
  const [fontSize, setFontSize] = useState(field ? String(field.fontSize) : '0')
  const [checked, setChecked] = useState(field?.value === true)
  const [option, setOption] = useState('Choice1')
  const [selectedByDefault, setSelectedByDefault] = useState(true)
  const [options, setOptions] = useState((field?.options ?? ['Option 1', 'Option 2', 'Option 3']).join('\n'))
  const [chosen, setChosen] = useState(Array.isArray(field?.value) ? field.value[0] ?? '' : typeof field?.value === 'string' && (type === 'dropdown' || type === 'radio') ? field.value : '')
  const [editable, setEditable] = useState(field?.editable ?? false)
  const [multiSelect, setMultiSelect] = useState(field?.multiSelect ?? false)
  const [caption, setCaption] = useState(field?.widgets[0]?.caption ?? 'Button')
  const [actionKind, setActionKind] = useState<ActionKind>(field?.action?.kind ?? 'none')
  const [url, setUrl] = useState(field?.action && (field.action.kind === 'uri' || field.action.kind === 'submit') ? field.action.url : 'https://')
  const [format, setFormat] = useState<'fdf' | 'xfdf' | 'html' | 'pdf'>(field?.action?.kind === 'submit' ? field.action.format : 'xfdf')
  const [code, setCode] = useState(field?.action?.kind === 'javascript' ? field.action.code : '')
  const [border, setBorder] = useState('#000000')
  const [noBorder, setNoBorder] = useState(false)
  const [background, setBackground] = useState('#e8efff')
  const [noBackground, setNoBackground] = useState(type !== 'text')
  const [error, setError] = useState('')
  const [ui, setUi] = useState<ScriptUi>(() => parseScripts(field?.scripts))
  const setScript = (patch: Partial<ScriptUi>) => setUi({ ...ui, ...patch })
  const scriptable = type === 'text' || type === 'dropdown'

  const optionList = options.split('\n').map((o) => o.trim()).filter(Boolean)
  const isRadioExisting = type === 'radio' && !editing && names.includes(name)
  const action = (): ButtonAction => (actionKind === 'reset' ? { kind: 'reset' } : actionKind === 'uri' ? { kind: 'uri', url } : actionKind === 'submit' ? { kind: 'submit', url, format } : actionKind === 'javascript' ? { kind: 'javascript', code } : { kind: 'none' })

  const submit = () => {
    const n = name.trim()
    if (!n) return setError('Give the field a name.')
    if (/\./.test(n)) return setError('A field name cannot contain a full stop.')
    if (!editing && type !== 'radio' && names.includes(n)) return setError(`There is already a field called "${n}".`)
    if (editing && n !== field.name && names.includes(n)) return setError(`There is already a field called "${n}".`)
    if (type === 'radio' && !editing && !option.trim()) return setError('Give the radio button a choice name.')
    if ((type === 'dropdown' || type === 'list') && !optionList.length) return setError('Give the list at least one option.')
    const size = Math.max(0, Number(fontSize) || 0)
    const max = Math.max(0, Math.floor(Number(maxLength) || 0))
    if (editing) {
      const p: FieldPatch = { name: n, tooltip, required, readOnly }
      if (scriptable) p.scripts = buildScripts(ui)
      if (type === 'text') Object.assign(p, { multiline, password, maxLength: max, align, fontSize: size, value: text })
      if (type === 'checkbox') p.value = checked
      if (type === 'radio') p.value = chosen
      if (type === 'dropdown' || type === 'list') Object.assign(p, { options: optionList, editable, multiSelect, fontSize: size, value: type === 'list' ? (chosen ? [chosen] : []) : chosen })
      if (type === 'button') Object.assign(p, { caption, action: action() })
      return onUpdate(field.name, p)
    }
    const spec: Omit<FieldSpec, 'page' | 'rect' | 'type'> = {
      name: n,
      tooltip,
      required,
      readOnly,
      border: noBorder ? null : border,
      background: noBackground ? null : background,
      fontSize: size || undefined
    }
    if (scriptable) spec.scripts = buildScripts(ui)
    if (type === 'text') Object.assign(spec, { value: text, multiline, password, maxLength: max || undefined, align })
    if (type === 'checkbox') spec.value = checked
    if (type === 'radio') Object.assign(spec, { option: option.trim(), value: selectedByDefault ? option.trim() : '' })
    if (type === 'dropdown' || type === 'list') Object.assign(spec, { options: optionList, editable, multiSelect, value: type === 'list' ? (chosen ? [chosen] : []) : chosen })
    if (type === 'button') Object.assign(spec, { caption, action: action() })
    onCreate(spec)
  }

  return (
    <Modal title={editing ? `${TYPE_NAME[type]} properties` : `New ${TYPE_NAME[type].toLowerCase()}`} onClose={onClose}>
      <form
        className="marks-form props-form"
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        <label className="props-row">
          <span>{type === 'radio' && !editing ? 'Group name' : 'Name'}</span>
          <input aria-label="Field name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </label>
        {isRadioExisting && <p className="muted">Adds a button to the existing group "{name}".</p>}
        <label className="props-row">
          <span>Tooltip</span>
          <input aria-label="Tooltip" value={tooltip} onChange={(e) => setTooltip(e.target.value)} />
        </label>
        <div className="marks-row">
          <label className="inline">
            <input type="checkbox" checked={required} onChange={(e) => setRequired(e.target.checked)} /> Required
          </label>
          <label className="inline">
            <input type="checkbox" checked={readOnly} onChange={(e) => setReadOnly(e.target.checked)} /> Read only
          </label>
        </div>

        {type === 'text' && (
          <>
            <label className="props-row">
              <span>Default value</span>
              <input aria-label="Default value" value={text} onChange={(e) => setText(e.target.value)} />
            </label>
            <div className="marks-row">
              <label className="inline">
                <input type="checkbox" checked={multiline} onChange={(e) => setMultiline(e.target.checked)} /> Several lines
              </label>
              <label className="inline">
                <input type="checkbox" checked={password} onChange={(e) => setPassword(e.target.checked)} /> Password
              </label>
            </div>
            <div className="marks-row">
              <label className="inline">
                Longest text
                <input type="number" aria-label="Longest text" min={0} value={maxLength} placeholder="no limit" onChange={(e) => setMaxLength(e.target.value)} />
              </label>
              <label className="inline">
                Align
                <select aria-label="Alignment" value={align} onChange={(e) => setAlign(Number(e.target.value) as 0 | 1 | 2)}>
                  <option value={0}>Left</option>
                  <option value={1}>Centre</option>
                  <option value={2}>Right</option>
                </select>
              </label>
            </div>
          </>
        )}
        {type === 'checkbox' && (
          <label className="inline">
            <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} /> Ticked to begin with
          </label>
        )}
        {type === 'radio' && !editing && (
          <>
            <label className="props-row">
              <span>Choice name</span>
              <input aria-label="Choice name" value={option} onChange={(e) => setOption(e.target.value)} />
            </label>
            <label className="inline">
              <input type="checkbox" checked={selectedByDefault} onChange={(e) => setSelectedByDefault(e.target.checked)} /> Selected to begin with
            </label>
          </>
        )}
        {(type === 'dropdown' || type === 'list') && (
          <>
            <label className="props-row">
              <span>Options (one per line)</span>
              <textarea aria-label="Options" rows={4} value={options} onChange={(e) => setOptions(e.target.value)} />
            </label>
            <label className="props-row">
              <span>Selected to begin with</span>
              <select aria-label="Selected to begin with" value={chosen} onChange={(e) => setChosen(e.target.value)}>
                <option value="">(none)</option>
                {optionList.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            </label>
            {type === 'dropdown' ? (
              <label className="inline">
                <input type="checkbox" checked={editable} onChange={(e) => setEditable(e.target.checked)} /> Allow typing a value that is not listed
              </label>
            ) : (
              <label className="inline">
                <input type="checkbox" checked={multiSelect} onChange={(e) => setMultiSelect(e.target.checked)} /> Allow several choices
              </label>
            )}
          </>
        )}
        {type === 'button' && (
          <>
            <label className="props-row">
              <span>Caption</span>
              <input aria-label="Caption" value={caption} onChange={(e) => setCaption(e.target.value)} />
            </label>
            <label className="props-row">
              <span>When pressed</span>
              <select aria-label="When pressed" value={actionKind} onChange={(e) => setActionKind(e.target.value as ActionKind)}>
                <option value="none">Nothing</option>
                <option value="reset">Clear the form</option>
                <option value="uri">Open a web address</option>
                <option value="submit">Send the form to a web address</option>
                <option value="javascript">Run JavaScript</option>
              </select>
            </label>
            {(actionKind === 'uri' || actionKind === 'submit') && (
              <label className="props-row">
                <span>Web address</span>
                <input aria-label="Web address" value={url} onChange={(e) => setUrl(e.target.value)} />
              </label>
            )}
            {actionKind === 'submit' && (
              <label className="props-row">
                <span>Send as</span>
                <select aria-label="Send as" value={format} onChange={(e) => setFormat(e.target.value as typeof format)}>
                  <option value="xfdf">XFDF</option>
                  <option value="fdf">FDF</option>
                  <option value="html">HTML form</option>
                  <option value="pdf">The whole PDF</option>
                </select>
              </label>
            )}
            {actionKind === 'javascript' && (
              <label className="props-row">
                <span>Script</span>
                <textarea aria-label="Script" rows={4} value={code} onChange={(e) => setCode(e.target.value)} spellCheck={false} />
              </label>
            )}
          </>
        )}
        {type !== 'checkbox' && type !== 'radio' && type !== 'button' && type !== 'signature' && (
          <label className="inline">
            Font size
            <input type="number" aria-label="Font size" min={0} max={72} value={fontSize} onChange={(e) => setFontSize(e.target.value)} /> (0 fits the box)
          </label>
        )}
        {scriptable && (
          <fieldset className="marks-remove script-box">
            <legend>Format, check and calculate</legend>
            <label className="props-row">
              <span>Format</span>
              <select aria-label="Format" value={ui.format} onChange={(e) => setScript({ format: e.target.value as FormatChoice })}>
                <option value="none">None</option>
                <option value="number">Number</option>
                <option value="percent">Percentage</option>
                <option value="date">Date</option>
                <option value="time">Time</option>
                <option value="special">Post code, phone number</option>
                <option value="custom">Custom script</option>
              </select>
            </label>
            {(ui.format === 'number' || ui.format === 'percent') && (
              <div className="marks-row">
                <label className="inline">
                  Decimal places
                  <input type="number" aria-label="Decimal places" min={0} max={10} value={ui.decimals} onChange={(e) => setScript({ decimals: Math.max(0, Math.min(10, Number(e.target.value) || 0)) })} />
                </label>
                <label className="inline">
                  Separators
                  <select aria-label="Separators" value={ui.separators} onChange={(e) => setScript({ separators: Number(e.target.value) as ScriptUi['separators'] })}>
                    <option value={0}>1,234.56</option>
                    <option value={1}>1234.56</option>
                    <option value={2}>1.234,56</option>
                    <option value={3}>1234,56</option>
                    <option value={4}>1&apos;234.56</option>
                  </select>
                </label>
              </div>
            )}
            {ui.format === 'number' && (
              <div className="marks-row">
                <label className="inline">
                  Currency
                  <input aria-label="Currency symbol" value={ui.currency} placeholder="$" onChange={(e) => setScript({ currency: e.target.value })} />
                </label>
                <label className="inline">
                  <input type="checkbox" checked={ui.currencyFirst} onChange={(e) => setScript({ currencyFirst: e.target.checked })} /> symbol first
                </label>
                <label className="inline">
                  <input type="checkbox" checked={ui.negativeBrackets} onChange={(e) => setScript({ negativeBrackets: e.target.checked })} /> negatives in brackets
                </label>
              </div>
            )}
            {ui.format === 'date' && (
              <label className="props-row">
                <span>Date form</span>
                <input aria-label="Date form" list="date-forms" value={ui.dateFormat} onChange={(e) => setScript({ dateFormat: e.target.value })} />
                <datalist id="date-forms">
                  {['dd/mm/yyyy', 'd/m/yy', 'd mmm yyyy', 'd mmmm yyyy', 'dddd d mmmm yyyy', 'yyyy-mm-dd'].map((f) => (
                    <option key={f} value={f} />
                  ))}
                </datalist>
              </label>
            )}
            {ui.format === 'time' && (
              <label className="props-row">
                <span>Time form</span>
                <select aria-label="Time form" value={ui.timeFormat} onChange={(e) => setScript({ timeFormat: e.target.value })}>
                  {['HH:MM', 'h:MM tt', 'HH:MM:ss', 'h:MM:ss tt'].map((f) => (
                    <option key={f} value={f}>
                      {f}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {ui.format === 'special' && (
              <label className="props-row">
                <span>Kind</span>
                <select aria-label="Special kind" value={ui.special} onChange={(e) => setScript({ special: Number(e.target.value) as ScriptUi['special'] })}>
                  <option value={0}>Post code (5 digits)</option>
                  <option value={1}>Post code and 4 digits</option>
                  <option value={2}>Phone number (10 digits)</option>
                  <option value={3}>Social security number</option>
                </select>
              </label>
            )}
            {ui.format === 'custom' && (
              <>
                <label className="props-row">
                  <span>Format script</span>
                  <textarea aria-label="Format script" rows={3} spellCheck={false} value={ui.custom.format ?? ''} onChange={(e) => setScript({ custom: { ...ui.custom, format: e.target.value } })} />
                </label>
                <label className="props-row">
                  <span>Keystroke script</span>
                  <textarea aria-label="Keystroke script" rows={2} spellCheck={false} value={ui.custom.keystroke ?? ''} onChange={(e) => setScript({ custom: { ...ui.custom, keystroke: e.target.value } })} />
                </label>
              </>
            )}
            <label className="props-row">
              <span>Check</span>
              <select aria-label="Check" value={ui.validate} onChange={(e) => setScript({ validate: e.target.value as ValidateChoice })}>
                <option value="none">Nothing</option>
                <option value="range">Number in a range</option>
                <option value="custom">Custom script</option>
              </select>
            </label>
            {ui.validate === 'range' && (
              <div className="marks-row">
                <label className="inline">
                  From
                  <input type="number" aria-label="Range from" value={ui.min} onChange={(e) => setScript({ min: e.target.value })} />
                </label>
                <label className="inline">
                  to
                  <input type="number" aria-label="Range to" value={ui.max} onChange={(e) => setScript({ max: e.target.value })} />
                </label>
              </div>
            )}
            {ui.validate === 'custom' && (
              <label className="props-row">
                <span>Check script</span>
                <textarea aria-label="Check script" rows={3} spellCheck={false} value={ui.custom.validate ?? ''} onChange={(e) => setScript({ custom: { ...ui.custom, validate: e.target.value } })} />
              </label>
            )}
            <label className="props-row">
              <span>Calculate</span>
              <select aria-label="Calculate" value={ui.calculate} onChange={(e) => setScript({ calculate: e.target.value as CalcChoice })}>
                <option value="none">Not calculated</option>
                <option value="SUM">Sum of fields</option>
                <option value="PRD">Product of fields</option>
                <option value="AVG">Average of fields</option>
                <option value="MIN">Smallest of fields</option>
                <option value="MAX">Largest of fields</option>
                <option value="custom">Custom script</option>
              </select>
            </label>
            {ui.calculate !== 'none' && ui.calculate !== 'custom' && (
              <div className="marks-row" role="group" aria-label="Fields to calculate from">
                {sourceNames.filter((n) => n !== (field?.name ?? name)).map((n) => (
                  <label key={n} className="inline">
                    <input type="checkbox" checked={ui.sources.includes(n)} onChange={(e) => setScript({ sources: e.target.checked ? [...ui.sources, n] : ui.sources.filter((x) => x !== n) })} /> {n}
                  </label>
                ))}
                {!sourceNames.filter((n) => n !== (field?.name ?? name)).length && <span className="muted">There are no other fields to calculate from yet.</span>}
              </div>
            )}
            {ui.calculate === 'custom' && (
              <label className="props-row">
                <span>Calculation script</span>
                <textarea aria-label="Calculation script" rows={3} spellCheck={false} value={ui.custom.calculate ?? ''} onChange={(e) => setScript({ custom: { ...ui.custom, calculate: e.target.value } })} />
              </label>
            )}
            <p className="muted small">Scripts run in a sandbox that cannot reach files or the network. A calculated field cannot be typed into.</p>
          </fieldset>
        )}
        {!editing && type !== 'signature' && (
          <div className="marks-row">
            <label className="inline">
              Border
              <input type="color" aria-label="Border colour" value={border} disabled={noBorder} onChange={(e) => setBorder(e.target.value)} />
            </label>
            <label className="inline">
              <input type="checkbox" checked={noBorder} onChange={(e) => setNoBorder(e.target.checked)} /> none
            </label>
            <label className="inline">
              Fill
              <input type="color" aria-label="Fill colour" value={background} disabled={noBackground} onChange={(e) => setBackground(e.target.value)} />
            </label>
            <label className="inline">
              <input type="checkbox" checked={noBackground} onChange={(e) => setNoBackground(e.target.checked)} /> none
            </label>
          </div>
        )}
        {error && (
          <p className="error-text" role="alert">
            {error}
          </p>
        )}
        <div className="marks-actions">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="primary" type="submit">
            {editing ? 'Apply' : 'Add field'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
