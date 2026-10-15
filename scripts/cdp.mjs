/**
 * Minimal Chrome DevTools Protocol client for driving the running Electron app in end-to-end checks.
 * Start the app with --remote-debugging-port=9333, import { ev, mouse, key, shot, sleep, done } from this file.
 */
let target
for (let i = 0; i < 40 && !target; i++) {
  try { target = (await (await fetch('http://127.0.0.1:9333/json')).json()).find(t => t.type === 'page') } catch {}
  if (!target) await new Promise(r => setTimeout(r, 500))
}
const ws = new WebSocket(target.webSocketDebuggerUrl)
await new Promise(r => (ws.onopen = r))
let nextId = 1
const waiting = new Map()
ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id) } }
export const send = (method, params = {}) => new Promise((res, rej) => {
  const id = nextId++
  waiting.set(id, m => (m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result)))
  ws.send(JSON.stringify({ id, method, params }))
})
export const ev = async expr => {
  const r = await send('Runtime.evaluate', { expression: `(async()=>{${expr}})()`, awaitPromise: true, returnByValue: true })
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? JSON.stringify(r.exceptionDetails))
  return r.result.value
}
export const sleep = ms => new Promise(r => setTimeout(r, ms))
export const mouse = (type, x, y, extra = {}) => send('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1, ...extra })
export const key = async (k, mods = 0, code) => {
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code: code ?? k, modifiers: mods, windowsVirtualKeyCode: k.length === 1 ? k.toUpperCase().charCodeAt(0) : 0 })
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code: code ?? k, modifiers: mods })
}
export const shot = async path => {
  const { data } = await send('Page.captureScreenshot', { format: 'png' });
  (await import('node:fs')).writeFileSync(path, Buffer.from(data, 'base64'))
}
export const done = () => { ws.close(); process.exit(0) }
