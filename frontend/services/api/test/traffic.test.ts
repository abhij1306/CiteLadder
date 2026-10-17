import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { policy } from '../src/config.ts';
import { refreshTrafficSnapshot, projectPerformanceRange } from '../src/traffic/snapshot.ts';
import { buildTrafficProjection, TrafficProjectionBuilder } from '../src/traffic/projection.ts';
import { TaskCancelledError } from '../src/workers/executor.ts';
import { Fixtures, testDatabase } from './support.ts';
import {
  importSeed,
  metric,
  requests,
  task,
  tenant,
  WINDOW,
  type Tenant,
} from './traffic-fixtures.ts';

const db = testDatabase(),
  fixtures = new Fixtures(db);
const context = { db, maxAttempts: 3, checkCancelled: async () => {} };
let t: Tenant, request: ReturnType<typeof requests>;
beforeEach(async () => {
  t = await tenant(db, fixtures);
  request = requests(db, t);
});
afterAll(async () => {
  await fixtures.cleanup();
  await db.destroy();
});
async function refreshed() {
  const seed = await importSeed(db, t);
  const id = await metric(db, seed, {});
  await refreshTrafficSnapshot(await task(db, t, 'traffic_snapshot_refresh'), context);
  return { seed, id };
}

describe('traffic projections and Performance', () => {
  it('refreshes every preset/granularity atomically, preserves provenance and enqueues one demand handoff', async () => {
    const { id } = await refreshed();
    const rows = await db
      .selectFrom('traffic_snapshots')
      .selectAll()
      .where('project_id', '=', t.projectId)
      .execute();
    expect(
      rows.every((r) => JSON.stringify(r.source_metric_row_ids) === JSON.stringify([id])),
    ).toBe(true);
    const successors = await db
      .selectFrom('analytics_tasks')
      .select('task_kind')
      .where('project_id', '=', t.projectId)
      .where('task_kind', '!=', 'traffic_snapshot_refresh')
      .execute();
    // Nothing is declared on this project, so no verification is queued.
    expect(successors.map((r) => r.task_kind).sort()).toEqual(['demand_snapshot_refresh']);
    const before = rows.map((r) => r.id).sort();
    await refreshTrafficSnapshot(await task(db, t, 'traffic_snapshot_refresh'), context);
    expect(
      (
        await db
          .selectFrom('traffic_snapshots')
          .select('id')
          .where('project_id', '=', t.projectId)
          .execute()
      )
        .map((r) => r.id)
        .sort(),
    ).toEqual(before);
  });

  it('anchors presets and Demand on the latest reported Search Console day, leaving lag unavailable', async () => {
    const seed = await importSeed(db, t);
    await metric(db, seed, { date: '2026-07-20', metrics: { impressions: 50, clicks: 5 } });
    await metric(db, seed, { date: '2026-07-26', metrics: { impressions: 100, clicks: 1 } });
    await refreshTrafficSnapshot(await task(db, t, 'traffic_snapshot_refresh'), context);
    const month = (await request('performance?range=month')).body.selected;
    expect([month.window_start, month.window_end]).toEqual(['2026-06-29', '2026-07-26']);
    const synced = await db
      .selectFrom('traffic_snapshots')
      .select('metrics')
      .where('project_id', '=', t.projectId)
      .where('window_start', '=', sql<Date>`${WINDOW[0]}::date`)
      .where('window_end', '=', sql<Date>`${WINDOW[1]}::date`)
      .where('granularity', '=', 'day')
      .executeTakeFirstOrThrow();
    const clicks = new Map(
      (
        synced.metrics as { series: { clicks: { date: string; value: number | null }[] } }
      ).series.clicks.map((point) => [point.date, point.value]),
    );
    // An empty day before the anchor is measured; empty days after it are lag.
    expect(
      ['2026-07-21', '2026-07-26', '2026-07-27', '2026-07-28'].map((d) => clicks.get(d)),
    ).toEqual([0, 1, null, null]);
    // A short incremental sync still hands Demand the same anchored policy window.
    await refreshTrafficSnapshot(
      await task(db, t, 'traffic_snapshot_refresh', ['2026-07-25', '2026-07-28']),
      context,
    );
    const demand = await db
      .selectFrom('analytics_tasks')
      .select('payload')
      .where('project_id', '=', t.projectId)
      .where('task_kind', '=', 'demand_snapshot_refresh')
      .execute();
    expect(demand.map((row) => row.payload)).toMatchObject([
      { window_start: '2026-06-29', window_end: '2026-07-26' },
    ]);
  });

  it('keeps headers GSC-only, Bing separate, and unavailable different from measured zero', async () => {
    const seed = await importSeed(db, t);
    await metric(db, seed, { metrics: { impressions: 0, clicks: 0 } });
    await metric(db, seed, {
      dataset: 'gsc_query_daily',
      values: ['query', WINDOW[1]],
      metrics: { impressions: 900, clicks: 30 },
    });
    await metric(db, seed, {
      dataset: 'bing_query_daily',
      values: ['query', WINDOW[1]],
      metrics: { impressions: 800, clicks: 20 },
    });
    await refreshTrafficSnapshot(await task(db, t, 'traffic_snapshot_refresh'), context);
    const { body } = await request('performance?range=month');
    expect(body.selected).toMatchObject({
      evidence_state: 'observed_zero',
      totals: { clicks: 0, impressions: 0, sessions: null, ctr: null },
    });
    expect(body.unavailable_dimensions).toContain('search_appearance');
    for (const [dimension, clicks] of [
      ['query', 30],
      ['bing_query', 20],
    ] as const) {
      const page = await request(
        `performance/table?snapshot_id=${body.selected.snapshot_id}&dimension=${dimension}`,
      );
      expect(page.body.items[0]?.metrics.clicks).toBe(clicks);
    }
  });

  it.each(['day', 'week', 'month', '3_months', '6_months', 'last_synced'])(
    'resolves %s dates independently of bucket size',
    async (range) => {
      await refreshed();
      const daily = await request(`performance?range=${range}&granularity=day`);
      const weekly = await request(`performance?range=${range}&granularity=week`);
      expect(daily.response.status).toBe(200);
      expect([weekly.body.selected.window_start, weekly.body.selected.window_end]).toEqual([
        daily.body.selected.window_start,
        daily.body.selected.window_end,
      ]);
      if (range.endsWith('months')) expect(daily.body.selected.snapshot_id).toBeNull();
    },
  );

  it('unprojected reads remain empty and never enqueue; previous/custom comparisons use exact windows', async () => {
    const initial = await request(
      'performance?range=custom&from=2026-07-01&to=2026-07-28&compare=previous',
    );
    expect(initial.body.selected.snapshot_id).toBeNull();
    expect(initial.body.comparison).toMatchObject({
      window_start: '2026-06-03',
      window_end: '2026-06-30',
      snapshot_id: null,
    });
    expect(
      await db
        .selectFrom('analytics_tasks')
        .select('id')
        .where('project_id', '=', t.projectId)
        .execute(),
    ).toEqual([]);
    await refreshed();
    expect(
      (await request('performance?range=month&compare=custom&compare_from=2026-06-01')).response
        .status,
    ).toBe(422);
    expect(
      (await request('performance?range=month&compare=year_over_year')).body.comparison?.window_end,
    ).toBe('2025-07-29');
  });

  it.each([
    'range=bad',
    'compare=bad',
    'granularity=',
    'from=2026-07-01',
    'from=2026-07-30&to=2026-07-01',
  ])('rejects invalid query %s', async (query) => {
    expect((await request(`performance?${query}`)).response.status).toBe(422);
  });

  it('binds cursor to filters, uses persisted counts and retains null comparison for unobserved keys', async () => {
    const seed = await importSeed(db, t);
    for (let i = 0; i < 12; i++)
      await metric(db, seed, {
        dataset: 'gsc_query_daily',
        values: [`query ${i}`, WINDOW[1]],
        metrics: { impressions: 100, clicks: i, position: i % 2 ? null : 5 },
      });
    await refreshTrafficSnapshot(await task(db, t, 'traffic_snapshot_refresh'), context);
    const dashboard = await request('performance?range=custom&from=2026-07-01&to=2026-07-28');
    const id = dashboard.body.selected.snapshot_id;
    const first = await request(`performance/table?snapshot_id=${id}`);
    expect(first.body.total_count).toBe(12);
    expect(first.body.items.map((r) => r.metrics.clicks)).toEqual([11, 10, 9, 8, 7, 6, 5, 4, 3, 2]);
    const second = await request(
      `performance/table?snapshot_id=${id}&cursor=${encodeURIComponent(first.body.next_cursor!)}`,
    );
    expect(second.body.items.map((r) => r.metrics.clicks)).toEqual([1, 0]);
    expect(second.body.next_cursor).toBeNull();
    for (const changed of ['page_size=25', 'sort=clicks', 'dimension=page'])
      expect(
        (
          await request(
            `performance/table?snapshot_id=${id}&${changed}&cursor=${encodeURIComponent(first.body.next_cursor!)}`,
          )
        ).response.status,
      ).toBe(400);
    for (const invalid of ['page_size=12', 'sort=bogus', 'dimension=bogus'])
      expect(
        (await request(`performance/table?snapshot_id=${id}&${invalid}`)).response.status,
      ).toBe(422);
    expect(first.body.items[0]?.comparison_metrics).toBeNull();
  });

  it('range requests dedupe, project all missing grains and preserve existing rows without downstream effects', async () => {
    const seed = await importSeed(db, t);
    await metric(db, seed, {});
    const url = 'performance/range?from=2026-07-01&to=2026-07-28';
    const one = await request(url, { method: 'POST' }),
      two = await request(url, { method: 'POST' });
    expect(one.response.status).toBe(202);
    expect(two.body.task_id).toBe(one.body.task_id);
    const row = await db
      .selectFrom('analytics_tasks')
      .selectAll()
      .where('id', '=', one.body.task_id)
      .executeTakeFirstOrThrow();
    await projectPerformanceRange(row, context);
    const before = await db
      .selectFrom('traffic_snapshots')
      .selectAll()
      .where('project_id', '=', t.projectId)
      .orderBy('id')
      .execute();
    await metric(db, seed, { revision: 1, metrics: { clicks: 99, impressions: 100 } });
    await projectPerformanceRange(row, context);
    expect(
      await db
        .selectFrom('traffic_snapshots')
        .selectAll()
        .where('project_id', '=', t.projectId)
        .orderBy('id')
        .execute(),
    ).toEqual(before);
    expect(before).toHaveLength(3);
    expect(
      await db
        .selectFrom('analytics_tasks')
        .select('id')
        .where('project_id', '=', t.projectId)
        .execute(),
    ).toHaveLength(1);
    expect((await request(`performance/range/${row.id}`)).body.task_id).toBe(row.id);
    expect(
      (await request('performance/range?from=2020-01-01&to=2026-01-01', { method: 'POST' }))
        .response.status,
    ).toBe(422);
  });

  it('clamps a custom range to the latest imported date and admits a retry after failure', async () => {
    const seed = await importSeed(db, t);
    await metric(db, seed, {});
    const url = 'performance/range?from=2026-07-01&to=2026-08-15';
    const first = await request(url, { method: 'POST' });
    expect([first.body.window_start, first.body.window_end]).toEqual(['2026-07-01', WINDOW[1]]);
    expect(
      (await request('performance/range?from=2026-07-29&to=2026-08-15', { method: 'POST' }))
        .response.status,
    ).toBe(422);
    await db
      .updateTable('analytics_tasks')
      .set({ status: 'failed' })
      .where('id', '=', first.body.task_id)
      .execute();
    const retried = await request(url, { method: 'POST' });
    expect(retried.body).toMatchObject({ status: 'queued', window_end: WINDOW[1] });
    expect(retried.body.task_id).not.toBe(first.body.task_id);
    expect((await request(url, { method: 'POST' })).body.task_id).toBe(retried.body.task_id);
    const row = await db
      .selectFrom('analytics_tasks')
      .selectAll()
      .where('id', '=', retried.body.task_id)
      .executeTakeFirstOrThrow();
    await projectPerformanceRange(row, context);
    const read = (await request('performance?range=custom&from=2026-07-01&to=2026-08-15')).body;
    expect(read.selected.window_end).toBe(WINDOW[1]);
    expect(read.selected.snapshot_id).not.toBeNull();
  });

  it('anchors extended ranges on the refresh anchor, not a later display-only range', async () => {
    await refreshed();
    await projectPerformanceRange(
      await task(db, t, 'performance_range_projection', ['2026-07-01', '2026-08-15']),
      context,
    );
    const body = (await request('performance?range=3_months')).body;
    expect([body.selected.window_start, body.selected.window_end]).toEqual([
      '2026-04-30',
      WINDOW[1],
    ]);
  });

  it('runs an authorized custom range once while leaving sibling tasks queued', async () => {
    const seed = await importSeed(db, t);
    await metric(db, seed, {});
    const admitted = await request('performance/range?from=2026-07-01&to=2026-07-28', {
      method: 'POST',
    });
    const sibling = await task(db, t, 'performance_range_projection', ['2026-07-02', '2026-07-28']);
    const route = `performance/range/${admitted.body.task_id}/run`;
    const other = await tenant(db, fixtures);
    expect(
      (await request(route, { method: 'POST', workspace: other.workspaceId })).response.status,
    ).toBe(404);
    const responses = await Promise.all([
      request(route, { method: 'POST' }),
      request(route, { method: 'POST' }),
    ]);
    expect(responses.map(({ response }) => response.status)).toEqual([200, 200]);
    expect((await request(`performance/range/${admitted.body.task_id}`)).body.status).toBe(
      'succeeded',
    );
    expect(
      (await request('performance?range=custom&from=2026-07-01&to=2026-07-28')).body.selected
        .snapshot_id,
    ).not.toBeNull();
    expect(
      await db
        .selectFrom('analytics_tasks')
        .select(['status', 'attempt_count'])
        .where('id', '=', sibling.id)
        .executeTakeFirstOrThrow(),
    ).toEqual({ status: 'queued', attempt_count: 0 });
  });

  it('rejects foreign workspace/project/task IDs and viewer writes', async () => {
    await refreshed();
    const other = await tenant(db, fixtures);
    expect((await request('performance', { authenticated: false })).response.status).toBe(404);
    expect((await request('performance', { workspace: other.workspaceId })).response.status).toBe(
      404,
    );
    expect((await request('performance', { project: other.projectId })).response.status).toBe(404);
    const foreign = await task(db, other, 'performance_range_projection');
    expect((await request(`performance/range/${foreign.id}`)).response.status).toBe(404);
    const viewer = await fixtures.user();
    await fixtures.member(t.workspaceId, viewer, 'viewer');
    expect(
      (
        await request('performance/range?from=2026-07-01&to=2026-07-28', {
          method: 'POST',
          user: viewer,
        })
      ).response.status,
    ).toBe(403);
    await expect(
      refreshTrafficSnapshot({ ...foreign, workspace_id: t.workspaceId }, context),
    ).rejects.toThrow();
    expect(
      await db
        .selectFrom('traffic_snapshots')
        .select('id')
        .where('project_id', '=', other.projectId)
        .execute(),
    ).toEqual([]);
    expect((await request(`performance/table?snapshot_id=${randomUUID()}`)).body.items).toEqual([]);
  });

  it('streams selected partition rows across SQL batch boundaries and cancels without publishing partial projections', async () => {
    const seed = await importSeed(db, t, 'gsc_page_daily');
    await metric(db, seed, {
      dataset: 'gsc_day_daily',
      metrics: { impressions: 1000, clicks: policy.traffic.TRAFFIC_METRIC_ROW_BATCH_SIZE },
    });
    const values = Array.from(
      { length: policy.traffic.TRAFFIC_METRIC_ROW_BATCH_SIZE + 1 },
      (_, i) => ({
        id: randomUUID(),
        workspace_id: t.workspaceId,
        project_id: t.projectId,
        property_ref: 'properties/123456789',
        provider: 'gsc',
        dataset: seed.dataset,
        date: WINDOW[1],
        dimension_key: `https://example.test/page-${i} | ${WINDOW[1]}`,
        metrics: JSON.stringify({ impressions: 100, clicks: i }),
        source_artifact_id: seed.artifactId,
        resync_seq: 0,
        importer_version: 'test',
        created_at: new Date(),
      }),
    );
    await db.insertInto('integration_metric_rows').values(values).execute();
    const row = await task(db, t, 'traffic_snapshot_refresh');
    let boundaries = 0;
    await expect(
      refreshTrafficSnapshot(row, {
        ...context,
        checkCancelled: async () => {
          if (++boundaries === 2) throw new TaskCancelledError();
        },
      }),
    ).rejects.toBeInstanceOf(TaskCancelledError);
    expect(
      await db
        .selectFrom('traffic_snapshots')
        .select('id')
        .where('project_id', '=', t.projectId)
        .execute(),
    ).toEqual([]);
    await refreshTrafficSnapshot(row, context);
    expect((await request('performance?range=month')).body.selected.totals.clicks).toBe(
      policy.traffic.TRAFFIC_METRIC_ROW_BATCH_SIZE,
    );
  });

  it('samples provenance separately by source and keeps exact stat counts above the limit', () => {
    const limit = policy.traffic.TRAFFIC_PROVENANCE_ID_LIMIT;
    const rows = Array.from({ length: limit + 1 }, (_, i) => ({
      id: `gsc-${String(i).padStart(5, '0')}`,
      source_artifact_id: 'gsc-artifact',
      property_ref: String(i),
      provider: 'gsc',
      dataset: 'gsc_day_daily',
      date: WINDOW[1],
      dimension_key: WINDOW[1],
      resync_seq: 0,
      metrics: { clicks: 1, impressions: 10 },
    }));
    const ga4 = rows.map((r) => ({
      ...r,
      id: r.id.replace('gsc', 'ga4'),
      dataset: 'ga4_channel_daily',
      dimension_key: 'Organic Search | 20260728',
      metrics: { sessions: 2 },
    }));
    const projection = buildTrafficProjection({
      windowStart: WINDOW[0],
      windowEnd: WINDOW[1],
      granularity: 'day',
      rows: [...rows, ...ga4],
    });
    expect(projection.metrics.totals).toMatchObject({
      clicks: limit + 1,
      sessions: 2 * (limit + 1),
    });
    expect(projection.metrics.provenance).toMatchObject({
      metric_row_total: 2 * limit,
      metric_rows_sampled: true,
      sampled_stat_rows: 1,
    });
    expect(projection.dimensions[0]?.metrics.source_metric_row_count).toBe(limit + 1);
    expect(projection.source_metric_row_ids).toEqual(ga4.slice(0, limit).map((r) => r.id));
  });

  it('does not turn an empty provider page into the project root', () => {
    const projection = buildTrafficProjection({
      windowStart: WINDOW[0],
      windowEnd: WINDOW[1],
      granularity: 'day',
      projectOrigin: 'https://example.test',
      rows: [
        {
          id: 'row',
          source_artifact_id: 'artifact',
          property_ref: 'p',
          provider: 'gsc',
          dataset: 'gsc_page_daily',
          date: WINDOW[1],
          dimension_key: ` | ${WINDOW[1]}`,
          resync_seq: 0,
          metrics: { clicks: 3, impressions: 100 },
        },
      ],
    });
    expect(projection.pages).toEqual([]);
    expect(projection.dimension_counts.page).toBe(0);
    expect(projection.metrics.totals.clicks).toBeNull();
  });

  it('rejects non-finite and boolean provider numbers instead of coercing them', () => {
    const row = {
      id: 'row',
      source_artifact_id: 'artifact',
      property_ref: 'p',
      provider: 'gsc',
      dataset: 'gsc_day_daily',
      date: WINDOW[1],
      dimension_key: WINDOW[1],
      resync_seq: 0,
      metrics: { clicks: true, impressions: Number.NaN, position: Infinity },
    };
    const options = { windowStart: WINDOW[0], windowEnd: WINDOW[1], granularity: 'day' };
    expect(buildTrafficProjection({ ...options, rows: [row] }).metrics.totals).toMatchObject({
      clicks: 0,
      impressions: 0,
      position: null,
    });
    const builder = new TrafficProjectionBuilder(options);
    builder.addBatch([row]);
    expect(builder.build()).toEqual(buildTrafficProjection({ ...options, rows: [row] }));
  });
});
