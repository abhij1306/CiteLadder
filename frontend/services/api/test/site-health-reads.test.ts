import { randomUUID } from 'node:crypto';
import {
  aeoReadinessSchema,
  architectureSchema,
  changeSummarySchema,
  issueHistoryPageSchema,
  pagesPageSchema,
  pageDetailSchema,
  siteCrawlEventSchema,
  siteHealthDashboardSchema,
  siteHealthOverviewSchema,
  siteIssueDetailSchema,
  siteIssuesPageSchema,
} from '@citeladder/contracts/site-health';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { createApp } from '../src/app.ts';
import { policy } from '../src/config.ts';
import { issueGroupId } from '../src/site-health/reads/rules.ts';
import { issueDetail } from '../src/site-health/reads/issues.ts';
import { encodeKeysetCursor } from '../src/http/keyset-cursor.ts';
import { TEST_SESSION_COOKIE, sessionToken, testConfig, testDatabase } from './support.ts';
import { SiteFixtures, type SiteSeed } from './site-health-fixtures.ts';
import type { Tenant } from './visibility-fixtures.ts';

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
const config = testConfig();
const db = testDatabase(config);
const app = createApp(config, db);
const fixtures = new SiteFixtures(db);

afterAll(async () => {
  await fixtures.cleanup();
  await db.destroy();
});

async function get(tenant: Tenant, path: string) {
  return app.request(`/api/v1${path}`, {
    headers: {
      cookie: `${TEST_SESSION_COOKIE}=${await sessionToken({ sub: tenant.userId, ver: 0 })}`,
      'x-workspace-id': tenant.workspaceId,
    },
  });
}
/** A 200 response parsed by the route's contract. */
async function json<Schema extends z.ZodType>(
  tenant: Tenant,
  path: string,
  schema: Schema,
): Promise<z.infer<Schema>> {
  const response = await get(tenant, path);
  expect(response.status, await response.clone().text()).toBe(200);
  return schema.parse(await response.json());
}

/** The URL was admitted to the crawl. */
async function observe(seed: SiteSeed, siteUrlId: string, crawlId = seed.crawlId) {
  await db
    .insertInto('site_url_observations')
    .values({
      id: randomUUID(),
      workspace_id: seed.workspaceId,
      project_id: seed.projectId,
      crawl_id: crawlId,
      site_url_id: siteUrlId,
      observed_url: seed.root,
      final_url: seed.root,
      depth: 0,
      source_kind: 'link',
      content_type: 'text/html',
      rewrite_reason: '',
      rewrite_version: 'fixture',
      title: '',
      value_kind: 'page',
      value_priority: 0,
      created_at: new Date(),
    })
    .execute();
}

async function monitor(seed: SiteSeed, siteUrlId: string) {
  const now = new Date();
  await db
    .insertInto('monitored_site_urls')
    .values({
      id: randomUUID(),
      workspace_id: seed.workspaceId,
      project_id: seed.projectId,
      profile_id: seed.profileId,
      site_url_id: siteUrlId,
      active: true,
      selection_source: 'user',
      selected_at: now,
      created_at: now,
      updated_at: now,
    })
    .execute();
}

type Page = Awaited<ReturnType<SiteFixtures['page']>>;

/** A page observed in the crawl, with its analysis finalized. */
async function page(seed: SiteSeed, path: string, options: { current?: boolean } = {}) {
  const row = await fixtures.page(seed, path, {}, options);
  await observe(seed, row.id);
  await db
    .updateTable('site_page_analyses')
    .set({
      finalized_at: new Date(),
      source_evaluation_ids: [],
      web_fundamentals_state: 'measured',
      aeo_measurement_state: 'not_measured',
    })
    .where('id', '=', row.analysisId)
    .execute();
  return row;
}

/** A failing evaluation of `ruleId` on the page's analysis, and its persisted issue. */
async function issue(seed: SiteSeed, target: Page, ruleId: string) {
  const rule = policy.site_health.rule_catalog.find((item) => item.rule_id === ruleId)!;
  const [analysis] = await db
    .selectFrom('site_page_analyses')
    .select('source_evaluation_ids')
    .where('id', '=', target.analysisId)
    .execute();
  const evaluationId = await fixtures.evaluation(seed, target, ruleId, 'missing');
  await db
    .updateTable('site_page_analyses')
    .set({ source_evaluation_ids: [...(analysis?.source_evaluation_ids ?? []), evaluationId] })
    .where('id', '=', target.analysisId)
    .execute();
  await db
    .insertInto('site_issues')
    .values({
      id: randomUUID(),
      workspace_id: seed.workspaceId,
      project_id: seed.projectId,
      crawl_id: seed.crawlId,
      site_url_id: target.id,
      analysis_id: target.analysisId,
      evaluation_id: evaluationId,
      source_artifact_id: target.artifactId,
      rule_id: ruleId,
      rule_version: rule.rule_version,
      dimension: rule.dimension,
      category: rule.category,
      severity: rule.severity,
      finding_class: rule.finding_class,
      description: rule.description,
      remediation: rule.remediation,
      analyzer_version: policy.site_health.versions.analyzer,
      created_at: new Date(),
    })
    .execute();
}

const byUrl = (items: { normalized_url: string; analysis_status: string; error_code: string }[]) =>
  Object.fromEntries(items.map((item) => [new URL(item.normalized_url).pathname, item]));

describe('page projections', () => {
  it('bounds detail evaluations in severity and rule order, including the highest severity at the end', async () => {
    const seed = await fixtures.crawl();
    const target = await page(seed, '/bounded');
    const baseId = await fixtures.evaluation(seed, target, 'technical.https', 'satisfied');
    const base = await db
      .selectFrom('site_rule_evaluations')
      .selectAll()
      .where('id', '=', baseId)
      .executeTakeFirstOrThrow();
    const rows = Array.from(
      { length: policy.site_health.reads.max_detail_evaluations + 1 },
      (_, i) => ({
        ...base,
        id: randomUUID(),
        rule_id: `fixture.${String(i).padStart(4, '0')}`,
        severity: i === policy.site_health.reads.max_detail_evaluations ? 'critical' : 'low',
      }),
    );
    await db.insertInto('site_rule_evaluations').values(rows).execute();
    await db
      .updateTable('site_page_analyses')
      .set({ source_evaluation_ids: rows.map((row) => row.id).reverse() })
      .where('id', '=', target.analysisId)
      .execute();
    const detail = await json(
      seed,
      `/site-crawls/${seed.crawlId}/pages/${target.id}`,
      pageDetailSchema,
    );
    expect(detail.evaluations.map((row) => row.id)).toEqual([
      rows.at(-1)!.id,
      ...rows.slice(0, policy.site_health.reads.max_detail_evaluations - 1).map((row) => row.id),
    ]);
  });

  it('derive presentation status in SQL, so a status filter pages without gaps', async () => {
    const seed = await fixtures.crawl('running');
    await page(seed, '/');
    const fail = async (path: string, code: string) => {
      const row = await page(seed, path, { current: false });
      await db
        .updateTable('site_crawl_tasks')
        .set({ status: 'failed', error_code: code })
        .where('id', '=', row.taskId)
        .execute();
    };
    await fail('/robots', 'robots_denied');
    await fail('/broken', 'http_5xx');
    // No analyze task at all: monitored waits; unmonitored was never selected.
    for (const path of ['/waiting', '/ignored']) {
      const row = await page(seed, path, { current: false });
      await db
        .updateTable('site_crawl_tasks')
        .set({ task_kind: 'discover' })
        .where('id', '=', row.taskId)
        .execute();
      if (path === '/waiting') await monitor(seed, row.id);
    }

    const pages = byUrl(
      (await json(seed, `/site-crawls/${seed.crawlId}/pages`, pagesPageSchema)).items,
    );
    expect(pages['/']).toMatchObject({ analysis_status: 'completed', error_code: '' });
    expect(pages['/robots']).toMatchObject({
      analysis_status: 'blocked',
      error_code: 'robots_denied',
    });
    expect(pages['/broken']).toMatchObject({ analysis_status: 'error', error_code: 'http_5xx' });
    expect(pages['/waiting']!.analysis_status).toBe('pending');
    expect(pages['/ignored']!.analysis_status).toBe('not_selected');

    const failures: string[] = [];
    let cursor = '';
    do {
      const body = await json(
        seed,
        `/site-crawls/${seed.crawlId}/pages?status=error_or_blocked&limit=1${cursor}`,
        pagesPageSchema,
      );
      expect(body.items).toHaveLength(1);
      failures.push(new URL(body.items[0]!.normalized_url).pathname);
      cursor = body.next_cursor ? `&cursor=${body.next_cursor}` : '';
    } while (cursor);
    expect(failures.sort()).toEqual(['/broken', '/robots']);

    await db
      .updateTable('site_crawls')
      .set({ status: 'completed' })
      .where('id', '=', seed.crawlId)
      .execute();
    const terminal = byUrl(
      (await json(seed, `/site-crawls/${seed.crawlId}/pages`, pagesPageSchema)).items,
    );
    expect(terminal['/waiting']!.analysis_status).toBe('not_measured');
  });

  it('bind a cursor to the filters and order it was issued for', async () => {
    const seed = await fixtures.crawl();
    await page(seed, '/');
    await page(seed, '/a');
    const first = await json(
      seed,
      `/site-crawls/${seed.crawlId}/pages?sort=inbound&limit=1`,
      pagesPageSchema,
    );
    expect(first.next_cursor).toBeTruthy();
    const replayed = await get(
      seed,
      `/site-crawls/${seed.crawlId}/pages?sort=url&limit=1&cursor=${first.next_cursor}`,
    );
    expect(replayed.status).toBe(400);
    expect(((await replayed.json()) as { error: { code: string } }).error.code).toBe(
      'invalid_cursor',
    );
  });

  it('show a full recrawl its frozen inventory, but never to a sample crawl', async () => {
    const seed = await fixtures.crawl();
    const earlier = await page(seed, '/earlier');
    const later = { ...seed, crawlId: randomUUID() };
    const [crawl] = await db
      .selectFrom('site_crawls')
      .selectAll()
      .where('id', '=', seed.crawlId)
      .execute();
    await db
      .insertInto('site_crawls')
      .values({
        ...crawl!,
        id: later.crawlId,
        created_at: new Date(Date.now() + 1000),
        configuration: JSON.stringify({ inventory_source_crawl_ids: [seed.crawlId] }),
      })
      .execute();
    const inherited = byUrl(
      (await json(seed, `/site-crawls/${later.crawlId}/pages`, pagesPageSchema)).items,
    );
    // The row links to the crawl that observed it and borrows none of its evidence.
    expect(inherited['/earlier']).toMatchObject({
      crawl_id: seed.crawlId,
      analysis_status: 'not_selected',
      issue_count: null,
    });
    expect((await get(seed, `/site-crawls/${later.crawlId}/pages/${earlier.id}`)).status).toBe(404);

    await db
      .updateTable('site_crawls')
      .set({ sample_mode: true })
      .where('id', '=', later.crawlId)
      .execute();
    expect(
      (await json(seed, `/site-crawls/${later.crawlId}/pages`, pagesPageSchema)).items,
    ).toEqual([]);
  });
});

describe('issue catalog', () => {
  it('binds occurrence cursors to the page filter and permits exhausted pages', async () => {
    const seed = await fixtures.crawl();
    const home = await page(seed, '/');
    const product = await page(seed, '/product');
    for (const target of [home, product]) await issue(seed, target, 'technical.indexable');
    const groupId = issueGroupId(seed.crawlId, 'technical.indexable', 'defect');
    const first = await issueDetail(db, seed.workspaceId, seed.crawlId, groupId, {
      limit: 1,
      cursor: null,
    });
    expect(first.next_cursor).not.toBeNull();
    await expect(
      issueDetail(
        db,
        seed.workspaceId,
        seed.crawlId,
        groupId,
        { limit: 1, cursor: first.next_cursor! },
        home.id,
      ),
    ).rejects.toThrow('cursor');
    const cursor = encodeKeysetCursor(
      'issue_detail',
      {
        crawl_id: seed.crawlId,
        group_id: groupId,
        site_url_id: home.id,
        page_kind: null,
      },
      ['https://example.test/zzz', randomUUID()],
    );
    expect(
      await issueDetail(db, seed.workspaceId, seed.crawlId, groupId, { limit: 1, cursor }, home.id),
    ).toMatchObject({ occurrences: [], next_cursor: null });
    await expect(
      issueDetail(db, seed.workspaceId, seed.crawlId, groupId, { limit: 1, cursor }, product.id),
    ).rejects.toThrow('cursor');
    // The catalog's page-kind filter narrows the rail to the pages its row counted.
    const products = await issueDetail(
      db,
      seed.workspaceId,
      seed.crawlId,
      groupId,
      { limit: 10, cursor: null },
      undefined,
      'product',
    );
    expect(products.occurrences.map((row) => row.site_url_id)).toEqual([product.id]);
    expect(products.affected_url_count).toBe(1);
    await expect(
      issueDetail(
        db,
        seed.workspaceId,
        seed.crawlId,
        groupId,
        { limit: 1, cursor: first.next_cursor! },
        undefined,
        'product',
      ),
    ).rejects.toThrow('cursor');
  });

  it('groups current issues by rule and counts groups, folding critical into high', async () => {
    const seed = await fixtures.crawl();
    const home = await page(seed, '/');
    const product = await page(seed, '/product');
    const stale = await page(seed, '/stale', { current: false });
    for (const target of [home, product]) await issue(seed, target, 'technical.indexable');
    await issue(seed, home, 'technical.title_present');
    await issue(seed, home, 'technical.meta_description_present');
    // An issue of a superseded analysis is history, not the crawl's state.
    await issue(seed, stale, 'technical.https');

    const body = await json(seed, `/site-crawls/${seed.crawlId}/issues`, siteIssuesPageSchema);
    expect(body.items.map((group: { rule_id: string }) => group.rule_id)).toEqual([
      'technical.indexable',
      'technical.title_present',
    ]);
    expect(body.items[0]).toMatchObject({
      group_id: issueGroupId(seed.crawlId, 'technical.indexable', 'defect'),
      affected_url_count: 2,
    });
    expect(body.summary).toMatchObject({
      issue_count: 2,
      advisory_issue_type_count: 1,
      occurrence_count: 3,
      severity_counts: { critical: 0, high: 2 },
    });
    const high = await json(
      seed,
      `/site-crawls/${seed.crawlId}/issues?severity=high`,
      siteIssuesPageSchema,
    );
    expect(high.items).toHaveLength(2);
    // Chips never narrow the counts they label.
    expect(high.summary.severity_counts.high).toBe(2);

    const detail = await json(
      seed,
      `/site-crawls/${seed.crawlId}/issues/${body.items[0]!.group_id}`,
      siteIssueDetailSchema,
    );
    expect(detail).toMatchObject({ occurrence_count: 2, affected_url_count: 2 });
    expect(
      detail.occurrences.map((row: { site_url_id: string }) => row.site_url_id).sort(),
    ).toEqual([home.id, product.id].sort());
    expect((await get(seed, `/site-crawls/${seed.crawlId}/issues/${randomUUID()}`)).status).toBe(
      404,
    );

    const csv = await (
      await get(seed, `/site-crawls/${seed.crawlId}/export.csv?view=issues`)
    ).text();
    const [header, first] = csv.split('\r\n');
    expect(header!.split(',')[0]).toBe('group_id');
    expect(first).toContain('"homepage, product"');
  });

  it('ranks a severity tier by pages affected, pages it on that order, and searches titles', async () => {
    const seed = await fixtures.crawl();
    const home = await page(seed, '/');
    const product = await page(seed, '/product');
    await issue(seed, home, 'technical.https');
    for (const target of [home, product]) await issue(seed, target, 'web.mobile_viewport');

    const firstPage = await json(
      seed,
      `/site-crawls/${seed.crawlId}/issues?limit=1`,
      siteIssuesPageSchema,
    );
    expect(firstPage.items.map((group: { rule_id: string }) => group.rule_id)).toEqual([
      'web.mobile_viewport',
    ]);
    const secondPage = await json(
      seed,
      `/site-crawls/${seed.crawlId}/issues?limit=1&cursor=${encodeURIComponent(firstPage.next_cursor!)}`,
      siteIssuesPageSchema,
    );
    expect(secondPage.items.map((group: { rule_id: string }) => group.rule_id)).toEqual([
      'technical.https',
    ]);
    expect(secondPage.next_cursor).toBeNull();

    // "Mobile viewport missing" is found by the words on screen, not only its rule id.
    const searched = await json(
      seed,
      `/site-crawls/${seed.crawlId}/issues?query=${encodeURIComponent('VIEWPORT missing')}`,
      siteIssuesPageSchema,
    );
    expect(searched.items.map((group: { rule_id: string }) => group.rule_id)).toEqual([
      'web.mobile_viewport',
    ]);
  });
});

describe('dashboard', () => {
  it('reports a failed root fetch and resolves the quota without writing the runtime', async () => {
    const seed = await fixtures.crawl('failed');
    const task = await fixtures.task(seed, 'discover');
    await db
      .updateTable('site_crawl_tasks')
      .set({ status: 'failed', error_code: 'http_5xx', attempt_count: 3 })
      .where('id', '=', task)
      .execute();
    for (const attempt of [1, 2, 3])
      await db
        .insertInto('site_fetch_attempts')
        .values({
          id: randomUUID(),
          workspace_id: seed.workspaceId,
          crawl_id: seed.crawlId,
          task_id: task,
          attempt_number: attempt,
          request_ordinal: 0,
          method: 'GET',
          outcome: 'error',
          error_code: 'http_5xx',
          status_code: 503,
          target_host: 'example.test',
          acquisition_policy_version: 'fixture',
          acquisition_transport: 'recorded',
          acquisition_trigger: 'fixture',
          impersonation_profile: '',
          created_at: new Date(),
        })
        .execute();
    const runtime = () =>
      db
        .selectFrom('workspace_site_health_runtime')
        .selectAll()
        .where('workspace_id', '=', seed.workspaceId)
        .execute();
    const before = await runtime();

    const body = await json(
      seed,
      `/projects/${seed.projectId}/site-health`,
      siteHealthDashboardSchema,
    );
    expect(body.phase).toBe('terminal');
    expect(body.crawl?.failure_summary).toMatchObject({
      code: 'http_5xx',
      message: 'The site returned HTTP 503 after 3 attempts',
    });
    expect(body.root_errors).toHaveLength(3);
    expect(await runtime()).toEqual(before);
  });
});

describe('crawl events', () => {
  it('resume after an anchor, replay nothing for a foreign one, and redact totals', async () => {
    const seed = await fixtures.crawl();
    const ids: string[] = [];
    const events = z.array(siteCrawlEventSchema);
    for (const [index, type] of [
      'crawl.started',
      'discovery.progress',
      'crawl.completed',
    ].entries()) {
      const id = randomUUID();
      ids.push(id);
      await db
        .insertInto('site_crawl_events')
        .values({
          id,
          crawl_id: seed.crawlId,
          event_type: type,
          message: '',
          payload: JSON.stringify({ analyzed: index, total: 50 }),
          created_at: new Date(Date.now() + index),
        })
        .execute();
    }
    const after = await json(
      seed,
      `/site-crawls/${seed.crawlId}/events?last_event_id=${ids[0]}`,
      events,
    );
    expect(after.map((event) => event.id)).toEqual(ids.slice(1));
    expect(
      await json(seed, `/site-crawls/${seed.crawlId}/events?last_event_id=${randomUUID()}`, events),
    ).toEqual([]);
    // The fixture crawl was frozen without count disclosure.
    const replay = await json(seed, `/site-crawls/${seed.crawlId}/events`, events);
    expect(replay[1]!.payload).toEqual({ analyzed: 1 });

    process.env.SITE_HEALTH_SSE_POLL_INTERVAL_SECONDS = '0.01';
    const stream = await get(seed, `/site-crawls/${seed.crawlId}/events?stream=true`);
    expect(stream.headers.get('content-type')).toBe('text/event-stream');
    // A terminal crawl's stream ends after its grace polls.
    const text = await stream.text();
    expect(text.match(/^event: /gmu)).toHaveLength(3);
    expect(text).toContain(`id: ${ids[2]}`);
    // A completed stream frees its per-user slot: more sequential streams than the cap all open.
    const statuses: number[] = [];
    for (let index = 0; index < 4; index++) {
      const next = await get(seed, `/site-crawls/${seed.crawlId}/events?stream=true`);
      statuses.push(next.status);
      await next.text(); // NOSONAR: each stream finishes before the next opens.
    }
    expect(statuses).toEqual([200, 200, 200, 200]);
  });
});

describe('snapshot projections', () => {
  it('fill presentation fields an older frozen snapshot lacks, and never recompute it', async () => {
    const seed = await fixtures.crawl();
    expect((await get(seed, `/projects/${seed.projectId}/site-health/overview`)).status).toBe(404);
    const snapshot = await fixtures.snapshot(seed, 'complete');
    await db
      .updateTable('site_health_snapshots')
      .set({
        aeo_measurement_state: 'limited_evidence',
        web_fundamentals_state: 'measured',
        classification_state: 'complete',
        search_eligibility: 'eligible',
        readiness_dimensions: JSON.stringify([
          {
            key: 'machine-readability',
            score: null,
            reason: 'unresolved_checks',
            coverage: 0,
            earned_points: 0,
            expected_points: 1,
            determinate_points: 0,
            dimension_applicability: 'applicable',
            determinate_checkpoint_ids: [],
            dimension_measurement_state: 'not_measured',
          },
          { key: 'retired-pillar' },
        ]),
        top_issues: JSON.stringify([
          {
            rule_id: 'technical.indexable',
            finding_class: 'defect',
            severity: 'critical',
            category: 'indexing',
            description: '',
            remediation: '',
            affected_pages: 1,
            eligibility_blocker: true,
          },
        ]),
        aeo_readiness_diagnostic: JSON.stringify({
          state: 'limited_evidence',
          crawl_id: seed.crawlId,
          score: 40,
          coverage: 0.5,
          profile_version: 'p',
          schema_contract_version: 's',
          scoring_version: 'v',
          presentation_version: 'r',
          analyzer_version: 'a',
          source_analysis_ids: [],
          analysis_count: 1,
          affected_page_count: 1,
          dimensions: [],
          limitations: [],
        }),
      })
      .where('id', '=', snapshot)
      .execute();

    const overview = await json(
      seed,
      `/projects/${seed.projectId}/site-health/overview`,
      siteHealthOverviewSchema,
    );
    expect(overview.aeo_dimensions).toHaveLength(1);
    expect(overview.aeo_dimensions[0]).toMatchObject({
      label: 'Machine readability',
      unresolved_count: 0,
    });
    expect(overview.top_issues[0]).toMatchObject({
      title: 'Page blocked from indexing',
      impact_band: 4,
      impact_label: 'Critical',
    });
    expect(overview.trend.reason).toBe('no_comparable_snapshot');

    const readiness = await json(
      seed,
      `/projects/${seed.projectId}/site-health/aeo-readiness`,
      aeoReadinessSchema,
    );
    expect(readiness).toMatchObject({ state: 'limited_evidence', score: 40 });
  });

  it('require both crawls of an exact change pair', async () => {
    const seed = await fixtures.crawl();
    const response = await get(
      seed,
      `/projects/${seed.projectId}/site-health/changes/summary?crawl_a_id=${seed.crawlId}`,
    );
    expect(response.status).toBe(422);
    const summary = await json(
      seed,
      `/projects/${seed.projectId}/site-health/changes/summary`,
      changeSummarySchema,
    );
    expect(summary).toMatchObject({ state: 'unavailable', snapshot_id: null });
  });

  it('render the architecture tree without dropping pages in a parent cycle', async () => {
    const seed = await fixtures.crawl();
    const snapshot = await fixtures.snapshot(seed, 'complete');
    const node = (id: string, url: string, parent: string | null) => ({
      site_url_id: id,
      url,
      title: '',
      page_kind: 'product',
      parent_site_url_id: parent,
      parent_source: 'url_parent',
      depth_from_home: 1,
    });
    const [a, b, root] = [randomUUID(), randomUUID(), randomUUID()];
    await db
      .insertInto('site_observed_architectures')
      .values({
        id: randomUUID(),
        workspace_id: seed.workspaceId,
        project_id: seed.projectId,
        crawl_id: seed.crawlId,
        source_snapshot_id: snapshot,
        coverage_state: 'complete',
        page_count: 3,
        hierarchy: JSON.stringify([
          node(root, 'https://example.test/', null),
          node(a, 'https://example.test/a', b),
          node(b, 'https://example.test/b', a),
        ]),
        internal_linking: JSON.stringify({
          internal_link_count: 2,
          content_link_count: 1,
          pages_with_incoming_count: 3,
          pages_with_incoming_percentage: 100,
        }),
        page_kinds: '[]',
        structure_depth: JSON.stringify({
          measured_page_count: 3,
          unmeasured_page_count: 0,
          buckets: [],
        }),
        architecture_formula_version: 'fixture',
        archetype_policy_version: 'fixture',
        analyzer_version: 'fixture',
        extractor_version: 'fixture',
        rule_version: 'fixture',
        created_at: new Date(),
      })
      .execute();

    const model = await json(
      seed,
      `/projects/${seed.projectId}/site-health/architecture`,
      architectureSchema,
    );
    // Every observed page has an inbound link, so there are no orphans.
    expect(model.internal_linking.orphan_page_count).toBe(0);
    const tree = await (
      await get(seed, `/site-crawls/${seed.crawlId}/export.md?view=architecture`)
    ).text();
    for (const path of ['/a', '/b']) {
      const line = tree.split('\n').find((line) => line.includes(`https://example.test${path}`));
      expect(line).toContain('[product]');
    }
  });
});

describe('issue history', () => {
  it('lists only resolved issues, never the page’s current ones', async () => {
    const seed = await fixtures.crawl();
    const home = await page(seed, '/');
    // A superseded analysis of the same URL in this crawl, before a re-audit.
    const earlier = await fixtures.page(seed, '/', {}, { current: false, siteUrlId: home.id });
    await issue(seed, earlier, 'technical.indexable');
    await issue(seed, earlier, 'technical.title_present');
    await issue(seed, home, 'technical.indexable');

    const path = `/site-crawls/${seed.crawlId}/pages/${home.id}/issue-history`;
    const history = await json(seed, path, issueHistoryPageSchema);
    expect(history.current_analysis_finalized).toBe(true);
    expect(history.items.map((row: { rule_id: string }) => row.rule_id)).toEqual([
      'technical.title_present',
    ]);
    // An unfinished analysis says so instead of reading as "nothing resolved".
    const pending = await fixtures.page(seed, '/pending', {});
    await observe(seed, pending.id);
    expect(
      await json(
        seed,
        `/site-crawls/${seed.crawlId}/pages/${pending.id}/issue-history`,
        issueHistoryPageSchema,
      ),
    ).toEqual({ items: [], next_cursor: null, current_analysis_finalized: false });
    expect((await get(await fixtures.crawl(), path)).status).toBe(404);
  });
});

describe('workspace authorization', () => {
  it('answers 404 for another workspace’s crawl and project', async () => {
    const seed = await fixtures.crawl();
    const foreign = await fixtures.crawl();
    for (const path of [
      `/site-crawls/${seed.crawlId}`,
      `/site-crawls/${seed.crawlId}/pages`,
      `/site-crawls/${seed.crawlId}/issues`,
      `/site-crawls/${seed.crawlId}/events`,
      `/site-crawls/${seed.crawlId}/export.csv`,
      `/projects/${seed.projectId}/site-health`,
      `/projects/${seed.projectId}/site-health/aeo-readiness`,
      `/projects/${seed.projectId}/site-health/changes`,
    ])
      expect((await get(foreign, path)).status, path).toBe(404);
  });
});
