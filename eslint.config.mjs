import { createRequire } from 'node:module'
import Module from 'node:module'
import js from '@eslint/js'
import reactHooks from 'eslint-plugin-react-hooks'
import globals from 'globals'

// typescript-eslint does not yet support TypeScript 7 (the project compiler). Point its `require('typescript')`
// at the side-by-side TypeScript 6 package. Remove this shim once typescript-eslint supports TS >= 7.1.
const require = createRequire(import.meta.url)
const ts6 = require.resolve('@typescript/typescript6')
const resolve = Module._resolveFilename
Module._resolveFilename = function (request, ...rest) {
  return resolve.call(this, request === 'typescript' ? ts6 : request, ...rest)
}
const { default: tseslint } = await import('typescript-eslint')

export default tseslint.config(
  { ignores: ['out/**', 'node_modules/**', 'dist/**', 'playwright-report/**', 'test-results/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/renderer/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // Relaxed to warnings so lint passes on existing code (hits when added: refs 13, set-state-in-effect 3, preserve-manual-memoization 2).
      'react-hooks/refs': 'warn',
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/preserve-manual-memoization': 'warn'
    },
    languageOptions: { globals: globals.browser }
  },
  {
    files: ['src/main/**/*.ts', 'src/preload/**/*.ts', 'scripts/**', 'e2e/**', '*.config.*'],
    languageOptions: { globals: globals.node }
  },
  // 1 hit when added (scripts/cdp.mjs).
  { files: ['scripts/**'], rules: { 'no-empty': 'warn' } },
  { linterOptions: { reportUnusedDisableDirectives: 'off' } }
)
