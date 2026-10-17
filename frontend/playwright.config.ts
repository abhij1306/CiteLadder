import { defineConfig } from '@playwright/test';

const e2ePort = 3100;

export default defineConfig({
  testDir: './e2e',
  workers: 1,
  retries: 1,
  reporter: [['html', { outputFolder: 'playwright-report', open: 'never' }]],
  outputDir: 'test-results',
  use: {
    baseURL: `http://127.0.0.1:${e2ePort}`,
    trace: 'on-first-retry',
  },
  webServer: {
    // `vp dev` is the Vite+ dev command; the standalone `vite` binary no
    // longer exists once the toolchain is bundled by vite-plus. Every spec
    // stubs the API it needs, so no backend runs behind the dev server.
    command: `pnpm exec vp dev -c apps/app/vite.config.ts --port ${e2ePort}`,
    url: `http://127.0.0.1:${e2ePort}`,
    reuseExistingServer: !process.env.CI,
  },
});
