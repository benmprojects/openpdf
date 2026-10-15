import { defineConfig } from '@playwright/test'

/**
 * Electron end-to-end tests. They run the built app, so run `npm run build` first (`npm run e2e` does not build).
 */
export default defineConfig({
  testDir: 'e2e',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  workers: 1,
  fullyParallel: false,
  reporter: [['list']]
})
