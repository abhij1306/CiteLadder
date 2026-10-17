import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    setupFiles: ['test/environment.ts', 'test/queue-isolation.ts'],
    // Database tests share one PostgreSQL; files run one at a time.
    fileParallelism: false,
  },
});
