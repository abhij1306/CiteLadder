import { setTimeout as sleep } from 'node:timers/promises';
import { afterAll, expect, it } from 'vitest';

import { policy } from '../src/config.ts';
import { SitePageFetcher, siteFetchSettings } from '../src/site-health/page-fetch.ts';
import { siteWorkerSettings } from '../src/site-health/runtime.ts';
import { SiteHealthWorker } from '../src/workers/site-health-worker.ts';
import { recordedSite, SiteFixtures, type SiteSeed } from './site-health-fixtures.ts';
import { testDatabase } from './support.ts';

const db = testDatabase();
const fixtures = new SiteFixtures(db);
afterAll(async () => {
  await fixtures.cleanup();
  await db.destroy();
});

const codes = policy.site_health.page_analysis.acquisition.error_codes;
const settings = {
  ...siteWorkerSettings({}),
  concurrency: 1,
  retryBase: 30,
  retryMax: 300,
  retryJitter: 0,
};
const fetcher = new SitePageFetcher(
  db,
  recordedSite({ '/flaky': { status: 503 } }),
  siteFetchSettings({
    SITE_HEALTH_PER_HOST_DELAY_SECONDS: '0',
    SITE_HEALTH_DEFAULT_CRAWL_DELAY_SECONDS: '0',
  }),
);
const row = (id: string) =>
  db.selectFrom('site_crawl_tasks').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
/** Lease task `id` to `owner` after `attempts` spent attempts, as a claim would. */
function lease(id: string, owner: string, attempts: number) {
  return db
    .updateTable('site_crawl_tasks')
    .set({
      status: 'leased',
      lease_owner: owner,
      lease_expires_at: new Date(Date.now() + 60_000),
      attempt_count: attempts,
      max_attempts: 10,
    })
    .where('id', '=', id)
    .returningAll()
    .executeTakeFirstOrThrow();
}
async function runningCrawl(): Promise<SiteSeed> {
  const seed = await fixtures.crawl('running');
  await db
    .updateTable('site_crawls')
    .set({ completed_at: null, analysis_status: 'running' })
    .where('id', '=', seed.crawlId)
    .execute();
  return seed;
}
/** Whole seconds from `before` until the settled task becomes claimable again. */
const delay = (task: { available_at: Date }, before: number) =>
  Math.round((task.available_at.getTime() - before) / 1000);

it.each([
  [0, 30],
  [1, 60],
  [4, 300],
])(
  'backs off a thrown error and a returned failure alike after %i spent attempts',
  async (spent, seconds) => {
    const seed = await runningCrawl();
    const returned = (await fixtures.analyzable(seed, '/flaky')).taskId;
    const thrown = await fixtures.task(seed, 'link_metrics');
    const worker = new SiteHealthWorker(db, {
      owner: 'runner-test',
      settings,
      fetcher,
      executors: {
        link_metrics: async () => {
          throw new Error('metrics failed');
        },
      },
    });
    const before = Date.now();
    await worker.execute(await lease(returned, worker.owner, spent));
    await worker.execute(await lease(thrown, worker.owner, spent));

    const [failed, crashed] = [await row(returned), await row(thrown)];
    expect(
      [failed, crashed].map((task) => [task.status, task.attempt_count, delay(task, before)]),
    ).toEqual([
      ['retry_wait', spent + 1, seconds],
      ['retry_wait', spent + 1, seconds],
    ]);
    expect([failed.error_code, crashed.error_code, crashed.error_detail]).toEqual([
      codes.http_5xx,
      'task_failed',
      'metrics failed',
    ]);
  },
);

it('fences a task whose lease was reclaimed while it ran: the old owner settles nothing', async () => {
  const seed = await runningCrawl();
  const id = await fixtures.task(seed, 'link_metrics');
  const worker = new SiteHealthWorker(db, {
    owner: 'stale-owner',
    settings,
    executors: {
      link_metrics: async (trx, crawl) => {
        // Recovery reclaimed the lease and another worker claimed the next attempt.
        await db
          .updateTable('site_crawl_tasks')
          .set({ lease_owner: 'next-owner', attempt_count: 1 })
          .where('id', '=', id)
          .execute();
        await trx
          .updateTable('site_crawls')
          .set({ analyzed_url_count: 99 })
          .where('id', '=', crawl.id)
          .execute();
      },
    },
  });
  const analyzed = () =>
    db
      .selectFrom('site_crawls')
      .select('analyzed_url_count')
      .where('id', '=', seed.crawlId)
      .executeTakeFirstOrThrow();
  await db
    .updateTable('site_crawls')
    .set({ analyzed_url_count: 7 })
    .where('id', '=', seed.crawlId)
    .execute();
  await worker.execute(await lease(id, worker.owner, 0));

  expect(await row(id)).toMatchObject({
    status: 'running',
    lease_owner: 'next-owner',
    attempt_count: 1,
    completed_at: null,
  });
  // The stale run's own writes rolled back with it.
  expect(await analyzed()).toEqual({ analyzed_url_count: 7 });
  await db
    .updateTable('site_crawl_tasks')
    .set({ status: 'cancelled' })
    .where('id', '=', id)
    .execute();
});

/** Recovery reclaimed the lease (one attempt) and the same owner claimed the task again. */
const reclaimedBySameOwner = () => ({
  attempt_count: 1,
  heartbeat_at: new Date('2026-01-01T00:00:00Z'),
  lease_expires_at: new Date(Date.now() + 60_000),
});
const cancel = (...ids: string[]) =>
  db.updateTable('site_crawl_tasks').set({ status: 'cancelled' }).where('id', 'in', ids).execute();

it('stops renewing a lease the same owner re-claimed at the next attempt', async () => {
  const seed = await runningCrawl();
  const id = await fixtures.task(seed, 'link_metrics');
  const reclaimed = reclaimedBySameOwner();
  const worker = new SiteHealthWorker(db, {
    owner: 'same-owner',
    settings: { ...settings, heartbeat: 0.05 },
    executors: {
      link_metrics: async () => {
        await db.updateTable('site_crawl_tasks').set(reclaimed).where('id', '=', id).execute();
        await sleep(400);
      },
    },
  });
  await worker.execute(await lease(id, worker.owner, 0));

  expect(await row(id)).toMatchObject({
    status: 'running',
    lease_owner: 'same-owner',
    ...reclaimed,
  });
  await cancel(id);
});

it('leaves the live claim untouched when a stale claim of the same owner defers it', async () => {
  const seed = await runningCrawl();
  await db
    .updateTable('site_crawls')
    .set({ site_facts: null })
    .where('id', '=', seed.crawlId)
    .execute();
  const root = await fixtures.analyzable(seed, '/');
  const setup = await fixtures.task(seed, 'site_setup');
  const worker = new SiteHealthWorker(db, { owner: 'same-owner', settings, fetcher });
  const stale = await lease(root.taskId, worker.owner, 0);
  const reclaimed = reclaimedBySameOwner();
  await db.updateTable('site_crawl_tasks').set(reclaimed).where('id', '=', root.taskId).execute();
  await worker.execute(stale);

  expect(await row(root.taskId)).toMatchObject({
    status: 'leased',
    lease_owner: 'same-owner',
    ...reclaimed,
  });
  await cancel(root.taskId, setup);
});
