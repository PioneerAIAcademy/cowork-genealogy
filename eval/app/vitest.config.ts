import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    pool: 'forks',
    // Raised from vitest's 5000ms default, matching every other workspace
    // config. This suite has its own CI job and its own parallel pool separate
    // from `make test-all`, but still runs vitest's own default clock over
    // forked processes competing for cores, the same contention shape.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname),
    },
  },
});
