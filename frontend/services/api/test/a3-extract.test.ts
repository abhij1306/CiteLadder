import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { Fixtures, testDatabase } from './support.ts';
import { seedImport, seedProject, type ImportSeed } from './referral-fixtures.ts';
import { tenant, task, requests, type Tenant } from './traffic-fixtures.ts';
import { refreshTrafficSnapshot } from '../src/traffic/snapshot.ts';
import { buildQueryEvidence } from '../src/demand/query-evidence.ts';
import { ingestReferrals } from '../src/referrals/ingest.ts';
import { classifyReferrals } from '../src/referrals/classify.ts';
import { refreshAiReferralsSnapshot } from '../src/referrals/snapshot.ts';
import { partitionQuality, selectedPartition } from '../src/integrations/partitions.ts';
import { getAiReferrals } from '../src/analytics/ai-referrals.ts';
import { pagesRead } from '../src/crawl-logs/pages.ts';
import { referralEvidence, referralExtras } from '../src/referrals/landing.ts';
import { policy } from '../src/config.ts';

const db = testDatabase(),
  fixtures = new Fixtures(db),
  day = '2026-10-02',
  window: [string, string] = [day, day];
const context = { db, maxAttempts: 3, checkCancelled: async () => {} };
let t: Tenant;
const providers = new Map<string, ImportSeed>();
beforeEach(async () => {
  t = await tenant(db, fixtures);
  providers.clear();
});

it('falls back from a legacy landing contract and flags wholly incompatible evidence', async () => {
  const current = await imported('ga4_landing_daily');
  const retained = await row(current, ['/guide', 'chatgpt.com', 'referral', 'example.test', day], {
    sessions: 4,
    keyEvents: 1,
  });
  const legacy = await imported('ga4_landing_daily', current, 1);
  await row(legacy, ['/guide', 'chatgpt.com', 'referral', day], { sessions: 100 });
  const oldDimensions = ['landingPage', 'sessionSource', 'sessionMedium', 'date'];
  await db
    .updateTable('integration_import_artifacts')
    .set({ query_snapshot: JSON.stringify({ dimensions: oldDimensions }) })
    .where('id', '=', legacy.artifactId)
    .execute();
  const scope = { workspaceId: t.workspaceId, projectId: t.projectId, start: day, end: day };
  const evidence = await referralEvidence(db, scope);
  expect(evidence.rows.map((r) => r.id)).toEqual([retained]);
  expect(evidence.quality.ga4_landing_daily?.[0]).toMatchObject({
    revision: 0,
    flags: expect.arrayContaining(['extract_contract_mismatch', 'partition_fallback']),
  });
  await db
    .updateTable('integration_import_artifacts')
    .set({ query_snapshot: JSON.stringify({ dimensions: oldDimensions }) })
    .where('id', '=', current.artifactId)
    .execute();
  const unavailable = await referralEvidence(db, scope);
  expect(unavailable.rows).toEqual([]);
  expect(unavailable.quality.ga4_landing_daily?.[0]).toMatchObject({
    revision: null,
    flags: expect.arrayContaining(['extract_contract_mismatch', 'unavailable']),
  });
  expect(referralExtras(unavailable, day, day).unattributed_landing).toBeNull();
});

it('joins mixed-case owned hosts and bounds deduplicated snapshot provenance without losing rollup IDs', async () => {
  const importedLanding = await imported('ga4_landing_daily');
  const metricId = await row(
    importedLanding,
    ['/guide?token=removed', 'chatgpt.com', 'referral', 'ExAmPlE.TeSt', day],
    { sessions: 4, keyEvents: 1 },
  );
  const evidence = await referralEvidence(db, {
    workspaceId: t.workspaceId,
    projectId: t.projectId,
    start: day,
    end: day,
  });
  const extras = referralExtras(evidence, day, day);
  expect(extras.landing[0]).toMatchObject({
    canonical_url: 'https://example.test/guide',
    sessions: 4,
    source_metric_row_ids: [metricId],
  });
  const metric = evidence.rows[0]!;
  const rows = Array.from({ length: policy.traffic.TRAFFIC_PROVENANCE_ID_LIMIT + 1 }, () => ({
    ...metric,
    id: randomUUID(),
    source_artifact_id: randomUUID(),
  }));
  const bounded = referralExtras({ ...evidence, rows: [...rows, rows[0]!] }, day, day);
  expect(bounded.source_metric_row_count).toBe(rows.length + 1);
  expect(bounded.source_artifact_ids).toHaveLength(policy.traffic.TRAFFIC_PROVENANCE_ID_LIMIT);
  expect(new Set(bounded.source_artifact_ids).size).toBe(bounded.source_artifact_ids.length);
  expect(bounded).not.toHaveProperty('source_metric_row_ids');
  expect(bounded.landing[0]?.source_metric_row_ids).toHaveLength(rows.length + 1);
});
afterAll(async () => {
  await fixtures.cleanup();
  await db.destroy();
});
async function imported(dataset: string, previous?: ImportSeed, revision = 0) {
  const provider = dataset.split('_')[0]!,
    base = providers.get(provider);
  const existing = base
    ? await db
        .selectFrom('integration_sync_runs')
        .select('id')
        .where('connection_id', '=', base.connectionId)
        .where('resync_seq', '=', revision)
        .executeTakeFirst()
    : null;
  let seed: ImportSeed;
  if (existing && base) {
    const old = await db
      .selectFrom('integration_import_artifacts')
      .selectAll()
      .where('id', '=', base.artifactId)
      .executeTakeFirstOrThrow();
    const artifactId = randomUUID();
    await db
      .insertInto('integration_import_artifacts')
      .values({ ...old, id: artifactId, sync_run_id: existing.id, dataset })
      .execute();
    seed = { ...base, dataset, syncRunId: existing.id, artifactId };
  } else
    seed = await seedImport(db, {
      ...t,
      dataset,
      window,
      previous: previous ?? base,
      resyncSeq: revision,
      provider,
    });
  if (!base) providers.set(provider, seed);
  await db
    .updateTable('integration_import_artifacts')
    .set({
      extract_metadata: JSON.stringify({
        timeZone: 'UTC',
        currencyCode: 'USD',
        analytics_quality: [],
        truncated: false,
      }),
    })
    .where('id', '=', seed.artifactId)
    .execute();
  return seed;
}
async function row(seed: ImportSeed, values: string[], metrics: Record<string, number>) {
  const run = await db
    .selectFrom('integration_sync_runs')
    .select(['resync_seq', 'property_ref'])
    .where('id', '=', seed.syncRunId)
    .executeTakeFirstOrThrow();
  const id = randomUUID();
  await db
    .insertInto('integration_metric_rows')
    .values({
      id,
      workspace_id: t.workspaceId,
      project_id: t.projectId,
      provider: seed.dataset.split('_')[0]!,
      property_ref: run.property_ref,
      dataset: seed.dataset,
      date: day,
      dimension_key: values.join(' | '),
      metrics: JSON.stringify(metrics),
      source_artifact_id: seed.artifactId,
      resync_seq: run.resync_seq,
      importer_version: '1',
      created_at: new Date(),
    })
    .execute();
  return id;
}
async function classify(seed: ImportSeed) {
  const queueTask = {
    ...(await task(db, t, 'ingest_referrals', window)),
    payload: { import_artifact_id: seed.artifactId },
  };
  await ingestReferrals(queueTask, context);
  await classifyReferrals({ ...queueTask, task_kind: 'classify_referrals' }, context);
}
describe('A3 integration partition replacement', () => {
  it.each(['traffic', 'referrals'] as const)(
    'retries %s publication when a resync commits between projection scans',
    async (owner) => {
      const first = await imported(
        owner === 'traffic' ? 'gsc_day_daily' : 'ga4_source_medium_daily',
      );
      await row(
        first,
        owner === 'traffic' ? [day] : ['chatgpt.com', 'referral', day],
        owner === 'traffic'
          ? { clicks: 99, impressions: 100 }
          : { sessions: 9, engagedSessions: 5, keyEvents: 2 },
      );
      if (owner === 'referrals') await classify(first);
      const executor = owner === 'traffic' ? refreshTrafficSnapshot : refreshAiReferralsSnapshot;
      const queueTask = await task(
        db,
        t,
        owner === 'traffic' ? 'traffic_snapshot_refresh' : 'ai_referrals_snapshot_refresh',
        window,
      );
      let replaced = false;
      await expect(
        executor(queueTask, {
          ...context,
          checkCancelled: async (boundary) => {
            if (
              !replaced &&
              boundary === (owner === 'traffic' ? 'snapshot write' : 'classification batch')
            ) {
              replaced = true;
              await imported(first.dataset, first, 1);
            }
          },
        }),
      ).rejects.toThrow(/partitions changed/);
      const table = owner === 'traffic' ? 'traffic_snapshots' : 'ai_referrals_snapshots';
      expect(
        await db.selectFrom(table).select('id').where('project_id', '=', t.projectId).execute(),
      ).toEqual([]);
      await executor(queueTask, context);
      if (owner === 'traffic') {
        const response = await requests(db, t)(`performance?range=custom&from=${day}&to=${day}`);
        expect(response.body.selected.totals.clicks).toBe(0);
      } else {
        const response = await getAiReferrals(db, {
          workspaceId: t.workspaceId,
          projectId: t.projectId,
          fromDate: day,
          toDate: day,
          rangeToken: null,
          granularity: 'day',
        });
        expect(response.referral_volume).toEqual([{ date: day, value: 0 }]);
      }
    },
  );
  it('preserves pending classification and reports source key events, property currency and channel populations', async () => {
    const source = await imported('ga4_source_medium_daily');
    await row(source, ['chatgpt.com', 'referral', day], {
      sessions: 4,
      engagedSessions: 2,
      keyEvents: 1,
    });
    await row(source, ['ordinary.example', 'referral', day], {
      sessions: 16,
      engagedSessions: 10,
      keyEvents: 6,
    });
    await refreshAiReferralsSnapshot(
      await task(db, t, 'ai_referrals_snapshot_refresh', window),
      context,
    );
    const read = () =>
      getAiReferrals(db, {
        workspaceId: t.workspaceId,
        projectId: t.projectId,
        fromDate: day,
        toDate: day,
        rangeToken: null,
        granularity: 'day',
      });
    expect((await read()).referral_volume[0]?.value).toBeNull();
    await classify(source);
    const channel = await imported('ga4_channel_daily');
    await row(channel, ['Organic Search', day], { sessions: 10, engagedSessions: 5, keyEvents: 2 });
    await row(channel, ['Direct', day], { sessions: 10, engagedSessions: 7, keyEvents: 5 });
    const commerce = await imported('ga4_ecommerce_source_medium_daily');
    await row(commerce, ['chatgpt.com', 'referral', day], {
      sessions: 4,
      transactions: 2,
      purchaseRevenue: 15.5,
    });
    await refreshAiReferralsSnapshot(
      await task(db, t, 'ai_referrals_snapshot_refresh', window),
      context,
    );
    const result = await read();
    expect(result.currency_code).toBe('USD');
    expect(result.source_measures).toEqual([
      {
        ai_source: 'chatgpt',
        sessions: 4,
        key_events: 1,
        engagement_rate: 0.5,
        transactions: 2,
        purchase_revenue: 15.5,
      },
    ]);
    expect(result.channel_comparison).toEqual([
      { channel: 'AI referrals', sessions: 4, key_events: 1, engagement_rate: 0.5 },
      { channel: 'Organic Search', sessions: 10, key_events: 2, engagement_rate: 0.5 },
      { channel: 'All other sessions', sessions: 6, key_events: 4, engagement_rate: 5 / 6 },
    ]);
  });
  it('carries flagged GA4 zeros as unavailable into landing, channel and Performance projections', async () => {
    const landing = await imported('ga4_landing_daily'),
      source = await imported('ga4_source_medium_daily'),
      channel = await imported('ga4_channel_daily');
    await row(landing, ['/zero', 'chatgpt.com', 'referral', 'example.test', day], {
      sessions: 0,
      engagedSessions: 0,
      keyEvents: 0,
    });
    await row(source, ['chatgpt.com', 'referral', day], {
      sessions: 0,
      engagedSessions: 0,
      keyEvents: 0,
    });
    await classify(source);
    await row(channel, ['Organic Search', day], { sessions: 0, engagedSessions: 0, keyEvents: 0 });
    for (const artifact of [landing, source, channel])
      await db
        .updateTable('integration_import_artifacts')
        .set({
          extract_metadata: JSON.stringify({
            timeZone: 'UTC',
            analytics_quality: ['thresholding'],
          }),
        })
        .where('id', '=', artifact.artifactId)
        .execute();
    await refreshAiReferralsSnapshot(
      await task(db, t, 'ai_referrals_snapshot_refresh', window),
      context,
    );
    const result = await getAiReferrals(db, {
      workspaceId: t.workspaceId,
      projectId: t.projectId,
      fromDate: day,
      toDate: day,
      rangeToken: null,
      granularity: 'day',
    });
    expect(result.landing_pages[0]).toMatchObject({ sessions: null, key_events: null });
    expect(result.unattributed_landing).toBeNull();
    expect(
      result.channel_comparison.every(
        (r) => r.sessions === null && r.key_events === null && r.engagement_rate === null,
      ),
    ).toBe(true);
    await refreshTrafficSnapshot(await task(db, t, 'traffic_snapshot_refresh', window), context);
    const performance = await requests(db, t)(`performance?range=custom&from=${day}&to=${day}`);
    expect(performance.body.selected.totals).toMatchObject({ sessions: null, key_events: null });
    expect(performance.body.coverage.analytics_quality.ga4_landing_daily?.[0]?.flags).toContain(
      'thresholding',
    );
  });
  it('replaces disappearing Performance and Demand identities, including an empty complete partition', async () => {
    const gsc = await imported('gsc_day_daily');
    await row(gsc, [day], { clicks: 99, impressions: 100 });
    await imported('gsc_day_daily', gsc, 1);
    await refreshTrafficSnapshot(await task(db, t, 'traffic_snapshot_refresh', window), context);
    const response = await requests(db, t)(`performance?range=custom&from=${day}&to=${day}`);
    expect(response.body.selected.totals.clicks).toBe(0);
    const query = await imported('gsc_query_page_daily');
    const gone = await row(query, ['gone', 'https://example.test/gone', day], {
      clicks: 1,
      impressions: 20,
      position: 12,
    });
    const newer = await imported('gsc_query_page_daily', query, 1);
    const retained = await row(newer, ['retained', 'https://example.test/retained', day], {
      clicks: 2,
      impressions: 30,
      position: 11,
    });
    const projection = await db.transaction().execute((trx) =>
      buildQueryEvidence(trx, {
        workspaceId: t.workspaceId,
        projectId: t.projectId,
        windowStart: day,
        windowEnd: day,
      }),
    );
    expect(projection.source_metric_row_ids).toEqual([retained]);
    expect(projection.source_metric_row_ids).not.toContain(gone);
  });
  it('replaces disappearing Referrals and landing rows without summing old revisions', async () => {
    const first = await imported('ga4_source_medium_daily');
    await row(first, ['chatgpt.com', 'referral', day], {
      sessions: 9,
      engagedSessions: 5,
      keyEvents: 2,
    });
    await classify(first);
    const newer = await imported('ga4_source_medium_daily', first, 1);
    await row(newer, ['ordinary.example', 'referral', day], {
      sessions: 10,
      engagedSessions: 5,
      keyEvents: 1,
    });
    await classify(newer);
    const landing = await imported('ga4_landing_daily');
    await row(landing, ['/gone', 'chatgpt.com', 'referral', 'example.test', day], {
      sessions: 9,
      keyEvents: 2,
      engagedSessions: 5,
    });
    await refreshAiReferralsSnapshot(
      await task(db, t, 'ai_referrals_snapshot_refresh', window),
      context,
    );
    await imported('ga4_landing_daily', landing, 1);
    expect(
      (
        await pagesRead(
          db,
          { workspaceId: t.workspaceId, projectId: t.projectId },
          { start_date: day, end_date: day },
        )
      ).items[0]?.referrals,
    ).toMatchObject({ state: 'flagged', value: 9, reason: 'projection_pending' });
    await refreshAiReferralsSnapshot(
      await task(db, t, 'ai_referrals_snapshot_refresh', window),
      context,
    );
    const result = await getAiReferrals(db, {
      workspaceId: t.workspaceId,
      projectId: t.projectId,
      fromDate: day,
      toDate: day,
      rangeToken: null,
      granularity: 'day',
    });
    expect(result.referral_volume).toEqual([{ date: day, value: 0 }]);
    expect(result.landing_pages).toEqual([]);
    expect(
      await db
        .selectFrom('ai_referral_landing_daily')
        .select('id')
        .where('project_id', '=', t.projectId)
        .execute(),
    ).toEqual([]);
  });
  it('falls back from failed and truncated partitions, flags missing evidence, and never publishes flagged zero', async () => {
    const first = await imported('ga4_source_medium_daily');
    await row(first, ['ordinary.example', 'referral', day], {
      sessions: 10,
      engagedSessions: 5,
      keyEvents: 0,
    });
    await classify(first);
    const failed = await imported('ga4_source_medium_daily', first, 1);
    await db
      .updateTable('integration_sync_runs')
      .set({ status: 'failed' })
      .where('id', '=', failed.syncRunId)
      .execute();
    await row(failed, ['chatgpt.com', 'referral', day], { sessions: 100 });
    expect(
      (
        await db
          .selectFrom('integration_metric_rows')
          .select('resync_seq')
          .where('project_id', '=', t.projectId)
          .where(selectedPartition())
          .execute()
      ).map((r) => r.resync_seq),
    ).toEqual([0]);
    const quality = await partitionQuality(
      db,
      { workspaceId: t.workspaceId, projectId: t.projectId, start: day, end: day },
      first.dataset,
    );
    expect(quality[0]?.flags).toContain('partition_fallback');
    await refreshAiReferralsSnapshot(
      await task(db, t, 'ai_referrals_snapshot_refresh', window),
      context,
    );
    expect(
      (
        await getAiReferrals(db, {
          workspaceId: t.workspaceId,
          projectId: t.projectId,
          fromDate: day,
          toDate: day,
          rangeToken: null,
          granularity: 'day',
        })
      ).referral_volume[0]?.value,
    ).toBeNull();
    const truncated = await imported(first.dataset, first, 2);
    await db
      .updateTable('integration_import_artifacts')
      .set({
        extract_metadata: JSON.stringify({ truncated: true, analytics_quality: ['invalid_rows'] }),
      })
      .where('id', '=', truncated.artifactId)
      .execute();
    expect(
      (
        await partitionQuality(
          db,
          { workspaceId: t.workspaceId, projectId: t.projectId, start: day, end: day },
          first.dataset,
        )
      )[0]?.revision,
    ).toBe(0);
  });
  it('classifies session-attributed landings, excludes other hosts and redacted paths, and scopes reads to the workspace', async () => {
    const landing = await imported('ga4_landing_daily');
    const base = { sessions: 3, engagedSessions: 2, keyEvents: 1 };
    await row(landing, ['/guide?secret=x', 'chatgpt.com', 'referral', 'example.test', day], base);
    await row(landing, ['/guide', 'chatgpt.com', 'referral', 'foreign.test', day], base);
    await row(landing, ['(not set)', 'claude.ai', 'referral', 'example.test', day], base);
    await row(landing, ['/ordinary', 'not-ai', 'referral', 'example.test', day], base);
    await refreshAiReferralsSnapshot(
      await task(db, t, 'ai_referrals_snapshot_refresh', window),
      context,
    );
    const rows = await db
      .selectFrom('ai_referral_landing_daily')
      .selectAll()
      .where('workspace_id', '=', t.workspaceId)
      .execute();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      canonical_url: 'https://example.test/guide',
      ai_source: 'chatgpt',
      sessions: 3,
      key_events: 1,
    });
    const foreign = await tenant(db, fixtures);
    const otherProject = await seedProject(db, t.workspaceId);
    const foreignTask = {
      ...(await task(db, { ...t, projectId: otherProject }, 'ingest_referrals', window)),
      payload: { import_artifact_id: landing.artifactId },
    };
    await expect(ingestReferrals(foreignTask, context)).rejects.toThrow(/unknown import artifact/);
    const result = await getAiReferrals(db, {
      workspaceId: foreign.workspaceId,
      projectId: t.projectId,
      fromDate: day,
      toDate: day,
      rangeToken: null,
      granularity: 'day',
    });
    expect(result.landing_pages).toEqual([]);
    const own = await getAiReferrals(db, {
      workspaceId: t.workspaceId,
      projectId: t.projectId,
      fromDate: day,
      toDate: day,
      rangeToken: null,
      granularity: 'day',
    });
    expect(own.unattributed_landing).toBe(3);
  });
});
