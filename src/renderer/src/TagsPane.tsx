import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import type { PdfClient } from './pdfClient'
import { STANDARD_TYPES, contentOfTag, describeTag, findTag, markArtifact, moveTag, readDocAccess, readTagTree, setDocAccess, setTagText, setTagType, validLangTag, validTagType, type DocAccess, type TagNode, type TagTree } from './structTree'
import { t } from './i18n'

type Highlight = { page: number; rect: { x: number; y: number; w: number; h: number } } | null

interface Props {
  client: PdfClient
  /** The document as it is now; the tree is read again whenever it changes. */
  bytes: Uint8Array
  /** The viewer has read the same file as `bytes` (so marked content can be placed on the page). */
  ready: boolean
  /** The document cannot be changed (owner restrictions) or is busy. */
  readOnly: boolean
  pageCount: number
  /** Page labels, to show "iv" where the page is numbered that way. */
  labels: string[] | null
  run: (fn: (base: Uint8Array) => Promise<Uint8Array | null>, done?: string) => Promise<void>
  onGoToPage: (page: number) => void
  onHighlight: (h: Highlight) => void
  /** Ask the pane to select an element (from the accessibility checker); `n` changes with every request. */
  focus?: { id: string; n: number } | null
}

const LANGUAGES: [string, string][] = [
  ['en-AU', 'English (Australia)'],
  ['en-GB', 'English (United Kingdom)'],
  ['en-US', 'English (United States)'],
  ['en-NZ', 'English (New Zealand)'],
  ['fr', 'French'],
  ['de', 'German'],
  ['es', 'Spanish'],
  ['it', 'Italian'],
  ['zh-Hans', 'Chinese (simplified)'],
  ['zh-Hant', 'Chinese (traditional)'],
  ['ja', 'Japanese'],
  ['ko', 'Korean'],
  ['vi', 'Vietnamese'],
  ['ar', 'Arabic']
]

/** Where the marked content of an element sits on its page: the union of the boxes of its content items. */
async function placeOf(client: PdfClient, node: TagNode): Promise<Highlight> {
  const items = contentOfTag(node).filter((c) => c.page >= 0 && c.mcid >= 0)
  if (!items.length) return null
  const page = items[0].page
  const wanted = new Set(items.filter((c) => c.page === page).map((c) => c.mcid))
  const boxes = (await client.mcidBoxes(page)).filter((b) => wanted.has(b.mcid))
  if (!boxes.length) return null
  const x1 = Math.min(...boxes.map((b) => b.x))
  const y1 = Math.min(...boxes.map((b) => b.y))
  const x2 = Math.max(...boxes.map((b) => b.x + b.w))
  const y2 = Math.max(...boxes.map((b) => b.y + b.h))
  return { page, rect: { x: x1, y: y1, w: x2 - x1, h: y2 - y1 } }
}

/** The Tags pane: the structure tree of a tagged PDF, with the edits that help a screen reader. */
export function TagsPane({ client, bytes, ready, readOnly, pageCount, labels, run, onGoToPage, onHighlight, focus }: Props) {
  const [tree, setTree] = useState<TagTree | null>(null)
  const [access, setAccess] = useState<DocAccess | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [open, setOpen] = useState<Set<string>>(new Set())
  const [docTitle, setDocTitle] = useState('')
  const [docLang, setDocLang] = useState('')
  const [form, setForm] = useState({ type: '', title: '', alt: '', actualText: '', lang: '' })
  const seq = useRef(0)

  useEffect(() => {
    let live = true
    Promise.all([readTagTree(bytes), readDocAccess(bytes)]).then(
      ([tr, ac]) => {
        if (!live) return
        setTree(tr)
        setAccess(ac)
        setProblem(null)
        setDocTitle(ac.title)
        setDocLang(ac.lang)
        setOpen((old) => {
          if (old.size) return old
          const next = new Set<string>()
          const walk = (n: TagNode, depth: number) => {
            if (depth < 2 && n.children.length) next.add(n.id)
            if (depth < 1) n.children.forEach((c) => walk(c, depth + 1))
          }
          tr.roots.forEach((r) => walk(r, 0))
          return next
        })
      },
      (e) => live && setProblem(e instanceof Error ? e.message : String(e))
    )
    return () => {
      live = false
    }
  }, [bytes])

  const node = useMemo(() => (tree && selected !== null ? findTag(tree.roots, selected) : undefined), [tree, selected])

  // The form follows the selected element.
  useEffect(() => {
    if (node) setForm({ type: node.type, title: node.title, alt: node.alt, actualText: node.actualText, lang: node.lang })
  }, [node])

  // Show where the element is on its page.
  useEffect(() => {
    const mine = ++seq.current
    if (!node || !ready) {
      onHighlight(null)
      return
    }
    placeOf(client, node).then(
      (h) => mine === seq.current && onHighlight(h),
      () => mine === seq.current && onHighlight(null)
    )
  }, [node, ready]) // eslint-disable-line react-hooks/exhaustive-deps

  // Choosing an element brings its page into view (editing it does not).
  useEffect(() => {
    if (node && node.page >= 0) onGoToPage(node.page)
  }, [selected]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => onHighlight(null), []) // eslint-disable-line react-hooks/exhaustive-deps

  // A request from the accessibility checker: select the element and open the ones above it.
  useEffect(() => {
    if (!focus || !tree) return
    const parts = focus.id.split('/')
    setOpen((o) => {
      const next = new Set(o)
      for (let i = 1; i < parts.length; i++) next.add(parts.slice(0, i).join('/'))
      return next
    })
    setSelected(focus.id)
  }, [focus, tree]) // eslint-disable-line react-hooks/exhaustive-deps

  const pageName = (p: number) => (p < 0 ? '' : t('page {n}', { n: labels?.[p] || String(p + 1) }))
  const langOk = !docLang.trim() || validLangTag(docLang.trim())
  const elLangOk = !form.lang.trim() || validLangTag(form.lang.trim())
  const typeOk = validTagType(form.type)

  const edit = async (job: (b: Uint8Array) => Promise<Uint8Array | null>, done: string) => {
    try {
      await run(job, done)
    } catch (e) {
      setProblem(e instanceof Error ? e.message : String(e))
    }
  }

  const apply = () => {
    if (!node) return
    const id = node.id
    const type = form.type
    void edit(async (b) => {
      let out = await setTagText(b, id, { title: form.title, alt: form.alt, actualText: form.actualText, lang: form.lang })
      if (type !== node.type) out = await setTagType(out, id, type)
      return out
    }, t('Tag changed'))
  }

  const move = async (delta: -1 | 1) => {
    if (!node) return
    let newId = node.id
    await edit(async (b) => {
      const r = await moveTag(b, node.id, delta)
      newId = r.id
      return r.moved ? r.bytes : null
    }, t('Reading order changed'))
    setSelected(newId)
  }

  const artefact = async () => {
    if (!node) return
    await edit(async (b) => (await markArtifact(b, node.id)).bytes, t('Marked as an artefact: it is no longer read'))
    setSelected(null)
    onHighlight(null)
  }

  const toggle = (id: string) =>
    setOpen((o) => {
      const next = new Set(o)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const onKey = (e: React.KeyboardEvent<HTMLUListElement>) => {
    const target = e.target as HTMLElement
    const id = target.dataset.tagId
    if (id === undefined) return
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const all = [...e.currentTarget.querySelectorAll<HTMLElement>('[data-tag-id]')]
      const next = all[all.indexOf(target) + (e.key === 'ArrowDown' ? 1 : -1)]
      if (next) {
        e.preventDefault()
        next.focus()
      }
    } else if (e.key === 'ArrowRight' && !open.has(id)) {
      e.preventDefault()
      setOpen((o) => new Set(o).add(id))
    } else if (e.key === 'ArrowLeft' && open.has(id)) {
      e.preventDefault()
      toggle(id)
    }
  }

  const row = (n: TagNode, level: number): React.ReactNode => {
    const expanded = open.has(n.id)
    const label = describeTag(n)
    return (
      <li key={n.id} role="treeitem" aria-level={level} aria-expanded={n.children.length ? expanded : undefined} aria-selected={selected === n.id}>
        <div className={`tag-row${selected === n.id ? ' selected' : ''}`} style={{ paddingLeft: (level - 1) * 14 }}>
          {n.children.length ? (
            <button type="button" className="icon tag-toggle" aria-label={expanded ? t('Collapse {what}', { what: label }) : t('Expand {what}', { what: label })} onClick={() => toggle(n.id)}>
              {expanded ? <ChevronDown size={14} aria-hidden /> : <ChevronRight size={14} aria-hidden />}
            </button>
          ) : (
            <span className="tag-toggle" aria-hidden />
          )}
          <button type="button" className="tag-name" data-tag-id={n.id} title={label} onClick={() => setSelected(n.id)}>
            <span className="tag-type">{n.type}</span>
            {(n.title || n.alt) && <span className="tag-text"> {n.title || n.alt}</span>}
            {n.page >= 0 && <span className="tag-page"> {pageName(n.page)}</span>}
          </button>
        </div>
        {n.children.length > 0 && expanded && <ul role="group">{n.children.map((c) => row(c, level + 1))}</ul>}
      </li>
    )
  }

  return (
    <div className="tags-pane" aria-label={t('Tags')}>
      <section className="tags-doc" aria-label={t('Document')}>
        <label className="props-row">
          <span>{t('Title')}</span>
          <input aria-label={t('Document title')} value={docTitle} disabled={readOnly} onChange={(e) => setDocTitle(e.target.value)} />
        </label>
        <label className="props-row">
          <span>{t('Language')}</span>
          <input aria-label={t('Document language')} list="tag-languages" value={docLang} disabled={readOnly} placeholder="en-AU" onChange={(e) => setDocLang(e.target.value)} aria-invalid={!langOk} />
        </label>
        <datalist id="tag-languages">
          {LANGUAGES.map(([code, name]) => (
            <option key={code} value={code}>
              {name}
            </option>
          ))}
        </datalist>
        {!langOk && (
          <p role="alert" className="error-text small">
            {t('A language is written like en-AU or fr.')}
          </p>
        )}
        <div className="side-toolbar tags-actions">
          <button type="button" disabled={readOnly || !langOk || (access?.title === docTitle && access?.lang === docLang.trim())} onClick={() => void edit((b) => setDocAccess(b, { title: docTitle.trim(), lang: docLang.trim() }), t('Title and language saved'))}>
            {t('Set title and language')}
          </button>
        </div>
      </section>
      {problem && (
        <p role="alert" className="error-text small">
          {problem}
        </p>
      )}
      {tree && !tree.roots.length && !problem && <p className="muted tags-note">{t('This document has no tags. Tags are made where the document is written; this pane edits the ones that are there.')}</p>}
      {tree && tree.roots.length > 0 && (
        <>
          <p className="muted small tags-note">
            {t('{n} elements, in reading order. Select one to see it on the page.', { n: tree.count })}
            {tree.truncated ? ` ${t('The tree is very large: part of it is not shown.')}` : ''}
          </p>
          <ul role="tree" aria-label={t('Structure tree')} className="tag-tree" onKeyDown={onKey}>
            {tree.roots.map((r) => row(r, 1))}
          </ul>
        </>
      )}
      {node && (
        <form
          className="tags-detail"
          aria-label={t('Selected element')}
          onSubmit={(e) => {
            e.preventDefault()
            apply()
          }}
        >
          <h3 className="tags-heading">{describeTag(node)}</h3>
          <label className="props-row">
            <span>{t('Type')}</span>
            <select aria-label={t('Tag type')} value={form.type} disabled={readOnly} onChange={(e) => setForm({ ...form, type: e.target.value })}>
              {!(STANDARD_TYPES as readonly string[]).includes(node.type) && <option value={node.type}>{node.type}</option>}
              {STANDARD_TYPES.map((x) => (
                <option key={x} value={x}>
                  {x}
                </option>
              ))}
            </select>
          </label>
          <label className="props-row">
            <span>{t('Title')}</span>
            <input aria-label={t('Element title')} value={form.title} disabled={readOnly} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          </label>
          <label className="props-row">
            <span>{t('Alternative text')}</span>
            <textarea aria-label={t('Alternative text')} rows={3} value={form.alt} disabled={readOnly} onChange={(e) => setForm({ ...form, alt: e.target.value })} placeholder={t('What a screen reader says instead of the picture')} />
          </label>
          <label className="props-row">
            <span>{t('Replacement text')}</span>
            <input aria-label={t('Replacement text')} value={form.actualText} disabled={readOnly} onChange={(e) => setForm({ ...form, actualText: e.target.value })} />
          </label>
          <label className="props-row">
            <span>{t('Language')}</span>
            <input aria-label={t('Element language')} list="tag-languages" value={form.lang} disabled={readOnly} aria-invalid={!elLangOk} onChange={(e) => setForm({ ...form, lang: e.target.value })} />
          </label>
          {!elLangOk && (
            <p role="alert" className="error-text small">
              {t('A language is written like en-AU or fr.')}
            </p>
          )}
          <div className="side-toolbar tags-actions">
            <button type="submit" disabled={readOnly || !typeOk || !elLangOk}>
              {t('Apply')}
            </button>
            <button type="button" disabled={readOnly} onClick={() => void move(-1)} title={t('Read this element earlier')}>
              {t('Move up')}
            </button>
            <button type="button" disabled={readOnly} onClick={() => void move(1)} title={t('Read this element later')}>
              {t('Move down')}
            </button>
            <button type="button" disabled={readOnly} onClick={() => void artefact()} title={t('Take it out of the tags and mark its content as decoration, which readers skip')}>
              {t('Mark as artefact')}
            </button>
          </div>
          <p className="muted small">{node.page >= 0 ? pageName(node.page) : t('No page')}</p>
        </form>
      )}
      {pageCount === 0 && <p className="muted">{t('Waiting for the document…')}</p>}
    </div>
  )
}
