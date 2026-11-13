import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtemp, writeFile, mkdir, copyFile, rm } from 'node:fs/promises';
import { expect, it, vi } from 'vitest';
import { operatorMain } from '../src/cli/operator.ts';

const execute = promisify(execFile);
const root = fileURLToPath(new URL('../../../../', import.meta.url));
const systemEnv = Object.fromEntries(
  Object.entries(process.env).filter(([key]) =>
    /^(PATH|SYSTEMROOT|WINDIR|TEMP|TMP|COMSPEC|PATHEXT|USERPROFILE|LOCALAPPDATA|APPDATA|PROCESSOR_ARCHITECTURE|OS)$/iu.test(
      key,
    ),
  ),
);
it('reports actionable reviewed failures while withholding arbitrary error messages', async () => {
  const stderr = vi.spyOn(console, 'error').mockImplementation(() => {});
  const originalExitCode = process.exitCode;
  try {
    await operatorMain(async () => {
      throw new Error('local_development_required');
    });
    expect(stderr).toHaveBeenLastCalledWith('local_development_required');
    await operatorMain(async () => {
      throw new Error('fixture-sensitive-value');
    });
    expect(stderr).toHaveBeenLastCalledWith('Error');
    // A database failure names its SQLSTATE, never the server's message.
    await operatorMain(async () => {
      throw Object.assign(new Error('password authentication failed for user "fixture"'), {
        code: '28P01',
      });
    });
    expect(stderr).toHaveBeenLastCalledWith('Error 28P01');
    expect(process.exitCode).toBe(1);
  } finally {
    process.exitCode = originalExitCode;
    stderr.mockRestore();
  }
});

it('native local configuration preserves dotenv precedence and disable admission', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'provision-config-'));
  const cli = join(directory, 'frontend/services/api/src/cli');
  await mkdir(cli, { recursive: true });
  await copyFile(
    join(root, 'frontend/services/api/src/cli/local-environment.ts'),
    join(cli, 'local-environment.ts'),
  );
  await writeFile(join(directory, '.env'), 'DATABASE_URL=postgresql://root-fixture/one\n');
  await writeFile(
    join(cli, 'probe.ts'),
    "import { localEnvironment } from './local-environment.ts'; console.log(localEnvironment().DATABASE_URL ?? 'missing');",
  );
  const probe = async (env: Record<string, string> = {}) =>
    (
      await execute(process.execPath, [join(cli, 'probe.ts')], { env: { ...systemEnv, ...env } })
    ).stdout.trim();
  try {
    expect(await probe()).toBe('postgresql://root-fixture/one');
    expect(await probe({ DATABASE_URL: 'postgresql://process-fixture/three' })).toBe(
      'postgresql://process-fixture/three',
    );
    expect(await probe({ CITELADDER_DISABLE_DOTENV: '1' })).toBe('missing');
    expect(
      await probe({
        CITELADDER_DISABLE_DOTENV: '1',
        DATABASE_URL: 'postgresql://isolated-fixture/four',
      }),
    ).toBe('postgresql://isolated-fixture/four');
  } finally {
    await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}, 90000);
