/**
 * Translation helper.
 *   node scripts/i18n.mjs            writes src/renderer/src/locales/_template.json: every translatable string, to copy and fill in
 *   node scripts/i18n.mjs --check    checks each catalogue against the source: strings that no longer exist, and {placeholders}
 *                                    that differ from the English
 * A string is translatable when it is written as t('...') or msg('...') in the renderer source.
 */
import { readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const src = join(root, 'src', 'renderer', 'src')
const locales = join(src, 'locales')

function* files(dir) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f)
    if (statSync(p).isDirectory()) {
      if (f !== 'locales') yield* files(p)
    } else if (/\.(ts|tsx)$/.test(f) && !/\.test\.tsx?$/.test(f) && f !== 'i18n.ts') yield p
  }
}

const unescape = (s) => s.replace(/\\(['\\])/g, '$1')

/** Every translatable string in the source. */
export function extractKeys() {
  const keys = new Set()
  const re = /\b(?:t|msg)\(\s*'((?:[^'\\]|\\.)*)'/g
  for (const file of files(src)) {
    const text = readFileSync(file, 'utf8')
    for (const m of text.matchAll(re)) keys.add(unescape(m[1]))
  }
  return [...keys].sort((a, b) => a.localeCompare(b))
}

const placeholders = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',')

/** Problems in the catalogues: stale keys and mismatched placeholders. */
export function checkCatalogues() {
  const keys = new Set(extractKeys())
  const problems = []
  for (const f of readdirSync(locales)) {
    if (!f.endsWith('.json') || f.startsWith('_')) continue
    const cat = JSON.parse(readFileSync(join(locales, f), 'utf8'))
    if (typeof cat.name !== 'string' || typeof cat.messages !== 'object') {
      problems.push(`${f}: not a catalogue (needs "name" and "messages")`)
      continue
    }
    for (const [k, v] of Object.entries(cat.messages)) {
      if (!keys.has(k)) problems.push(`${f}: "${k}" is not in the source any more`)
      else if (typeof v !== 'string' || !v.trim()) problems.push(`${f}: "${k}" has no translation`)
      else if (placeholders(k) !== placeholders(v)) problems.push(`${f}: "${k}" has different {placeholders} in its translation`)
    }
  }
  return problems
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes('--check')) {
    const problems = checkCatalogues()
    if (problems.length) {
      console.error(problems.join('\n'))
      process.exit(1)
    }
    console.log('Catalogues are consistent with the source.')
  } else {
    const keys = extractKeys()
    writeFileSync(join(locales, '_template.json'), JSON.stringify({ name: '', messages: Object.fromEntries(keys.map((k) => [k, ''])) }, null, 2) + '\n')
    console.log(`Wrote src/renderer/src/locales/_template.json (${keys.length} strings)`)
  }
}
