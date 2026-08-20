import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    css: true,
    // Raised from vitest's 5000ms default: `make test-all` runs every workspace
    // suite through turbo in parallel, and cases here measured at 78-235ms
    // standalone (hardware moves this) still land at 5.3-6.2s under that
    // contention, tipping over the default at random rather than for any
    // reason related to the diff.
    testTimeout: 30_000,
    hookTimeout: 30_000
  }
})
