import { afterAll, expect, it } from 'vitest';
import { dispatchTool } from '../src/mcp/tools.ts';
import { frozen, visibilityReads } from './visibility-read-support.ts';
import type { Tenant } from './visibility-fixtures.ts';

const { db, fixtures, measuredRun } = visibilityReads();
afterAll(async () => {
  await fixtures.cleanup();
  await db.destroy();
});

const reader =
  (tenant: Tenant) =>
  (name: string, args: Record<string, unknown> = {}) =>
    dispatchTool(
      db,
      { kind: 'member', ...tenant },
      name,
      { project_id: tenant.projectId, ...args },
      '',
    );
const metrics = (completed: number) => ({
  total_completed: completed,
  brand_mention_count: 0,
  owned_citation_response_count: 0,
  brand_mention_rate: 0,
  owned_citation_rate: 0,
  competitor_mention_rate: {},
  competitor_citation_rate: {},
  share_of_voice: { mention_counts: { 'Acme Corp': 0 } },
  coverage: { requested: completed, failed: 0, not_run: 0 },
  per_prompt: [{ composite_score: 0 }],
});

it('reads near misses of one run apart from no retrieval data and from none missed', async () => {
  const tenant = await fixtures.tenant();
  const sources = (args: Record<string, unknown> = {}) =>
    reader(tenant)('read_visibility_sources', { view: 'near_misses', ...args });
  expect(await sources()).toMatchObject({ state: 'unavailable', reason: 'no_completed_run' });
  const blind = await measuredRun(tenant, '2026-02-01T00:00:00Z', metrics(1));
  await fixtures.execution(tenant, {
    auditId: blind,
    engine: 'gemini',
    analysis: { citations: [{ url: 'https://other.com/x' }] },
  });
  expect(await sources()).toMatchObject({
    state: 'unavailable',
    reason: 'retrieval_not_observed',
    coverage: { answers_with_retrieval: 0, engines_without_retrieval: ['gemini'] },
  });
  const cited = { url: 'https://acme.example/pricing?token=secret', isOwned: true, urlHash: 'p' };
  const run = await measuredRun(tenant, '2026-03-01T00:00:00Z', metrics(2));
  await fixtures.execution(tenant, {
    auditId: run,
    analysis: { citations: [cited], retrieved: [cited] },
  });
  expect(await sources()).toMatchObject({ state: 'available', audit_id: run, items: [] });
  await fixtures.execution(tenant, { auditId: run, analysis: { retrieved: [cited] } });
  const page = await sources({ limit: 1 });
  expect(page).toMatchObject({
    state: 'available',
    coverage: { answers_with_retrieval: 2 },
    items: [{ url: 'https://acme.example/pricing', retrieved: 2, cited: 1 }],
    pagination: { has_more: false },
  });
  const foreign = await fixtures.tenant();
  const theirs = await measuredRun(foreign, '2026-03-01T00:00:00Z', metrics(1));
  await expect(sources({ audit_id: theirs })).rejects.toThrow();
});

it('charts citation share over runs, keeping a source absent from a bucket a real zero', async () => {
  const tenant = await fixtures.tenant();
  const series = (args: Record<string, unknown> = {}) =>
    reader(tenant)('read_visibility_sources', { view: 'series', granularity: 'month', ...args });
  expect(await series()).toEqual({
    state: 'unavailable',
    reason: 'no_completed_run',
    artifact_refs: [],
  });
  const february = await measuredRun(tenant, '2026-02-01T00:00:00Z', metrics(2));
  expect(await series({ audit_id: february })).toMatchObject({
    state: 'unavailable',
    reason: 'no_answers_in_selection',
  });
  await fixtures.execution(tenant, { auditId: february, analysis: { citations: [] } });
  expect(await series()).toMatchObject({
    state: 'available',
    buckets: [{ at: '2026-02-01T00:00:00Z', answers: 1 }],
    series: [],
  });
  await fixtures.execution(tenant, {
    auditId: february,
    analysis: { citations: [{ url: 'https://review.example/a?utm=1' }] },
  });
  const march = await measuredRun(tenant, '2026-03-01T00:00:00Z', metrics(1));
  await fixtures.execution(tenant, { auditId: march, analysis: { citations: [] } });
  expect(await series({ level: 'url' })).toMatchObject({
    state: 'available',
    buckets: [
      { at: '2026-03-01T00:00:00Z', answers: 1 },
      { at: '2026-02-01T00:00:00Z', answers: 2 },
    ],
    series: [
      {
        key: 'https://review.example/a',
        points: [
          { responses: 0, share: 0 },
          { responses: 1, share: 0.5 },
        ],
      },
    ],
  });
  const first = await series({ limit: 1 });
  expect(first).toMatchObject({ buckets: [{ at: '2026-03-01T00:00:00Z' }] });
  const next = String((first.pagination as { next_cursor: string }).next_cursor);
  expect(await series({ limit: 1, cursor: next })).toMatchObject({
    buckets: [{ at: '2026-02-01T00:00:00Z' }],
    pagination: { has_more: false },
  });
  await expect(series({ limit: 1, cursor: next, granularity: 'week' })).rejects.toThrow(
    'cursor belongs to another selection',
  );
  const foreign = await fixtures.tenant();
  const theirs = await measuredRun(foreign, '2026-03-01T00:00:00Z', metrics(1));
  await expect(series({ audit_id: theirs })).rejects.toThrow();
});

it('reports movers only against a comparable earlier run', async () => {
  const tenant = await fixtures.tenant();
  const movers = (args: Record<string, unknown> = {}) =>
    reader(tenant)('read_visibility_sources', { view: 'movers', ...args });
  expect(await movers()).toMatchObject({ state: 'unavailable', reason: 'no_completed_run' });
  const only = await measuredRun(tenant, '2026-02-01T00:00:00Z', metrics(1));
  await fixtures.execution(tenant, {
    auditId: only,
    analysis: { citations: [{ url: 'https://a.example/x' }] },
  });
  const alone = await movers();
  expect(alone).toMatchObject({ state: 'unavailable', audit_id: only });
  expect(alone.reason).not.toBe('comparable');
  const later = await measuredRun(tenant, '2026-03-01T00:00:00Z', metrics(1));
  await fixtures.execution(tenant, {
    auditId: later,
    analysis: {
      citations: [{ url: 'https://a.example/x' }, { url: 'https://b.example/y' }],
    },
  });
  expect(await movers()).toMatchObject({
    state: 'available',
    audit_id: later,
    baseline_audit_ids: [only],
    citations: { current: 2, baseline: 1 },
    risers: [{ key: 'b.example', current_share: 0.5, previous_share: 0, delta: 50 }],
    fallers: [{ key: 'a.example', current_share: 0.5, previous_share: 1, delta: -50 }],
  });
  const foreign = await fixtures.tenant();
  const theirs = await measuredRun(foreign, '2026-03-01T00:00:00Z', metrics(1));
  await expect(movers({ audit_id: theirs })).rejects.toThrow();
});

it('reads AI Overview rates with their denominators, apart from a surface that has none', async () => {
  const tenant = await fixtures.tenant();
  const surface = (args: Record<string, unknown> = {}) =>
    reader(tenant)('read_visibility_overview', { view: 'surface', ...args });
  expect(await surface({ engine: 'chatgpt' })).toEqual({
    state: 'unavailable',
    reason: 'not_applicable',
    artifact_refs: [],
  });
  expect(await surface()).toMatchObject({ state: 'unavailable', reason: 'no_completed_run' });
  const auditId = await measuredRun(tenant, '2026-02-01T00:00:00Z', metrics(2), {
    configuration: frozen(),
  });
  await fixtures.execution(tenant, {
    auditId,
    engine: 'google_ai_overview',
    observation: { outcome: 'no_ai_overview', aioPresent: false },
  });
  const read = await surface({ engine: 'google_ai_overview' });
  expect(read).toMatchObject({
    state: 'available',
    audit_id: auditId,
    engines: [
      {
        logical_engine: 'google_ai_overview',
        trigger_rate: { numerator: 0, denominator: 1, value: 0 },
        brand_mention_rate_when_present: { numerator: 0, denominator: 0, value: null },
      },
    ],
  });
  const foreign = await fixtures.tenant();
  const theirs = await measuredRun(foreign, '2026-03-01T00:00:00Z', metrics(1));
  await expect(surface({ audit_id: theirs })).rejects.toThrow();
});

it("lists every market's headline, keeping an unmeasured market apart from a measured zero", async () => {
  const tenant = await fixtures.tenant();
  const markets = (args: Record<string, unknown> = {}) =>
    reader(tenant)('read_visibility_overview', { view: 'markets', ...args });
  expect(await markets()).toMatchObject({
    state: 'available',
    markets: [{ state: 'no_run', responses: null, mention_rate: null }],
  });
  const auditId = await measuredRun(tenant, '2026-02-01T00:00:00Z', metrics(4));
  expect(await markets()).toMatchObject({
    state: 'available',
    markets: [{ state: 'measured', audit_id: auditId, responses: 4, mention_rate: 0 }],
  });
  const foreign = await fixtures.tenant();
  await expect(
    dispatchTool(
      db,
      { kind: 'member', ...foreign },
      'read_visibility_overview',
      { project_id: tenant.projectId, view: 'markets' },
      '',
    ),
  ).rejects.toThrow();
});
