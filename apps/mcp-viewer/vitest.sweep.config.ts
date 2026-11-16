import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// `make mcp-viewer-sweep`: the page over every committed e2e end state. Never in CI.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    include: ['sweep/**/*.sweep.tsx'],
    execArgv: ['--no-experimental-webstorage'],
    testTimeout: 600_000,
    silent: false
  }
})
