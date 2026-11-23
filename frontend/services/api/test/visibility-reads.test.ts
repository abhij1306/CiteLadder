/**
 * The selection reads moved over HTTP: the dashboard, prompt
 * scores, trends, query fanout, the Sources table and per-answer evidence.
 *
 * Runs against the real PostgreSQL schema, with workspace isolation on every route.
 */
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { policy } from '../src/config.ts';
import type { Json, Tenant } from './visibility-fixtures.ts';
import { compareSelection } from '../src/visibility/comparison.ts';
import { record } from '../src/db/json.ts';
import { sql } from 'kysely';
import { frozen, route, visibilityReads, type Row } from './visibility-read-support.ts';

const { db, fixtures, get, measuredRun, newMarket } = visibilityReads();

function aggregate(input: {
  completed: number;
  brand: number;
  owned?: number;
  globex?: number;
  expected?: number;
}): Record<string, unknown> {
  const { completed, brand, owned = 0, globex = 0 } = input;
  return {
    total_completed: completed,
    brand_mention_count: brand,
    owned_citation_response_count: owned,
    brand_mention_rate: brand / completed,
    owned_citation_rate: owned / completed,
    competitor_mention_rate: { Globex: globex / completed },
    competitor_citation_rate: { Globex: 0 },
    share_of_voice: { mention_counts: { 'Acme Corp': brand, Globex: globex } },
    coverage: { requested: input.expected ?? completed, failed: 0, not_run: 0 },
    per_prompt: [{ composite_score: 60 }, { composite_score: 40 }],
  };
}

async function runsInOwnMarket(tenant: Tenant, cited: { baseline: string; current: string }) {
  const marketId = await newMarket(tenant);
  const complete = aggregate({ completed: 1, brand: 0 });
  const run = async (completedAt: string, url: string) => {
    const auditId = await measuredRun(tenant, completedAt, complete);
    await fixtures.execution(tenant, { auditId, analysis: { citations: [{ url }] } });
    return auditId;
  };
  const baseline = await run('2026-02-01T00:00:00Z', cited.baseline);
  const current = await run('2026-03-01T00:00:00Z', cited.current);
  await db
    .updateTable('audits')
    .set({ market_id: marketId })
    .where('id', 'in', [baseline, current])
    .execute();
  return { baseline, current };
}

afterAll(async () => {
  await fixtures.cleanup();
  await db.destroy();
});

it('measures the baseline walk over 100 runs with alternating frozen routes', async () => {
  const tenant = await fixtures.tenant();
  const metrics = aggregate({ completed: 2, brand: 1 });
  const configuration = (index: number): Json => ({
    ...frozen(),
    engine_routes: {
      chatgpt: {
        transport_provider: 'test',
        transport_model: index % 2 ? 'model-b' : 'model-a',
      },
    },
  });
  const run = (index: number, finalize: boolean) =>
    measuredRun(tenant, new Date(Date.UTC(2026, 0, 1) + index * 86400000).toISOString(), metrics, {
      configuration: configuration(index),
      finalize,
    });
  const ids = await Promise.all(Array.from({ length: 99 }, (_, index) => run(index, false)));
  ids.push(await run(99, true));
  const currentConfiguration = configuration(99);
  let cellQueries = 0;
  const counted = db.withPlugin({
    transformQuery({ node }) {
      const selections = record(node).selections;
      if (
        Array.isArray(selections) &&
        selections.some(
          (selection) =>
            record(record(record(selection).selection).column).column &&
            record(record(record(record(selection).selection).column).column).name ===
              'request_snapshot',
        )
      )
        cellQueries++;
      return node;
    },
    transformResult: async ({ result }) => result,
  });
  const comparison = await compareSelection(
    counted,
    tenant,
    {
      auditId: ids[99]!,
      workspaceId: tenant.workspaceId,
      configuration: currentConfiguration,
      completedAt: new Date(Date.UTC(2026, 0, 1) + 99 * 86400000).toISOString().replace(/Z$/u, ''),
      analyzerVersion: 'test',
      scoringRuleVersion: 'test',
      metrics,
    },
    { cohort: 'core', engine: null, baselineId: null },
  );
  console.info(`100 alternating-route runs, loadComparisonCells calls = ${cellQueries}`);
  expect(comparison).toMatchObject({ baseline_audit_id: ids[97], skipped_runs: 1 });
  expect(cellQueries).toBeLessThan(10);
});

describe('workspace isolation', () => {
  it('answers every moved read for a foreign project as not found', async () => {
    const tenant = await fixtures.tenant();
    const outsider = await fixtures.tenant();
    for (const suffix of ['', '/prompts', '/trends', '/fanout', '/sources', '/evidence']) {
      const { status, body } = await get(outsider, route(tenant, suffix));
      expect([suffix, status, record(body.error).message]).toEqual([
        suffix,
        404,
        'Project not found',
      ]);
    }
  });
});

describe('GET /visibility', () => {
  let tenant: Tenant;
  let baseline: string;
  let latest: string;

  beforeAll(async () => {
    tenant = await fixtures.tenant();
    await fixtures.brand(tenant.projectId, 'Acme Corp', true);
    await fixtures.competitor(tenant.projectId, { name: 'Globex', domains: ['globex.example'] });
    baseline = await measuredRun(
      tenant,
      '2026-03-01T00:00:00Z',
      aggregate({ completed: 4, brand: 2, owned: 1, globex: 2 }),
    );
    latest = await measuredRun(
      tenant,
      '2026-03-08T00:00:00Z',
      {
        ...aggregate({ completed: 4, brand: 3, owned: 2, globex: 1 }),
        comparison: aggregate({ completed: 2, brand: 2 }),
      },
      { visibilityScore: 70 },
    );
    await fixtures.execution(tenant, {
      auditId: latest,
      analysis: { brandMentioned: false, competitorMentions: ['Globex'] },
    });
  });

  it('projects the latest run against its nearest compatible baseline', async () => {
    const { status, body } = await get(tenant, route(tenant));

    expect(status).toBe(200);
    expect(body).toMatchObject({
      audit_id: latest,
      selection_mode: 'latest',
      visibility_rate: 0.75,
      owned_citation_rate: 0.5,
      visibility_score: 70,
      prompt_performance_score: 50,
      counts: { responses: 4, brand_responses: 3, expected: 4 },
    });
    expect(body.comparison).toMatchObject({
      status: 'comparable',
      baseline_audit_id: baseline,
      baseline_at: '2026-03-01T00:00:00Z',
      deltas: { visibility: 25, owned_citation: 25 },
    });
    const [brand, globex] = body.rankings as Row[];
    expect(brand).toMatchObject({
      name: 'Acme Corp',
      is_brand: true,
      share_of_voice: 0.75,
      logo_url: `/api/v1/projects/${tenant.projectId}/logo`,
      website_url: 'https://acme.example',
      visibility_delta: 25,
      gap_count: null,
    });
    expect(globex).toMatchObject({
      name: 'Globex',
      website_url: 'https://globex.example',
      gap_count: 1,
    });
  });

  it("reads a cohort's own aggregate, and a single engine's slice has no stored score", async () => {
    const comparison = await get(tenant, route(tenant), { cohort: 'comparison' });
    expect(comparison.body).toMatchObject({ cohort: 'comparison', visibility_rate: 1 });

    const engine = await get(tenant, route(tenant), { engine: 'chatgpt' });
    expect(engine.body).toMatchObject({ visibility_score: null, visibility_rate: 0.75 });
    expect((engine.body.per_engine as Row[]).map((row) => row.logical_engine)).toEqual(['chatgpt']);
  });

  it('reports failed answers as unknown when the run recorded no coverage', async () => {
    const unrecorded = await fixtures.tenant();
    const { coverage: _coverage, ...withoutCoverage } = aggregate({ completed: 2, brand: 1 });
    await measuredRun(unrecorded, '2026-03-02T09:00:00Z', withoutCoverage);
    const unknown = await get(unrecorded, route(unrecorded));
    expect(unknown.body).toMatchObject({ total_completed: 2, total_failed: null });

    const recorded = await fixtures.tenant();
    await measuredRun(recorded, '2026-03-02T09:00:00Z', aggregate({ completed: 2, brand: 1 }));
    const measured = await get(recorded, route(recorded));
    expect(measured.body).toMatchObject({ total_completed: 2, total_failed: 0 });
  });

  it('compares share of voice at the mention level, as the tile shows it', async () => {
    const tenant = await fixtures.tenant();
    const withMentions = (brand: number, globex: number) => ({
      ...aggregate({ completed: 4, brand: 2, globex: 2 }),
      share_of_voice: { mention_counts: { 'Acme Corp': brand, Globex: globex } },
    });
    await measuredRun(tenant, '2026-03-02T09:00:00Z', withMentions(1, 1));
    await measuredRun(tenant, '2026-03-09T09:00:00Z', withMentions(3, 1));
    const { body } = await get(tenant, route(tenant));
    expect(body.comparison).toMatchObject({ status: 'comparable', deltas: { sov: 25 } });
  });

  it('answers nothing measured, metrics still being written and a missing run each with its own code', async () => {
    const answer = async (who: Tenant, path: string, query: Record<string, string> = {}) => {
      const { status, body } = await get(who, path, query);
      return [status, record(body.error).code];
    };
    const empty = await fixtures.tenant();
    expect(await answer(empty, route(empty))).toEqual([404, 'visibility_not_measured']);
    expect(await answer(empty, route(empty, '/perception'))).toEqual([
      404,
      'visibility_not_measured',
    ]);
    expect(
      await answer(tenant, route(tenant), {
        selection_mode: 'range',
        from: '2020-01-01T00:00:00Z',
        to: '2020-01-08T00:00:00Z',
      }),
    ).toEqual([404, 'visibility_not_measured']);

    const pending = await fixtures.tenant();
    const unwritten = await fixtures.audit(pending, {
      completedAt: new Date('2026-03-10T00:00:00Z'),
      configuration: frozen(),
    });
    expect(await answer(pending, route(pending))).toEqual([404, 'visibility_metrics_pending']);
    expect(await answer(pending, route(pending), { audit_id: unwritten })).toEqual([
      404,
      'visibility_metrics_pending',
    ]);

    expect(await answer(tenant, route(tenant), { audit_id: randomUUID() })).toEqual([
      404,
      'not_found',
    ]);
    expect(await answer(empty, route(empty), { audit_id: unwritten })).toEqual([404, 'not_found']);
    expect(await answer(empty, route(pending))).toEqual([404, 'not_found']);
  });

  it('rejects a malformed selection', async () => {
    expect((await get(tenant, route(tenant), { selection_mode: 'run' })).status).toBe(422);
    expect((await get(tenant, route(tenant), { engine: 'altavista' })).status).toBe(422);
  });

  it('pools one configuration over a period and compares the period before it', async () => {
    const pooled = await fixtures.tenant();
    const wholeSet = (at: string, brand: number) =>
      measuredRun(pooled, at, aggregate({ completed: 4, brand }));
    const before = await wholeSet('2026-03-28T00:00:00Z', 1);
    const first = await wholeSet('2026-04-02T00:00:00Z', 2);
    const second = await wholeSet('2026-04-05T00:00:00Z', 4);
    await measuredRun(pooled, '2026-04-06T00:00:00Z', aggregate({ completed: 1, brand: 0 }), {
      configuration: frozen({ panel_hash: 'panel-subset', prompt_selection: 'selected' }),
    });

    const { status, body } = await get(pooled, route(pooled), {
      selection_mode: 'range',
      from: '2026-04-01T00:00:00Z',
      to: '2026-04-08T00:00:00Z',
    });

    expect(status).toBe(200);
    expect(body).toMatchObject({
      selection_mode: 'range',
      audit_id: second,
      source_audit_ids: [first, second],
      from_at: '2026-04-01T00:00:00Z',
      visibility_rate: 0.75,
      visibility_score: null,
      coverage: { requested: 8, completed: 8, rate: 1 },
    });
    expect(body).not.toHaveProperty('citation_totals');
    expect(body.comparison).toMatchObject({
      status: 'comparable',
      baseline_audit_ids: [before],
      baseline_at: '2026-03-25T00:00:00Z',
      deltas: { visibility: 50 },
    });
  });
});

describe('GET /visibility/trends', () => {
  it('folds a week, weighting each rate by the responses behind it', async () => {
    const tenant = await fixtures.tenant();
    const monday = await measuredRun(
      tenant,
      '2026-03-02T09:00:00Z',
      aggregate({ completed: 4, brand: 2 }),
    );
    const wednesday = await measuredRun(
      tenant,
      '2026-03-04T09:00:00Z',
      aggregate({ completed: 2, brand: 2 }),
    );

    const raw = await get(tenant, route(tenant, '/trends'));
    expect(raw.body.map((point) => point.audit_id)).toEqual([monday, wednesday]);

    const weekly = await get(tenant, route(tenant, '/trends'), { granularity: 'week' });
    expect(weekly.body).toHaveLength(1);
    expect(weekly.body[0]).toMatchObject({
      audit_id: null,
      completed_at: '2026-03-02T00:00:00Z',
      run_count: 2,
      source_audit_ids: [monday, wednesday],
      counts: { responses: 6, brand_responses: 4 },
      spans_version_boundary: false,
    });
    expect(weekly.body[0]!.visibility_rate).toBeCloseTo(4 / 6);

    expect((await get(tenant, route(tenant, '/trends'), { engine: 'claude' })).body).toEqual([]);
    const invalid = await get(tenant, route(tenant, '/trends'), { granularity: 'hour' });
    expect([invalid.status, record(invalid.body.error).message]).toEqual([
      422,
      'Unsupported granularity: hour',
    ]);
  });

  it('caps points after bucketing, so every week survives a run-heavy period', async () => {
    const tenant = await fixtures.tenant();
    const runs = 105;
    for (let index = 0; index < runs; index++)
      await measuredRun(
        tenant,
        new Date(Date.UTC(2026, 2, 2, 0, 0) + index * 60_000).toISOString(),
        aggregate({ completed: 2, brand: 1 }),
      );
    const early = await measuredRun(
      tenant,
      '2026-02-16T09:00:00Z',
      aggregate({ completed: 2, brand: 1 }),
    );
    const weekly = await get(tenant, route(tenant, '/trends'), { granularity: 'week' });
    expect(weekly.body.map((point) => point.run_count)).toEqual([1, runs]);
    expect(weekly.body[0]!.source_audit_ids).toEqual([early]);
    expect(weekly.body[1]!.sov).not.toHaveProperty('response');
    expect(weekly.body[1]!.sov).toHaveProperty('mention');
    expect(
      weekly.body.map((point) => (point.rankings as { sentiment: unknown }[])[0]?.sentiment),
    ).toEqual([null, null]);
  }, 60_000);

  it('reads the newest trend_max_runs runs and never folds part of a cut bucket', async () => {
    const tenant = await fixtures.tenant();
    const metrics = aggregate({ completed: 2, brand: 1 });
    const ids: string[] = [];
    for (const day of ['2026-03-02', '2026-03-10', '2026-03-11', '2026-03-16', '2026-03-17'])
      ids.push(await measuredRun(tenant, `${day}T09:00:00Z`, metrics));
    const bound = policy.visibility.trend_max_runs;
    policy.visibility.trend_max_runs = 3;
    try {
      const raw = await get(tenant, route(tenant, '/trends'));
      expect(raw.body.map((point) => point.audit_id)).toEqual(ids.slice(2));
      const weekly = await get(tenant, route(tenant, '/trends'), { granularity: 'week' });
      expect(weekly.body.map((point) => [point.completed_at, point.source_audit_ids])).toEqual([
        ['2026-03-16T00:00:00Z', ids.slice(3)],
      ]);
    } finally {
      policy.visibility.trend_max_runs = bound;
    }
  });

  it('applies the slice before the run bound, so a narrow slice reaches its older runs', async () => {
    const tenant = await fixtures.tenant();
    const metrics = aggregate({ completed: 2, brand: 1 });
    const retrievalOff = frozen({
      measurement_policy: {
        retrieval_enabled: false,
        max_output_tokens: 1000,
        answer_instruction: '',
      },
    });
    const off: string[] = [];
    for (const day of ['2026-02-02', '2026-02-03'])
      off.push(
        await measuredRun(tenant, `${day}T09:00:00Z`, metrics, { configuration: retrievalOff }),
      );
    for (const day of ['2026-03-02', '2026-03-03', '2026-03-04', '2026-03-05'])
      await measuredRun(tenant, `${day}T09:00:00Z`, metrics);
    const bound = policy.visibility.trend_max_runs;
    policy.visibility.trend_max_runs = 3;
    try {
      const { body } = await get(tenant, route(tenant, '/trends'), { retrieval_enabled: 'false' });
      expect(body.map((point) => point.audit_id)).toEqual(off);
    } finally {
      policy.visibility.trend_max_runs = bound;
    }
  });

  it('folds each analyzer version into its own point, never one blend', async () => {
    const tenant = await fixtures.tenant();
    await measuredRun(tenant, '2026-03-02T09:00:00Z', aggregate({ completed: 4, brand: 2 }), {
      analyzerVersion: 'v1',
    });
    await measuredRun(tenant, '2026-03-03T09:00:00Z', aggregate({ completed: 4, brand: 2 }), {
      analyzerVersion: 'v2',
    });

    const { body } = await get(tenant, route(tenant, '/trends'), { granularity: 'week' });
    expect(body.map((point) => [point.run_count, point.analyzer_versions])).toEqual([
      [1, ['v1']],
      [1, ['v2']],
    ]);
    expect(body.some((point) => point.spans_version_boundary)).toBe(false);
  });

  it('slices by frozen retrieval state before folding', async () => {
    const tenant = await fixtures.tenant();
    await measuredRun(tenant, '2026-03-02T09:00:00Z', aggregate({ completed: 4, brand: 2 }));
    const off = await measuredRun(
      tenant,
      '2026-03-03T09:00:00Z',
      aggregate({ completed: 4, brand: 2 }),
      {
        configuration: frozen({
          measurement_policy: {
            retrieval_enabled: false,
            max_output_tokens: 1000,
            answer_instruction: '',
          },
        }),
      },
    );

    const { body } = await get(tenant, route(tenant, '/trends'), { retrieval_enabled: 'false' });
    expect(body.map((point) => point.audit_id)).toEqual([off]);
  });
});
describe('GET /visibility/fanout and /visibility/evidence', () => {
  let tenant: Tenant;
  let auditId: string;
  let pricingTask: string;
  let artifactTask: string;

  beforeAll(async () => {
    tenant = await fixtures.tenant();
    auditId = await fixtures.audit(tenant);
    const at = (minute: number) => new Date(`2026-03-01T10:${String(minute).padStart(2, '0')}:00Z`);
    pricingTask = (
      await fixtures.execution(tenant, {
        auditId,
        engine: 'chatgpt',
        taskEvents: [{ query: 'Best CRM' }, { query: 'crm pricing' }, {}],
        analysis: { brandMentioned: true, createdAt: at(1), brandMentions: ['Acme Corp'] },
      })
    ).taskId;
    artifactTask = (
      await fixtures.execution(tenant, {
        auditId,
        engine: 'claude',
        taskEvents: [{ query: 'ignored' }],
        artifactEvents: [{ query: 'best crm', sequence: '2' }],
        analysis: {
          createdAt: at(2),
          competitorMentions: ['Globex'],
          citations: [{ url: 'https://globex.example/x', matched: 'Globex' }],
        },
      })
    ).taskId;
    await fixtures.execution(tenant, {
      auditId,
      engine: 'gemini',
      analysis: { createdAt: at(3), searchUsed: true, searchQueryCount: 2 },
    });
    await fixtures.execution(tenant, {
      auditId,
      engine: 'chatgpt_search',
      providerMetadata: { fanout_availability: 'unavailable' },
      analysis: { createdAt: at(4) },
    });
  });

  it('totals the whole selection whatever the search or page', async () => {
    const all = await get(tenant, route(tenant, '/fanout'), { audit_id: auditId });
    expect(all.body).toMatchObject({
      event_count: 3,
      distinct_queries: 3,
      matched_queries: 3,
      coverage: { queries_available: 2, count_only: 1, unavailable: 1 },
    });

    const searched = await get(tenant, route(tenant, '/fanout'), {
      audit_id: auditId,
      search: 'BEST',
      limit: '1',
    });
    expect(searched.body).toMatchObject({
      distinct_queries: 3,
      matched_queries: 2,
    });
    expect(searched.body.items as Row[]).toHaveLength(1);
    expect(searched.body.next_cursor).toEqual(expect.any(String));
    const next = await get(tenant, route(tenant, '/fanout'), {
      audit_id: auditId,
      search: 'BEST',
      limit: '1',
      cursor: searched.body.next_cursor as string,
    });
    expect(next.body).toMatchObject({
      event_count: 3,
      distinct_queries: 3,
      matched_queries: 2,
      next_cursor: null,
    });
    expect((next.body.items as Row[])[0]!.query).not.toBe((searched.body.items as Row[])[0]!.query);
    expect(
      (
        await get(tenant, route(tenant, '/fanout'), {
          audit_id: auditId,
          search: 'pricing',
          cursor: searched.body.next_cursor as string,
        })
      ).status,
    ).toBe(422);

    const drilled = await get(tenant, route(tenant, '/fanout'), {
      audit_id: auditId,
      query: '  crm pricing  ',
    });
    expect(drilled.body).toMatchObject({ total_answers: 1, answers: [{ task_id: pricingTask }] });
  });

  it('pools persisted queries across runs, retaining duplicates and paging each answer once', async () => {
    const pooled = await fixtures.tenant();
    const runs: string[] = [];
    const tasks: string[] = [];
    for (let index = 0; index < 2; index++) {
      const run = await fixtures.audit(pooled);
      runs.push(run);
      const execution = await fixtures.execution(pooled, {
        auditId: run,
        artifactEvents: [{ query: '  crm  ' }, { query: 'crm' }, { sequence: 3 }],
        analysis: { brandMentioned: index === 0 },
      });
      tasks.push(execution.taskId);
    }
    const first = await get(pooled, route(pooled, '/fanout'), {
      audit_ids: runs,
      query: 'crm',
      limit: '1',
    });
    expect(first.body).toMatchObject({
      event_count: 6,
      distinct_queries: 1,
      total_answers: 2,
      coverage: { queries_available: 2 },
      items: [{ query: 'crm', event_count: 4, response_count: 2, brand_response_count: 1 }],
    });
    const next = await get(pooled, route(pooled, '/fanout'), {
      audit_ids: runs,
      query: 'crm',
      limit: '1',
      cursor: first.body.next_cursor as string,
    });
    expect(next.body).toMatchObject({ event_count: 6, total_answers: 2, next_cursor: null });
    expect(
      [...(first.body.answers as Row[]), ...(next.body.answers as Row[])]
        .map((row) => row.task_id)
        .sort(),
    ).toEqual(tasks.sort());
  });

  it('serves normalized evidence newest first, one keyset page at a time', async () => {
    const first = await get(tenant, route(tenant, '/evidence'), {
      audit_id: auditId,
      limit: '2',
    });
    expect(first.body).toMatchObject({ total: 4, truncated: true });
    const items = first.body.items as Row[];
    expect(items.map((item) => item.logical_engine)).toEqual(['chatgpt_search', 'gemini']);
    expect(items.map((item) => item.state)).toEqual(['unavailable', 'count_only']);

    const second = await get(tenant, route(tenant, '/evidence'), {
      audit_id: auditId,
      limit: '2',
      cursor: first.body.next_cursor as string,
      as_of: first.body.as_of as string,
    });
    const [claude, chatgpt] = second.body.items as Row[];
    expect(second.body.total).toBe(4);
    expect(second.body.truncated).toBe(false);
    expect(claude).toMatchObject({
      task_id: artifactTask,
      event_source: 'raw_artifact',
      search_events: [{ query: 'best crm', sequence: 2 }],
      mentions: [{ kind: 'competitor', name: 'Globex' }],
      citations: [{ url: 'https://globex.example/x', matched_competitor: 'Globex' }],
    });
    expect(chatgpt).toMatchObject({ event_source: 'audit_task', state: 'queries_available' });
    expect(chatgpt!.search_events as Row[]).toHaveLength(2);

    const moved = await get(tenant, route(tenant, '/evidence'), {
      audit_id: auditId,
      limit: '2',
      cursor: first.body.next_cursor as string,
    });
    expect([moved.status, record(moved.body.error).message]).toEqual([
      422,
      'Invalid evidence cursor for this selection',
    ]);
  });

  it('filters by outcome and competitor, and a gap needs its competitor', async () => {
    const gaps = await get(tenant, route(tenant, '/evidence'), {
      audit_id: auditId,
      outcome: 'competitor_gap',
      competitor: 'Globex',
    });
    expect((gaps.body.items as Row[]).map((item) => item.task_id)).toEqual([artifactTask]);
    expect(
      (await get(tenant, route(tenant, '/evidence'), { outcome: 'competitor_gap' })).status,
    ).toBe(422);
  });

  it('keeps frozen prompt options at the same microsecond cutoff as evidence', async () => {
    const precise = await fixtures.tenant();
    const run = await fixtures.audit(precise);
    const execution = await fixtures.execution(precise, {
      auditId: run,
      promptText: 'Precise prompt',
    });
    const at = sql<Date>`'2026-03-01T00:00:00.000500Z'::timestamptz`;
    await db
      .updateTable('audit_prompt_snapshots')
      .set({ created_at: at })
      .where('audit_id', '=', run)
      .execute();
    await db
      .updateTable('response_analyses')
      .set({ created_at: at })
      .where('id', '=', execution.analysisId!)
      .execute();
    const result = await get(precise, route(precise, '/evidence'), {
      audit_id: run,
      as_of: '2026-03-01T00:00:00.000750Z',
    });
    expect(result.body).toMatchObject({
      total: 1,
      items: [{ task_id: execution.taskId }],
      prompt_options: [{ label: 'Precise prompt' }],
    });
  });

  it("offers only brand runs' prompts in the prompt filter", async () => {
    const shop = await fixtures.tenant();
    const brand = await fixtures.audit(shop);
    const commerce = await fixtures.audit(shop, { scope: 'commerce' });
    await fixtures.execution(shop, { auditId: brand, promptText: 'Best index fund?' });
    await fixtures.execution(shop, { auditId: commerce, promptText: 'Cheapest running shoes?' });

    const { body } = await get(shop, route(shop, '/evidence'), {});
    expect(body).toMatchObject({ total: 1, prompt_options: [{ label: 'Best index fund?' }] });
    expect(body.prompt_options).toHaveLength(1);
  });
});

describe('GET /visibility/sources', () => {
  it('pages a multi-run selection in both directions with stable totals and bound filters', async () => {
    const tenant = await fixtures.tenant();
    const runs: string[] = [];
    for (let i = 0; i < 2; i++) {
      const auditId = await fixtures.audit(tenant);
      runs.push(auditId);
      await fixtures.execution(tenant, {
        auditId,
        analysis: {
          citations: [
            { url: 'https://a.example/1', sourceClass: 'news' },
            { url: `https://${i ? 'c' : 'b'}.example/1`, sourceClass: 'news' },
          ],
        },
      });
      await fixtures.sourceAggregates(tenant, auditId);
    }
    const first = await get(tenant, route(tenant, '/sources'), { audit_ids: runs, limit: '1' });
    expect(first.body).toMatchObject({
      total: 3,
      responses: 2,
      total_citations: 4,
      category_totals: { news: 4 },
      previous_cursor: null,
      items: [{ key: 'a.example', responses: 2 }],
    });
    const second = await get(tenant, route(tenant, '/sources'), {
      audit_ids: [...runs].reverse(),
      limit: '1',
      cursor: first.body.next_cursor as string,
    });
    expect(second.body).toMatchObject({
      total: 3,
      responses: 2,
      total_citations: 4,
      category_totals: { news: 4 },
      items: [{ key: 'b.example' }],
    });
    const last = await get(tenant, route(tenant, '/sources'), {
      audit_ids: runs,
      limit: '1',
      cursor: second.body.next_cursor as string,
    });
    expect(last.body).toMatchObject({ next_cursor: null, items: [{ key: 'c.example' }] });
    const back = await get(tenant, route(tenant, '/sources'), {
      audit_ids: runs,
      limit: '1',
      cursor: last.body.previous_cursor as string,
    });
    expect(back.body.items).toEqual(second.body.items);
    const start = await get(tenant, route(tenant, '/sources'), {
      audit_ids: runs,
      limit: '1',
      cursor: back.body.previous_cursor as string,
    });
    expect(start.body).toMatchObject({ previous_cursor: null, items: first.body.items });
    expect(
      (
        await get(tenant, route(tenant, '/sources'), {
          audit_ids: runs,
          limit: '1',
          domain: 'a.example',
          cursor: first.body.next_cursor as string,
        })
      ).status,
    ).toBe(422);
  });
  it('counts domains, then pages with their page record and co-named brands', async () => {
    const tenant = await fixtures.tenant();
    const auditId = await fixtures.audit(tenant);
    await fixtures.execution(tenant, {
      auditId,
      analysis: {
        brandMentions: ['Acme Corp'],
        citations: [
          { url: 'https://example.com/a', urlHash: 'hash-a' },
          { url: 'https://example.com/b' },
        ],
      },
    });
    await fixtures.execution(tenant, {
      auditId,
      analysis: {
        citations: [
          { url: 'https://example.com/a', urlHash: 'hash-a' },
          { url: 'https://other.com/x', sourceClass: 'news' },
        ],
      },
    });
    await fixtures.sourceAggregates(tenant, auditId);
    const action = randomUUID();
    await fixtures.sourcePage(tenant, { urlHash: 'hash-a', url: 'https://example.com/a', action });

    const domains = await get(tenant, route(tenant, '/sources'), { audit_id: auditId });
    expect(domains.body).toMatchObject({
      total: 2,
      responses: 2,
      total_citations: 4,
      category_totals: { news: 1 },
    });
    expect(
      (domains.body.items as Row[]).map((row) => [row.key, row.response_rate, row.last_cited_at]),
    ).toEqual([
      ['example.com', 1, null],
      ['other.com', 0.5, null],
    ]);

    const pages = await get(tenant, route(tenant, '/sources'), {
      audit_id: auditId,
      domain: 'example.com',
    });
    const [page] = pages.body.items as Row[];
    expect(page).toMatchObject({
      key: 'https://example.com/a',
      url_hash: 'hash-a',
      inspection_state: 'inspected',
      opportunity_id: action,
      page_format: 'article',
      retrieval_rate: null,
      mentions: 1,
      brands: [{ kind: 'brand', name: 'Acme Corp', responses: 1 }],
    });
    expect(page!.last_cited_at).toEqual(expect.any(String));

    const naive = await get(tenant, route(tenant, '/sources'), { as_of: '2026-03-01T00:00:00' });
    expect([naive.status, record(naive.body.error).message]).toEqual([
      422,
      "'as_of' must be timezone-aware",
    ]);
  });

  it("moves each row's response rate against a complete, earlier baseline set", async () => {
    const tenant = await fixtures.tenant();
    const complete = aggregate({ completed: 1, brand: 0 });
    const baseline = await measuredRun(tenant, '2026-02-01T00:00:00Z', complete);
    await fixtures.execution(tenant, {
      auditId: baseline,
      analysis: { citations: [{ url: 'https://example.com/a' }] },
    });
    const current = await measuredRun(tenant, '2026-03-01T00:00:00Z', complete);
    await fixtures.execution(tenant, {
      auditId: current,
      analysis: { citations: [{ url: 'https://other.com/x' }] },
    });
    await fixtures.sourceAggregates(tenant, baseline);
    await fixtures.sourceAggregates(tenant, current);

    const { body } = await get(tenant, route(tenant, '/sources'), {
      audit_ids: [current],
      baseline_audit_ids: [baseline],
    });

    expect(body.comparison_status).toBe('comparable');
    expect((body.items as Row[]).map((row) => [row.key, row.response_delta])).toEqual([
      ['other.com', 100],
    ]);
  });

  it("compares a named run with its baseline in the runs' own market", async () => {
    const tenant = await fixtures.tenant();
    const { baseline, current } = await runsInOwnMarket(tenant, {
      baseline: 'https://other.com/y',
      current: 'https://other.com/x',
    });
    await fixtures.sourceAggregates(tenant, baseline);
    await fixtures.sourceAggregates(tenant, current);

    const { body } = await get(tenant, route(tenant, '/sources'), {
      audit_ids: [current],
      baseline_audit_ids: [baseline],
    });

    expect(body.comparison_status).toBe('comparable');
    expect((body.items as Row[]).map((row) => [row.key, row.response_delta])).toEqual([
      ['other.com', 0],
    ]);
  });

  it('moves a filtered row against the same source type in the baseline', async () => {
    const tenant = await fixtures.tenant();
    const complete = aggregate({ completed: 1, brand: 0 });
    const baseline = await measuredRun(tenant, '2026-02-01T00:00:00Z', complete);
    await fixtures.execution(tenant, {
      auditId: baseline,
      analysis: { citations: [{ url: 'https://other.com/y', sourceClass: 'forum' }] },
    });
    const current = await measuredRun(tenant, '2026-03-01T00:00:00Z', complete);
    await fixtures.execution(tenant, {
      auditId: current,
      analysis: { citations: [{ url: 'https://other.com/x', sourceClass: 'news' }] },
    });
    await fixtures.sourceAggregates(tenant, baseline);
    await fixtures.sourceAggregates(tenant, current);
    const delta = async (query: Record<string, string>) =>
      (
        (
          await get(tenant, route(tenant, '/sources'), {
            audit_ids: [current],
            baseline_audit_ids: [baseline],
            ...query,
          })
        ).body.items as Row[]
      ).map((row) => [row.key, row.response_delta]);

    expect(await delta({})).toEqual([['other.com', 0]]);
    expect(await delta({ source_type: 'news' })).toEqual([['other.com', 100]]);
  });

  it('leaves a named commerce run out of the sources a brand run shows', async () => {
    const tenant = await fixtures.tenant();
    const brand = await fixtures.audit(tenant);
    const commerce = await fixtures.audit(tenant, { scope: 'commerce' });
    for (const auditId of [brand, commerce]) {
      await fixtures.execution(tenant, {
        auditId,
        analysis: { citations: [{ url: 'https://shelf.example/p' }] },
      });
      await fixtures.sourceAggregates(tenant, auditId);
    }
    const read = async (auditId: string) => {
      const { body } = await get(tenant, route(tenant, '/sources'), { audit_id: auditId });
      return [body.responses, (body.items as Row[]).map((row) => [row.key, row.responses])];
    };

    expect(await read(brand)).toEqual([1, [['shelf.example', 1]]]);
    expect(await read(commerce)).toEqual([0, []]);
  });

  it('counts reads beside citations, and leaves engines that expose none unknown', async () => {
    const tenant = await fixtures.tenant();
    const auditId = await fixtures.audit(tenant);
    await fixtures.execution(tenant, {
      auditId,
      engine: 'chatgpt',
      analysis: {
        citations: [{ url: 'https://other.com/x', urlHash: 'hash-x' }],
        retrieved: [
          { url: 'https://acme.example/pricing', isOwned: true, urlHash: 'hash-p' },
          { url: 'https://other.com/x', urlHash: 'hash-x' },
        ],
      },
    });
    await fixtures.execution(tenant, {
      auditId,
      engine: 'chatgpt',
      analysis: {
        citations: [{ url: 'https://acme.example/pricing', isOwned: true, urlHash: 'hash-p' }],
        retrieved: [{ url: 'https://acme.example/pricing', isOwned: true, urlHash: 'hash-p' }],
      },
    });
    await fixtures.execution(tenant, {
      auditId,
      engine: 'gemini',
      analysis: { citations: [{ url: 'https://other.com/x', urlHash: 'hash-x' }] },
    });
    await fixtures.sourceAggregates(tenant, auditId);

    const domains = await get(tenant, route(tenant, '/sources'), { audit_id: auditId });
    expect(domains.body.retrieval).toEqual({ responses: 2, unavailable_engines: ['gemini'] });
    expect(
      (domains.body.items as Row[]).map((row) => [row.key, row.responses, row.retrieved]),
    ).toEqual([
      ['other.com', 2, 1],
      ['acme.example', 1, 2],
    ]);

    const gemini = await get(tenant, route(tenant, '/sources'), {
      audit_id: auditId,
      engine: 'gemini',
    });
    expect((gemini.body.items as Row[]).map((row) => [row.key, row.retrieved])).toEqual([
      ['other.com', null],
    ]);

    const misses = await get(tenant, route(tenant, '/sources/near-misses'), { audit_id: auditId });
    expect(misses.body).toMatchObject({
      responses: 2,
      unavailable_engines: ['gemini'],
      items: [{ url: 'https://acme.example/pricing', url_hash: 'hash-p', retrieved: 2, cited: 1 }],
    });
  });

  it('ranks risers and fallers by change in citation share against a comparable baseline', async () => {
    const tenant = await fixtures.tenant();
    const complete = aggregate({ completed: 1, brand: 0 });
    const baseline = await measuredRun(tenant, '2026-02-01T00:00:00Z', complete);
    await fixtures.execution(tenant, {
      auditId: baseline,
      analysis: {
        citations: [
          { url: 'https://falling.example/a' },
          { url: 'https://falling.example/b' },
          { url: 'https://steady.example/a' },
          { url: 'https://gone.example/a' },
        ],
      },
    });
    const current = await measuredRun(tenant, '2026-03-01T00:00:00Z', complete);
    await fixtures.execution(tenant, {
      auditId: current,
      analysis: {
        citations: [
          { url: 'https://rising.example/a' },
          { url: 'https://falling.example/a' },
          { url: 'https://steady.example/a' },
          { url: 'https://rising.example/b' },
        ],
      },
    });

    const { body } = await get(tenant, route(tenant, '/sources/movers'), {
      audit_ids: [current],
      baseline_audit_ids: [baseline],
    });
    expect(body).toEqual({
      dimension: 'domain',
      comparison_status: 'comparable',
      current_citations: 4,
      previous_citations: 4,
      risers: [{ key: 'rising.example', current_share: 0.5, previous_share: 0, delta: 50 }],
      fallers: [
        { key: 'falling.example', current_share: 0.25, previous_share: 0.5, delta: -25 },
        { key: 'gone.example', current_share: 0, previous_share: 0.25, delta: -25 },
      ],
    });

    const unpaired = await get(tenant, route(tenant, '/sources/movers'), { audit_ids: [current] });
    expect(unpaired.body).toMatchObject({
      comparison_status: 'no_baseline',
      current_citations: null,
      risers: [],
    });
  });

  it("ranks movers against a baseline in the runs' own, non-default market", async () => {
    const tenant = await fixtures.tenant();
    const { baseline, current } = await runsInOwnMarket(tenant, {
      baseline: 'https://falling.example/a',
      current: 'https://rising.example/a',
    });

    const { body } = await get(tenant, route(tenant, '/sources/movers'), {
      audit_id: current,
      baseline_audit_ids: [baseline],
    });
    expect(body).toEqual({
      dimension: 'domain',
      comparison_status: 'comparable',
      current_citations: 1,
      previous_citations: 1,
      risers: [{ key: 'rising.example', current_share: 1, previous_share: 0, delta: 100 }],
      fallers: [{ key: 'falling.example', current_share: 0, previous_share: 1, delta: -100 }],
    });
  });
});
