import { _electron as electron, expect, test, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, statSync, copyFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

/**
 * Walkthrough: clicks every button on every ribbon tab (enumerated from the DOM) on an open document and records what
 * happened. It reports; it only fails on uncaught page errors being unrecorded... it never asserts on individual commands.
 * The report is printed at the end and written to walkthrough-report.txt in the test output folder.
 * Native OS dialogs are replaced in the main process with a stub that records the call and cancels.
 */
const root = resolve(__dirname, '..')
const DIALOGS = '[role="dialog"], .modal, .page-dialog, .stamp-picker, .modal-backdrop'

test.setTimeout(Number(process.env.WALK_TIMEOUT ?? 170_000))

test('walkthrough of every ribbon button and the main workflows', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'openpdf-walk-'))
  const pdfPath = join(dir, 'walk.pdf')
  const pdf2 = join(dir, 'walk2.pdf')
  const savePath = join(dir, 'saved-copy.pdf')
  execFileSync('python', [join(root, 'scripts', 'make-test-pdf.py'), pdfPath], { stdio: 'inherit' })
  copyFileSync(pdfPath, pdf2)

  const app = await electron.launch({
    args: ['.', pdfPath],
    cwd: root,
    env: {
      ...process.env,
      OPENPDF_E2E: '1',
      OPENPDF_E2E_DISCARD: '1',
      OPENPDF_E2E_USERDATA: join(dir, 'userdata'),
      OPENPDF_E2E_OPEN: pdfPath,
      OPENPDF_E2E_DIR: dir
    }
  })
  const report: string[] = []
  const log = (s: string): void => {
    report.push(s)
    console.log(s)
  }
  try {
    // Stub every native dialog: record it, answer "cancel".
    await app.evaluate(({ dialog }) => {
      const g = globalThis as unknown as { __native: string[] }
      g.__native = []
      const rec = (n: string) => g.__native.push(n)
      const d = dialog as unknown as Record<string, (...a: unknown[]) => unknown>
      d.showOpenDialog = async () => (rec('showOpenDialog'), { canceled: true, filePaths: [] })
      d.showSaveDialog = async () => (rec('showSaveDialog'), { canceled: true, filePath: undefined })
      d.showMessageBox = async () => (rec('showMessageBox'), { response: 1, checkboxChecked: false })
      d.showMessageBoxSync = () => (rec('showMessageBoxSync'), 1)
    })
    const takeNative = async (): Promise<string[]> =>
      app.evaluate(() => {
        const g = globalThis as unknown as { __native: string[] }
        return g.__native.splice(0)
      })

    const win = await app.firstWindow()
    let current = 'startup'
    const problems: string[] = []
    const errs: string[] = []
    win.on('pageerror', (e) => errs.push(`pageerror: ${e.message}`))
    win.on('console', (m) => {
      if (m.type() === 'error') errs.push(`console.error: ${m.text().slice(0, 300)}`)
    })
    const jsDialogs: string[] = []
    win.on('dialog', (d) => {
      jsDialogs.push(`${d.type()}: ${d.message().slice(0, 120)}`)
      void d.accept(d.type() === 'prompt' ? d.defaultValue() || '1' : undefined).catch(() => undefined)
    })
    const flushErrs = (): string[] => errs.splice(0)

    await expect(win.locator('.page')).toHaveCount(6)
    // Playwright's dialog.accept does not reach Electron's window.confirm; answer "OK" in the page and record the text.
    await win.evaluate(() => {
      const w = window as unknown as { __js: string[] }
      w.__js = []
      window.confirm = (m?: string) => (w.__js.push(`confirm: ${(m ?? '').slice(0, 100)}`), true)
      window.alert = (m?: unknown) => void w.__js.push(`alert: ${String(m).slice(0, 100)}`)
      window.prompt = (m?: string, d?: string) => (w.__js.push(`prompt: ${(m ?? '').slice(0, 100)}`), d ?? '1')
    })

    const fingerprint = (): Promise<string> =>
      win.evaluate((dl) => {
        const visible = (el: Element): boolean => (el as HTMLElement).offsetParent !== null || getComputedStyle(el).position === 'fixed'
        const dialogs = [...document.querySelectorAll(dl)].filter(visible).length
        const pressed = [...document.querySelectorAll('[aria-pressed="true"]')].map((e) => (e.getAttribute('aria-label') || e.textContent || '').trim()).join('|')
        const banners = [...document.querySelectorAll('.banner, .error, .recovery-bar, [role="alert"], [role="status"]')].map((e) => (e.textContent || '').trim().slice(0, 80)).join('|')
        const dirty = document.querySelectorAll('.tab-dirty').length
        const tabs = document.querySelectorAll('.tabs [role="tab"]').length
        const pages = document.querySelectorAll('.page').length
        const sc = document.querySelector('.scroller')
        const sidebar = (document.querySelector('aside.sidebar')?.textContent || '').length
        const cls = document.querySelector('.scroller')?.className ?? ''
        const overlay = document.querySelectorAll('.page *').length
        const zoom = (document.querySelector('[aria-label="Zoom"]') as HTMLInputElement | null)?.value ?? ''
        const ribbonTab = document.querySelector('.rtab.on')?.textContent
        const pr = document.querySelector('.page')?.getBoundingClientRect()
        const p0 = pr ? Math.round(pr.width) + 'x' + Math.round(pr.height) : ''
        return JSON.stringify({ dialogs, pressed, banners, dirty, tabs, pages, sidebar, cls, overlay, zoom, ribbonTab, p0, sc: sc ? sc.scrollHeight : 0 })
      }, DIALOGS)

    const openDialogs = (): Promise<number> =>
      win.evaluate((dl) => [...document.querySelectorAll(dl)].filter((el) => (el as HTMLElement).offsetParent !== null || getComputedStyle(el).position === 'fixed').length, DIALOGS)

    /** Close any open dialog. Returns how it closed. */
    const closeDialogs = async (): Promise<string> => {
      if ((await openDialogs()) === 0) return 'none'
      await win.keyboard.press('Escape')
      await win.waitForTimeout(150)
      if ((await openDialogs()) === 0) return 'esc'
      const btn = win.locator(DIALOGS).last().getByRole('button', { name: /^(cancel|close|done|✕|no|exit|ok)/i }).first()
      if (await btn.count()) {
        await btn.click({ timeout: 2000 }).catch(() => undefined)
        await win.waitForTimeout(150)
        if ((await openDialogs()) === 0) return 'button-only'
      }
      for (let i = 0; i < 3 && (await openDialogs()); i++) {
        await win.keyboard.press('Escape')
        await win.waitForTimeout(100)
      }
      return (await openDialogs()) === 0 ? 'multi-esc' : 'STUCK'
    }

    const healthy = (): Promise<boolean> =>
      win.evaluate(() => document.querySelectorAll('.page').length === 6 && document.querySelectorAll('.tab-dirty').length === 0 && document.querySelectorAll('.tabs [role="tab"]').length === 1)

    const reopen = async (): Promise<void> => {
      await closeDialogs()
      for (let i = 0; i < 8 && (await win.locator('.tabs [role="tab"]').count()); i++) {
        await win.evaluate(() => (document.querySelector('.tab-close') as HTMLElement | null)?.click())
        await win.waitForTimeout(150)
      }
      if (await win.locator('.tabs [role="tab"]').count()) {
        log(`  (diag) tab will not close: ${await win.evaluate(() => JSON.stringify({ dirty: document.querySelectorAll('.tab-dirty').length, overlays: [...document.querySelectorAll('.page-dialog,.modal,[role=status],[role=alert]')].map((e) => e.className + ':' + (e.textContent || '').slice(0, 60)) }))} `)
        await win.locator('.tab-close').first().click({ force: true, timeout: 3000 }).catch(() => undefined)
      }
      await expect(win.locator('.tabs [role="tab"]')).toHaveCount(0, { timeout: 5000 })
      await win.evaluate(() => (document.querySelector('.tab-new') as HTMLElement | null)?.click())
      await expect(win.locator('.page')).toHaveCount(6, { timeout: 15_000 })
    }

    const reset = async (): Promise<void> => {
      await closeDialogs()
      await win.keyboard.press('Escape')
      if (!(await healthy())) {
        try {
          await reopen()
        } catch (e) {
          log(`!! could not recover document after "${current}": ${(e as Error).message.slice(0, 120)}`)
          throw e
        }
      }
      // back to the Select tool if one exists
      const sel = win.locator('.ribbon-body').getByRole('button', { name: /^Select$/ })
      if (await sel.count()) await sel.first().click({ timeout: 1000 }).catch(() => undefined)
    }

    // Native dialog buttons: nothing to skip by name because every native dialog is stubbed.
    const tabNames = await win.locator('[aria-label="Ribbon"] [role="tab"]').allTextContents()
    log(`Ribbon tabs: ${tabNames.join(', ')}`)

    const rows: string[] = []
    const noEffect: string[] = []
    const stuck: string[] = []
    const errored: string[] = []
    let total = 0

    for (const tab of tabNames) {
      await reset()
      await win.getByRole('tab', { name: tab, exact: true }).first().click()
      const labels = await win.locator('.ribbon-body button').evaluateAll((els) =>
        els.map((e, i) => ({ i, label: ((e.getAttribute('aria-label') || e.textContent || e.getAttribute('title') || '') as string).trim(), disabled: (e as HTMLButtonElement).disabled }))
      )
      log(`\n== ${tab}: ${labels.length} buttons`)
      const seen = new Map<string, number>()
      for (const b of labels) {
        const n = (seen.get(b.label) ?? 0) + 1
        seen.set(b.label, n)
        const name = `${tab} > ${b.label}${n > 1 ? ` #${n}` : ''}`
        current = name
        if (!(await healthy())) {
          await reset().catch(() => undefined)
          await win.getByRole('tab', { name: tab, exact: true }).first().click()
        }
        const nowDisabled = await win.locator('.ribbon-body button').nth(b.i).isDisabled().catch(() => true)
        if (nowDisabled) {
          rows.push(`${name}: disabled`)
          continue
        }
        total++
        try {
          if (!(await healthy())) await reset()
          await win.keyboard.press('Escape')
          await win.getByRole('tab', { name: tab, exact: true }).first().click({ timeout: 3000 })
          const btn = win.locator('.ribbon-body button').nth(b.i)
          flushErrs()
          jsDialogs.length = 0
          await takeNative()
          const before = await fingerprint()
          const wasPressed = await btn.getAttribute('aria-pressed', { timeout: 2000 })
          await btn.click({ timeout: 3000, noWaitAfter: true })
          await win.waitForTimeout(200)
          const after = await fingerprint()
          const native = await takeNative()
          const e = flushErrs()
          const pressed = await win.locator('.ribbon-body button').nth(b.i).getAttribute('aria-pressed', { timeout: 2000 }).catch(() => null)
          const dlg = await openDialogs()
          const changed = before !== after
          const facts: string[] = []
          if (dlg) facts.push(`dialog(${await win.locator(DIALOGS).last().getAttribute('aria-label').catch(() => '?')})`)
          if (native.length) facts.push(`native:${native.join(',')}`)
          const js = await win.evaluate(() => (window as unknown as { __js: string[] }).__js.splice(0))
          if (js.length) facts.push(`js:${js.join(';')}`)
          if (pressed !== wasPressed) facts.push(`pressed:${wasPressed}->${pressed}`)
          if (changed && !dlg) facts.push('dom-changed')
          let closeHow = ''
          if (dlg) {
            closeHow = await closeDialogs()
            facts.push(`close:${closeHow}`)
            if (closeHow === 'STUCK') stuck.push(name)
            else if (closeHow === 'button-only') facts.push('(Esc does not close)')
          }
          // tool drag
          if (pressed === 'true' && wasPressed !== 'true' && !dlg && tab !== 'View' && !/^(Colour|Properties|Hand)/.test(b.label)) {
            const pg = await win.locator('.page').first().boundingBox({ timeout: 3000 })
            if (pg) {
              await win.locator('.page').first().scrollIntoViewIfNeeded({ timeout: 3000 })
              const pb = (await win.locator('.page').first().boundingBox({ timeout: 3000 }))!
              const pre = await fingerprint()
              await win.mouse.move(pb.x + pb.width * 0.3, pb.y + pb.height * 0.3)
              await win.mouse.down()
              await win.mouse.move(pb.x + pb.width * 0.45, pb.y + pb.height * 0.38, { steps: 6 })
              await win.mouse.move(pb.x + pb.width * 0.6, pb.y + pb.height * 0.45, { steps: 6 })
              await win.mouse.up()
              await win.waitForTimeout(300)
              await win.keyboard.press('Escape')
              const post = await fingerprint()
              const pre2 = JSON.parse(pre) as Record<string, unknown>
              const post2 = JSON.parse(post) as Record<string, unknown>
              const drag = pre2.overlay !== post2.overlay || pre2.dirty !== post2.dirty || pre2.dialogs !== post2.dialogs || pre2.banners !== post2.banners
              facts.push(drag ? 'drag:result' : 'drag:NOTHING')
              if (!drag) noEffect.push(`${name} (tool pressed, drag on page produced nothing)`)
              await closeDialogs()
            }
          }
          const e2 = flushErrs()
          const allErr = [...e, ...e2]
          if (allErr.length) {
            facts.push(`ERRORS: ${[...new Set(allErr)].join(' || ')}`)
            errored.push(`${name}: ${[...new Set(allErr)][0]}`)
          }
          if (!facts.length) {
            facts.push('NO VISIBLE EFFECT')
            noEffect.push(name)
          }
          rows.push(`${name}: ${facts.join('; ')}`)
        } catch (err) {
          const msg = (err as Error).message.split('\n')[0].slice(0, 160)
          rows.push(`${name}: HARNESS ${msg}`)
          problems.push(`${name}: ${msg}`)
          await win.keyboard.press('Escape').catch(() => undefined)
        }
      }
      for (const r of rows.splice(0)) log(r)
    }

    log(`\nClicked ${total} enabled buttons.`)
    log(`Dialogs that do not close with Esc/Cancel: ${stuck.join('; ') || 'none'}`)
    log(`No visible effect: ${noEffect.join('; ') || 'none'}`)
    log(`Errors: ${errored.join('\n  ') || 'none'}`)

    // ---- Workflows ----
    log('\n== Workflows')
    await reset()
    const step = async (name: string, fn: () => Promise<void>): Promise<void> => {
      current = name
      flushErrs()
      try {
        await fn()
        const e = flushErrs()
        log(`${name}: ok${e.length ? ` BUT ERRORS: ${[...new Set(e)].join(' || ')}` : ''}`)
      } catch (err) {
        log(`${name}: FAILED ${(err as Error).message.split('\n')[0].slice(0, 200)}`)
        flushErrs()
        await win.keyboard.press('Escape').catch(() => undefined)
      }
    }

    await step('thumbnails context menu', async () => {
      await win.getByRole('tab', { name: 'Home', exact: true }).first().click()
      const th = win.locator('[data-thumb="1"]')
      await th.click({ button: 'right', timeout: 3000 })
      await win.waitForTimeout(300)
      const items = await win.locator('[role="menuitem"], .ctx-menu button, .context-menu button, .menu button').allTextContents()
      log(`  context menu items: ${items.length ? items.map((s) => s.trim()).join(', ') : 'NONE FOUND'}`)
      if (!items.length) throw new Error('no context menu appeared')
      for (let k = 0; k < items.length; k++) {
        await th.click({ button: 'right', timeout: 3000 })
        const item = win.locator('[role="menuitem"], .ctx-menu button, .context-menu button, .menu button').nth(k)
        const label = ((await item.textContent()) || '').trim()
        const dis = await item.isDisabled().catch(() => false)
        if (dis) {
          await win.keyboard.press('Escape')
          continue
        }
        const f0 = await fingerprint()
        flushErrs()
        await item.click({ timeout: 2000 }).catch(() => undefined)
        await win.waitForTimeout(300)
        const f1 = await fingerprint()
        const e = flushErrs()
        const d = await openDialogs()
        const how = d ? await closeDialogs() : ''
        log(`  menu "${label}": ${f0 !== f1 || d ? 'effect' : 'NO VISIBLE EFFECT'}${d ? ` dialog close:${how}` : ''}${e.length ? ` ERRORS ${e[0]}` : ''}`)
        await win.keyboard.press('Escape')
        if (!(await healthy())) await reset()
      }
    })
    await reset()

    await step('sidebar panes (thumbnails, bookmarks, others)', async () => {
      const tabs = win.locator('[aria-label="Side pane"] [role="tab"]')
      const n = await tabs.count()
      for (let i = 0; i < n; i++) {
        const t = tabs.nth(i)
        const nm = (await t.getAttribute('aria-label')) ?? `#${i}`
        flushErrs()
        await t.click()
        await win.waitForTimeout(300)
        const text = ((await win.locator('aside.sidebar').textContent()) ?? '').trim().slice(0, 60)
        const e = flushErrs()
        log(`  pane ${nm}: "${text}"${e.length ? ` ERRORS ${e[0]}` : ''}`)
        if (/bookmark|outline/i.test(nm)) {
          const first = win.locator('aside.sidebar [role="treeitem"], aside.sidebar .outline-item, aside.sidebar li button, aside.sidebar .bookmark').first()
          if (await first.count()) {
            await win.locator('.scroller').evaluate((s) => (s.scrollTop = 0))
            await first.click({ timeout: 2000 }).catch(() => undefined)
            await win.waitForTimeout(400)
            log('  clicked first bookmark')
          } else log('  bookmarks pane: no entries found (test PDF has bookmarks)')
        }
      }
    })

    await step('search', async () => {
      await win.keyboard.press('Control+f')
      const find = win.getByRole('searchbox', { name: 'Find in document' })
      await expect(find).toBeVisible({ timeout: 3000 })
      await find.fill('fox')
      await find.press('Enter')
      await expect(win.locator('.search-status')).toHaveText(/of \d+/)
      await find.press('Enter')
      await find.press('Shift+Enter')
      await find.fill('zzzzqqq')
      await find.press('Enter')
      log(`  no-match status: "${await win.locator('.search-status').textContent()}"`)
      await find.press('Escape')
    })

    await step('zoom modes', async () => {
      await win.getByRole('tab', { name: 'View', exact: true }).first().click()
      const zoomBtns = await win.locator('.ribbon-body [aria-label="Zoom"] button, .ribbon-body [role="group"][aria-label="Zoom"] button').allTextContents()
      log(`  zoom group buttons: ${zoomBtns.map((s) => s.trim()).join(', ')}`)
      const sc = win.locator('.scroller')
      const w0 = (await win.locator('.page').first().boundingBox())!.width
      await win.keyboard.press('Control+=')
      await win.waitForTimeout(500)
      const w1 = (await win.locator('.page').first().boundingBox())!.width
      await win.keyboard.press('Control+-')
      await win.keyboard.press('Control+-')
      await win.waitForTimeout(500)
      const w2 = (await win.locator('.page').first().boundingBox())!.width
      await win.keyboard.press('Control+1')
      await win.waitForTimeout(500)
      const w3 = (await win.locator('.page').first().boundingBox())!.width
      await win.keyboard.press('Control+0')
      await win.waitForTimeout(500)
      const w4 = (await win.locator('.page').first().boundingBox())!.width
      log(`  widths fit:${w0.toFixed(0)} in:${w1.toFixed(0)} out2:${w2.toFixed(0)} 100%:${w3.toFixed(0)} fit:${w4.toFixed(0)}`)
      if (!(w1 > w0 && w2 < w1)) throw new Error('zoom keys did not change page size as expected')
      void sc
    })
    await reset()

    await step('tool gestures (screenshot diff of the page)', async () => {
      const tools: Array<[string, string]> = [
        ['Home', 'Note'], ['Comment', 'Note'], ['Comment', 'Text box'], ['Comment', 'Typewriter'], ['Comment', 'Attach file'], ['Comment', 'Sound'], ['Comment', 'Callout'],
        ['Draw', 'Polygon'], ['Draw', 'Polyline'], ['Draw', 'Cloud'], ['Draw', 'Eraser'],
        ['Forms', 'Text'], ['Forms', 'Check box'], ['Forms', 'Radio'], ['Forms', 'Drop-down'], ['Forms', 'List box'], ['Forms', 'Button'], ['Forms', 'Signature'],
        ['Redact', 'Mark area'], ['Measure', 'Distance'], ['Measure', 'Perimeter'], ['Measure', 'Area']
      ]
      for (const [tab, name] of tools) {
        await reset()
        await win.getByRole('tab', { name: tab, exact: true }).first().click()
        const btn = win.locator('.ribbon-body').getByRole('button', { name, exact: true }).first()
        if (!(await btn.count()) || (await btn.isDisabled())) {
          log(`  ${tab} > ${name}: not available`)
          continue
        }
        await btn.click({ timeout: 3000 })
        await win.locator('.page').first().scrollIntoViewIfNeeded({ timeout: 3000 })
        const pb = (await win.locator('.page').first().boundingBox({ timeout: 3000 }))!
        const clip = { x: pb.x, y: pb.y, width: pb.width, height: Math.min(pb.height, 500) }
        const shot = async (): Promise<string> => (await win.screenshot({ clip })).toString('base64')
        const state = async (): Promise<string> => (await fingerprint()) + (await shot())
        const P = (fx: number, fy: number) => [pb.x + pb.width * fx, pb.y + pb.height * fy] as const
        const tryIt = async (kind: string, run: () => Promise<void>): Promise<boolean> => {
          const b = await state()
          flushErrs()
          await run()
          await win.waitForTimeout(700)
          const a = await state()
          return a !== b
        }
        const results: string[] = []
        const drag = async (): Promise<void> => {
          await win.mouse.move(...P(0.3, 0.2))
          await win.mouse.down()
          await win.mouse.move(...P(0.45, 0.26), { steps: 5 })
          await win.mouse.move(...P(0.6, 0.32), { steps: 5 })
          await win.mouse.up()
        }
        const click = async (): Promise<void> => {
          await win.mouse.click(...P(0.3, 0.2))
        }
        const poly = async (): Promise<void> => {
          await win.mouse.click(...P(0.3, 0.2))
          await win.mouse.click(...P(0.5, 0.2))
          await win.mouse.click(...P(0.5, 0.3))
          await win.mouse.dblclick(...P(0.3, 0.3))
        }
        let ok = ''
        for (const [k, fn] of [['drag', drag], ['click', click], ['multi-click', poly]] as const) {
          if (await tryIt(k, fn)) {
            ok = k
            break
          }
          results.push(k)
        }
        const e = flushErrs()
        log(`  ${tab} > ${name}: ${ok ? `works by ${ok}` : 'NOTHING HAPPENED with drag, click or multi-click'}${e.length ? ` ERRORS ${e[0]}` : ''}${(await openDialogs()) ? ' (a dialog opened)' : ''}`)
        await closeDialogs()
      }
    })

    await step('tabs: open second doc, switch, close', async () => {
      await app.evaluate((_e, p) => void (process.env.OPENPDF_E2E_OPEN = p), pdf2)
      await win.locator('.tab-new').click()
      await expect(win.locator('.tabs [role="tab"]')).toHaveCount(2, { timeout: 10_000 })
      await expect(win.locator('.page:visible')).toHaveCount(6)
      await win.locator('.tabs [role="tab"]').first().click()
      await win.waitForTimeout(300)
      await win.locator('.tabs [role="tab"]').nth(1).click()
      await win.waitForTimeout(300)
      await expect(win.locator('.page:visible')).toHaveCount(6)
      await win.locator('.tab-close').nth(1).click()
      await expect(win.locator('.tabs [role="tab"]')).toHaveCount(1)
      await expect(win.locator('.page:visible')).toHaveCount(6)
    })

    await reset()
    await step('undo / redo / save / re-open', async () => {
      await win.getByRole('tab', { name: 'Organise', exact: true }).first().click()
      await win.locator('[data-thumb="1"]').click()
      const before = await win.locator('.page:visible').nth(1).boundingBox()
      await win.getByRole('button', { name: 'Rotate right' }).click()
      await expect(win.locator('.tab-dirty')).toBeVisible()
      await win.waitForTimeout(500)
      const rotated = await win.locator('.page:visible').nth(1).boundingBox()
      if (Math.abs(rotated!.width - before!.width) < 2) log('  NOTE: page 2 size unchanged after Rotate right')
      await win.keyboard.press('Control+z')
      await win.waitForTimeout(600)
      const undone = await win.locator('.page:visible').nth(1).boundingBox()
      log(`  undo restores page shape: ${Math.abs(undone!.width - before!.width) < 3}; dirty after undo: ${await win.locator('.tab-dirty').count()}`)
      await win.keyboard.press('Control+y')
      await win.waitForTimeout(600)
      const redone = await win.locator('.page:visible').nth(1).boundingBox()
      log(`  redo re-applies rotation: ${Math.abs(redone!.width - rotated!.width) < 3}`)
      // Save As to temp copy via the test hook is not wired for OPENPDF_E2E_SAVE here (set per-launch); use Ctrl+S on the temp file.
      await win.keyboard.press('Control+s')
      await win.waitForTimeout(1500)
      const dirtyAfter = await win.locator('.tab-dirty').count()
      const size = statSync(pdfPath).size
      log(`  after Ctrl+S: dirty markers ${dirtyAfter}, file size ${size}, banner: "${((await win.locator('.banner').first().textContent().catch(() => '')) ?? '').slice(0, 80)}"`)
      writeFileSync(savePath, '')
      // re-open the saved file
      await app.evaluate((_e, p) => void (process.env.OPENPDF_E2E_OPEN = p), pdfPath)
      await win.locator('.tab-close').first().click()
      await expect(win.locator('.tabs [role="tab"]')).toHaveCount(0, { timeout: 5000 })
      await win.locator('.tab-new').click()
      await expect(win.locator('.tabs [role="tab"]')).toHaveCount(1, { timeout: 10_000 })
      await win.waitForTimeout(1200)
      const reopened = await win.locator('.page:visible').nth(1).boundingBox()
      log(`  reopened page 2 is rotated like the saved one: ${Math.abs(reopened!.width - rotated!.width) < 3}`)
      if (dirtyAfter) throw new Error('document still marked unsaved after Ctrl+S')
    })

    // report
    const out = report.join('\n')
    console.log('\n===== WALKTHROUGH REPORT =====\n' + out + '\n===== END =====')
    writeFileSync(test.info().outputPath('walkthrough-report.txt'), out)
    console.log(`harness problems: ${problems.join(' | ') || 'none'}`)
    expect(existsSync(pdf2)).toBe(true)
  } finally {
    await app.close().catch(() => undefined)
    rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 })
  }
})

export type { Page }
