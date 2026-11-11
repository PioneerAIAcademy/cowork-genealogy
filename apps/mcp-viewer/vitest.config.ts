import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// `.ts` suites are pure logic under node; `.tsx` suites need a DOM.
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
          // Node 25 and later ship a built-in localStorage global that hides jsdom's.
          execArgv: ['--no-experimental-webstorage'],
          testTimeout: 30_000,
          hookTimeout: 30_000
        }
      }
    ]
  }
})
