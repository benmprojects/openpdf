import { _electron as electron, expect, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(__dirname, '..')

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'openpdf-e2e-'))
  const pdf = join(dir, 'a.pdf')
  execFileSync('python', ['-c', 'import sys, pymupdf\nd = pymupdf.open()\nd.new_page(width=300, height=300).insert_text((50, 100), "Langue", fontsize=14)\nd.save(sys.argv[1])', pdf])
  return { dir, pdf }
}

const launch = (dir: string, pdf: string) => electron.launch({ args: ['.', pdf], cwd: root, env: { ...process.env, OPENPDF_E2E: '1', OPENPDF_E2E_USERDATA: join(dir, 'ud'), OPENPDF_E2E_DISCARD: '1' } })

test('the language can be changed in Settings, covers the ribbon and dialog titles, and is remembered', async () => {
  const { dir, pdf } = setup()
  try {
    const first = await launch(dir, pdf)
    try {
      const win = await first.firstWindow()
      await expect(win.locator('.page')).toHaveCount(1)
      await expect(win.getByRole('tab', { name: 'File', exact: true })).toBeVisible()
      await win.getByRole('button', { name: 'Settings' }).click()
      await win.getByRole('combobox', { name: 'Language' }).selectOption('fr')
      await win.keyboard.press('Escape')
      await expect(win.getByRole('tab', { name: 'Fichier', exact: true })).toBeVisible()
      await expect(win.getByRole('tab', { name: 'Accueil', exact: true })).toBeVisible()
      expect(await win.evaluate(() => document.documentElement.lang)).toBe('fr')
      // Buttons and dialog titles too; text that has no translation stays English.
      await win.getByRole('tab', { name: 'Fichier', exact: true }).click()
      await expect(win.getByRole('button', { name: 'Ouvrir', exact: true })).toBeVisible()
      await win.getByRole('button', { name: 'Lot', exact: true }).click()
      await expect(win.getByRole('dialog', { name: 'Traitement par lots' })).toBeVisible()
    } finally {
      await first.close()
    }
    expect(JSON.parse(readFileSync(join(dir, 'ud', 'settings.json'), 'utf8')).language).toBe('fr')

    // Next start: still French.
    const second = await launch(dir, pdf)
    try {
      const win = await second.firstWindow()
      await expect(win.getByRole('tab', { name: 'Fichier', exact: true })).toBeVisible()
      await win.getByRole('button', { name: 'Paramètres' }).click()
      await win.getByRole('combobox', { name: 'Langue' }).selectOption('system')
      await win.keyboard.press('Escape')
      await expect(win.getByRole('tab', { name: 'File', exact: true })).toBeVisible()
    } finally {
      await second.close()
    }
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 })
  }
})

test('a translation dropped in the data folder is offered without rebuilding the program', async () => {
  const { dir, pdf } = setup()
  mkdirSync(join(dir, 'ud', 'locales'), { recursive: true })
  writeFileSync(join(dir, 'ud', 'locales', 'de.json'), JSON.stringify({ name: 'Deutsch (Test)', messages: { File: 'Datei', Home: 'Start', Open: 'Öffnen' } }))
  try {
    const app = await launch(dir, pdf)
    try {
      const win = await app.firstWindow()
      await expect(win.locator('.page')).toHaveCount(1)
      await win.getByRole('button', { name: 'Settings' }).click()
      const select = win.getByRole('combobox', { name: 'Language' })
      await expect(select.locator('option', { hasText: 'Deutsch (Test)' })).toHaveCount(1)
      await select.selectOption('de')
      await win.keyboard.press('Escape')
      await expect(win.getByRole('tab', { name: 'Datei', exact: true })).toBeVisible()
      await expect(win.getByRole('tab', { name: 'Start', exact: true })).toBeVisible()
      // Not translated: the rest of the ribbon stays English.
      await expect(win.getByRole('tab', { name: 'Forms', exact: true })).toBeVisible()
    } finally {
      await app.close()
    }
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 })
  }
})
