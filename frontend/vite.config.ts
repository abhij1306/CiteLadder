import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import { defineConfig } from 'vite-plus';

import { fmtConfig, lintConfig } from './vp-shared-config.ts';

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
    exclude: ['**/node_modules/**', 'e2e', 'services/**'],
    css: false,
  },
  lint: lintConfig,
  fmt: fmtConfig,
});
