import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

export default defineConfig({
  resolve: {
    alias: {
      '@renderer': resolve(__dirname, 'src/renderer/src')
    }
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./test/setup.ts'],
    // Raised from vitest's 5000ms default: `make test-all` runs every workspace
    // suite through turbo in parallel, and the feedback-zip archive-budget test
    // is genuinely CPU-bound (~2.4s standalone, DEFLATE-compressing 45 MB) and
    // lands at 5-8s under that contention. hookTimeout matters here too — the
    // feedback suite's beforeEach does disk I/O and can overrun its own budget
    // separately from the test's.
    testTimeout: 30_000,
    hookTimeout: 30_000
  }
})
