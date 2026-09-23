import { defineConfig, devices } from '@playwright/test';
import { createFixtureSync } from './tests/e2e/create-fixture';

/**
 * Playwright config for the eval CRUD UI.
 *
 * Tests live in `tests/e2e/`. The webServer block boots `npm run dev`
 * automatically when running locally; CI can set PLAYWRIGHT_WEB_SERVER=0
 * to skip if the server is already running.
 *
 * A temp fixture tree is created at config load time (before the web
 * server starts) so the server reads from isolated test data, not from
 * the repository's real eval/ directory.
 */
if (!process.env.EVAL_DIR) {
  process.env.EVAL_DIR = createFixtureSync();
}

export default defineConfig({
  testDir: './tests/e2e',
  globalTeardown: './tests/e2e/global-teardown.ts',
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:3100',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  webServer: process.env.PLAYWRIGHT_WEB_SERVER === '0'
    ? undefined
    : {
        command: 'npm run dev -- --port 3100',
        url: 'http://127.0.0.1:3100',
        timeout: 120_000,
        reuseExistingServer: !process.env.CI,
      },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
