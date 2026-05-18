import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright config for the eval CRUD UI.
 *
 * Tests live in `tests/e2e/`. The webServer block boots `npm run dev`
 * automatically when running locally; CI can set PLAYWRIGHT_WEB_SERVER=0
 * to skip if the server is already running.
 */
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:3100',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  webServer: process.env.PLAYWRIGHT_WEB_SERVER === '0'
    ? undefined
    : {
        command: 'npm run dev -- --port 3100',
        url: 'http://localhost:3100',
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
