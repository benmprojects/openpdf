import { _electron as electron, expect, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(__dirname, '..')
/** ROADMAP Phase 9 target: a 500-page file shows its first page within 2 s of opening. */
const TARGET_MS = 2000

/** Opens `pdfPath` with Ctrl+O from the welcome screen; resolves with ms from Open to the first page drawn. */
async function timeOpen(env: Record<string, string>, pageCount: number) {
  const app = await electron.launch({ args: ['.'], cwd: root, env: { ...process.env, OPENPDF_E2E: '1', OPENPDF_E2E_DISCARD: '1', ...env } })
  const win = await app.firstWindow()
  const problems: string[] = []
  win.on('pageerror', (e) => problems.push(e.message))
  await win.waitForLoadState('domcontentloaded')
  await win.waitForTimeout(500)
  // Measured inside the page: from the Open command to the first page canvas holding a rendering.
  await win.evaluate(() => {
    const w = window as unknown as { __firstPaint?: number; __openAt?: number }
    w.__openAt = performance.now()
    const poll = () => {
      const c = document.querySelector<HTMLCanvasElement>('.page canvas')
      if (c && c.width > 0) w.__firstPaint = performance.now() - w.__openAt!
      else requestAnimationFrame(poll)
    }
    requestAnimationFrame(poll)
  })
  await win.keyboard.press('Control+o')
  await expect.poll(() => win.evaluate(() => (window as unknown as { __firstPaint?: number }).__firstPaint ?? null), { timeout: 30_000 }).not.toBeNull()
  const ms = await win.evaluate(() => (window as unknown as { __firstPaint: number }).__firstPaint)
  await expect(win.locator('.page')).toHaveCount(pageCount)
  return { app, win, ms, problems }
}

test('a 500-page file shows its first page within 2 s and stays within memory bounds', async () => {
  test.setTimeout(180_000)
  const dir = mkdtempSync(join(tmpdir(), 'openpdf-e2e-'))
  const pdfPath = join(dir, 'big.pdf')
  execFileSync('python', [join(root, 'scripts', 'make-big-pdf.py'), pdfPath, '500'])
  const { app, win, ms, problems } = await timeOpen({ OPENPDF_E2E_USERDATA: join(dir, 'ud'), OPENPDF_E2E_OPEN: pdfPath }, 500)
  try {
    console.log(`First page of 500 drawn ${Math.round(ms)} ms after Open`)

    // Scroll through the whole document; renderer memory must stay bounded (pages off screen release their bitmaps).
    for (let i = 0; i < 10; i++) {
      await win.locator('.scroller').evaluate((el, f) => (el.scrollTop = el.scrollHeight * f), i / 10)
      await win.waitForTimeout(300)
    }
    const metrics = await app.evaluate(({ app: a }) => a.getAppMetrics().map((m) => ({ type: m.type, kb: m.memory.workingSetSize })))
    const renderer = metrics.filter((m) => m.type === 'Tab').reduce((s, m) => s + m.kb, 0)
    console.log(`Renderer working set after scrolling: ${Math.round(renderer / 1024)} MB`)
    expect(renderer / 1024).toBeLessThan(1500)
    expect(ms).toBeLessThan(TARGET_MS)
    expect(problems).toEqual([])
  } finally {
    await app.close()
    rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 })
  }
})

test('a page with 2000 annotations shows within 2 s', async () => {
  test.setTimeout(120_000)
  const dir = mkdtempSync(join(tmpdir(), 'openpdf-e2e-'))
  const pdfPath = join(dir, 'annots.pdf')
  const make = `
import sys, pymupdf
d = pymupdf.open()
p = d.new_page()
p.insert_text((50, 60), "Many annotations", fontsize=14)
for i in range(2000):
    x, y = 20 + (i % 50) * 11, 80 + (i // 50) * 18
    p.add_rect_annot(pymupdf.Rect(x, y, x + 8, y + 12))
d.save(sys.argv[1])
`
  execFileSync('python', ['-c', make, pdfPath])
  const { app, win, ms, problems } = await timeOpen({ OPENPDF_E2E_USERDATA: join(dir, 'ud'), OPENPDF_E2E_OPEN: pdfPath }, 1)
  try {
    console.log(`Page with 2000 annotations drawn ${Math.round(ms)} ms after Open`)
    // The annotations are imported too (each one selectable).
    await expect(win.getByRole('tab', { name: 'Comment', exact: true })).toBeVisible()
    expect(ms).toBeLessThan(TARGET_MS)
    expect(problems).toEqual([])
  } finally {
    await app.close()
    rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 })
  }
})
