import { afterAll, expect, it, vi } from 'vitest';
import * as safeFetch from '../src/projects/safe-fetch.ts';
import { policy } from '../src/config.ts';
import { exclusiveDrain } from '../src/workers/runner.ts';
import { createApp } from '../src/app.ts';
import { SiteFixtures, type SiteSeed } from './site-health-fixtures.ts';
import { TEST_SESSION_COOKIE, sessionToken, testConfig, testDatabase } from './support.ts';

const config = testConfig();
const db = testDatabase(config);
const app = createApp(config, db);
const fixtures = new SiteFixtures(db);
afterAll(async () => {
  await fixtures.cleanup();
  await db.destroy();
});

async function run(seed: SiteSeed, crawlId = seed.crawlId) {
  return app.request(`/api/v1/site-crawls/${crawlId}/run`, {
    method: 'POST',
    headers: {
      cookie: `${TEST_SESSION_COOKIE}=${await sessionToken({ sub: seed.userId, ver: 0 })}`,
      'x-workspace-id': seed.workspaceId,
    },
  });
}

it('executes only the authorized crawl and leases concurrent interactive requests once', async () => {
  const seed = await fixtures.crawl();
  const other = await fixtures.crawl();
  const sibling = { ...seed, crawlId: await fixtures.sibling(seed) };
  const taskId = await fixtures.task(seed);
  const unrelated: string[] = [await fixtures.task(other), await fixtures.task(sibling)];
  expect((await run(other, seed.crawlId)).status).toBe(404);
  const responses = await Promise.all([run(seed), run(seed)]);
  expect(responses.map((response) => response.status)).toEqual([200, 200]);
  const tasks = await db
    .selectFrom('site_crawl_tasks')
    .selectAll()
    .where('id', 'in', [taskId, ...unrelated])
    .execute();
  expect(tasks.find((task) => task.id === taskId)).toMatchObject({
    status: 'succeeded',
    attempt_count: 1,
  });
  expect(tasks.filter((task) => unrelated.includes(task.id)).map((task) => task.status)).toEqual([
    'queued',
    'queued',
  ]);
});

it('bounds even the initial robots request and leaves interrupted work recoverable', async () => {
  const seed = await fixtures.crawl('queued');
  const taskId = await fixtures.task(seed, 'discover');
  const timeout = policy.site_health.interactive.timeout_seconds;
  policy.site_health.interactive.timeout_seconds = 1;
  let interrupted = false;
  const transport = vi
    .spyOn(safeFetch, 'fetchWebsite')
    .mockImplementation(async (_url, options) => {
      const signal = options?.signal;
      if (!signal) throw new Error('Missing acquisition deadline');
      signal.throwIfAborted();
      return new Promise((_resolve, reject) => {
        signal.addEventListener(
          'abort',
          () => {
            interrupted = true;
            reject(signal.reason);
          },
          { once: true },
        );
      });
    });
  try {
    expect((await run(seed)).status).toBe(200);
    expect(interrupted).toBe(true);
    expect(
      await db
        .selectFrom('site_crawl_tasks')
        .selectAll()
        .where('id', '=', taskId)
        .executeTakeFirst(),
    ).toMatchObject({ status: 'retry_wait', lease_owner: null });
  } finally {
    policy.site_health.interactive.timeout_seconds = timeout;
    transport.mockRestore();
  }
});

it('leaves work to an active background drain instead of bypassing crawler pacing', async () => {
  const seed = await fixtures.crawl();
  const taskId = await fixtures.task(seed);
  await exclusiveDrain(
    config,
    {
      signal: AbortSignal.timeout(30_000),
      deadline: performance.now() + 30_000,
    },
    0,
  )(async () => {
    expect((await run(seed)).status).toBe(200);
    expect(
      await db
        .selectFrom('site_crawl_tasks')
        .select(['status', 'attempt_count'])
        .where('id', '=', taskId)
        .executeTakeFirstOrThrow(),
    ).toEqual({ status: 'queued', attempt_count: 0 });
    return 0;
  });
  expect((await run(seed)).status).toBe(200);
  expect(
    await db
      .selectFrom('site_crawl_tasks')
      .select(['status', 'attempt_count'])
      .where('id', '=', taskId)
      .executeTakeFirstOrThrow(),
  ).toEqual({ status: 'succeeded', attempt_count: 1 });
});
