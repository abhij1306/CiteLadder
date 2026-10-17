import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { policy } from '../src/config.ts';
import {
  compareCrawls,
  expectedKey,
  type ChangePage,
  type RuleState,
} from '../src/site-health/change-compare.ts';
import { contentRecord, declaredCheckField } from '../src/site-health/change-snapshot.ts';
import { siteWorkerSettings } from '../src/site-health/runtime.ts';
import { SiteFixtures, type SiteSeed } from './site-health-fixtures.ts';
import { testDatabase } from './support.ts';

const rule = (outcome: string, severity = 'high'): RuleState => ({
  outcome,
  severity,
  evaluationId: randomUUID(),
});
function page(
  overrides: Partial<ChangePage> = {},
  fields: Record<string, unknown> = {},
): ChangePage {
  return {
    siteUrlId: '00000000-0000-0000-0000-000000000001',
    normalizedUrl: 'https://example.com/page',
    analysisId: randomUUID(),
    artifactId: randomUUID(),
    rules: { title: rule('satisfied') },
    intendedIndexable: true,
    ...overrides,
    fields: {
      title: 'Same',
      meta_description: 'Description',
      h1: ['Heading'],
      canonical: 'https://example.com/page',
      robots_noindex: false,
      json_ld_present: true,
      internal_link_count: 2,
      http_status: 200,
      redirect_target: 'https://example.com/page',
      ...fields,
    },
  };
}
const classes = (before: ChangePage, after: ChangePage) =>
  compareCrawls([before], [after], { completePair: true }).map((item) => [
    item.field,
    item.change_class,
  ]);

describe('crawl comparison', () => {
  it('a re-analysed page with identical evidence makes no claim', () => {
    expect(compareCrawls([page()], [page()], { completePair: true })).toEqual([]);
  });
  it('classifies rule and HTTP transitions and links the declared implementation', () => {
    const after = page(
      { rules: { title: rule('missing', 'critical') } },
      {
        title: 'Missing',
        http_status: 503,
      },
    );
    const expected = new Map([
      [expectedKey(after.siteUrlId, 'title'), { eventId: 'event', expectedValue: 'Missing' }],
    ]);
    const changes = compareCrawls([page()], [after], { completePair: true, expected });
    const title = changes.find((item) => item.field === 'title')!;
    expect(title).toMatchObject({
      change_class: 'critical-regression',
      expected: true,
      implementation_event_id: 'event',
    });
    expect(changes.find((item) => item.field === 'http_status')!.change_class).toBe(
      'critical-regression',
    );
  });
  it('a rule transition is a change even when the extracted value is unchanged', () => {
    const after = page({ rules: { title: rule('missing') } });
    const expected = new Map([
      [expectedKey(after.siteUrlId, 'title'), { eventId: 'event', expectedValue: 'fail' }],
    ]);
    const [change] = compareCrawls([page()], [after], { completePair: true, expected });
    expect(change).toMatchObject({
      field: 'title',
      change_class: 'potential-regression',
      expected: true,
    });
  });
  it('partial outcomes count as failures in both directions', () => {
    const partial = page({ rules: { title: rule('partial') } });
    expect(classes(page(), partial)).toEqual([['title', 'potential-regression']]);
    expect(classes(partial, page())).toEqual([['title', 'improvement']]);
  });
  it('a de-indexed page that intended indexing is critical; other moves are neutral', () => {
    expect(classes(page(), page({}, { robots_noindex: true }))).toEqual([
      ['robots_noindex', 'critical-regression'],
    ]);
    expect(classes(page(), page({}, { redirect_target: 'https://example.com/next' }))).toEqual([
      ['redirect_target', 'neutral-change'],
    ]);
  });
  it('URL presence is claimed only for a complete pair', () => {
    const added = page({ siteUrlId: '00000000-0000-0000-0000-000000000002' });
    expect(compareCrawls([page()], [added], { completePair: false })).toEqual([]);
    expect(
      compareCrawls([page()], [added], { completePair: true }).map((item) => [
        item.site_url_id,
        item.after_value,
        item.change_class,
      ]),
    ).toEqual([
      [added.siteUrlId, true, 'improvement'],
      ['00000000-0000-0000-0000-000000000001', false, 'potential-regression'],
    ]);
  });
});

describe('content comparison', () => {
  const content = (shingles: string[], modified: string, extra: Record<string, unknown> = {}) =>
    page(
      {},
      {
        content_change: {
          shingles,
          heading_outline: ['Overview'],
          modified,
          coverage: 'complete',
          extractor_version: 'extract-v2',
          ...extra,
        },
      },
    );
  const result = (before: ChangePage, after: ChangePage) =>
    compareCrawls([before], [after], { completePair: true }).find(
      (item) => item.field === 'content_change',
    )!.after_value as Record<string, unknown>;
  const same = ['alpha beta gamma delta epsilon'];

  it('text change and metadata consistency are independent judgements', () => {
    expect(
      result(content(same, '2026-01-01'), content(['new useful evidence'], '2026-01-01')),
    ).toMatchObject({
      content_change_classification: 'substantial_change',
      metadata_consistency: 'inconsistent',
      content_delta_ratio: 1,
    });
  });
  it('a date-only refresh is recorded as unchanged text with inconsistent metadata', () => {
    expect(result(content(same, '2026-01-01'), content(same, '2026-02-01'))).toMatchObject({
      content_change_classification: 'unchanged',
      metadata_consistency: 'inconsistent',
    });
  });
  it('equal instants in different offsets are not a refresh', () => {
    expect(
      result(content(same, '2026-01-01T00:00:00Z'), content(same, '2026-01-01T01:00:00+01:00'))
        .metadata_consistency,
    ).toBe('consistent');
  });
  it('an extractor change is insufficient evidence even when the excerpt is equal', () => {
    const previous = content(same, '2026-01-01', { coverage: 'unknown', extractor_version: 'v1' });
    expect(result(previous, content(same, '2026-02-01'))).toMatchObject({
      content_change_classification: 'insufficient_evidence',
      comparison_coverage: 'unknown',
      coverage_reason: 'extractor_incompatible',
      metadata_consistency: 'unknown',
    });
  });
  it('short text yields one shingle and records completeness provenance', () => {
    const facts = {
      primary_content_text: 'Short changed TEXT',
      primary_content_truncated: false,
      primary_content_pre_truncation_length: 18,
    };
    expect(contentRecord(facts, 'v2')).toMatchObject({
      shingles: ['short changed text'],
      coverage: 'complete',
    });
    expect(contentRecord({ primary_content_text: 'Some text' }, 'v2').coverage_reason).toBe(
      'legacy_completeness_unknown',
    );
  });
});

const db = testDatabase();
const fixtures = new SiteFixtures(db);
afterAll(async () => {
  await fixtures.cleanup();
  await db.destroy();
});
const worker = (seed: SiteSeed) =>
  fixtures.worker(seed, {
    owner: 'change-intel',
    settings: { ...siteWorkerSettings({}), retryBase: 0, retryMax: 0, retryJitter: 0 },
  });
const hour = 3_600_000;
const facts = { title: 'Pricing', headings: { h1_texts: ['Pricing'] } };

/** Crawl A an hour before the seed's crawl B, both analysing the same two URLs. */
async function pair() {
  const b = await fixtures.crawl();
  const a = {
    ...b,
    crawlId: await fixtures.sibling(b, {
      created_at: new Date(Date.now() - 3 * hour),
      completed_at: new Date(Date.now() - 2 * hour),
    }),
  };
  await db
    .updateTable('site_crawls')
    .set({ analyzed_url_count: 2 })
    .where('id', 'in', [a.crawlId, b.crawlId])
    .execute();
  const urls = [];
  for (const path of ['/', '/pricing']) {
    const first = await fixtures.page(a, path, facts, { observed: true });
    await fixtures.page(b, path, facts, { observed: true, siteUrlId: first.id });
    urls.push(first.id);
  }
  return { a, b, urls };
}
async function run(seed: SiteSeed) {
  await fixtures.task(seed, 'change_intel');
  expect(await worker(seed).runOnce()).toBe(1);
}
const snapshots = (seed: SiteSeed) =>
  db
    .selectFrom('site_change_snapshots')
    .selectAll()
    .where('crawl_b_id', '=', seed.crawlId)
    .execute();
const analyticsTasks = (seed: SiteSeed) =>
  db
    .selectFrom('analytics_tasks')
    .select(['task_kind', 'payload'])
    .where('workspace_id', '=', seed.workspaceId)
    .orderBy('task_kind')
    .execute();

it('reads a declared rule fix in the outcome vocabulary crawl evidence uses', () => {
  const rule = policy.site_health.change_intel.field_rules.title;
  expect(
    declaredCheckField({ kind: 'site_rule', rule_id: rule, expected_outcome: 'pass' }),
  ).toEqual(['title', 'satisfied']);
  expect(declaredCheckField({ kind: 'traffic_metric' })).toEqual([null, null]);
});

describe('change_intel task', () => {
  it('persists one provenance-exact snapshot and its handoff with the task, idempotently', async () => {
    const { a, b } = await pair();
    await run(b);
    await run(b);
    const [snapshot, ...rest] = await snapshots(b);
    expect(rest).toEqual([]);
    expect(snapshot).toMatchObject({
      crawl_a_id: a.crawlId,
      state: 'available',
      complete_pair: true,
      summary: { total: 0, counts_by_class: {} },
    });
    expect(snapshot!.source_analysis_ids).toHaveLength(4);
    // Without GA4 the project derives no AI Traffic insights.
    expect(await analyticsTasks(b)).toEqual([
      {
        task_kind: 'opportunity_refresh',
        payload: { trigger_kind: 'site_change', trigger_id: snapshot!.id },
      },
      // No declaration is in its window, so no verification is queued.
    ]);
    const statuses = await db
      .selectFrom('site_crawl_tasks')
      .select('status')
      .where('crawl_id', '=', b.crawlId)
      .where('task_kind', '=', 'change_intel')
      .execute();
    expect(statuses.map((row) => row.status)).toEqual(['succeeded', 'succeeded']);
  });

  it('a revised analysis appends a superseding snapshot recording the change', async () => {
    const { b, urls } = await pair();
    await run(b);
    await db
      .updateTable('site_page_analyses')
      .set({ is_current: false })
      .where('crawl_id', '=', b.crawlId)
      .where('site_url_id', '=', urls[1]!)
      .execute();
    await fixtures.page(b, '/pricing', { ...facts, title: 'Plans' }, { siteUrlId: urls[1] });
    await run(b);
    const all = await snapshots(b);
    const revised = all.find((row) => row.supersedes_id);
    expect(all).toHaveLength(2);
    expect(revised!.supersedes_id).toBe(all.find((row) => row !== revised)!.id);
    const observations = await db
      .selectFrom('site_change_observations')
      .select(['field', 'before_value', 'after_value', 'workspace_id'])
      .where('snapshot_id', '=', revised!.id)
      .execute();
    expect(observations).toEqual([
      {
        field: 'title',
        before_value: 'Pricing',
        after_value: 'Plans',
        workspace_id: b.workspaceId,
      },
    ]);
  });

  it('prefers the newest compatible predecessor and otherwise names the scope boundary', async () => {
    const b = await fixtures.crawl();
    await db
      .updateTable('site_crawls')
      .set({
        configuration: JSON.stringify({ discovery_mode: 'automatic', requested_page_limit: 20 }),
      })
      .where('id', '=', b.crawlId)
      .execute();
    const earlier = (days: number, configuration: unknown) =>
      fixtures.sibling(b, {
        analyzed_url_count: 1,
        configuration: JSON.stringify(configuration),
        created_at: new Date(Date.now() - days * 24 * hour),
      });
    // The page limit is the fetch budget left, not scope: it never breaks a pair.
    const compatible = await earlier(2, { discovery_mode: 'automatic', requested_page_limit: 50 });
    await earlier(1, { discovery_mode: 'manual' });
    // A newer page rerun re-read one page; it is never the site baseline.
    await earlier(0.5, { discovery_mode: 'automatic', page_rerun: true });
    const other = await fixtures.crawl();
    await fixtures.sibling(other, { analyzed_url_count: 1, created_at: new Date(0) });
    await run(b);
    expect((await snapshots(b))[0]).toMatchObject({ crawl_a_id: compatible });

    await db
      .updateTable('site_crawls')
      .set({ configuration: JSON.stringify({ discovery_mode: 'sitemap' }) })
      .where('id', '=', compatible)
      .execute();
    await run(b);
    expect((await snapshots(b)).find((row) => row.crawl_a_id !== compatible)).toMatchObject({
      state: 'non_comparable',
      reason_code: 'crawl_scope_mismatch',
    });
  });

  it('writes no comparison for a page rerun but still hands its page to Opportunities', async () => {
    const { b } = await pair();
    await db
      .updateTable('site_crawls')
      .set({ configuration: JSON.stringify({ page_rerun: true }) })
      .where('id', '=', b.crawlId)
      .execute();
    await run(b);
    expect(await snapshots(b)).toEqual([]);
    expect((await analyticsTasks(b)).map((task) => task.task_kind)).toContain(
      'opportunity_refresh',
    );
  });

  it('a page cap keeps the snapshot partial and says so', async () => {
    const { b } = await pair();
    const limits = policy.site_health.change_intel;
    const maxPages = limits.max_pages;
    limits.max_pages = 1;
    try {
      await run(b);
    } finally {
      limits.max_pages = maxPages;
    }
    const [snapshot] = await snapshots(b);
    expect(snapshot!.complete_pair).toBe(false);
    expect(snapshot!.limitations).toContain('evidence_page_limit_reached');
  });

  it('Traffic evidence routes the handoff through Demand with the change trigger', async () => {
    const { b } = await pair();
    await db
      .insertInto('traffic_snapshots')
      .values({
        id: randomUUID(),
        workspace_id: b.workspaceId,
        project_id: b.projectId,
        granularity: 'day',
        window_start: '2026-01-01',
        window_end: '2026-01-28',
        formula_version: 'fixture',
        normalization_version: 'fixture',
        created_at: new Date(),
      })
      .execute();
    await run(b);
    const [snapshot] = await snapshots(b);
    const demand = (await analyticsTasks(b)).find(
      (task) => task.task_kind === 'demand_snapshot_refresh',
    );
    expect(demand?.payload).toMatchObject({
      window_start: '2026-01-01',
      window_end: '2026-01-28',
      source_revision: `site_change:${snapshot!.id}`.slice(0, 24),
      downstream_trigger_kind: 'site_change',
      downstream_trigger_id: snapshot!.id,
    });
    expect((await analyticsTasks(b)).map((task) => task.task_kind)).not.toContain(
      'opportunity_refresh',
    );
  });

  it('a cancelled task writes neither the snapshot nor the handoff', async () => {
    const { b } = await pair();
    const id = await fixtures.task(b, 'change_intel');
    const held = worker(b);
    const task = await fixtures.claim(held, b, 'change_intel', id);
    await db
      .updateTable('site_crawl_tasks')
      .set({ status: 'cancelled' })
      .where('id', '=', id)
      .execute();
    await held.execute(task);
    expect(await snapshots(b)).toEqual([]);
    expect(await analyticsTasks(b)).toEqual([]);
  });
});
