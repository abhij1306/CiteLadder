import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  POLICY_PATH,
  SPLIT_INSTRUCTIONS,
  isChecked,
} from '../../frontend/scripts/check-token-size.mjs';

const SCRIPT = fileURLToPath(
  new URL('../../frontend/scripts/check-token-size.mjs', import.meta.url),
);
const POLICY = JSON.parse(readFileSync(new URL(`../../${POLICY_PATH}`, import.meta.url), 'utf8'));

function repository() {
  const root = mkdtempSync(join(tmpdir(), 'citeladder-token-size-'));
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' });
  git('init', '-q');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'Test');
  git('config', 'core.autocrlf', 'false');
  const write = (file, content) => {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), content);
  };
  const policy = (baseline) => write(POLICY_PATH, JSON.stringify({ ...POLICY, baseline }));
  const check = (...args) => {
    const run = spawnSync(process.execPath, [SCRIPT, ...args], { cwd: root, encoding: 'utf8' });
    return { status: run.status, stderr: run.stderr };
  };
  return { root, git, write, policy, check };
}

test('the hook judges the staged blob at 6,000 tokens and prints the split instructions', () => {
  const repo = repository();
  try {
    repo.policy({});
    repo.git('add', '.');
    repo.git('commit', '-qm', 'policy');

    repo.write('frontend/a.ts', 'x'.repeat(24_000));
    repo.git('add', 'frontend/a.ts');
    repo.write('frontend/a.ts', 'x'.repeat(40_000));
    assert.deepEqual(repo.check('--staged'), { status: 0, stderr: '' });

    repo.write('frontend/a.ts', 'x'.repeat(24_001));
    repo.git('add', 'frontend/a.ts');
    repo.write('frontend/a.ts', 'small');
    const { status, stderr } = repo.check('--staged');
    assert.equal(status, 1);
    assert.match(stderr, /^ {2}frontend\/a\.ts: 6001 tokens \(limit 6000\)$/mu);
    for (const step of SPLIT_INSTRUCTIONS) assert.ok(stderr.includes(step), step);

    // CI judges the commits since the base, so a --no-verify commit still fails.
    const base = repo.git('rev-parse', 'HEAD').trim();
    repo.git('commit', '-qm', 'oversized', '--no-verify');
    assert.equal(repo.check('--base', base).status, 1);
    assert.match(repo.check('--base', base).stderr, /frontend\/a\.ts: 6001 tokens/u);
  } finally {
    rmSync(repo.root, { recursive: true, force: true });
  }
});

test('tests, codegen, config and registries are ignored; authored source is not', () => {
  const ignored = [
    'frontend/services/api/test/projects.test.ts',
    'frontend/components/agent/chat-screen.test.tsx',
    'frontend/e2e/action-loop.spec.ts',
    'frontend/services/api/test/site-health-fixtures.ts',
    'frontend/services/api/src/generated/db-schema.ts',
    'frontend/services/api/src/config/opportunity.ts',
    'frontend/lib/config/agent.ts',
    'frontend/apps/app/src/globals.css',
    'frontend/services/api/src/mcp/tools.ts',
    'frontend/services/api/src/mcp/write-tools.ts',
    'frontend/services/api/migrations/0002_x.sql',
    'README.md',
  ];
  const checked = [
    'frontend/services/api/src/mcp/retrieval.ts',
    'frontend/components/agent/chat-screen.tsx',
    'frontend/apps/app/src/app.css',
    'frontend/scripts/check-token-size.mjs',
    'scripts/oss-boundary.mjs',
  ];
  assert.deepEqual(
    [...ignored, ...checked].filter((file) => isChecked(POLICY, file)),
    checked,
  );
});

test('the baseline exempts its files and may only shrink', () => {
  const repo = repository();
  try {
    repo.policy({ 'frontend/big.ts': 7000 });
    repo.write('frontend/big.ts', 'x'.repeat(28_000));
    repo.git('add', '.');
    repo.git('commit', '-qm', 'baseline');

    repo.write('frontend/big.ts', 'x'.repeat(28_004));
    repo.git('add', 'frontend/big.ts');
    assert.deepEqual(repo.check('--staged'), { status: 0, stderr: '' });

    repo.policy({ 'frontend/big.ts': 7000, 'frontend/new.ts': 6500 });
    repo.write('frontend/new.ts', 'x'.repeat(26_000));
    repo.git('add', '.');
    assert.match(repo.check('--staged').stderr, /frontend\/new\.ts: new baseline entry/u);
    repo.git('reset', '-q', '--hard');

    repo.write('frontend/big.ts', 'x'.repeat(24_000));
    repo.git('add', 'frontend/big.ts');
    assert.match(
      repo.check('--staged').stderr,
      /frontend\/big\.ts: now 6000 tokens, within the 6000 limit; delete its baseline entry/u,
    );

    repo.git('rm', '-q', '--cached', 'frontend/big.ts');
    const removed = repo.check('--staged');
    assert.equal(removed.status, 1);
    assert.match(removed.stderr, /frontend\/big\.ts: no longer exists; delete its baseline entry/u);
  } finally {
    rmSync(repo.root, { recursive: true, force: true });
  }
});
