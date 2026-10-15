import { useEffect, useRef, useState } from 'react'
import { Modal } from './AppDialogs'
import { appEnv, checkSteps, runBatch, STEP_LABELS, type BatchAction, type BatchResult, type BatchStep } from './batch'
import { ALL_ALLOWED } from '../../shared/pdfSecurity'
import type { InstalledPlugin } from '../../main/plugins'
import { t } from './i18n'

const KINDS = Object.keys(STEP_LABELS) as BatchStep['kind'][]

const NO_ALL = { metadata: true, attachments: true, javascript: true, comments: false, bookmarks: false, thumbnails: true }

export function newStep(kind: BatchStep['kind']): BatchStep {
  switch (kind) {
    case 'watermark':
      return { kind, text: 'DRAFT', fontSize: 60, color: '#cc0000', opacity: 0.25, angle: 45, behind: false }
    case 'headerFooter':
      return { kind, slots: { bc: 'Page <<page>> of <<pages>>' }, fontSize: 9, color: '#000000', margin: 24, startNumber: 1 }
    case 'optimise':
      return { kind, level: 'standard' }
    case 'ocr':
      return { kind, languages: ['eng'], dpi: 300, all: false }
    case 'sanitise':
      return { kind, options: { ...NO_ALL } }
    case 'properties':
      return { kind }
    case 'rotate':
      return { kind, degrees: 90 }
    case 'security':
      return { kind, userPassword: '', ownerPassword: '', keyLength: 256, permissions: { ...ALL_ALLOWED } }
    case 'plugin':
      return { kind, plugin: '', action: '', params: {} }
    default:
      return { kind } as BatchStep
  }
}

const num = (v: string, fallback: number) => (Number.isFinite(Number(v)) && v.trim() !== '' ? Number(v) : fallback)

function StepEditor({ step, languages, plugins, onChange }: { step: BatchStep; languages: [string, string][]; plugins: InstalledPlugin[]; onChange: (s: BatchStep) => void }) {
  const field = (label: string, el: React.ReactNode) => (
    <label className="batch-field">
      <span>{label}</span>
      {el}
    </label>
  )
  switch (step.kind) {
    case 'watermark':
      return (
        <>
          {field('Text', <input aria-label="Watermark text" value={step.text} onChange={(e) => onChange({ ...step, text: e.target.value })} />)}
          {field('Size', <input aria-label="Watermark size" type="number" min={8} max={200} value={step.fontSize} onChange={(e) => onChange({ ...step, fontSize: num(e.target.value, 60) })} />)}
          {field('Opacity', <input aria-label="Watermark opacity" type="number" min={0.05} max={1} step={0.05} value={step.opacity} onChange={(e) => onChange({ ...step, opacity: num(e.target.value, 0.25) })} />)}
          {field('Angle', <input aria-label="Watermark angle" type="number" min={-90} max={90} value={step.angle} onChange={(e) => onChange({ ...step, angle: num(e.target.value, 45) })} />)}
          <label className="inline">
            <input type="checkbox" checked={step.behind} onChange={(e) => onChange({ ...step, behind: e.target.checked })} /> Behind the page content
          </label>
        </>
      )
    case 'headerFooter':
      return (
        <>
          {field('Header left', <input aria-label="Header left" value={step.slots.tl ?? ''} onChange={(e) => onChange({ ...step, slots: { ...step.slots, tl: e.target.value } })} />)}
          {field('Header right', <input aria-label="Header right" value={step.slots.tr ?? ''} onChange={(e) => onChange({ ...step, slots: { ...step.slots, tr: e.target.value } })} />)}
          {field('Footer', <input aria-label="Footer" value={step.slots.bc ?? ''} onChange={(e) => onChange({ ...step, slots: { ...step.slots, bc: e.target.value } })} />)}
          <span className="muted">Tokens: &lt;&lt;page&gt;&gt; &lt;&lt;pages&gt;&gt; &lt;&lt;date&gt;&gt; &lt;&lt;file&gt;&gt;</span>
        </>
      )
    case 'optimise':
      return field(
        'Level',
        <select aria-label="Optimise level" value={step.level} onChange={(e) => onChange({ ...step, level: e.target.value as typeof step.level })}>
          <option value="light">Light: keep pictures as they are</option>
          <option value="standard">Standard: pictures to 150 dpi</option>
          <option value="small">Smallest: pictures to 100 dpi</option>
        </select>
      )
    case 'ocr':
      return (
        <>
          {field(
            'Language',
            <select aria-label="OCR language" value={step.languages[0] ?? 'eng'} onChange={(e) => onChange({ ...step, languages: [e.target.value] })}>
              {languages.map(([c, n]) => (
                <option key={c} value={c}>
                  {n}
                </option>
              ))}
            </select>
          )}
          {field(
            'Quality',
            <select aria-label="OCR quality" value={step.dpi} onChange={(e) => onChange({ ...step, dpi: Number(e.target.value) as 200 | 300 | 400 })}>
              <option value={200}>Faster (200 dpi)</option>
              <option value={300}>Standard (300 dpi)</option>
              <option value={400}>Small print (400 dpi)</option>
            </select>
          )}
          <label className="inline">
            <input type="checkbox" checked={step.all} onChange={(e) => onChange({ ...step, all: e.target.checked })} /> Recognise pages that already have text too
          </label>
        </>
      )
    case 'sanitise':
      return (
        <div className="batch-checks">
          {(['metadata', 'attachments', 'javascript', 'comments', 'bookmarks', 'thumbnails'] as const).map((k) => (
            <label key={k} className="inline">
              <input type="checkbox" checked={step.options[k]} onChange={(e) => onChange({ ...step, options: { ...step.options, [k]: e.target.checked } })} />{' '}
              {{ metadata: 'Metadata', attachments: 'Attached files', javascript: 'JavaScript', comments: 'Comments', bookmarks: 'Bookmarks', thumbnails: 'Thumbnails' }[k]}
            </label>
          ))}
        </div>
      )
    case 'properties':
      return (
        <>
          {(['title', 'author', 'subject', 'keywords'] as const).map((k) => (
            <label key={k} className="batch-field">
              <span>{k[0].toUpperCase() + k.slice(1)}</span>
              <input aria-label={`Property ${k}`} placeholder="(leave as it is)" value={step[k] ?? ''} onChange={(e) => onChange({ ...step, [k]: e.target.value === '' ? undefined : e.target.value })} />
            </label>
          ))}
        </>
      )
    case 'rotate':
      return field(
        'Turn',
        <select aria-label="Rotate by" value={step.degrees} onChange={(e) => onChange({ ...step, degrees: Number(e.target.value) as 90 | 180 | 270 })}>
          <option value={90}>90° clockwise</option>
          <option value={180}>180°</option>
          <option value={270}>90° anticlockwise</option>
        </select>
      )
    case 'security':
      return (
        <>
          {field('Open password', <input aria-label="Batch open password" type="password" value={step.userPassword} onChange={(e) => onChange({ ...step, userPassword: e.target.value })} />)}
          {field('Permissions password', <input aria-label="Batch permissions password" type="password" value={step.ownerPassword} onChange={(e) => onChange({ ...step, ownerPassword: e.target.value })} />)}
          <label className="inline">
            <input type="checkbox" checked={step.permissions.extract} onChange={(e) => onChange({ ...step, permissions: { ...step.permissions, extract: e.target.checked } })} /> Allow copying
          </label>
          <label className="inline">
            <input type="checkbox" checked={step.permissions.print !== 'none'} onChange={(e) => onChange({ ...step, permissions: { ...step.permissions, print: e.target.checked ? 'full' : 'none' } })} /> Allow printing
          </label>
          <label className="inline">
            <input type="checkbox" checked={step.permissions.modifyOther} onChange={(e) => onChange({ ...step, permissions: { ...step.permissions, modifyOther: e.target.checked, annotate: e.target.checked, form: e.target.checked, assemble: e.target.checked } })} /> Allow editing
          </label>
          <span className="muted">The passwords are saved in the action in plain text.</span>
        </>
      )
    case 'plugin': {
      const chosen = plugins.find((p) => p.manifest.id === step.plugin)?.manifest.actions.find((a) => a.id === step.action)
      return (
        <>
          {field(
            'Action',
            <select
              aria-label="Plugin action"
              value={step.plugin ? `${step.plugin}::${step.action}` : ''}
              onChange={(e) => {
                const [plugin = '', action = ''] = e.target.value.split('::')
                const a = plugins.find((p) => p.manifest.id === plugin)?.manifest.actions.find((x) => x.id === action)
                onChange({ kind: 'plugin', plugin, action, params: Object.fromEntries((a?.params ?? []).map((q) => [q.id, q.default ?? ''])) })
              }}
            >
              <option value="">Choose…</option>
              {plugins.flatMap((p) => p.manifest.actions.map((a) => (
                <option key={`${p.manifest.id}::${a.id}`} value={`${p.manifest.id}::${a.id}`}>
                  {p.manifest.name}: {a.label}
                </option>
              )))}
            </select>
          )}
          {(chosen?.params ?? []).map((q) => (
            <label key={q.id} className="batch-field">
              <span>{q.label}</span>
              <input aria-label={`Plugin parameter ${q.label}`} value={step.params[q.id] ?? ''} onChange={(e) => onChange({ ...step, params: { ...step.params, [q.id]: e.target.value } })} />
            </label>
          ))}
          {plugins.length === 0 && <span className="muted">No plugins are installed (File, then Plugins).</span>}
        </>
      )
    }
    default:
      return null
  }
}

const size = (n?: number) => (n === undefined ? '' : n > 1_048_576 ? `${(n / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`)

/** Run a list of steps over many PDFs. */
export function BatchDialog({ onClose }: { onClose: () => void }) {
  const [steps, setSteps] = useState<BatchStep[]>([])
  const [actions, setActions] = useState<BatchAction[]>([])
  const [actionName, setActionName] = useState('')
  const [languages, setLanguages] = useState<[string, string][]>([['eng', 'English']])
  const [plugins, setPlugins] = useState<InstalledPlugin[]>([])
  const [inputs, setInputs] = useState('')
  const [recursive, setRecursive] = useState(true)
  const [outMode, setOutMode] = useState<'folder' | 'beside'>('folder')
  const [outDir, setOutDir] = useState('')
  const [suffix, setSuffix] = useState('_processed')
  const [problems, setProblems] = useState<string[]>([])
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number; current: string } | null>(null)
  const [results, setResults] = useState<BatchResult[] | null>(null)
  const cancelled = useRef(false)

  useEffect(() => {
    void window.openpdf.batchActions().then(setActions)
    void window.openpdf.ocrLanguages().then((l) => setLanguages(l.all))
    void window.openpdf.pluginsList().then(setPlugins)
  }, [])

  const setStep = (i: number, s: BatchStep) => setSteps((list) => list.map((x, k) => (k === i ? s : x)))
  const move = (i: number, d: -1 | 1) =>
    setSteps((list) => {
      const j = i + d
      if (j < 0 || j >= list.length) return list
      const next = [...list]
      ;[next[i], next[j]] = [next[j], next[i]]
      return next
    })
  const lines = () => inputs.split(/\r?\n/).map((l) => l.trim().replace(/^"|"$/g, '')).filter(Boolean)

  const addPicked = async (folders: boolean) => {
    const picked = await window.openpdf.batchPick(folders)
    if (picked.length) setInputs((t) => [...t.split(/\r?\n/).filter((l) => l.trim()), ...picked].join('\n'))
  }
  const pickOut = async () => {
    const d = await window.openpdf.pickFolder()
    if (d) setOutDir(d)
  }

  const run = async () => {
    const issues = checkSteps(steps)
    if (!lines().length) issues.push('Add the files or folders to process.')
    if (outMode === 'folder' && !outDir.trim()) issues.push('Choose the folder for the results.')
    setProblems(issues)
    if (issues.length) return
    setRunning(true)
    cancelled.current = false
    setResults(null)
    try {
      const env = await appEnv()
      const res = await runBatch(
        { steps, inputs: lines(), recursive, outDir: outMode === 'folder' ? outDir.trim() : null, suffix },
        { expand: (p, r) => window.openpdf.batchExpand(p, r), read: (p) => window.openpdf.batchRead(p), write: (s, d, x, data) => window.openpdf.batchWrite(s, d, x, data) },
        env,
        (done, total, current) => setProgress({ done, total, current }),
        () => cancelled.current
      )
      setResults(res)
      if (!res.length) setProblems(['No PDF files were found in what you chose.'])
    } catch (e) {
      setProblems([e instanceof Error ? e.message : String(e)])
    } finally {
      setRunning(false)
      setProgress(null)
    }
  }

  const saveAction = async () => {
    const name = actionName.trim()
    if (!name) return setProblems(['Give the action a name to save it.'])
    if (!steps.length) return setProblems(['Add at least one step before saving.'])
    setActions(await window.openpdf.batchSaveAction({ name, steps }))
    setProblems([])
  }
  const exportAction = async () => {
    const data = new TextEncoder().encode(JSON.stringify({ name: actionName.trim() || 'Action', steps }, null, 2))
    await window.openpdf.saveData(`${actionName.trim() || 'action'}.json`, data, { name: 'Batch actions', ext: 'json' })
  }
  const importAction = async () => {
    const f = await window.openpdf.pickFile({ name: 'Batch actions', ext: ['json'] })
    if (!f) return
    try {
      const a = JSON.parse(new TextDecoder().decode(f.data)) as BatchAction
      if (!Array.isArray(a.steps)) throw new Error('not an action')
      setSteps(a.steps)
      setActionName(a.name ?? '')
      setProblems([])
    } catch {
      setProblems(['That file is not a batch action.'])
    }
  }

  const okCount = results?.filter((r) => r.ok).length ?? 0
  return (
    <Modal title={t('Batch processing')} onClose={running ? () => undefined : onClose} wide>
      <div className="marks-form batch">
        <section aria-label="Steps">
          <h3>1. Steps</h3>
          <div className="batch-actionbar">
            <select
              aria-label="Saved actions"
              value=""
              onChange={(e) => {
                const a = actions.find((x) => x.name === e.target.value)
                if (a) {
                  setSteps(a.steps)
                  setActionName(a.name)
                }
              }}
            >
              <option value="">Saved actions…</option>
              {actions.map((a) => (
                <option key={a.name} value={a.name}>
                  {a.name}
                </option>
              ))}
            </select>
            <input aria-label="Action name" placeholder="Name to save as" value={actionName} onChange={(e) => setActionName(e.target.value)} />
            <button type="button" onClick={() => void saveAction()}>
              Save
            </button>
            {actions.some((a) => a.name === actionName) && (
              <button type="button" onClick={() => void window.openpdf.batchDeleteAction(actionName).then(setActions)}>
                Delete
              </button>
            )}
            <button type="button" onClick={() => void exportAction()} disabled={!steps.length}>
              Save to file…
            </button>
            <button type="button" onClick={() => void importAction()}>
              Load from file…
            </button>
          </div>
          <ol className="batch-steps">
            {steps.map((s, i) => (
              <li key={i} className="batch-step">
                <div className="batch-step-head">
                  <strong>{STEP_LABELS[s.kind]}</strong>
                  <span style={{ flex: 1 }} />
                  <button type="button" aria-label={`Move step ${i + 1} up`} onClick={() => move(i, -1)} disabled={i === 0}>
                    ↑
                  </button>
                  <button type="button" aria-label={`Move step ${i + 1} down`} onClick={() => move(i, 1)} disabled={i === steps.length - 1}>
                    ↓
                  </button>
                  <button type="button" aria-label={`Remove step ${i + 1}`} onClick={() => setSteps((l) => l.filter((_, k) => k !== i))}>
                    ✕
                  </button>
                </div>
                <StepEditor step={s} languages={languages} plugins={plugins} onChange={(n) => setStep(i, n)} />
              </li>
            ))}
          </ol>
          <select
            aria-label="Add a step"
            value=""
            onChange={(e) => {
              if (e.target.value) setSteps((l) => [...l, newStep(e.target.value as BatchStep['kind'])])
            }}
          >
            <option value="">Add a step…</option>
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {STEP_LABELS[k]}
              </option>
            ))}
          </select>
        </section>

        <section aria-label="Files">
          <h3>2. Files</h3>
          <textarea aria-label="Files and folders" rows={3} placeholder="One file or folder per line" value={inputs} onChange={(e) => setInputs(e.target.value)} />
          <div className="batch-actionbar">
            <button type="button" onClick={() => void addPicked(false)}>
              Add files…
            </button>
            <button type="button" onClick={() => void addPicked(true)}>
              Add folders…
            </button>
            <label className="inline">
              <input type="checkbox" checked={recursive} onChange={(e) => setRecursive(e.target.checked)} /> Include subfolders
            </label>
          </div>
        </section>

        <section aria-label="Results">
          <h3>3. Where the results go</h3>
          <label className="inline">
            <input type="radio" name="outmode" checked={outMode === 'folder'} onChange={() => setOutMode('folder')} /> In this folder
          </label>
          {outMode === 'folder' && (
            <div className="batch-actionbar">
              <input aria-label="Results folder" value={outDir} onChange={(e) => setOutDir(e.target.value)} placeholder="Folder for the results" />
              <button type="button" onClick={() => void pickOut()}>
                Browse…
              </button>
            </div>
          )}
          <label className="inline">
            <input type="radio" name="outmode" checked={outMode === 'beside'} onChange={() => setOutMode('beside')} /> Beside each original
          </label>
          <label className="batch-field">
            <span>Add to the name</span>
            <input aria-label="Name suffix" value={suffix} onChange={(e) => setSuffix(e.target.value)} />
          </label>
          <p className="muted">Originals are never changed, and an existing file is never overwritten (a number is added to the name instead).</p>
        </section>

        {problems.length > 0 && (
          <div role="alert" className="error-text">
            {problems.map((p) => (
              <p key={p}>{p}</p>
            ))}
          </div>
        )}
        {progress && (
          <p role="status" className="muted">
            {progress.current ? `Processing ${progress.done + 1} of ${progress.total}: ${progress.current}` : 'Finishing…'}
          </p>
        )}
        {results && (
          <section aria-label="Outcome">
            <h3>
              Done: {okCount} of {results.length} file{results.length === 1 ? '' : 's'} processed
            </h3>
            <ul className="batch-results">
              {results.map((r) => (
                <li key={r.source} className={r.ok ? 'std-pass' : 'std-fail'}>
                  <span aria-hidden>{r.ok ? '✔' : '✖'}</span> {r.source.split(/[\\/]/).pop()}
                  {r.ok ? (
                    <span className="muted">
                      {' '}
                      → {r.output?.split(/[\\/]/).pop()} ({size(r.before)} → {size(r.after)}
                      {r.notes.length ? `; ${r.notes.join('; ')}` : ''})
                    </span>
                  ) : (
                    <span className="muted"> {r.error}</span>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}
        <div className="marks-actions">
          <span style={{ flex: 1 }} />
          {running ? (
            <button type="button" onClick={() => (cancelled.current = true)}>
              Stop after this file
            </button>
          ) : (
            <>
              <button type="button" onClick={onClose}>
                Close
              </button>
              <button className="primary" type="button" onClick={() => void run()}>
                Run
              </button>
            </>
          )}
        </div>
      </div>
    </Modal>
  )
}
