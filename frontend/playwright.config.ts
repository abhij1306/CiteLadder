import { defineConfig } from '@playwright/test';

const e2ePort = 3100;

export default defineConfig({
  testDir: './e2e',
  // Every test owns its browser context and stubs its own reads, so tests
  // spread across workers.
  fullyParallel: true,
  workers: process.env.CI ? 4 : undefined,
  retries: 1,
  // `list` records every test's duration, so the log shows where time goes.
  reporter: [['list'], ['html', { outputFolder: 'playwright-report', open: 'never' }]],
  outputDir: 'test-results',
  use: {
    baseURL: `http://127.0.0.1:${e2ePort}`,
    trace: 'on-first-retry',
  },
  webServer: {
    // The built SPA, as it ships: a dev server transforms hundreds of modules
    // on every full page load, which made each navigation cost seconds. Every
    // spec stubs the API it needs, so no backend runs behind the preview.
    command: `pnpm build && pnpm exec vp preview -c apps/app/vite.config.ts --port ${e2ePort}`,
    url: `http://127.0.0.1:${e2ePort}`,
    reuseExistingServer: !process.env.CI,
  },
});
