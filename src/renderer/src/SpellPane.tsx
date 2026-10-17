import { useCallback, useEffect, useRef, useState } from 'react'
import type { PdfClient } from './pdfClient'
import { findMisspellings, readAllText, spellContext, type SpellWord } from './proofing'
import { t } from './i18n'

type Highlight = { page: number; rect: { x: number; y: number; w: number; h: number } } | null

/** Words skipped with Ignore, kept for the session and shared by every document. */
const ignoredWords = new Set<string>()

interface Props {
  client: PdfClient
  /** The viewer has read the same file as the pane checks (the page text is cached by the client). */
  ready: boolean
  pageCount: number
  labels: string[] | null
  onGoToPage: (page: number) => void
  onHighlight: (h: Highlight) => void
}

/** The Spelling pane: the words in the document's text that the dictionary does not know, with suggestions. */
export function SpellPane({ client, ready, pageCount, labels, onGoToPage, onHighlight }: Props) {
  const [state, setState] = useState<'idle' | 'reading' | 'off' | 'nodict' | 'done'>('idle')
  const [progress, setProgress] = useState(0)
  const [texts, setTexts] = useState<string[]>([])
  const [list, setList] = useState<SpellWord[]>([])
  const [sel, setSel] = useState(0)
  const [occ, setOcc] = useState(0)
  const [suggestions, setSuggestions] = useState<string[]>([])
  const [ignoreCaps, setIgnoreCaps] = useState(true)
  const [ignoreDigits, setIgnoreDigits] = useState(true)
  const [notice, setNotice] = useState<string | null>(null)
  const [languages, setLanguages] = useState<string[]>([])
  const run = useRef(0)

  const check = useCallback(async () => {
    const mine = ++run.current
    setState('reading')
    setNotice(null)
    onHighlight(null)
    const status = await window.openpdf.spell.status()
    if (mine !== run.current) return
    setLanguages(status.languages)
    if (!status.enabled) {
      setState('off')
      return
    }
    if (!window.openpdf.spell.ready()) {
      setState('nodict')
      return
    }
    const signal = { cancelled: false }
    const watcher = setInterval(() => {
      signal.cancelled = mine !== run.current
    }, 100)
    try {
      const all = await readAllText(client, pageCount, (n) => mine === run.current && setProgress(n), signal)
      if (mine !== run.current) return
      setTexts(all)
      const found = findMisspellings(all, (words) => window.openpdf.spell.misspelled(words), { ignoreCaps, ignoreDigits }, ignoredWords)
      setList(found)
      setSel(0)
      setOcc(0)
      setState('done')
    } catch (e) {
      if (mine === run.current) {
        setNotice(e instanceof Error ? e.message : String(e))
        setState('done')
      }
    } finally {
      clearInterval(watcher)
    }
  }, [client, pageCount, ignoreCaps, ignoreDigits]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (ready && pageCount > 0) void check()
    return () => {
      run.current++
    }
  }, [ready, pageCount, check])

  useEffect(() => () => onHighlight(null), []) // eslint-disable-line react-hooks/exhaustive-deps

  const word = list[sel]
  const at = word?.occurrences[occ]

  // Suggestions and the place on the page follow the choice.
  useEffect(() => {
    if (!word) {
      setSuggestions([])
      onHighlight(null)
      return
    }
    setSuggestions(window.openpdf.spell.suggest(word.word))
  }, [word?.word]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!at) return onHighlight(null)
    let live = true
    client.pageText(at.page).then(
      (pt) => {
        if (!live) return
        const first = pt.charOf[at.start]
        const last = pt.charOf[Math.max(at.start, at.end - 1)]
        let x1 = Infinity
        let y1 = Infinity
        let x2 = -Infinity
        let y2 = -Infinity
        for (let c = first; c <= last; c++) {
          const l = pt.boxes[c * 4]
          const tp = pt.boxes[c * 4 + 1]
          const r = pt.boxes[c * 4 + 2]
          const b = pt.boxes[c * 4 + 3]
          if (r - l <= 0 && b - tp <= 0) continue
          x1 = Math.min(x1, l)
          y1 = Math.min(y1, tp)
          x2 = Math.max(x2, r)
          y2 = Math.max(y2, b)
        }
        onHighlight(Number.isFinite(x1) ? { page: at.page, rect: { x: x1, y: y1, w: x2 - x1, h: y2 - y1 } } : null)
      },
      () => live && onHighlight(null)
    )
    onGoToPage(at.page)
    return () => {
      live = false
    }
  }, [at?.page, at?.start, word?.word]) // eslint-disable-line react-hooks/exhaustive-deps

  const drop = (w: SpellWord) => {
    const next = list.filter((x) => x !== w)
    setList(next)
    setSel((s) => Math.min(s, Math.max(0, next.length - 1)))
    setOcc(0)
  }

  const ignore = () => {
    if (!word) return
    ignoredWords.add(word.word.replace(/’/g, "'").toLowerCase())
    drop(word)
  }

  const add = async () => {
    if (!word) return
    const ok = await window.openpdf.spell.addWord(word.word.replace(/’/g, "'"))
    if (ok) {
      setNotice(t('{word} added to the dictionary.', { word: word.word }))
      drop(word)
    } else setNotice(t('The word could not be added to the dictionary.'))
  }

  const copy = async (s: string) => {
    try {
      await navigator.clipboard.writeText(s)
      setNotice(t('Copied {word}. Paste it where the word is with the Edit text tool.', { word: s }))
    } catch {
      setNotice(t('The suggestion could not be copied.'))
    }
  }

  const pageName = (p: number) => t('page {n}', { n: labels?.[p] || String(p + 1) })
  const total = list.reduce((n, w) => n + w.occurrences.length, 0)

  return (
    <div className="spell-pane" aria-label={t('Spelling')}>
      <div className="side-toolbar">
        <button type="button" onClick={() => void check()} disabled={!ready || state === 'reading'}>
          {t('Check again')}
        </button>
        <button
          type="button"
          onClick={() => {
            ignoredWords.clear()
            void check()
          }}
          disabled={!ready || state === 'reading'}
          title={t('Forget the words ignored so far and check again')}
        >
          {t('Reset ignored')}
        </button>
      </div>
      <label className="spell-opt">
        <input type="checkbox" checked={ignoreCaps} onChange={(e) => setIgnoreCaps(e.target.checked)} /> {t('Ignore words in capitals')}
      </label>
      <label className="spell-opt">
        <input type="checkbox" checked={ignoreDigits} onChange={(e) => setIgnoreDigits(e.target.checked)} /> {t('Ignore words with numbers')}
      </label>
      {state === 'reading' && (
        <p className="muted small" role="status">
          {t('Reading the text… {done} of {total} pages', { done: progress, total: pageCount })}
        </p>
      )}
      {state === 'off' && <p className="muted small">{t('Spell check is turned off. Turn it on in Settings (Check spelling in text boxes), then check again.')}</p>}
      {state === 'nodict' && <p className="muted small">{t('The spelling dictionary is not loaded. It is downloaded the first time it is needed, so this computer must be online once. Check again in a moment.')}</p>}
      {state === 'done' && (
        <p className="muted small" role="status">
          {list.length
            ? t('{words} words not in the dictionary ({n} places). Dictionary: {lang}.', { words: list.length, n: total, lang: languages.join(', ') || '…' })
            : t('No spelling mistakes found in the text of the {n} pages. Dictionary: {lang}.', { n: texts.length, lang: languages.join(', ') || '…' })}
        </p>
      )}
      {notice && (
        <p className="small" role="status">
          {notice}
        </p>
      )}
      {list.length > 0 && (
        <ul className="side-list spell-list" aria-label={t('Words not in the dictionary')}>
          {list.map((w, i) => (
            <li key={w.word.toLowerCase()} className={i === sel ? 'selected' : undefined}>
              <button
                type="button"
                className="link-btn"
                aria-pressed={i === sel}
                onClick={() => {
                  setSel(i)
                  setOcc(0)
                }}
              >
                <span className="side-list-name">{w.word}</span>
              </button>
              <span className="muted small">{w.occurrences.length > 1 ? t('{n} places', { n: w.occurrences.length }) : pageName(w.occurrences[0].page)}</span>
            </li>
          ))}
        </ul>
      )}
      {word && at && (
        <section className="spell-detail" aria-label={t('Selected word')}>
          <h3 className="tags-heading">{word.word}</h3>
          <p className="small spell-context">{spellContext(texts[at.page] ?? '', at)}</p>
          <p className="muted small">
            {pageName(at.page)} ({t('{i} of {n}', { i: occ + 1, n: word.occurrences.length })})
          </p>
          <div className="side-toolbar spell-actions">
            <button type="button" disabled={occ === 0} onClick={() => setOcc(occ - 1)}>
              {t('Previous')}
            </button>
            <button type="button" disabled={occ + 1 >= word.occurrences.length} onClick={() => setOcc(occ + 1)}>
              {t('Next')}
            </button>
          </div>
          <p className="small">{suggestions.length ? t('Suggestions') : t('No suggestions.')}</p>
          {suggestions.length > 0 && (
            <ul className="spell-suggest" aria-label={t('Suggestions')}>
              {suggestions.map((s) => (
                <li key={s}>
                  <button type="button" onClick={() => void copy(s)} title={t('Copy this suggestion')}>
                    {s}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="side-toolbar spell-actions">
            <button type="button" onClick={ignore} title={t('Skip this word for the rest of the session')}>
              {t('Ignore')}
            </button>
            <button type="button" onClick={() => void add()} title={t('Add this word to the dictionary')}>
              {t('Add to dictionary')}
            </button>
          </div>
        </section>
      )}
    </div>
  )
}
