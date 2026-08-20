import { defineConfig } from 'vitest/config'

// Standalone (not merged with vite.config.ts): these are pure-logic unit tests
// that need no DOM and no React plugin. A dedicated config keeps `vitest run`
// from pulling the app build's `@genealogy/schema generate` dev step or its
// jsx transform. Add a jsdom project here if a component render test is ever
// needed.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}'],
    // Raised from vitest's 5000ms default, matching every other workspace
    // config: `make test-all` runs every suite through turbo in parallel, and
    // this package competes for the same cores as the ones already observed
    // flaking under that contention, even though nothing here has flaked yet.
    testTimeout: 30_000,
    hookTimeout: 30_000
  }
})
