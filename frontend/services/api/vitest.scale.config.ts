import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/scale/**/*.scale.ts'],
    setupFiles: ['test/environment.ts', 'test/queue-isolation.ts'],
    fileParallelism: false,
    testTimeout: 30 * 60 * 1000,
    hookTimeout: 5 * 60 * 1000,
  },
});
