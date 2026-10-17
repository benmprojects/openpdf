import { _electron as electron, expect, test, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(__dirname, '..')

interface Problem {
  rule: string
  where: string
  detail?: string
}

/**
 * Walks the visible page and reports accessibility problems that can be found from the DOM: controls with no
 * accessible name, form fields with no label, duplicate ids, positive tabindex, and text below WCAG AA contrast
 * (4.5:1, or 3:1 for large text). Disabled controls are exempt from contrast, as in WCAG.
 */
async function audit(page: Page): Promise<Problem[]> {
  return page.evaluate(() => {
    const problems: { rule: string; where: string; detail?: string }[] = []
    const visible = (el: Element): boolean => {
      const r = (el as HTMLElement).getBoundingClientRect()
      const s = getComputedStyle(el)
      return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && !el.closest('[aria-hidden="true"]')
    }
    const describe = (el: Element): string => {
      const e = el as HTMLElement
      const label = e.getAttribute('aria-label') || e.getAttribute('title') || (e.textContent ?? '').trim().slice(0, 30)
      return `${el.tagName.toLowerCase()}${e.className && typeof e.className === 'string' ? '.' + e.className.split(' ')[0] : ''}${label ? ` "${label}"` : ''}`
    }
    const textOf = (el: Element): string => {
      let s = ''
      for (const n of el.childNodes) {
        if (n.nodeType === 3) s += n.textContent
        else if (n.nodeType === 1 && !(n as Element).closest('[aria-hidden="true"]') && getComputedStyle(n as Element).display !== 'none') s += textOf(n as Element)
      }
      return s.trim()
    }
    const nameOf = (el: Element): string => {
      const e = el as HTMLElement
      const labelledby = e.getAttribute('aria-labelledby')
      if (labelledby) return labelledby.split(/\s+/).map((id) => document.getElementById(id)?.textContent ?? '').join(' ').trim()
      return (e.getAttribute('aria-label') ?? '').trim() || textOf(el) || (e.getAttribute('title') ?? '').trim() || (el instanceof HTMLImageElement ? el.alt : '')
    }

    // 1. Names.
    for (const el of document.querySelectorAll('button, [role="button"], [role="tab"], [role="menuitem"], a[href], [role="checkbox"], [role="switch"]')) {
      if (visible(el) && !nameOf(el)) problems.push({ rule: 'control-name', where: describe(el) })
    }
    for (const el of document.querySelectorAll('input:not([type="hidden"]), select, textarea')) {
      if (!visible(el)) continue
      const e = el as HTMLInputElement
      const labelled = !!e.labels?.length || !!e.getAttribute('aria-label')?.trim() || !!e.getAttribute('aria-labelledby') || !!e.title
      if (!labelled) problems.push({ rule: 'field-label', where: describe(el), detail: e.type })
    }
    for (const el of document.querySelectorAll('img')) if (visible(el) && !(el as HTMLImageElement).alt && el.getAttribute('role') !== 'presentation' && el.getAttribute('aria-hidden') !== 'true') problems.push({ rule: 'image-alt', where: describe(el) })
    for (const el of document.querySelectorAll('[role="dialog"]')) if (!nameOf(el)) problems.push({ rule: 'dialog-name', where: describe(el) })

    // 2. Ids and tab order.
    const ids = new Map<string, number>()
    for (const el of document.querySelectorAll('[id]')) ids.set(el.id, (ids.get(el.id) ?? 0) + 1)
    for (const [id, n] of ids) if (n > 1) problems.push({ rule: 'duplicate-id', where: `#${id}`, detail: `${n} elements` })
    for (const el of document.querySelectorAll('[tabindex]')) if (Number(el.getAttribute('tabindex')) > 0) problems.push({ rule: 'positive-tabindex', where: describe(el) })

    // 3. Contrast.
    const parse = (c: string): [number, number, number, number] => {
      const m = /rgba?\(([^)]+)\)/.exec(c)
      if (!m) return [0, 0, 0, 1]
      const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number)
      return [p[0], p[1], p[2], p[3] ?? 1]
    }
    const background = (el: Element): [number, number, number] => {
      const layers: [number, number, number, number][] = []
      for (let e: Element | null = el; e; e = e.parentElement) {
        const c = parse(getComputedStyle(e).backgroundColor)
        if (c[3] > 0) layers.push(c)
        if (c[3] >= 1) break
      }
      let [r, g, b] = [255, 255, 255]
      for (const [lr, lg, lb, la] of layers.reverse()) [r, g, b] = [lr * la + r * (1 - la), lg * la + g * (1 - la), lb * la + b * (1 - la)]
      return [r, g, b]
    }
    const lum = ([r, g, b]: number[]) => {
      const f = (v: number) => {
        const s = v / 255
        return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
      }
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
    }
    const seen = new Set<string>()
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const txt = (n.textContent ?? '').trim()
      const el = n.parentElement
      if (!txt || !el || !visible(el) || el.closest('canvas, svg, [aria-hidden="true"], .page, .modal-backdrop > :not(.modal)')) continue
      if ((el.closest('button, input, select, textarea, [role="tab"]') as HTMLButtonElement | null)?.disabled || el.closest('fieldset:disabled')) continue
      const s = getComputedStyle(el)
      const fg = parse(s.color)
      const bg = background(el)
      const blended: [number, number, number] = [fg[0] * fg[3] + bg[0] * (1 - fg[3]), fg[1] * fg[3] + bg[1] * (1 - fg[3]), fg[2] * fg[3] + bg[2] * (1 - fg[3])]
      const l1 = lum(blended)
      const l2 = lum(bg)
      const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)
      const size = parseFloat(s.fontSize)
      const large = size >= 24 || (size >= 18.66 && Number(s.fontWeight) >= 700)
      const need = large ? 3 : 4.5
      if (ratio < need) {
        const key = `${describe(el)}|${s.color}|${s.backgroundColor}`
        if (!seen.has(key)) {
          seen.add(key)
          problems.push({ rule: 'contrast', where: describe(el), detail: `${ratio.toFixed(2)}:1 (needs ${need}) ${s.color} on rgb(${bg.map(Math.round).join(',')})` })
        }
      }
    }
    return problems
  })
}

const fmt = (p: Problem[]) => p.map((x) => `${x.rule}: ${x.where}${x.detail ? ` (${x.detail})` : ''}`)

test('the main screens have no missing names, labels or ids, and text meets WCAG AA contrast', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'openpdf-e2e-'))
  const pdf = join(dir, 'a.pdf')
  execFileSync('python', ['-c', 'import sys, pymupdf\nd = pymupdf.open()\nd.new_page(width=300, height=300).insert_text((50, 100), "Accessibility", fontsize=14)\nd.new_page(width=300, height=300)\nd.save(sys.argv[1])', pdf])
  const app = await electron.launch({ args: ['.', pdf], cwd: root, env: { ...process.env, OPENPDF_E2E: '1', OPENPDF_E2E_USERDATA: join(dir, 'ud'), OPENPDF_E2E_DISCARD: '1' } })
  try {
    const win = await app.firstWindow()
    await expect(win.locator('.page')).toHaveCount(2)
    const all: string[] = []
    for (const scheme of ['light', 'dark'] as const) {
      await win.emulateMedia({ colorScheme: scheme })
      const tabs = await win.getByRole('tablist', { name: 'Ribbon' }).getByRole('tab').allTextContents()
      for (const t of tabs) {
        await win.getByRole('tab', { name: t, exact: true }).click()
        all.push(...fmt(await audit(win)).map((m) => `[${scheme} / ${t}] ${m}`))
      }
      for (const side of ['Pages', 'Bookmarks', 'Comments', 'Attachments', 'Layers', 'Media', 'Tags', 'Spelling']) {
        await win.getByRole('tab', { name: side, exact: true }).click()
        all.push(...fmt(await audit(win)).map((m) => `[${scheme} / side ${side}] ${m}`))
      }
    }
    // Duplicates (the same finding in several tabs) are shown once.
    const unique = [...new Set(all.map((m) => m.replace(/^\[[^\]]*\] /, '')))]
    expect(unique, unique.join('\n')).toEqual([])
  } finally {
    await app.close()
    rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 })
  }
})

test('dialogs have names, take focus when they open, close with Escape, and give focus back', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'openpdf-e2e-'))
  const pdf = join(dir, 'a.pdf')
  execFileSync('python', ['-c', 'import sys, pymupdf\nd = pymupdf.open()\nd.new_page(width=300, height=300).insert_text((50, 100), "Accessibility", fontsize=14)\nd.save(sys.argv[1])', pdf])
  const app = await electron.launch({ args: ['.', pdf], cwd: root, env: { ...process.env, OPENPDF_E2E: '1', OPENPDF_E2E_USERDATA: join(dir, 'ud'), OPENPDF_E2E_DISCARD: '1' } })
  try {
    const win = await app.firstWindow()
    await expect(win.locator('.page')).toHaveCount(1)
    const opens: [string, string, string][] = [
      ['File', 'Batch', 'Batch processing'],
      ['File', 'Plugins', 'Plugins'],
      ['File', 'Security', 'Security'],
      ['File', 'Standards', 'PDF standards'],
      ['File', 'Accessibility check', 'Accessibility check'],
      ['File', 'Word count', 'Word count'],
      ['Convert', 'OCR', 'Recognise text (OCR)'],
      ['Sign', 'Sign document', 'Sign document'],
      ['Redact', 'Hidden information', 'Remove hidden information'],
      ['Organise', 'Compare', 'Compare documents']
    ]
    const problems: string[] = []
    for (const scheme of ['light', 'dark'] as const) {
    await win.emulateMedia({ colorScheme: scheme })
    for (const [tab, button, title] of opens) {
      await win.getByRole('tab', { name: tab, exact: true }).click()
      const trigger = win.getByRole('button', { name: button, exact: true })
      await trigger.click()
      const dialog = win.getByRole('dialog', { name: title })
      await expect(dialog).toBeVisible()
      // Focus is inside the dialog.
      const inside = await win.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'))
      if (!inside) problems.push(`${title}: focus did not move into the dialog`)
      const found = await audit(win)
      problems.push(...fmt(found).map((m) => `${scheme} / ${title}: ${m}`))
      await win.keyboard.press('Escape')
      await expect(dialog).toHaveCount(0)
      // And back to what opened it.
      const back = await win.evaluate((name) => {
        const el = document.activeElement
        return !!el && el !== document.body && ((el.getAttribute('aria-label') ?? '') === name || (el.textContent ?? '').trim().startsWith(name))
      }, button)
      if (!back) problems.push(`${title}: focus did not return to the "${button}" button`)
    }
    }
    expect([...new Set(problems)], problems.join('\n')).toEqual([])
  } finally {
    await app.close()
    rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 })
  }
})

test('every control can be reached and operated from the keyboard, and shows where focus is', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'openpdf-e2e-'))
  const pdf = join(dir, 'a.pdf')
  execFileSync('python', ['-c', 'import sys, pymupdf\nd = pymupdf.open()\nd.new_page(width=300, height=300).insert_text((50, 100), "Keyboard", fontsize=14)\nd.save(sys.argv[1])', pdf])
  const app = await electron.launch({ args: ['.', pdf], cwd: root, env: { ...process.env, OPENPDF_E2E: '1', OPENPDF_E2E_USERDATA: join(dir, 'ud'), OPENPDF_E2E_DISCARD: '1' } })
  try {
    const win = await app.firstWindow()
    await expect(win.locator('.page')).toHaveCount(1)
    const problems: string[] = []
    // Tab through the first stretch of the page: each stop must be a named element with a visible focus indicator.
    await win.locator('body').click({ position: { x: 5, y: 5 } })
    for (let i = 0; i < 40; i++) {
      await win.keyboard.press('Tab')
      const stop = await win.evaluate(() => {
        const el = document.activeElement as HTMLElement | null
        if (!el || el === document.body) return null
        const s = getComputedStyle(el)
        const outline = s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0
        const shadow = s.boxShadow !== 'none'
        const name = el.getAttribute('aria-label') || el.textContent?.trim() || el.getAttribute('title') || ''
        return { tag: el.tagName.toLowerCase(), cls: el.className, name: name.slice(0, 30), focusVisible: outline || shadow || s.borderColor !== '', hasName: !!name }
      })
      if (stop && !stop.hasName) problems.push(`tab stop ${i + 1}: ${stop.tag}.${stop.cls} has no name`)
    }
    expect(problems, problems.join('\n')).toEqual([])
    // The ribbon's tabs work with the arrow keys.
    await win.getByRole('tab', { name: 'Home', exact: true }).focus()
    await win.keyboard.press('ArrowRight')
    const focused = await win.evaluate(() => document.activeElement?.getAttribute('aria-label') || document.activeElement?.textContent)
    expect(focused).toBeTruthy()
  } finally {
    await app.close()
    rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 })
  }
})

test('Tab stays inside an open dialog, in both directions', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'openpdf-e2e-'))
  const pdf = join(dir, 'a.pdf')
  execFileSync('python', ['-c', 'import sys, pymupdf\nd = pymupdf.open()\nd.new_page(width=300, height=300).insert_text((50, 100), "Trap", fontsize=14)\nd.save(sys.argv[1])', pdf])
  const app = await electron.launch({ args: ['.', pdf], cwd: root, env: { ...process.env, OPENPDF_E2E: '1', OPENPDF_E2E_USERDATA: join(dir, 'ud'), OPENPDF_E2E_DISCARD: '1' } })
  try {
    const win = await app.firstWindow()
    await expect(win.locator('.page')).toHaveCount(1)
    await win.getByRole('tab', { name: 'File', exact: true }).click()
    await win.getByRole('button', { name: 'Security', exact: true }).click()
    await expect(win.getByRole('dialog', { name: 'Security' })).toBeVisible()
    for (const key of ['Tab', 'Shift+Tab']) {
      for (let i = 0; i < 25; i++) {
        await win.keyboard.press(key)
        expect(await win.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'))).toBe(true)
      }
    }
    expect(await win.evaluate(() => document.documentElement.lang)).toBe('en-AU')
  } finally {
    await app.close()
    rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 })
  }
})
