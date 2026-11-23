import { afterAll, expect, it, vi } from 'vitest';
import { sql } from 'kysely';

import { policy } from '../src/config.ts';
import { record } from '../src/db/json.ts';
import * as lifecycle from '../src/site-health/lifecycle.ts';
import { crawlCounters } from '../src/site-health/reads/crawl-counters.ts';
import { persistLiveCounters } from '../src/site-health/terminal-counters.ts';
import { recoverExpiredLeases } from '../src/site-health/lease-recovery.ts';
import { crawlCadences } from '../src/site-health/refresh-cadence.ts';
import { siteWorkerSettings } from '../src/site-health/runtime.ts';
import { SiteHealthWorker } from '../src/workers/site-health-worker.ts';
import { lockSiteTask } from '../src/site-health/site-task.ts';
import { cancelCrawl } from '../src/site-health/controls.ts';
import { liveScoreSummary } from '../src/site-health/live-score.ts';
import { finalizeHash } from '../src/site-health/terminal-publication.ts';
import { SitePageFetcher, siteFetchSettings } from '../src/site-health/page-fetch.ts';
import { recordedSite, SiteFixtures } from './site-health-fixtures.ts';
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
const crawlOf = (id: string) =>
  db.selectFrom('site_crawls').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
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
  expect(
    (await recoverExpiredLeases(db, 10, new Date(Date.now() + 86_400_000), seed)).reclaimed,
  ).toBe(0);
  await db
    .updateTable('site_crawl_tasks')
    .set({
      lease_expires_at: sql<Date>`clock_timestamp() - interval '1 second'`,
    })
    .where('id', '=', id)
    .execute();
  expect(
    (await recoverExpiredLeases(db, 10, new Date(Date.now() - 86_400_000), seed)).reclaimed,
  ).toBe(1);
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
  expect((await recoverExpiredLeases(db, 10, now, seed)).reclaimed).toBe(1);
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
  const tasks = await worker.queue.claim({
    owner: worker.owner,
    kinds: ['link_metrics'],
    scope: { workspaceId: seed.workspaceId, taskIds: [id] },
  });
  expect(tasks.map((task) => [task.id, task.status])).toEqual([[id, 'running']]);
  expect(await worker.queue.heartbeat(id, 'dead-worker', seed.workspaceId)).toBe(false);
  const lockAs = (owner: string, task = claimed) =>
    db
      .transaction()
      .execute(
        async (trx) => (await lockSiteTask(trx, { queue: worker.queue, owner }, task))?.task,
      );
  expect(await lockAs('dead-worker')).toBeUndefined();
  expect(await lockAs(worker.owner, await row(id))).toMatchObject({
    id,
    status: 'running',
    lease_owner: 'replacement',
  });
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
  const result = await recoverExpiredLeases(db, 10, now, seed);
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
  expect((await recoverExpiredLeases(db, 10, now, seed)).reclaimed).toBe(0);
});

it('bounds recovery, skips locked rows, leaves unexpired and terminal tasks untouched, and concurrent sweeps spend once', async () => {
  const first = await fixtures.crawl();
  const oldest = await fixtures.task(first);
  const next = await fixtures.task(first);
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
    expect((await recoverExpiredLeases(db, 1, now, first)).reclaimed).toBe(1);
    expect((await row(next)).attempt_count).toBe(1);
    expect((await row(oldest)).attempt_count).toBe(0);
  });
  const results = await Promise.all([
    recoverExpiredLeases(db, 1, now, first),
    recoverExpiredLeases(db, 1, now, first),
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
  await recoverExpiredLeases(db, 10, undefined, seed);
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
    taskScope: seed,
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
    taskScope: seed,
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
  const slow = await fixtures.task(await fixtures.crawl(), 'link_metrics', { priority: 100 });
  await fixtures.task(await fixtures.crawl(), 'link_metrics', { priority: 90 });
  const third = await fixtures.task(await fixtures.crawl(), 'link_metrics');
  const order: string[] = [];
  let releaseSlow: () => void = () => {};
  const slowDone = new Promise<void>((resolve) => {
    releaseSlow = resolve;
  });
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

it('opens another claim window while no peer of its group has work due', async () => {
  const run = async (peersDue: boolean) => {
    const ids = await Promise.all(
      [1, 2, 3].map(async () => fixtures.task(await fixtures.crawl(), 'link_metrics')),
    );
    const worker = new SiteHealthWorker(db, {
      settings: { ...settings, claimWindow: 1e-9 },
      executors: { link_metrics: async () => {} },
    });
    const claimed = await worker.drain(
      1,
      () => true,
      async () => peersDue,
    );
    await db
      .updateTable('site_crawl_tasks')
      .set({ status: 'cancelled' })
      .where('id', 'in', ids)
      .where('status', '=', 'queued')
      .execute();
    return claimed;
  };
  expect(await run(true)).toBe(1);
  expect(await run(false)).toBe(3);
});

it('drains every bounded recovery batch before treating an empty claim as idle', async () => {
  const seed = await fixtures.crawl();
  const ids = await Promise.all([
    fixtures.task(seed, 'site_setup', { maximum: 1 }),
    fixtures.task(seed, 'discover', { maximum: 1 }),
  ]);
  for (const id of ids) await expired(id);
  const worker = new SiteHealthWorker(db, {
    settings: { ...settings, reclaimBatch: 1 },
    taskScope: seed,
  });
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
    settings: { ...settings, backstopInterval: 1 },
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
    expect(reconcile).toHaveBeenLastCalledWith(db, seed.workspaceId, seed.crawlId, {
      refreshScore: false,
    });
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

it('fails a long crawl only once it stops settling tasks', async () => {
  const twoHoursAgo = new Date(Date.now() - 2 * 3600_000);
  const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000);
  const crawlLastSettled = async (minutesAgo: number, finalizeHeartbeat?: number) => {
    const seed = await fixtures.crawl('running');
    await db
      .updateTable('site_crawls')
      .set({ started_at: twoHoursAgo, created_at: twoHoursAgo, completed_at: null })
      .where('id', '=', seed.crawlId)
      .execute();
    const settled = await fixtures.task(seed, 'analyze');
    await db
      .updateTable('site_crawl_tasks')
      .set({ status: 'succeeded', completed_at: ago(minutesAgo) })
      .where('id', '=', settled)
      .execute();
    if (finalizeHeartbeat === undefined) return fixtures.task(seed, 'analyze');
    const finalize = await fixtures.task(seed, 'finalize');
    await db
      .updateTable('site_crawl_tasks')
      .set({
        status: 'running',
        url_hash: finalizeHash({ id: seed.crawlId }, 'drained'),
        lease_owner: 'live',
        lease_expires_at: new Date(Date.now() + 60_000),
        heartbeat_at: ago(finalizeHeartbeat),
      })
      .where('id', '=', finalize)
      .execute();
    return finalize;
  };
  const moving = await crawlLastSettled(5);
  const stuck = await crawlLastSettled(40);
  const publishing = await crawlLastSettled(40, 1);
  const silent = await crawlLastSettled(40, 40);
  await lifecycle.reconcileOverdue(db, { ...settings.lifecycle, batch: 1000 });
  expect(await row(moving)).toMatchObject({ status: 'queued' });
  expect(await row(stuck)).toMatchObject({ status: 'failed', error_code: 'crawl_overdue' });
  expect(await row(publishing)).toMatchObject({ status: 'running' });
  expect((await crawlOf((await row(publishing)).crawl_id)).status).toBe('running');
  expect(await row(silent)).toMatchObject({ status: 'failed', error_code: 'crawl_overdue' });
  expect((await crawlOf((await row(silent)).crawl_id)).status).toBe('failed');
});

it('reconciles and stops a crawl while a task commit inserts rows that reference it', async () => {
  const seed = await fixtures.crawl('running');
  await fixtures.task(seed);
  await db.transaction().execute(async (trx) => {
    await sql`select id from site_crawls where id = ${seed.crawlId} for key share`.execute(trx);
    await cancelCrawl(db, seed.workspaceId, seed.crawlId);
    await lifecycle.reconcileCrawl(db, seed.workspaceId, seed.crawlId);
  });
  const crawl = await db
    .selectFrom('site_crawls')
    .select('status')
    .where('id', '=', seed.crawlId)
    .executeTakeFirstOrThrow();
  expect(crawl.status).toBe('cancelled');
});

it('commits an analysis while another analysis holds the workspace runtime lock', async () => {
  const seed = await fixtures.crawl('running');
  await db
    .updateTable('site_crawls')
    .set({ analysis_status: 'running', completed_at: null })
    .where('id', '=', seed.crawlId)
    .execute();
  const page = await fixtures.analyzable(seed, '/');
  const fetcher = new SitePageFetcher(
    db,
    recordedSite({ '/': { body: '<html><head><title>Page</title></head><body>Hi</body></html>' } }),
    siteFetchSettings({ SITE_HEALTH_PER_HOST_DELAY_SECONDS: '0' }),
  );
  const worker = new SiteHealthWorker(db, { owner: 'runtime-held', settings, fetcher });
  const leased = await db
    .updateTable('site_crawl_tasks')
    .set({
      status: 'leased',
      lease_owner: worker.owner,
      lease_expires_at: new Date(Date.now() + 60_000),
    })
    .where('id', '=', page.taskId)
    .returningAll()
    .executeTakeFirstOrThrow();
  await db.transaction().execute(async (trx) => {
    await sql`select id from workspace_site_health_runtime
      where workspace_id = ${seed.workspaceId} for share`.execute(trx);
    await worker.execute(leased);
  });
  expect(await row(page.taskId)).toMatchObject({ status: 'succeeded', attempt_count: 1 });
});

it('scores a running crawl as the mean of its tracked pages’ stored scores', async () => {
  const seed = await fixtures.crawl('running');
  const analyzed = async (path: string, web: number | null, aeo: number | null) => {
    const member = await fixtures.analyzable(seed, path);
    const page = await fixtures.page(seed, path, {}, { siteUrlId: member.siteUrlId });
    await db
      .updateTable('site_page_analyses')
      .set({ web_fundamentals_score: web, aeo_readiness_score: aeo })
      .where('id', '=', page.analysisId)
      .execute();
    return page;
  };
  const home = await analyzed('/', 90, null);
  await analyzed('/a', 60, 40);
  await analyzed('/b', null, 80);
  const untracked = await analyzed('/c', 0, 0);
  await db
    .updateTable('monitored_site_urls')
    .set({ active: false })
    .where('site_url_id', '=', untracked.id)
    .execute();
  await db
    .updateTable('site_crawl_tasks')
    .set({ classification_expected: true })
    .where('crawl_id', '=', seed.crawlId)
    .execute();
  const evaluation = await fixtures.evaluation(seed, home, 'technical.indexable', 'missing');
  await fixtures.issue(seed, home, 'technical.indexable', evaluation);
  await db
    .updateTable('site_issues')
    .set({ is_current: true })
    .where('evaluation_id', '=', evaluation)
    .execute();
  expect(await liveScoreSummary(db, await crawlOf(seed.crawlId))).toMatchObject({
    classification_state: 'complete',
    classification_expected_page_count: 3,
    web_fundamentals_score: 75,
    web_fundamentals_coverage: 2 / 3,
    aeo_readiness_score: 60,
    analyzed_count: 3,
    selected_count: 3,
    issue_count: 1,
    by_page_kind: {
      homepage: { analyzed_count: 1, web_fundamentals_score: 90, aeo_readiness_score: null },
      product: { analyzed_count: 2, web_fundamentals_score: 60, aeo_readiness_score: 60 },
    },
  });
});

it('refreshes a running crawl summary without overwriting one that settled meanwhile', async () => {
  const refreshWhileLocked = async (settle: boolean) => {
    const seed = await fixtures.crawl('running');
    await db
      .updateTable('site_crawls')
      .set({ analysis_status: 'running', completed_at: null })
      .where('id', '=', seed.crawlId)
      .execute();
    const member = await fixtures.analyzable(seed, '/');
    await db.deleteFrom('site_crawl_tasks').where('id', '=', member.taskId).execute();
    const page = await fixtures.page(seed, '/', {}, { siteUrlId: member.siteUrlId });
    await fixtures.evaluation(seed, page, 'technical.indexable', 'satisfied');
    await fixtures.analyzable(seed, '/pending');
    const cadence = crawlCadences(siteWorkerSettings({}).scoreRefresh);
    const task = { id: page.taskId, crawl_id: seed.crawlId, workspace_id: seed.workspaceId };
    let refreshing: Promise<unknown> = Promise.resolve();
    await db.transaction().execute(async (trx) => {
      await sql`select id from site_crawls where id = ${seed.crawlId} for update`.execute(trx);
      refreshing = lifecycle.reconcileAfterTask(db, task, cadence);
      if (settle)
        await trx
          .updateTable('site_crawls')
          .set({ status: 'completed' })
          .where('id', '=', seed.crawlId)
          .execute();
    });
    await refreshing;
    const crawl = await db
      .selectFrom('site_crawls')
      .select('score_summary')
      .where('id', '=', seed.crawlId)
      .executeTakeFirstOrThrow();
    return crawl.score_summary;
  };
  expect(await refreshWhileLocked(false)).toMatchObject({ analyzed_count: 1 });
  expect(await refreshWhileLocked(true)).toBeNull();
});

it('renders the counters an active crawl persisted, probing an expired lease at read time', async () => {
  const seed = await fixtures.crawl('running');
  const page = await fixtures.analyzable(seed, '/persisted');
  const target = { workspace_id: seed.workspaceId, crawl_id: seed.crawlId };
  const read = async () => crawlCounters(db, await crawlOf(seed.crawlId));
  await persistLiveCounters(db, target);
  await fixtures.analyzable(seed, '/later');
  expect(await read()).toMatchObject({
    queued: 1,
    activity: { state: 'working', reason: 'active_work', queue_depth: 1 },
  });
  const copy = record((await crawlOf(seed.crawlId)).live_counters);
  const waitingUntil = async (at: number) => {
    const activity = { ...record(copy.activity), state: 'waiting', reason: 'retry_backoff' };
    const next_available_at = new Date(at).toISOString();
    await db
      .updateTable('site_crawls')
      .set({
        live_counters: JSON.stringify({ ...copy, activity: { ...activity, next_available_at } }),
      })
      .where('id', '=', seed.crawlId)
      .execute();
    return (await read()).activity.state;
  };
  expect(await waitingUntil(Date.now() + 60_000)).toBe('waiting');
  expect(await waitingUntil(Date.now() - 1000)).toBe('working');
  await expired(page.taskId);
  expect(await read()).toMatchObject({
    queued: 1,
    activity: { state: 'stalled', reason: 'expired_lease' },
  });
  await persistLiveCounters(db, target);
  expect(await read()).toMatchObject({ queued: 1, running: 1 });
  await db
    .updateTable('site_crawls')
    .set({ status: 'completed' })
    .where('id', '=', seed.crawlId)
    .execute();
  await db
    .updateTable('site_crawl_tasks')
    .set({ status: 'cancelled' })
    .where('crawl_id', '=', seed.crawlId)
    .execute();
  await persistLiveCounters(db, target);
  expect((await crawlOf(seed.crawlId)).live_counters).toMatchObject({ queued: 1, running: 1 });
});
