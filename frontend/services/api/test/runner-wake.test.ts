import { sql } from 'kysely';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../src/config.ts';
import { createDatabase } from '../src/db/database.ts';
import { setLogSink } from '../src/logging.ts';
import { exclusiveDrain } from '../src/workers/runner.ts';
import { runnerStarter } from '../src/workers/start-runner.ts';
import { testConfig } from './support.ts';

describe('Cloud Run wake-up', () => {
  const job = 'projects/citeladder-test/locations/us-central1/jobs/runner';
  const db = createDatabase(testConfig());
  afterAll(() => db.destroy());
  const google = () =>
    vi.fn<typeof fetch>(async (url) =>
      Response.json(
        String(url).startsWith('http:')
          ? { access_token: 'recorded' }
          : { name: 'operations/test' },
      ),
    );
  it('coalesces a burst and permits another launch after the interval', async () => {
    const send = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ access_token: 'recorded-access-token' }))
      .mockResolvedValueOnce(Response.json({ name: 'operations/test' }))
      .mockResolvedValueOnce(Response.json({ access_token: 'recorded-access-token' }))
      .mockResolvedValueOnce(Response.json({ name: 'operations/test2' }));
    let clock = 0;
    const start = runnerStarter(
      testConfig({ CLOUD_RUN_RUNNER_JOB: job, CITELADDER_ORIGIN_TOKEN: 'a'.repeat(32) }),
      db,
      send,
      () => clock,
    );
    await Promise.all(Array.from({ length: 20 }, () => start()));
    expect(send).toHaveBeenCalledTimes(2);
    clock = 5000;
    await start();
    expect(send).toHaveBeenCalledTimes(4);
    expect(send.mock.calls[0]).toMatchObject([
      'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token',
      {
        headers: { 'Metadata-Flavor': 'Google' },
        redirect: 'error',
        signal: expect.any(AbortSignal),
      },
    ]);
    expect(send.mock.calls[1]).toMatchObject([
      `https://run.googleapis.com/v2/${job}:run`,
      {
        method: 'POST',
        headers: { Authorization: 'Bearer recorded-access-token' },
        body: '{}',
        redirect: 'error',
      },
    ]);
  });
  it('shares a start still in flight after the interval instead of launching a duplicate', async () => {
    let releaseToken: (response: Response) => void = () => {};
    const send = vi
      .fn<typeof fetch>()
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            releaseToken = resolve;
          }),
      )
      .mockResolvedValueOnce(Response.json({ name: 'operations/only' }));
    let clock = 0;
    const start = runnerStarter(
      testConfig({ CLOUD_RUN_RUNNER_JOB: job, CITELADDER_ORIGIN_TOKEN: 'a'.repeat(32) }),
      db,
      send,
      () => clock,
    );
    const first = start();
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    clock = 60_000;
    const second = start();
    releaseToken(Response.json({ access_token: 'recorded-access-token' }));
    await Promise.all([first, second]);
    expect(send.mock.calls.map(([url]) => String(url))).toEqual([
      'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token',
      `https://run.googleapis.com/v2/${job}:run`,
    ]);
  });
  it('is disabled without a job, and failure leaves the committed response usable without secret diagnostics', async () => {
    const send = vi.fn<typeof fetch>().mockRejectedValue(new Error('private bearer token'));
    await runnerStarter(loadConfig({ APP_ENV: 'test' }), db, send)();
    expect(send).not.toHaveBeenCalled();
    const records: Record<string, unknown>[] = [];
    const restore = setLogSink((line) => records.push(JSON.parse(line)));
    try {
      await expect(
        runnerStarter(
          testConfig({ CLOUD_RUN_RUNNER_JOB: job, CITELADDER_ORIGIN_TOKEN: 'a'.repeat(32) }),
          db,
          send,
        )(),
      ).resolves.toBe(false);
    } finally {
      setLogSink(restore);
    }
    expect(records).toEqual([
      expect.objectContaining({
        event: 'runner_start_failed',
        level: 'warning',
        error_class: 'Error',
        error_code: null,
        status: null,
        timed_out: false,
      }),
    ]);
    expect(JSON.stringify(records)).not.toContain('private bearer token');
  });

  it('logs why Google refused a runner start, without its response body', async () => {
    const send = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ access_token: 'recorded-access-token' }))
      .mockResolvedValueOnce(new Response('quota body detail', { status: 429 }));
    const records: Record<string, unknown>[] = [];
    const restore = setLogSink((line) => records.push(JSON.parse(line)));
    try {
      const start = runnerStarter(
        testConfig({ CLOUD_RUN_RUNNER_JOB: job, CITELADDER_ORIGIN_TOKEN: 'a'.repeat(32) }),
        db,
        send,
      );
      expect(await start('handover')).toBe(false);
    } finally {
      setLogSink(restore);
    }
    expect(records).toEqual([
      expect.objectContaining({
        event: 'runner_start_failed',
        error_class: 'RunnerStartError',
        error_code: 'runner_start_rejected',
        status: 429,
        elapsed_ms: expect.any(Number),
      }),
    ]);
    expect(JSON.stringify(records)).not.toContain('quota body detail');
  });

  it('skips Google requests while a runner holds the drain lock, except that runner’s own handover', async () => {
    const config = testConfig({
      CLOUD_RUN_RUNNER_JOB: job,
      CITELADDER_ORIGIN_TOKEN: 'a'.repeat(32),
    });
    const send = google();
    let clock = 0;
    const start = runnerStarter(config, db, send, () => clock);
    await exclusiveDrain(config, {
      signal: new AbortController().signal,
      deadline: Number.POSITIVE_INFINITY,
    })(async () => {
      expect(await start()).toBe(false);
      expect(send).not.toHaveBeenCalled();
      expect(await start('handover')).toBe(true);
      return 0;
    });
    const body = JSON.parse(String(send.mock.calls[1]![1]!.body));
    const env = Object.fromEntries(
      body.overrides.containerOverrides[0].env.map((v: { name: string; value: string }) => [
        v.name,
        v.value,
      ]),
    );
    expect(testConfig(env).execution.drainLockWaitMs).toBe(780_000);
    expect(testConfig().execution.drainLockWaitMs).toBe(15_000);
    clock = 5000;
    expect(await start()).toBe(true);
    expect(send).toHaveBeenCalledTimes(4);
  });

  it('continues a bounded launch when the drain probe fails', async () => {
    const unavailable = createDatabase(testConfig());
    await unavailable.destroy();
    const send = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ access_token: 'recorded-access-token' }))
      .mockResolvedValueOnce(Response.json({ name: 'operations/test' }));
    const restore = setLogSink(() => {});
    try {
      const start = runnerStarter(
        testConfig({ CLOUD_RUN_RUNNER_JOB: job, CITELADDER_ORIGIN_TOKEN: 'a'.repeat(32) }),
        unavailable,
        send,
        () => 0,
      );
      await start();
      await start();
      expect(send).toHaveBeenCalledTimes(2);
    } finally {
      setLogSink(restore);
    }
  });

  it('bounds a stalled PostgreSQL lock probe by the wake deadline', async () => {
    const delayed = db.withPlugin({
      transformQuery: () => sql`select pg_sleep(0.2), false as held`.toOperationNode(),
      transformResult: async ({ result }) => result,
    });
    const send = vi.fn<typeof fetch>();
    const restore = setLogSink(() => {});
    try {
      await runnerStarter(
        testConfig({
          CLOUD_RUN_RUNNER_JOB: job,
          CITELADDER_ORIGIN_TOKEN: 'a'.repeat(32),
          RUNNER_WAKE_TIMEOUT_MS: '20',
        }),
        delayed,
        send,
      )();
      expect(send).not.toHaveBeenCalled();
    } finally {
      setLogSink(restore);
    }
  });

  it('keeps a newer launch reservation when an older probe reports an active drain', async () => {
    let probes = 0;
    const delayed = db.withPlugin({
      transformQuery: () =>
        (++probes === 1
          ? sql`select pg_sleep(0.1), true as held`
          : sql`select false as held`
        ).toOperationNode(),
      transformResult: async ({ result }) => result,
    });
    let clock = 0;
    const send = google();
    const start = runnerStarter(
      testConfig({ CLOUD_RUN_RUNNER_JOB: job, CITELADDER_ORIGIN_TOKEN: 'a'.repeat(32) }),
      delayed,
      send,
      () => clock,
    );
    const older = start();
    clock = 5000;
    await start();
    await older;
    clock = 5001;
    await start();
    expect(send).toHaveBeenCalledTimes(2);
  });
});
