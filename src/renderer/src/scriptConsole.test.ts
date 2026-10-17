import { describe, expect, it } from 'vitest'
import { CONSOLE_LIMIT, append, consoleText, linesOf } from './scriptConsole'
import { runScript } from './formScripts'

const at = new Date(2026, 9, 17, 9, 5, 7)

describe('script console', () => {
  it('turns a run into lines: printed text, messages, then the error', () => {
    const lines = linesOf('Open', { log: ['a', 'b'], alerts: ['hello'], error: 'boom' }, at)
    expect(lines.map((l) => [l.level, l.text])).toEqual([['log', 'a'], ['log', 'b'], ['alert', 'hello'], ['error', 'boom']])
    expect(lines[0].at).toBe('09:05:07')
  })

  it('numbers lines on and keeps the newest when it is full', () => {
    let list = append([], linesOf('x', { log: ['1', '2'], alerts: [] }, at))
    expect(list.map((l) => l.id)).toEqual([1, 2])
    list = append(list, linesOf('x', { log: ['3'], alerts: [] }, at))
    expect(list.map((l) => l.id)).toEqual([1, 2, 3])
    const many = append([], Array.from({ length: CONSOLE_LIMIT + 5 }, (_, i) => ({ at: '00:00:00', source: 's', text: String(i), level: 'log' as const })))
    expect(many).toHaveLength(CONSOLE_LIMIT)
    expect(many[many.length - 1].text).toBe(String(CONSOLE_LIMIT + 4))
    expect(append(list, [])).toBe(list)
  })

  it('writes plain text', () => {
    expect(consoleText(append([], linesOf('Open', { log: ['hi'], alerts: ['m'], error: 'bad' }, at)))).toBe('09:05:07  [Open] hi\n09:05:07  [Open] Message: m\n09:05:07  [Open] Error: bad')
  })

  it('collects what a script prints in the sandbox', async () => {
    const r = await runScript('MouseUp', 'console.println("one"); console.println(2); app.alert("shown");', '', [])
    expect(r.error).toBeUndefined()
    expect(linesOf('Test', r, at).map((l) => l.text)).toEqual(['one', '2', 'shown'])
  })
})
