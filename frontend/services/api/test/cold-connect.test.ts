/** Post-connect exercises native successor admission and persisted projections. */
import { afterAll, expect, it } from 'vitest';
import { sql } from 'kysely';
import { enqueuePostSyncProjections } from '../src/integrations/projections.ts';
import { readProjectReadiness } from '../src/integrations/readiness.ts';
import { drainWorkspace } from './analytics-drain.ts';
import { Fixtures, testDatabase } from './support.ts';
import { seedImport } from './referral-fixtures.ts';
import { importSeed, metric, requests, tenant, WINDOW } from './traffic-fixtures.ts';

const db = testDatabase(),
  fixtures = new Fixtures(db);
afterAll(async () => {
  await fixtures.cleanup();
  await db.destroy();
});

it('refreshes AI Referrals after classification, not also before it, for referral runs', async () => {
  // One GA4 connection per workspace: each run gets its own tenant.
  const extrasOnly = await importSeed(db, await tenant(db, fixtures), 'ga4_channel_daily');
  const referral = await importSeed(db, await tenant(db, fixtures), 'ga4_source_medium_daily');
  // The referral run also carries an extras dataset.
  await metric(db, referral, {
    dataset: 'ga4_channel_daily',
    values: ['Organic Search', '20260728'],
  });
  await db.transaction().execute(async (trx) => {
    for (const seed of [extrasOnly, referral]) {
      const run = await trx
        .selectFrom('integration_sync_runs')
        .selectAll()
        .select([
          sql<string>`window_start::text`.as('window_start'),
          sql<string>`window_end::text`.as('window_end'),
        ])
        .where('id', '=', seed.syncRunId)
        .executeTakeFirstOrThrow();
      await enqueuePostSyncProjections(trx, run);
    }
  });
  const queued = await db
    .selectFrom('analytics_tasks')
    .select(['task_kind', 'idempotency_key'])
    .where('workspace_id', 'in', [extrasOnly.workspaceId, referral.workspaceId])
    .where('task_kind', 'in', ['ai_referrals_snapshot_refresh', 'ingest_referrals'])
    .execute();
  const runOf = (key: string) =>
    [extrasOnly, referral].find((seed) => key.includes(seed.syncRunId))?.syncRunId;
  expect(
    queued
      .filter((row) => row.task_kind === 'ai_referrals_snapshot_refresh')
      .map((row) => runOf(row.idempotency_key)),
  ).toEqual([extrasOnly.syncRunId]);
  expect(queued.filter((row) => row.task_kind === 'ingest_referrals')).toHaveLength(1);
});

it('shares one queued Traffic refresh per window and queues a successor once it starts', async () => {
  const t = await tenant(db, fixtures);
  const gsc = await seedImport(db, {
    ...t,
    dataset: 'gsc_day_daily',
    window: WINDOW,
    provider: 'gsc',
  });
  const ga4 = await importSeed(db, t, 'ga4_channel_daily');
  const project = async (seeds: (typeof gsc)[]) =>
    db.transaction().execute(async (trx) => {
      for (const seed of seeds) {
        const run = await trx
          .selectFrom('integration_sync_runs')
          .selectAll()
          .select([
            sql<string>`window_start::text`.as('window_start'),
            sql<string>`window_end::text`.as('window_end'),
          ])
          .where('id', '=', seed.syncRunId)
          .executeTakeFirstOrThrow();
        // A failed run always refreshes, whatever it imported.
        await enqueuePostSyncProjections(trx, run, true);
      }
    });
  const refreshes = () =>
    db
      .selectFrom('analytics_tasks')
      .select(['status', sql<string>`payload->>'source_revision'`.as('source')])
      .where('workspace_id', '=', t.workspaceId)
      .where('task_kind', '=', 'traffic_snapshot_refresh')
      .orderBy('created_at')
      .execute();

  await project([gsc, ga4]);
  expect(await refreshes()).toEqual([{ status: 'queued', source: gsc.syncRunId }]);

  await db
    .updateTable('analytics_tasks')
    .set({ status: 'running' })
    .where('workspace_id', '=', t.workspaceId)
    .where('task_kind', '=', 'traffic_snapshot_refresh')
    .execute();
  await project([ga4]);
  expect(await refreshes()).toEqual([
    { status: 'running', source: gsc.syncRunId },
    { status: 'queued', source: ga4.syncRunId },
  ]);
});

it('takes a first connect through both workers to analysis_ready without provider I/O', async () => {
  const t = await tenant(db, fixtures);
  const gsc = await seedImport(db, {
      ...t,
      dataset: 'gsc_day_daily',
      window: WINDOW,
      provider: 'gsc',
    }),
    ga4 = await importSeed(db, t, 'ga4_channel_daily');
  for (const seed of [gsc, ga4])
    await db
      .updateTable('integration_sync_runs')
      .set({ sync_kind: 'backfill' })
      .where('id', '=', seed.syncRunId)
      .execute();
  await metric(db, gsc, { metrics: { clicks: 30, impressions: 300, position: 4.5 } });
  await metric(db, ga4, {
    values: ['Organic Search', '20260728'],
    metrics: { sessions: 40, engagedSessions: 25 },
  });
  for (let i = 0; i < 12; i++) {
    await metric(db, gsc, {
      dataset: 'gsc_query_daily',
      values: [`query ${i}`, WINDOW[1]],
      metrics: { clicks: i, impressions: 100 },
    });
    await metric(db, gsc, {
      dataset: 'gsc_query_page_daily',
      values: [`query ${i}`, 'https://example.test/page', WINDOW[1]],
      metrics: { clicks: i, impressions: 100 },
    });
  }
  await db.transaction().execute(async (trx) => {
    for (const seed of [gsc, ga4]) {
      const run = await trx
        .selectFrom('integration_sync_runs')
        .selectAll()
        .select([
          sql<string>`window_start::text`.as('window_start'),
          sql<string>`window_end::text`.as('window_end'),
        ])
        .where('id', '=', seed.syncRunId)
        .where('workspace_id', '=', t.workspaceId)
        .executeTakeFirstOrThrow();
      await enqueuePostSyncProjections(trx, run);
    }
  });
  expect(await drainWorkspace(db, t.workspaceId)).toBeGreaterThanOrEqual(2);
  const tasks = await db
    .selectFrom('analytics_tasks')
    .select(['task_kind', 'status', 'error_detail'])
    .select(sql<boolean>`available_at > now()`.as('deferred'))
    .where('workspace_id', '=', t.workspaceId)
    .execute();
  // Insight refresh is coalesced and debounced independently of readiness.
  expect(tasks.filter((row) => row.task_kind === 'ai_traffic_insights_refresh')).toEqual([
    {
      task_kind: 'ai_traffic_insights_refresh',
      status: 'queued',
      error_detail: '',
      deferred: true,
    },
  ]);
  expect(
    tasks
      .filter((row) => row.task_kind !== 'ai_traffic_insights_refresh')
      .every((row) => row.status === 'succeeded'),
    JSON.stringify(tasks),
  ).toBe(true);
  const request = requests(db, t);
  const dashboard = await request('performance?range=month');
  const tablePath = `performance/table?snapshot_id=${dashboard.body.selected.snapshot_id}`;
  const first = await request(tablePath);
  expect(first.body.items.length).toBeGreaterThan(0);
  const queries = await request(
    `demand/query-evidence?window_start=${WINDOW[0]}&window_end=${WINDOW[1]}&limit=2`,
  );
  expect(queries.response.status, JSON.stringify(queries.body)).toBe(200);
  expect(queries.body.items).toHaveLength(2);
  const next = await request(
    `demand/query-evidence?window_start=${WINDOW[0]}&window_end=${WINDOW[1]}&limit=2&cursor=${encodeURIComponent(queries.body.next_cursor!)}`,
  );
  expect(next.body.items).toHaveLength(2);
  expect(
    next.body.items.some((row) => queries.body.items.some((first) => first.id === row.id)),
  ).toBe(false);
  // The TS worker drains the readiness chain, Opportunity refresh included.
  expect(await readProjectReadiness(db, t)).toMatchObject({
    stage: 'analysis_ready',
    connection_count: 2,
    providers: ['ga4', 'gsc'],
    has_performance_snapshot: true,
    has_demand_snapshot: true,
    imported_through: WINDOW[1],
  });
}, 30_000);
