/**
 * The script console: what scripts printed with console.println, the messages they showed with app.alert, and the errors
 * that stopped them, in the order they happened. Read only; it lives as long as the document is open.
 */
export interface ConsoleLine {
  id: number
  /** HH:MM:SS, local time. */
  at: string
  /** What ran: "Open", "Field Total", "Link" and so on. */
  source: string
  text: string
  level: 'log' | 'alert' | 'error'
}

export const CONSOLE_LIMIT = 500

interface Outcome {
  log: string[]
  alerts: string[]
  error?: string
}

const pad = (n: number) => String(n).padStart(2, '0')
export const clock = (d: Date): string => `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`

/** The lines one script run adds (ids are given by `append`). */
export function linesOf(source: string, r: Outcome, when = new Date()): Omit<ConsoleLine, 'id'>[] {
  const at = clock(when)
  return [
    ...r.log.map((text): Omit<ConsoleLine, 'id'> => ({ at, source, text, level: 'log' })),
    ...r.alerts.map((text): Omit<ConsoleLine, 'id'> => ({ at, source, text, level: 'alert' })),
    ...(r.error ? [{ at, source, text: r.error, level: 'error' as const }] : [])
  ]
}

/** Adds lines, numbering them on from the last, and drops the oldest beyond the limit. */
export function append(list: ConsoleLine[], add: Omit<ConsoleLine, 'id'>[]): ConsoleLine[] {
  if (!add.length) return list
  let id = (list[list.length - 1]?.id ?? 0) + 1
  const next = [...list, ...add.map((l) => ({ ...l, id: id++ }))]
  return next.length > CONSOLE_LIMIT ? next.slice(next.length - CONSOLE_LIMIT) : next
}

/** The console as plain text, for copying. */
export const consoleText = (list: ConsoleLine[]): string => list.map((l) => `${l.at}  [${l.source}] ${l.level === 'error' ? 'Error: ' : l.level === 'alert' ? 'Message: ' : ''}${l.text}`).join('\n')
