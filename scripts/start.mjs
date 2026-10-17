#!/usr/bin/env node
/**
 * Runs a self-hosted CiteLadder without Docker: applies migrations, ensures
 * the local workspace, then serves the API + built app and drains background
 * work in a loop. Needs DATABASE_URL (PostgreSQL 16) and a prior `pnpm build`.
 *
 * Instance secrets are generated once into .data/secrets.env; values already
 * in the environment (or in .env) win.
 */
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const api = join(root, 'frontend/services/api');
const staticDir = join(root, 'frontend/apps/app/dist');

function readEnvFile(path) {
  if (!existsSync(path)) return {};
  const values = {};
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/u)) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/u.exec(line);
    if (match) values[match[1]] = match[2].replace(/^(['"])(.*)\1$/u, '$2');
  }
  return values;
}

const dataDir = join(root, '.data');
const secretsFile = join(dataDir, 'secrets.env');
if (!existsSync(secretsFile)) {
  mkdirSync(dataDir, { recursive: true });
  const names = ['ENCRYPTION_KEY', 'API_KEY_PEPPER', 'REFERRAL_HASH_SALT'];
  const body = names.map((name) => `${name}=${randomBytes(48).toString('base64url')}`).join('\n');
  writeFileSync(secretsFile, `${body}\n`, { mode: 0o600 });
}

const env = {
  APP_ENV: 'production',
  NODE_ENV: 'production',
  PORT: '8100',
  ...readEnvFile(secretsFile),
  ...readEnvFile(join(root, '.env')),
  ...process.env,
  STATIC_DIR: staticDir,
};
const origin = env.PUBLIC_APP_ORIGIN || `http://localhost:${env.PORT}`;
env.PUBLIC_API_URL ||= origin;
env.FRONTEND_URL ||= origin;

if (!env.DATABASE_URL) {
  console.error('DATABASE_URL is not set. Point it at a PostgreSQL 16 database, e.g.');
  console.error('  DATABASE_URL=postgresql://user:password@localhost:5432/citeladder pnpm start');
  process.exit(1);
}
if (!existsSync(join(staticDir, 'index.html'))) {
  console.error('The app is not built yet. Run `pnpm build` first.');
  process.exit(1);
}

function runOnce(script) {
  const result = spawnSync(process.execPath, [script], { cwd: api, env, stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
runOnce('src/cli/migrate.ts');
runOnce('src/cli/bootstrap-account.ts');

const server = spawn(process.execPath, ['src/server.ts'], { cwd: api, env, stdio: 'inherit' });
let stopping = false;
server.on('exit', (code) => {
  if (!stopping) process.exit(code ?? 1);
});

// Background work: one tick drains queued crawls, audits and syncs, then the
// loop waits and ticks again.
const interval = Number(env.RUNNER_INTERVAL_SECONDS ?? 10) * 1000;
let timer;
function tick() {
  const child = spawn(process.execPath, ['src/tick.ts'], { cwd: api, env, stdio: 'inherit' });
  child.on('exit', () => {
    if (!stopping) timer = setTimeout(tick, interval);
  });
}
tick();

for (const signal of ['SIGINT', 'SIGTERM'])
  process.once(signal, () => {
    stopping = true;
    clearTimeout(timer);
    server.kill(signal);
  });
console.log(`CiteLadder is starting on ${origin}`);
