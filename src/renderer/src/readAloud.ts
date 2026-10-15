/**
 * Read aloud with the system's voices (Web Speech API; on Windows these are the installed SAPI voices).
 * Text is spoken a sentence-sized chunk at a time, because very long utterances stall in Chromium, and page by
 * page, so reading can follow the document.
 */
export type ReaderState = 'idle' | 'speaking' | 'paused'

export interface ReaderOptions {
  voiceURI?: string
  rate: number
  /** Text of a page, or null when there are no more pages. */
  pageText: (page: number) => Promise<string | null>
  onPage: (page: number) => void
  onState: (s: ReaderState) => void
}

/** Splits text into chunks of whole sentences, each at most about `max` characters. */
export function chunkText(text: string, max = 220): string[] {
  const clean = text.replace(/\s+/g, ' ').trim()
  if (!clean) return []
  const sentences = clean.match(/[^.!?;:]+[.!?;:]*\s*/g) ?? [clean]
  const out: string[] = []
  let cur = ''
  for (const s of sentences) {
    if (s.length > max) {
      if (cur) out.push(cur.trim())
      cur = ''
      for (let i = 0; i < s.length; i += max) out.push(s.slice(i, i + max).trim())
      continue
    }
    if (cur.length + s.length > max && cur) {
      out.push(cur.trim())
      cur = ''
    }
    cur += s
  }
  if (cur.trim()) out.push(cur.trim())
  return out.filter(Boolean)
}

export class Reader {
  private run = 0
  constructor(private opts: ReaderOptions) {}

  get state(): ReaderState {
    if (!speechSynthesis.speaking && !speechSynthesis.pending) return 'idle'
    return speechSynthesis.paused ? 'paused' : 'speaking'
  }

  /** Reads from `page` to the end of the document, or only `text` when given (a selection). */
  async start(page: number, text?: string): Promise<void> {
    this.stop()
    const run = ++this.run
    this.opts.onState('speaking')
    const voice = speechSynthesis.getVoices().find((v) => v.voiceURI === this.opts.voiceURI)
    const speak = (chunk: string) =>
      new Promise<void>((resolve) => {
        const u = new SpeechSynthesisUtterance(chunk)
        if (voice) u.voice = voice
        u.rate = this.opts.rate
        u.onend = () => resolve()
        u.onerror = () => resolve()
        speechSynthesis.speak(u)
      })
    if (text !== undefined) {
      for (const c of chunkText(text)) {
        if (run !== this.run) return
        await speak(c)
      }
    } else {
      for (let p = page; ; p++) {
        if (run !== this.run) return
        const t = await this.opts.pageText(p)
        if (t === null) break
        this.opts.onPage(p)
        for (const c of chunkText(t)) {
          if (run !== this.run) return
          await speak(c)
        }
      }
    }
    if (run === this.run) this.opts.onState('idle')
  }

  pause(): void {
    speechSynthesis.pause()
    this.opts.onState('paused')
  }

  resume(): void {
    speechSynthesis.resume()
    this.opts.onState('speaking')
  }

  stop(): void {
    this.run++
    speechSynthesis.cancel()
    this.opts.onState('idle')
  }
}
