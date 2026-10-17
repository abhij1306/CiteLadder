import { afterAll, expect, it, vi } from 'vitest';
import { sql } from 'kysely';

import { policy } from '../src/config.ts';
import * as lifecycle from '../src/site-health/lifecycle.ts';
import { recoverExpiredLeases } from '../src/site-health/lease-recovery.ts';
import { siteWorkerSettings } from '../src/site-health/runtime.ts';
import { SiteHealthWorker } from '../src/workers/site-health-worker.ts';
import { TaskCancelledError } from '../src/workers/executor.ts';
import { lockSiteTask } from '../src/site-health/task-fence.ts';
import { SiteFixtures } from './site-health-fixtures.ts';
import { testDatabase } from './support.ts';

const db = testDatabase();
const fixtures = new SiteFixtures(db);
afterAll(async () => {
  await fixtures.cleanup();
  await db.destroy();
});
const settings = { ...siteWorkerSettings({}), concurrency: 1, poll: 0 };
const row = (id: string) =>
  db.selectFrom('site_crawl_tasks').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
async function expired(id: string, attempts = 0, at = new Date(Date.now() - 1000)) {
  await db
    .updateTable('site_crawl_tasks')
    .set({
      status: 'running',
      attempt_count: attempts,
      lease_owner: 'dead-worker',
      lease_expires_at: at,
      heartbeat_at: at,
    })
    .where('id', '=', id)
    .execute();
}

it('uses database time to recover leases despite application clock skew', async () => {
  const seed = await fixtures.crawl('running');
  const id = await fixtures.task(seed);
  await db
    .updateTable('site_crawl_tasks')
    .set({
      status: 'running',
      lease_owner: 'worker',
      lease_expires_at: sql<Date>`clock_timestamp() + interval '120 seconds'`,
    })
    .where('id', '=', id)
    .execute();
  expect((await recoverExpiredLeases(db, 10, new Date(Date.now() + 86_400_000))).reclaimed).toBe(0);
  await db
    .updateTable('site_crawl_tasks')
    .set({
      lease_expires_at: sql<Date>`clock_timestamp() - interval '1 second'`,
    })
    .where('id', '=', id)
    .execute();
  expect((await recoverExpiredLeases(db, 10, new Date(Date.now() - 86_400_000))).reclaimed).toBe(1);
  expect(await row(id)).toMatchObject({ status: 'retry_wait', attempt_count: 1 });
  await db
    .updateTable('site_crawl_tasks')
    .set({ status: 'cancelled' })
    .where('id', '=', id)
    .execute();
});

it('reclaims retryable leases, spends one attempt, and fences the old owner after a new claim', async () => {
  const seed = await fixtures.crawl('running');
  const id = await fixtures.task(seed);
  await expired(id);
  const claimed = await row(id);
  const now = new Date();
  expect((await recoverExpiredLeases(db, 10, now)).reclaimed).toBe(1);
  expect(await row(id)).toMatchObject({
    status: 'retry_wait',
    attempt_count: 1,
    lease_owner: null,
    heartbeat_at: null,
    completed_at: null,
    available_at: now,
    updated_at: now,
  });
  const worker = new SiteHealthWorker(db, { owner: 'replacement', settings });
  const tasks = await worker.queue.claim({ owner: worker.owner, kinds: ['link_metrics'] });
  expect(tasks.map((task) => task.id)).toEqual([id]);
  expect(await worker.queue.markRunning(id, worker.owner)).toBe(true);
  expect(await worker.queue.heartbeat(id, 'dead-worker', seed.workspaceId)).toBe(false);
  await expect(
    db.transaction().execute((trx) => lockSiteTask(trx, claimed, 'dead-worker')),
  ).rejects.toBeInstanceOf(TaskCancelledError);
  // Finish the fixture so subsequent queue-drain tests cannot claim it.
  await db
    .updateTable('site_crawl_tasks')
    .set({ status: 'cancelled' })
    .where('id', '=', id)
    .execute();
});

it('terminal recovery preserves committed evidence and names the crawl to reconcile', async () => {
  const seed = await fixtures.crawl('running');
  const page = await fixtures.page(seed, '/', { title: 'Persisted' });
  await expired(page.taskId, 2);
  const now = new Date();
  const result = await recoverExpiredLeases(db, 10, now);
  expect(result).toEqual({
    reclaimed: 1,
    failedTaskIds: [page.taskId],
    failedCrawls: [{ crawlId: seed.crawlId, workspaceId: seed.workspaceId }],
  });
  expect(await row(page.taskId)).toMatchObject({
    status: 'failed',
    attempt_count: 3,
    completed_at: now,
    updated_at: now,
    result_artifact_id: page.artifactId,
    error_code: policy.task_queue.max_attempts_error,
    lease_owner: null,
    lease_expires_at: null,
  });
  expect(
    await db
      .selectFrom('site_fetch_artifacts')
      .select('normalized_facts')
      .where('id', '=', page.artifactId)
      .executeTakeFirstOrThrow(),
  ).toEqual({ normalized_facts: { title: 'Persisted' } });
  expect((await recoverExpiredLeases(db, 10, now)).reclaimed).toBe(0);
});

it('bounds recovery, skips locked rows, leaves unexpired and terminal tasks untouched, and concurrent sweeps spend once', async () => {
  const first = await fixtures.crawl();
  const second = await fixtures.crawl();
  const oldest = await fixtures.task(first);
  const next = await fixtures.task(second);
  const live = await fixtures.task(first);
  const terminal = await fixtures.task(first);
  const now = new Date();
  await expired(oldest, 0, new Date(now.getTime() - 2000));
  await expired(next, 0, new Date(now.getTime() - 1000));
  await expired(live, 0, new Date(now.getTime() + 60_000));
  await db
    .updateTable('site_crawl_tasks')
    .set({ status: 'cancelled', lease_expires_at: new Date(0) })
    .where('id', '=', terminal)
    .execute();
  await db.transaction().execute(async (trx) => {
    await trx
      .selectFrom('site_crawl_tasks')
      .select('id')
      .where('id', '=', oldest)
      .forUpdate()
      .execute();
    expect((await recoverExpiredLeases(db, 1, now)).reclaimed).toBe(1);
    expect((await row(next)).attempt_count).toBe(1);
    expect((await row(oldest)).attempt_count).toBe(0);
  });
  const results = await Promise.all([
    recoverExpiredLeases(db, 1, now),
    recoverExpiredLeases(db, 1, now),
  ]);
  expect(results.reduce((sum, result) => sum + result.reclaimed, 0)).toBe(1);
  expect((await row(oldest)).attempt_count).toBe(1);
  expect((await row(live)).status).toBe('running');
  expect((await row(terminal)).status).toBe('cancelled');
  await db
    .updateTable('site_crawl_tasks')
    .set({ status: 'cancelled' })
    .where('id', 'in', [oldest, next, live])
    .execute();
});

it('preserves a more specific failure code when a recovered lease exhausts its attempts', async () => {
  const seed = await fixtures.crawl();
  const id = await fixtures.task(seed, 'site_setup', { maximum: 1 });
  await expired(id);
  await db
    .updateTable('site_crawl_tasks')
    .set({ error_code: 'fetch_timeout', error_detail: 'recorded failure' })
    .where('id', '=', id)
    .execute();
  await recoverExpiredLeases(db, 10);
  expect(await row(id)).toMatchObject({
    status: 'failed',
    attempt_count: 1,
    error_code: 'fetch_timeout',
    error_detail: 'recorded failure',
  });
});

it('drains recovered and successor work through acknowledgement without claiming future work', async () => {
  const seed = await fixtures.crawl();
  const id = await fixtures.task(seed);
  await expired(id);
  const future = await fixtures.task(seed);
  await db
    .updateTable('site_crawl_tasks')
    .set({ available_at: new Date(Date.now() + 60_000) })
    .where('id', '=', future)
    .execute();
  let successor: string | null = null;
  const worker = new SiteHealthWorker(db, {
    settings,
    executors: {
      link_metrics: async (trx, crawl) => {
        if (successor) return;
        successor = await new SiteFixtures(trx).task(
          { ...seed, crawlId: crawl.id },
          'architecture',
        );
      },
      architecture: async () => {},
    },
  });
  expect(await worker.runUntilIdle(new AbortController().signal)).toBe(2);
  expect((await row(id)).status).toBe('succeeded');
  expect((await row(successor!)).status).toBe('succeeded');
  expect((await row(future)).status).toBe('queued');
  await db
    .updateTable('site_crawl_tasks')
    .set({ status: 'cancelled' })
    .where('id', '=', future)
    .execute();
});

it('finishes its leased batch and stops new claims once the budget expires or shutdown is requested', async () => {
  const seed = await fixtures.crawl();
  const first = await fixtures.task(seed, 'link_metrics', { priority: 100 });
  const remaining = await fixtures.task(seed);
  let elapsed = 0;
  const clock = vi.spyOn(performance, 'now').mockImplementation(() => elapsed);
  const worker = new SiteHealthWorker(db, {
    settings,
    executors: {
      link_metrics: async () => {
        elapsed = 20;
      },
    },
  });
  try {
    expect(await worker.runUntilIdle(new AbortController().signal, 0.01)).toBe(1);
    expect((await row(first)).status).toBe('succeeded');
    expect((await row(remaining)).status).toBe('queued');
    const stop = new AbortController();
    stop.abort();
    expect(await worker.runUntilIdle(stop.signal)).toBe(0);
    await expect(worker.runUntilIdle(stop.signal, Number.NaN)).rejects.toThrow(
      'positive and finite',
    );
    await db
      .updateTable('site_crawl_tasks')
      .set({ status: 'cancelled' })
      .where('id', '=', remaining)
      .execute();
  } finally {
    clock.mockRestore();
  }
});

it('refills a freed slot while a slow task is still running', async () => {
  // Separate crawls: transactional executors serialize on their crawl's row lock.
  const slow = await fixtures.task(await fixtures.crawl(), 'link_metrics', { priority: 100 });
  await fixtures.task(await fixtures.crawl(), 'link_metrics', { priority: 90 });
  const third = await fixtures.task(await fixtures.crawl(), 'link_metrics');
  const order: string[] = [];
  let releaseSlow: () => void = () => {};
  const slowDone = new Promise<void>((resolve) => {
    releaseSlow = resolve;
  });
  // Without refilling, the third task would wait for the slow one: fail fast instead of hanging.
  const fallback = setTimeout(releaseSlow, 3000);
  const worker = new SiteHealthWorker(db, {
    settings,
    executors: {
      link_metrics: async (_trx, _crawl, task) => {
        if (task.id === slow) {
          await slowDone;
          order.push('slow');
        } else if (task.id === third) {
          order.push('third');
          releaseSlow();
        }
      },
    },
  });
  try {
    expect(await worker.drain(2)).toBe(3);
    expect(order).toEqual(['third', 'slow']);
  } finally {
    clearTimeout(fallback);
  }
});

it('drains every bounded recovery batch before treating an empty claim as idle', async () => {
  const seed = await fixtures.crawl();
  const ids = await Promise.all([
    fixtures.task(seed, 'site_setup', { maximum: 1 }),
    fixtures.task(seed, 'discover', { maximum: 1 }),
  ]);
  for (const id of ids) await expired(id);
  const worker = new SiteHealthWorker(db, { settings: { ...settings, reclaimBatch: 1 } });
  expect(await worker.runUntilIdle(new AbortController().signal)).toBe(0);
  expect((await Promise.all(ids.map(row))).map((task) => task.status)).toEqual([
    'failed',
    'failed',
  ]);
});

it('guards scoped maintenance failures and throttles reconciliation while continuing scoped claims', async () => {
  const seed = await fixtures.crawl();
  const other = await fixtures.crawl();
  const id = await fixtures.task(seed);
  const unrelated = await fixtures.task(other);
  let now = Date.now();
  const clock = vi.spyOn(Date, 'now').mockImplementation(() => now);
  const reconcile = vi
    .spyOn(lifecycle, 'reconcileCrawl')
    .mockRejectedValueOnce(new Error('temporary reconcile failure'));
  const worker = new SiteHealthWorker(db, {
    settings: { ...settings, poll: 1 },
    taskScope: { workspaceId: seed.workspaceId, crawlId: seed.crawlId },
    executors: { link_metrics: async () => {} },
  });
  try {
    expect(await worker.runOnce()).toBe(1);
    expect((await row(id)).status).toBe('succeeded');
    expect(await worker.runOnce()).toBe(0);
    expect(reconcile).toHaveBeenCalledTimes(1);
    now += 1000;
    expect(await worker.runOnce()).toBe(0);
    expect(reconcile).toHaveBeenCalledTimes(2);
    expect(reconcile).toHaveBeenLastCalledWith(db, seed.workspaceId, seed.crawlId);
    expect((await row(unrelated)).status).toBe('queued');
  } finally {
    clock.mockRestore();
    reconcile.mockRestore();
    await db
      .updateTable('site_crawl_tasks')
      .set({ status: 'cancelled' })
      .where('id', '=', unrelated)
      .execute();
  }
});
