import { setTimeout as sleep } from 'node:timers/promises';
import { afterAll, expect, it } from 'vitest';

import { policy } from '../src/config.ts';
import { SitePageFetcher, siteFetchSettings } from '../src/site-health/page-fetch.ts';
import { siteWorkerSettings } from '../src/site-health/runtime.ts';
import { loadScope, startCrawl } from '../src/site-health/site-task.ts';
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
  recordedSite({
    '/flaky': { status: 503 },
    '/page': { body: '<html><head><title>Page</title></head><body>Hi</body></html>' },
  }),
  siteFetchSettings({
    SITE_HEALTH_PER_HOST_DELAY_SECONDS: '0',
    SITE_HEALTH_DEFAULT_CRAWL_DELAY_SECONDS: '0',
  }),
);
const row = (id: string) =>
  db.selectFrom('site_crawl_tasks').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
function lease(id: string, owner: string, attempts: number) {
  return db
    .updateTable('site_crawl_tasks')
    .set({
      status: 'running',
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
  expect(await analyzed()).toEqual({ analyzed_url_count: 7 });
  await db
    .updateTable('site_crawl_tasks')
    .set({ status: 'cancelled' })
    .where('id', '=', id)
    .execute();
});

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

it('never starts a stale claim once the same owner re-claimed the next attempt', async () => {
  const seed = await runningCrawl();
  const id = await fixtures.task(seed, 'link_metrics');
  const worker = new SiteHealthWorker(db, {
    owner: 'same-owner',
    settings,
    executors: { link_metrics: async () => undefined },
  });
  const stale = await lease(id, worker.owner, 0);
  const reclaimed = reclaimedBySameOwner();
  await db.updateTable('site_crawl_tasks').set(reclaimed).where('id', '=', id).execute();
  await worker.execute(stale);

  expect(await row(id)).toMatchObject({
    status: 'running',
    lease_owner: 'same-owner',
    ...reclaimed,
  });
  await cancel(id);
});

it('lets a stale analyze slot of the same owner write nothing to the live claim', async () => {
  const seed = await runningCrawl();
  const page = await fixtures.analyzable(seed, '/page');
  const worker = new SiteHealthWorker(db, { owner: 'same-owner', settings, fetcher });
  const stale = await lease(page.taskId, worker.owner, 0);
  const reclaimed = reclaimedBySameOwner();
  await db.updateTable('site_crawl_tasks').set(reclaimed).where('id', '=', page.taskId).execute();
  await worker.execute(stale);
  expect(await row(page.taskId)).toMatchObject({
    status: 'running',
    classification_expected: false,
    ...reclaimed,
  });

  await worker.execute(await row(page.taskId));
  expect(await row(page.taskId)).toMatchObject({
    status: 'succeeded',
    classification_expected: true,
    attempt_count: 2,
  });
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
    status: 'running',
    lease_owner: 'same-owner',
    ...reclaimed,
  });
  await cancel(root.taskId, setup);
});

it('starts a queued crawl for its first task, and cancels the task when Stop got there first', async () => {
  const seed = await fixtures.crawl('queued');
  const first = await fixtures.analyzable(seed, '/first');
  const second = await fixtures.analyzable(seed, '/second');
  const ctx = { db, owner: 'start-owner' };
  const loaded = async (id: string) => {
    const scope = await loadScope(db, await lease(id, ctx.owner, 0));
    if (!scope) throw new Error('task not found');
    return scope;
  };
  const stale = await loaded(second.taskId);

  const started = await startCrawl(ctx, await loaded(first.taskId));
  expect([started?.crawl.status, started?.crawl.started_at === null]).toEqual(['running', false]);

  await db
    .updateTable('site_crawls')
    .set({ status: 'cancelled' })
    .where('id', '=', seed.crawlId)
    .execute();
  expect(await startCrawl(ctx, stale)).toBeNull();
  expect((await row(second.taskId)).status).toBe('cancelled');
});
