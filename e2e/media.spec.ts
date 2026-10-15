import { _electron as electron, expect, test } from '@playwright/test'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { PDFDocument, PDFName, PDFString } from 'pdf-lib'

const root = resolve(__dirname, '..')

/** A real WAV: 0.25 s of silence, 8 kHz, 16-bit mono. */
function wav(): Uint8Array {
  const samples = 2000
  const b = Buffer.alloc(44 + samples * 2)
  b.write('RIFF', 0)
  b.writeUInt32LE(36 + samples * 2, 4)
  b.write('WAVEfmt ', 8)
  b.writeUInt32LE(16, 16)
  b.writeUInt16LE(1, 20)
  b.writeUInt16LE(1, 22)
  b.writeUInt32LE(8000, 24)
  b.writeUInt32LE(16000, 28)
  b.writeUInt16LE(2, 32)
  b.writeUInt16LE(16, 34)
  b.write('data', 36)
  b.writeUInt32LE(samples * 2, 40)
  return new Uint8Array(b)
}

async function makePdf(path: string, audio: Uint8Array): Promise<void> {
  const doc = await PDFDocument.create()
  const page = doc.addPage([300, 300])
  const ctx = doc.context
  const file = (name: string, data: Uint8Array) => ctx.register(ctx.obj({ Type: 'Filespec', F: PDFString.of(name), EF: { F: ctx.register(ctx.flateStream(data)) } }))
  const annots = ctx.obj([])
  annots.push(ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Screen', Rect: [20, 200, 120, 250], T: PDFString.of('Intro'), A: { S: 'Rendition', R: { Type: 'Rendition', S: 'MR', C: { Type: 'MediaClip', S: 'MCD', CT: PDFString.of('audio/wav'), D: file('site-intro.wav', audio) } } } })))
  annots.push(ctx.register(ctx.obj({ Type: 'Annot', Subtype: '3D', Rect: [20, 100, 120, 150], T: PDFString.of('Pump model') })))
  page.node.set(PDFName.of('Annots'), annots)
  writeFileSync(path, await doc.save())
}

test('audio in a document is listed, plays in the built-in player, and can be saved; 3D content is reported', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'openpdf-e2e-'))
  const out = join(dir, 'saved')
  mkdirSync(out)
  const audio = wav()
  const pdf = join(dir, 'media.pdf')
  await makePdf(pdf, audio)
  const app = await electron.launch({ args: ['.', pdf], cwd: root, env: { ...process.env, OPENPDF_E2E: '1', OPENPDF_E2E_USERDATA: join(dir, 'ud'), OPENPDF_E2E_DISCARD: '1', OPENPDF_E2E_DIR: out } })
  try {
    const win = await app.firstWindow()
    const problems: string[] = []
    win.on('pageerror', (e) => problems.push(e.message))
    await expect(win.locator('.page')).toHaveCount(1)
    await win.getByRole('tab', { name: 'Media', exact: true }).click()
    const list = win.getByRole('list', { name: 'Media' })
    await expect(list.getByText('site-intro.wav')).toBeVisible()
    await expect(list.getByText('Pump model')).toBeVisible()
    await expect(list.getByText('3D content: cannot be shown here')).toBeVisible()
    // 3D content has no play or save buttons.
    await expect(list.getByRole('button', { name: /Play Pump model|Save Pump model/ })).toHaveCount(0)

    await list.getByRole('button', { name: 'Play site-intro.wav' }).click()
    const player = win.getByRole('dialog', { name: 'site-intro.wav' })
    const audioEl = player.locator('audio')
    await expect(audioEl).toBeVisible()
    await expect.poll(() => audioEl.evaluate((a: HTMLAudioElement) => a.readyState)).toBeGreaterThanOrEqual(1)
    const duration = await audioEl.evaluate((a: HTMLAudioElement) => a.duration)
    expect(duration).toBeGreaterThan(0.2)
    expect(duration).toBeLessThan(0.3)
    await player.getByRole('button', { name: 'Close', exact: true }).first().click()

    await list.getByRole('button', { name: 'Save site-intro.wav' }).click()
    await expect.poll(() => readdirSync(out)).toEqual(['site-intro.wav'])
    expect(Buffer.from(readFileSync(join(out, 'site-intro.wav'))).equals(Buffer.from(audio))).toBe(true)
    expect(problems).toEqual([])
  } finally {
    await app.close()
    rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 })
  }
})
