import { defineConfig } from 'vitest/config'

// Standalone (not merged with vite.config.ts): these are pure-logic unit tests
// that need no DOM and no React plugin. A dedicated config keeps `vitest run`
// from pulling the app build's `@genealogy/schema generate` dev step or its
// jsx transform. Add a jsdom project here if a component render test is ever
// needed.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}']
  }
})
