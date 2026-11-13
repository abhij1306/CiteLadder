import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    setupFiles: ['test/environment.ts', 'test/queue-isolation.ts'],
    // Database tests share one PostgreSQL; files run one at a time.
    fileParallelism: false,
    // Measured and published, never a gate (docs/DEVELOPMENT.md#coverage).
    // CI passes `--coverage`; a local run stays uninstrumented. Istanbul
    // instruments only `include`; V8's block coverage slows every module,
    // which made PDF layout (fontkit) about 4x slower than an uninstrumented run.
    coverage: {
      provider: 'istanbul',
      include: ['src/**/*.ts'],
      exclude: ['src/generated/**'],
      reporter: ['text-summary', 'json-summary', 'lcov'],
    },
  },
});
