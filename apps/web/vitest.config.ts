import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// Two projects split by extension. The `.ts` suites (chatEvents + the three
// transport suites) are pure logic and run under `node`, exactly as before —
// flipping them to jsdom is deliberately avoided (issue #1458). The `.tsx`
// suites are component render tests that need a DOM and the React plugin's jsx
// transform, so they run under `jsdom`. The globs are exact (`.ts` vs `.tsx`)
// and do not overlap, so no file runs twice or under the wrong environment.
// `testTimeout`/`hookTimeout` are not inherited into inline projects, so both
// carry them: raised from vitest's 5000ms default to match every other
// workspace config under `make test-all`'s parallel turbo contention.
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'node',
          environment: 'node',
          include: ['src/**/*.test.ts'],
          testTimeout: 30_000,
          hookTimeout: 30_000
        }
      },
      {
        plugins: [react()],
        test: {
          name: 'jsdom',
          environment: 'jsdom',
          include: ['src/**/*.test.tsx'],
          testTimeout: 30_000,
          hookTimeout: 30_000
        }
      }
    ]
  }
})
