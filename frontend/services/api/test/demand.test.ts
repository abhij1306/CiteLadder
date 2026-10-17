import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { policy } from '../src/config.ts';
import { classifyProjectQueries } from '../src/demand/classification.ts';
import { resolveOwnedPages } from '../src/demand/page-equivalence.ts';
import { buildQueryEvidence } from '../src/demand/query-evidence.ts';
import { recomputeDemand } from '../src/demand/snapshot.ts';
import { hash } from '../src/traffic/normalization.ts';
import { enqueue, seedProject } from './referral-fixtures.ts';
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
  fixtures = new Fixtures(db),
  context = { db, maxAttempts: 3, checkCancelled: async () => {} };
let t: Tenant, request: ReturnType<typeof requests>;
beforeEach(async () => {
  t = await tenant(db, fixtures);
  request = requests(db, t);
});
afterAll(async () => {
  await fixtures.cleanup();
  await db.destroy();
});
const scope = () => ({
  workspaceId: t.workspaceId,
  projectId: t.projectId,
  windowStart: WINDOW[0],
  windowEnd: WINDOW[1],
});
async function demand(window = WINDOW, owner = t) {
  const row = await task(db, owner, 'demand_snapshot_refresh', window);
  await recomputeDemand(row, context);
  await db
    .updateTable('analytics_tasks')
    .set({ status: 'succeeded' })
    .where('id', '=', row.id)
    .execute();
  return row;
}
async function siteUrl(owner: Tenant, url: string) {
  const id = randomUUID();
  await db
    .insertInto('site_urls')
    .values({
      id,
      workspace_id: owner.workspaceId,
      project_id: owner.projectId,
      normalized_url: url,
      display_url: url,
      url_hash: hash(url),
      host: new URL(url).hostname,
      depth: 0,
      discovery_status: 'discovered',
      corpus_disposition: 'analyze',
      disposition_reason: 'html_content',
      disposition_version: '1',
      item_kind: 'html_page',
      latest_content_type: '',
      latest_source_kind: 'sitemap',
      latest_title: '',
      first_seen_at: new Date(),
      last_seen_at: new Date(),
    })
    .execute();
  return id;
}
/** A live or superseded opportunity for `targetKey`, joined to a new Action. */
async function promoted(targetKey: string, superseded: boolean) {
  const actionId = randomUUID(),
    now = new Date();
  await db
    .insertInto('actions')
    .values({
      id: actionId,
      workspace_id: t.workspaceId,
      project_id: t.projectId,
      group_key: `test:${actionId}`,
      target_kind: 'query',
      target_label: 'AI software',
      origin: 'evidence',
      status: 'open',
      families: JSON.stringify([]),
      approach: '',
      skill_id: '',
      diagnosis: JSON.stringify({}),
      member_opportunity_ids: JSON.stringify([]),
      created_at: now,
      updated_at: now,
    })
    .execute();
  await db
    .insertInto('opportunities')
    .values({
      id: randomUUID(),
      workspace_id: t.workspaceId,
      project_id: t.projectId,
      action_id: actionId,
      target_key: targetKey,
      rule_id: 'demand.test',
      rule_version: 'test',
      analyzer_version: 'test',
      formula_version: 'test',
      opportunity_type: 'demand',
      severity: 'medium',
      priority_score: 50,
      title: 'Promoted',
      remediation: '',
      superseded_at: superseded ? now : null,
      created_at: now,
      updated_at: now,
    })
    .execute();
  return actionId;
}

describe('demand projections and admission', () => {
  it('publishes source-linked demand and query evidence, retries idempotently, and keeps origin DAG handoffs', async () => {
    const seed = await importSeed(db, t, 'gsc_query_page_daily');
    const page = await siteUrl(t, 'https://example.test/page');
    const sourceId = await metric(db, seed, {
      values: ['AI software', 'https://example.test/page', WINDOW[1]],
      metrics: { impressions: 100, clicks: 0, position: 5.25 },
    });
    const row = await demand();
    const initial = await request('demand/latest');
    expect(initial.body.signals.map((r: { signal_type: string }) => r.signal_type)).toContain(
      'striking_distance',
    );
    expect(initial.body.source_metric_row_ids).toEqual([sourceId]);
    expect(initial.body.signals.every((r) => r.action_id === null)).toBe(true);
    const signal = await db
      .selectFrom('demand_signals')
      .select(['id', 'identity_hash'])
      .where('snapshot_id', '=', initial.body.id)
      .where('signal_type', '=', 'striking_distance')
      .executeTakeFirstOrThrow();
    await promoted(`demand:${signal.identity_hash}`, true);
    const live = await promoted(`demand:${signal.identity_hash}`, false);
    const linked = (await request('demand/latest')).body.signals;
    // Only the promoted signal links, and to its live opportunity's Action.
    expect(linked.filter((r) => r.action_id !== null).map((r) => [r.id, r.action_id])).toEqual([
      [signal.id, live],
    ]);
    const query = await request(
      `demand/query-evidence?window_start=${WINDOW[0]}&window_end=${WINDOW[1]}`,
    );
    expect(query.body.items[0]).toMatchObject({
      source_metric_row_id: sourceId,
      site_url_id: page,
      resolution_outcome: 'exact',
      clicks: 0,
    });
    await Promise.all([recomputeDemand(row, context), recomputeDemand(row, context)]);
    expect((await request('demand/latest')).body.id).toBe(initial.body.id);
    expect(
      await db
        .selectFrom('demand_snapshots')
        .select('id')
        .where('project_id', '=', t.projectId)
        .execute(),
    ).toHaveLength(1);
    const triggerId = randomUUID();
    await recomputeDemand(
      {
        ...row,
        payload: {
          ...(row.payload as object),
          downstream_trigger_kind: 'site_crawl',
          downstream_trigger_id: triggerId,
        },
      },
      context,
    );
    const handoff = await db
      .selectFrom('analytics_tasks')
      .select('payload')
      .where('project_id', '=', t.projectId)
      .where('idempotency_key', 'like', `opportunity:site_crawl:${triggerId}:%`)
      .executeTakeFirst();
    expect(handoff?.payload).toEqual({ trigger_kind: 'site_crawl', trigger_id: triggerId });
  });

  it('keeps unavailable and recorded zero distinct, and invalid source rows out of evidence', async () => {
    await demand();
    let page = await request(
      `demand/query-evidence?window_start=${WINDOW[0]}&window_end=${WINDOW[1]}`,
    );
    expect(page.body.snapshot.state).toBe('unavailable');
    const seed = await importSeed(db, t, 'gsc_query_page_daily');
    await db
      .updateTable('integration_import_artifacts')
      .set({
        query_snapshot: JSON.stringify({ start_date: WINDOW[0], end_date: WINDOW[1] }),
        row_count: 0,
      })
      .where('id', '=', seed.artifactId)
      .execute();
    await metric(db, seed, {
      values: ['valid', 'https://example.test/page', WINDOW[1]],
      metrics: { impressions: true, clicks: 0 },
    });
    await demand();
    page = await request(`demand/query-evidence?window_start=${WINDOW[0]}&window_end=${WINDOW[1]}`);
    expect(page.body.snapshot.state).toBe('unavailable');
    expect(page.body.items).toEqual([]);
    expect(page.body.snapshot.limitations).toContain('malformed_source_rows_excluded');
  });

  it('appends branded overrides, selects the newest, and leaves saved projections unchanged until requested', async () => {
    await demand();
    const before = (await request('demand/latest')).body;
    const url = 'demand/query-classification-overrides';
    const first = await request(url, {
      method: 'POST',
      body: { query: ' AI! Software ', classification: 'branded' },
    });
    const second = await request(url, {
      method: 'POST',
      body: { query: 'ai software', classification: 'non_branded' },
    });
    expect(first.response.status).toBe(201);
    expect(second.body.override_id).not.toBe(first.body.override_id);
    const resolved = await classifyProjectQueries(db, t.workspaceId, t.projectId, ['AI software']);
    expect(resolved.get('ai software')).toMatchObject({
      classification: 'non_branded',
      override_id: second.body.override_id,
    });
    expect(
      await db
        .selectFrom('branded_query_overrides')
        .select('id')
        .where('project_id', '=', t.projectId)
        .execute(),
    ).toHaveLength(2);
    expect((await request('demand/latest')).body).toEqual(before);
    const invalid = await request(url, {
      method: 'POST',
      body: { query: '!!!', classification: 'branded' },
    });
    expect(invalid.response.status).toBe(422);
    expect(invalid.body.error.details.errors[0]).toMatchObject({
      loc: ['query'],
      type: 'value_error',
    });
  });

  it('serializes manual admission, dedupes identical retries and rolls back capacity rejection', async () => {
    await demand();
    await demand(['2026-06-01', '2026-06-28']);
    const body = { window_start: WINDOW[0], window_end: WINDOW[1] };
    const responses = await Promise.all([
      request('demand/recompute', { method: 'POST', body }),
      request('demand/recompute', { method: 'POST', body }),
    ]);
    expect(responses.map((r) => r.body.status).sort()).toEqual(['already_queued', 'queued']);
    const rejected = await request('demand/recompute', {
      method: 'POST',
      body: { window_start: '2026-06-01', window_end: '2026-06-28' },
    });
    expect(rejected.response.status).toBe(429);
    expect(rejected.response.headers.get('retry-after')).toBeTruthy();
    const pending = await db
      .selectFrom('analytics_tasks')
      .select('id')
      .where('project_id', '=', t.projectId)
      .where('task_kind', '=', 'demand_snapshot_refresh')
      .where('status', '=', 'queued')
      .execute();
    expect(pending).toHaveLength(1);
    // Capacity is per project, and automatic refreshes never hold it.
    const second = { ...t, projectId: await seedProject(db, t.workspaceId) };
    await demand(WINDOW, second);
    await enqueue(db, {
      ...second,
      kind: 'demand_snapshot_refresh',
      payload: { window_start: '2026-06-01', window_end: '2026-06-28', manual: false },
    });
    const isolated = await request('demand/recompute', {
      method: 'POST',
      body,
      project: second.projectId,
    });
    expect(isolated.body.status).toBe('queued');
    const unsaved = await request('demand/recompute', {
      method: 'POST',
      body: { window_start: '2020-01-01', window_end: '2020-01-28' },
    });
    expect(unsaved.body.error.code).toBe('demand_window_not_saved');
  });

  it('scopes query paging, resolution and override writes to membership/project, and validates 422 locations', async () => {
    const foreign = await tenant(db, fixtures);
    await siteUrl(foreign, 'https://example.test/page');
    const seed = await importSeed(db, t, 'gsc_query_page_daily');
    for (let i = 0; i < 3; i++)
      await metric(db, seed, { values: [`q${i}`, 'https://example.test/page', WINDOW[1]] });
    await demand();
    const prefix = `demand/query-evidence?window_start=${WINDOW[0]}&window_end=${WINDOW[1]}`;
    const first = await request(`${prefix}&limit=2`),
      second = await request(`${prefix}&limit=2&cursor=${first.body.next_cursor}`);
    expect([...first.body.items, ...second.body.items]).toHaveLength(3);
    expect(
      first.body.items.every(
        (r: { resolution_outcome: string }) => r.resolution_outcome === 'unresolved',
      ),
    ).toBe(true);
    expect(
      (await resolveOwnedPages(db, t.workspaceId, t.projectId, ['https://example.test/page'])).get(
        'https://example.test/page',
      )?.outcome,
    ).toBe('unresolved');
    const invalid = await request(`${prefix}&cursor=bad`);
    expect(invalid.body.error.code).toBe('query_evidence_cursor_invalid');
    expect((await request('demand/query-evidence')).body.error.details.errors[0]).toMatchObject({
      loc: ['window_start'],
      type: 'missing',
    });
    for (const url of [
      'demand/latest',
      prefix,
      'demand/query-evidence/summary?window_start=2026-07-01&window_end=2026-07-28',
    ])
      expect((await request(url, { project: foreign.projectId })).response.status).toBe(404);
    const viewer = await fixtures.user();
    await fixtures.member(t.workspaceId, viewer, 'viewer');
    for (const suffix of ['recompute', 'query-classification-overrides'])
      expect(
        (await request(`demand/${suffix}`, { method: 'POST', user: viewer, body: {} })).response
          .status,
      ).toBe(403);
    expect(
      (
        await request('demand/query-classification-overrides', {
          method: 'POST',
          project: foreign.projectId,
          body: { query: 'test', classification: 'branded' },
        })
      ).response.status,
    ).toBe(404);
    const extra = await request('demand/recompute', {
      method: 'POST',
      body: { window_start: WINDOW[0], window_end: WINDOW[1], extra: 1 },
    });
    expect(extra.body.error.details.errors[0]).toMatchObject({
      loc: ['extra'],
      type: 'extra_forbidden',
    });
  });

  it('supersedes query evidence for re-syncs and recomputes classification without rewriting history', async () => {
    const seed = await importSeed(db, t, 'gsc_query_page_daily');
    const values = ['AI tools', 'https://example.test/page', WINDOW[1]];
    await siteUrl(t, values[1]!);
    await metric(db, seed, { values, metrics: { impressions: 100, clicks: 0, position: 5 } });
    await metric(db, seed, { values: ['Other tools', values[1]!, WINDOW[1]] });
    await demand();
    const path = `demand/query-evidence?window_start=${WINDOW[0]}&window_end=${WINDOW[1]}&limit=1`;
    const before = (await request(path)).body;
    const oldDemand = (await request('demand/latest')).body;
    const revisionId = await metric(db, seed, {
      values,
      revision: 1,
      metrics: { impressions: 200, clicks: 2, position: 5 },
    });
    await demand();
    const revised = (await request(`${path}&query=AI%20tools`)).body;
    expect(revised.snapshot.supersedes_snapshot_id).toBe(before.snapshot.id);
    expect(revised.items).toMatchObject([
      { impressions: 200, clicks: 2, source_metric_row_id: revisionId },
    ]);
    expect((await request(`${path}&cursor=${before.next_cursor}`)).response.status).toBe(422);
    const priorSignals = await db
      .selectFrom('demand_signals')
      .selectAll()
      .where('snapshot_id', '=', oldDemand.id)
      .execute();
    expect(priorSignals.some((r) => r.signal_type === 'striking_distance')).toBe(true);
    await request('demand/query-classification-overrides', {
      method: 'POST',
      body: { query: 'AI tools', classification: 'branded' },
    });
    await demand();
    const latest = (await request('demand/latest')).body;
    expect(
      latest.signals.filter(
        (r) => r.signal_type === 'striking_distance' && r.topic_cluster === 'ai tools',
      ),
    ).toEqual([]);
    expect(latest.source_hash).not.toBe(oldDemand.source_hash);
    expect(
      await db
        .selectFrom('demand_signals')
        .selectAll()
        .where('snapshot_id', '=', oldDemand.id)
        .execute(),
    ).toEqual(priorSignals);
    expect((await request(path)).body.snapshot.id).toBe(revised.snapshot.id);
  });

  it.each([
    ['bad', 'date_parsing'],
    ['2026-02-30', 'date_parsing'],
    ['2026-07-01T12:00:00Z', 'date_parsing'],
    [null, 'date_type'],
  ])('preserves date validation location and type for %s', async (date, type) => {
    const result = await request('demand/recompute', {
      method: 'POST',
      body: { window_start: date, window_end: WINDOW[1] },
    });
    expect(result.response.status).toBe(422);
    expect(result.body.error).toMatchObject({
      code: 'validation_error',
      details: { errors: [{ loc: ['window_start'], type }] },
    });
    if (date !== null)
      expect(
        (
          await request(
            `demand/query-evidence?window_start=${encodeURIComponent(date)}&window_end=${WINDOW[1]}`,
          )
        ).body.error.details.errors[0],
      ).toMatchObject({ loc: ['window_start'], type });
  });

  it.each([
    ['', [], 'missing'],
    ['null', [], 'missing'],
    ['{', ['1'], 'json_invalid'],
  ] as const)('validates raw body %s before projecting', async (rawBody, loc, type) => {
    const result = await request('demand/recompute', { method: 'POST', rawBody });
    expect(result.response.status).toBe(422);
    expect(result.body.error.details.errors).toMatchObject([{ loc, type }]);
  });

  it('reports missing enum fields as missing, not as invalid enum values', async () => {
    const result = await request('demand/query-classification-overrides', {
      method: 'POST',
      body: { query: 'tools' },
    });
    expect(result.response.status).toBe(422);
    expect(result.body.error.details.errors).toMatchObject([
      { loc: ['classification'], type: 'missing' },
    ]);
  });

  it('accepts ISO midnight dates without losing the requested calendar window', async () => {
    await demand();
    const result = await request('demand/recompute', {
      method: 'POST',
      body: { window_start: `${WINDOW[0]}T00:00:00Z`, window_end: `${WINDOW[1]}T00:00:00+05:30` },
    });
    expect(result.response.status).toBe(202);
  });

  it('caps rows before projection, keeping the highest-impression and newest rows', async () => {
    const seed = await importSeed(db, t, 'gsc_query_page_daily');
    const last = policy.demand.QUERY_EVIDENCE_MAX_ROWS;
    for (let offset = 0; offset <= last; offset += 500) {
      const rows = Array.from({ length: Math.min(500, last + 1 - offset) }, (_, i) => ({
        id: randomUUID(),
        workspace_id: t.workspaceId,
        project_id: t.projectId,
        property_ref: 'properties/123456789',
        provider: 'gsc',
        dataset: seed.dataset,
        // The alphabetically first row is the oldest; the last has most impressions.
        date: offset + i === 0 ? WINDOW[0] : WINDOW[1],
        dimension_key: `q${String(offset + i).padStart(5, '0')} | https://example.test/page | ${WINDOW[1]}`,
        metrics: JSON.stringify({ impressions: offset + i === last ? 1000 : 10, clicks: 0 }),
        source_artifact_id: seed.artifactId,
        resync_seq: 0,
        importer_version: 'test',
        created_at: new Date(),
      }));
      await db.insertInto('integration_metric_rows').values(rows).execute();
    }
    const snapshot = await db.transaction().execute((trx) => buildQueryEvidence(trx, scope()));
    expect(snapshot.coverage).toMatchObject({
      projected_row_count: policy.demand.QUERY_EVIDENCE_MAX_ROWS,
      truncated: true,
    });
    expect(snapshot.limitations).toContain('query_evidence_row_limit');
    const kept = await db
      .selectFrom('query_evidence_rows')
      .select('normalized_query')
      .where('snapshot_id', '=', snapshot.id)
      .where('normalized_query', 'in', ['q00000', `q${String(last).padStart(5, '0')}`])
      .execute();
    expect(kept.map((r) => r.normalized_query)).toEqual([`q${String(last).padStart(5, '0')}`]);
    // Seeds the full row cap; parallel suites need more than the default budget.
  }, 30_000);
});
