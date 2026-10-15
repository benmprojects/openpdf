import { _electron as electron, expect, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(__dirname, '..')

// Note: this spec uses the real system clipboard.
test('snapshot tool copies the dragged box as a PNG, turned with the view', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'openpdf-e2e-'))
  const pdfPath = join(dir, 'snap.pdf')
  execFileSync('python', [join(root, 'scripts', 'make-test-pdf.py'), pdfPath])
  const app = await electron.launch({ args: ['.', pdfPath], cwd: root, env: { ...process.env, OPENPDF_E2E: '1', OPENPDF_E2E_USERDATA: join(dir, 'ud') } })
  /** Width and height of the PNG on the clipboard, read from its header. */
  const clip = () =>
    app.evaluate(async ({ clipboard }) => {
      const items = await clipboard.read()
      const item = items.find((i) => i.types.includes('image/png'))
      if (!item) return null
      const b = new Uint8Array(await (await item.getType('image/png')).arrayBuffer())
      const v = new DataView(b.buffer)
      return { w: v.getUint32(16), h: v.getUint32(20) }
    })
  try {
    const win = await app.firstWindow()
    await expect(win.locator('.page')).toHaveCount(6)
    await win.getByRole('button', { name: 'Snapshot' }).click()
    const drag = async (fw: number, fh: number) => {
      const p = (await win.locator('.page').first().boundingBox())!
      const x = p.x + 40
      const y = p.y + 30
      await win.mouse.move(x, y)
      await win.mouse.down()
      await win.mouse.move(x + fw, y + fh, { steps: 4 })
      await expect(win.locator('.zoom-band')).toBeVisible()
      await win.mouse.up()
    }
    // A wide box: the image is wide too, at 200 dpi (box in CSS px / zoom = points; x 200/72).
    await drag(300, 100)
    await expect(win.getByText(/Snapshot copied to the clipboard/)).toBeVisible()
    const zoom = Number((await win.locator('.zoom-now').textContent())!.replace('%', '')) / 100
    const a = (await clip())!
    expect(Math.abs(a.w - (300 / zoom) * (200 / 72))).toBeLessThan(6)
    expect(Math.abs(a.h - (100 / zoom) * (200 / 72))).toBeLessThan(6)

    // With the view turned a quarter, the same on-screen shape still gives a wide image.
    await win.getByRole('tab', { name: 'View' }).click()
    await win.getByRole('button', { name: 'Rotate view clockwise' }).click()
    await win.getByRole('tab', { name: 'Home' }).click()
    await win.waitForTimeout(300)
    await drag(300, 100)
    await expect.poll(async () => {
      const b = await clip()
      return b ? b.w > b.h * 2 : false
    }).toBe(true)
  } finally {
    await app.close()
    rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 })
  }
})
