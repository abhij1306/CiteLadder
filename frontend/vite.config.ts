import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import { defineConfig } from 'vite-plus';

import { fmtConfig, lintConfig } from './vp-shared-config.ts';

// Vitest defaults to one worker per core, so an unqualified `vitest run` opens
// ~11 processes here and two overlapping runs saturate the machine. Every
// invocation path -- the gate, `pnpm test`, CI -- goes through this file, so the
// cap belongs here rather than in a flag each caller has to remember.
const maxWorkers = Number(process.env.VITEST_MAX_WORKERS ?? 2);

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': resolve(import.meta.dirname, '.'),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./test/setup.ts'],
    include: ['**/*.{test,spec}.{ts,tsx}'],
    maxWorkers,
    // Server-side services run their own Node-environment suites.
    exclude: ['**/node_modules/**', 'e2e', 'services/**'],
    css: false,
  },
  lint: lintConfig,
  fmt: fmtConfig,
});
