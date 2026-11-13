/**
 * `pnpm migrate`: the migrate CLI with `DATABASE_URL` from the shared .env
 * reader (POSTGRES_* or DATABASE_URL), so the local development database
 * migrates without exporting it first. An explicit `DATABASE_URL`, as CI sets,
 * wins. The Docker image runs `src/cli/migrate.ts` directly.
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { localEnvironment } from '../src/cli/local-environment.ts';

const cli = fileURLToPath(new URL('../src/cli/migrate.ts', import.meta.url));
const { status } = spawnSync(process.execPath, [cli, ...process.argv.slice(2)], {
  env: localEnvironment(),
  stdio: 'inherit',
});
process.exit(status ?? 1);
