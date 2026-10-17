/**
 * Runs API tests, or regenerates the Kysely types with `--types`, against the
 * local development database. The URL comes from the shared .env reader
 * (POSTGRES_* or DATABASE_URL) and the credentials the test guard refuses are
 * dropped; nothing secret is printed. Output goes to one reusable log in the
 * Git directory, or the system temp directory outside a checkout.
 *
 *   pnpm --filter @citeladder/api test:local test/projects.test.ts
 *   pnpm --filter @citeladder/api test:local --types
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { closeSync, openSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { localEnvironment } from '../src/cli/local-environment.ts';
import { isInheritedCredential } from '../test/inherited-credentials.ts';

const apiRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const args = process.argv.slice(2).filter((arg) => arg !== '--');
const types = args.includes('--types');
const files = args.filter((arg) => arg !== '--types');

// Always the local POSTGRES_* database: an inherited DATABASE_URL could name a
// shared or remote one, and the suite writes and deletes rows.
const url = localEnvironment({ ...process.env, DATABASE_URL: undefined }).DATABASE_URL;
if (!url) throw new Error('Set POSTGRES_* in .env (see .env.example).');
const env = Object.fromEntries(
  Object.entries(process.env).filter(([name]) => !isInheritedCredential(name)),
);
env[types ? 'TYPES_DATABASE_URL' : 'API_TEST_DATABASE_URL'] = url;

// Developer tooling runs git and pnpm from the caller's PATH.
function logDirectory(): string {
  try {
    const gitArgs = ['-C', apiRoot, 'rev-parse', '--absolute-git-dir'];
    return execFileSync('git', gitArgs, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim(); // NOSONAR: trusted PATH.
  } catch {
    return tmpdir();
  }
}
const log = join(logDirectory(), 'api-test.log');
const command = types ? ['db:types'] : ['exec', 'vitest', 'run', ...files];
const output = openSync(log, 'w');
let status: number | null;
try {
  const [program, programArgs] =
    process.platform === 'win32'
      ? [process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', 'pnpm', ...command]]
      : ['pnpm', command];
  status = spawnSync(program, programArgs, {
    cwd: apiRoot,
    env,
    stdio: ['ignore', output, output],
    windowsHide: true,
  }).status; // NOSONAR: trusted PATH.
} finally {
  closeSync(output);
}
process.stdout.write(`${readFileSync(log, 'utf8').split(/\r?\n/u).slice(-40).join('\n')}\n`);
process.stdout.write(`exit ${status} (full log: ${log})\n`);
process.exit(status ?? 1);
