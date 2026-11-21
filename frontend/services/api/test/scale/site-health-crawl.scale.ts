import { randomUUID } from 'node:crypto';
import { sql, type KyselyPlugin, type QueryId, type RootOperationNode } from 'kysely';
import { afterAll, describe, expect, it } from 'vitest';

import { policy } from '../../src/config.ts';
import type { Database } from '../../src/db/database.ts';
import { issueFixes } from '../../src/site-health/issue-fixes.ts';
import { publishRunningIssues } from '../../src/site-health/issue-catalog.ts';
import { issues, unfilteredIssues } from '../../src/site-health/reads/issues.ts';
import { pages } from '../../src/site-health/reads/pages.ts';
import { SiteHealthWorker } from '../../src/workers/site-health-worker.ts';
import { acquisitionHarness } from '../site-health-acquisition-support.ts';
import { FinalizeFixtures, type SiteSeed } from '../site-health-finalize-fixtures.ts';
import { asOwner, testConfig, testDatabase } from '../support.ts';

const PAGES = Number(process.env.SITE_HEALTH_SCALE_PAGES ?? 5000);
const SITEMAP_URLS = 40_000;
const CHUNK = 1000;
const NAV = Array.from({ length: 20 }, (_, index) => `/nav-${index}`);
const RULES = [
  ['technical.indexable', 'satisfied'],
  ['technical.title_present', 'missing'],
  ['search.snippet_access', 'satisfied'],
] as const;
const CATALOG = new Map(policy.site_health.rule_catalog.map((rule) => [rule.rule_id, rule]));

const db = testDatabase();
// Fixture work only: removing a tens-of-thousands-page workspace outlasts the service statement bound.
const fixtureDb = testDatabase(
  testConfig({ DB_STATEMENT_TIMEOUT_MS: '300000', DB_COMMAND_TIMEOUT_SECONDS: '300' }),
);
const fixtures = new FinalizeFixtures(fixtureDb);
const harness = acquisitionHarness(db, fixtures);
afterAll(async () => {
  try {
    await fixtures.cleanup();
  } finally {
    await Promise.all([fixtureDb.destroy(), db.destroy()]);
  }
});

const CRAWL_TABLES = new Set(['site_page_analyses', 'site_rule_evaluations', 'site_issues']);
function primaryTable(node: RootOperationNode) {
  if (node.kind === 'SelectQueryNode')
    return /"name":"(\w+)"/.exec(JSON.stringify(node.from))?.[1] ?? '';
  const text = node.kind === 'RawNode' ? node.sqlFragments.join(' ') : '';
  return /\bfrom\s+(\w+)/.exec(text)?.[1] ?? '';
}
function meter() {
  const tables = new Map<QueryId, string>();
  const most: Record<string, number> = {};
  const peak = { heap: 0 };
  const plugin: KyselyPlugin = {
    transformQuery: ({ node, queryId }) => {
      tables.set(queryId, primaryTable(node));
      return node;
    },
    transformResult: ({ result, queryId }) => {
      const table = tables.get(queryId) ?? '';
      tables.delete(queryId);
      if (CRAWL_TABLES.has(table)) most[table] = Math.max(most[table] ?? 0, result.rows.length);
      peak.heap = Math.max(peak.heap, process.memoryUsage().heapUsed);
      return Promise.resolve(result);
    },
  };
  return { db: db.withPlugin(plugin), most, peak };
}

const path = (index: number) => (index === 0 ? '/' : `/page-${index}`);
const text = (index: number) =>
  Array.from({ length: 80 }, (_, word) => `w${(index * 7919 + word * 104_729) % 1_000_003}`).join(
    ' ',
  );
const facts = (url: string, index: number) => ({
  has_html: true,
  title: `Page ${index}`,
  delivery: { status_code: 200 },
  robots: { noindex: false },
  primary_content_text: text(index),
  links: {
    anchors: [...NAV, path(index + 1)].map((target) => ({ url: target, is_internal: true })),
  },
  canonical_declarations: [url],
});

async function analyze(seed: SiteSeed, limit: number) {
  const tasks = await db
    .selectFrom('site_crawl_tasks')
    .select(['id', 'site_url_id', 'requested_url'])
    .where('workspace_id', '=', seed.workspaceId)
    .where('crawl_id', '=', seed.crawlId)
    .where('task_kind', '=', 'analyze')
    .where('status', '=', 'queued')
    .orderBy('id')
    .limit(limit)
    .execute();
  const now = new Date();
  for (let offset = 0; offset < tasks.length; offset += CHUNK)
    await settleChunk({ seed, chunk: chunkOf(tasks, offset), now }); // NOSONAR -- Chunks write in order so the fixture's memory stays one chunk.
  return tasks.length;
}

type AnalyzeTask = Readonly<{ id: string; site_url_id: string | null; requested_url: string }>;

function chunkOf(tasks: readonly AnalyzeTask[], offset: number) {
  return tasks.slice(offset, offset + CHUNK).map((task, index) => ({
    ...task,
    index: offset + index,
    artifactId: randomUUID(),
    analysisId: randomUUID(),
    evaluations: RULES.map(([rule, outcome]) => ({ id: randomUUID(), rule, outcome })),
  }));
}

async function settleChunk({
  seed,
  chunk,
  now,
}: Readonly<{ seed: SiteSeed; chunk: ReturnType<typeof chunkOf>; now: Date }>) {
  await db
    .insertInto('site_fetch_artifacts')
    .values(
      chunk.map((page) => ({
        id: page.artifactId,
        workspace_id: seed.workspaceId,
        crawl_id: seed.crawlId,
        task_id: page.id,
        requested_url: page.requested_url,
        final_url: page.requested_url,
        status_code: 200,
        content_type: 'text/html',
        content_hash: page.artifactId.replaceAll('-', ''),
        normalized_facts: JSON.stringify(facts(page.requested_url, page.index)),
        extractor_version: policy.site_health.versions.extractor,
        fetched_at: now,
        created_at: now,
        fetch_purpose: 'analyze',
        acquisition_policy_version: 'fixture',
        acquisition_transport: 'recorded',
        acquisition_trigger: 'fixture',
        http_version: 'HTTP/1.1',
        impersonation_profile: '',
      })),
    )
    .execute();
  await db
    .insertInto('site_page_analyses')
    .values(
      chunk.map((page) => ({
        id: page.analysisId,
        workspace_id: seed.workspaceId,
        project_id: seed.projectId,
        crawl_id: seed.crawlId,
        site_url_id: page.site_url_id!,
        artifact_id: page.artifactId,
        status: 'completed',
        is_current: true,
        page_kind: page.index === 0 ? 'homepage' : 'product',
        analyzer_version: policy.site_health.versions.analyzer,
        scoring_version: 'fixture',
        profile_version: 'fixture',
        traits_version: 'fixture',
        classifier_version: 'fixture',
        presentation_version: 'fixture',
        schema_contract_version: 'fixture',
        aeo_measurement_state: 'not_measured',
        aeo_measurement_reason: 'fixture',
        web_fundamentals_state: 'measured',
        web_fundamentals_score: 50,
        technical_critical_complete: false,
        technical_determinate_weight: 0,
        technical_earned_weight: 0,
        technical_expected_weight: 0,
        source_evaluation_ids: page.evaluations.map((row) => row.id),
        created_at: now,
      })),
    )
    .execute();
  const evaluations = chunk.flatMap((page) =>
    page.evaluations.map(({ id, rule, outcome }) => ({
      page,
      id,
      rule: CATALOG.get(rule)!,
      outcome,
    })),
  );
  await db
    .insertInto('site_rule_evaluations')
    .values(
      evaluations.map(({ page, id, rule, outcome }) => ({
        id,
        workspace_id: seed.workspaceId,
        analysis_id: page.analysisId,
        source_artifact_id: page.artifactId,
        rule_id: rule.rule_id,
        rule_version: rule.rule_version,
        dimension: rule.dimension,
        category: rule.category,
        severity: rule.severity,
        finding_class: rule.finding_class,
        scope: rule.scope,
        weight: rule.weight,
        outcome,
        display_applicability: true,
        score_applicability: true,
        reason_code: 'fixture',
        readiness_dimension: '',
        readiness_weight: 0,
        analyzer_version: policy.site_health.versions.analyzer,
        extractor_version: policy.site_health.versions.extractor,
        created_at: now,
      })),
    )
    .execute();
  await db
    .insertInto('site_issues')
    .values(
      evaluations
        .filter(({ outcome }) => outcome === 'missing')
        .map(({ page, id, rule }) => ({
          id: randomUUID(),
          workspace_id: seed.workspaceId,
          project_id: seed.projectId,
          crawl_id: seed.crawlId,
          site_url_id: page.site_url_id!,
          analysis_id: page.analysisId,
          evaluation_id: id,
          source_artifact_id: page.artifactId,
          rule_id: rule.rule_id,
          dimension: rule.dimension,
          category: rule.category,
          severity: rule.severity,
          finding_class: rule.finding_class,
          evidence: JSON.stringify({}),
          description: rule.description,
          remediation: rule.remediation,
          analyzer_version: policy.site_health.versions.analyzer,
          rule_version: rule.rule_version,
          is_current: true,
          created_at: now,
        })),
    )
    .execute();
  await db
    .updateTable('site_crawl_tasks')
    .set({ status: 'succeeded', classification_expected: true, completed_at: now })
    .where('workspace_id', '=', seed.workspaceId)
    .where(
      'id',
      'in',
      chunk.map((page) => page.id),
    )
    .execute();
  for (const page of chunk)
    await db // NOSONAR -- One artifact per task, in order.
      .updateTable('site_crawl_tasks')
      .set({ result_artifact_id: page.artifactId })
      .where('workspace_id', '=', seed.workspaceId)
      .where('id', '=', page.id)
      .execute();
}

function urlset(urls: readonly string[]) {
  const entries = urls.map((url) => `<url><loc>${url}</loc></url>`).join('');
  return `<urlset>${entries}</urlset>`;
}

function scanned(read: (trx: Database) => Promise<unknown>) {
  const scans = async (trx: Database) => {
    const { rows } = await sql<{ scans: number }>`
      select coalesce(sum(seq_scan + coalesce(idx_scan, 0)), 0)::int as scans
      from pg_stat_xact_user_tables
      where relname in ('site_page_analyses', 'site_crawl_tasks', 'site_page_link_metrics')`.execute(
      trx,
    );
    return rows[0]?.scans ?? 0;
  };
  return db.transaction().execute(async (trx) => {
    const before = await scans(trx);
    await read(trx);
    return (await scans(trx)) - before;
  });
}

async function timed<T>(read: () => Promise<T>) {
  const started = performance.now();
  const value = await read();
  return { value, ms: Math.round(performance.now() - started) };
}

describe('Site Health crawl at scale', () => {
  it(`sets up, analyzes, publishes in batches and finalizes ${PAGES} pages within one batch per read`, async () => {
    const seed = await harness.crawl(
      { discovery: 'pending', config: { automatic_monitor_limit: PAGES } },
      { monitored: PAGES },
    );
    const setup = await harness.queued(seed, 'site_setup');
    const listed = Array.from(
      { length: PAGES },
      (_, index) => `https://example.test${path(index)}`,
    );
    const documents = Array.from({ length: Math.ceil(PAGES / SITEMAP_URLS) }, (_, index) =>
      listed.slice(index * SITEMAP_URLS, (index + 1) * SITEMAP_URLS),
    );
    const served = Object.fromEntries(
      documents.map((urls, index) => [
        `/pages-${index}.xml`,
        {
          contentType: 'application/xml',
          body: urlset(urls),
        },
      ]),
    );
    const index = documents
      .map((_, at) => `<sitemap><loc>https://example.test/pages-${at}.xml</loc></sitemap>`)
      .join('');
    await harness.run(
      harness.worker({
        '/robots.txt': {
          body: 'User-agent: *\nAllow: /\n\nSitemap: https://example.test/index.xml\n',
          contentType: 'text/plain',
        },
        '/index.xml': {
          contentType: 'application/xml',
          body: `<sitemapindex>${index}</sitemapindex>`,
        },
        ...served,
      }),
      setup,
    );
    expect(await harness.task(setup)).toMatchObject({ status: 'succeeded' });
    const tracked = await db
      .selectFrom('site_crawl_tasks')
      .select(sql<number>`count(*)::int`.as('count'))
      .where('crawl_id', '=', seed.crawlId)
      .where('task_kind', '=', 'analyze')
      .executeTakeFirstOrThrow();
    expect(tracked.count).toBe(PAGES);

    const half = await analyze(seed, Math.floor(PAGES / 2));
    await publishRunningIssues(db, { workspace_id: seed.workspaceId, crawl_id: seed.crawlId });
    const paging = { limit: 50, cursor: null };
    const running = await timed(() =>
      issues(db, seed.workspaceId, seed.crawlId, unfilteredIssues(null), paging),
    );
    expect(
      running.value.items.find((item) => item.rule_id === 'technical.title_present')
        ?.affected_url_count,
    ).toBe(half);
    await asOwner((owner) =>
      sql`analyze site_urls, monitored_site_urls, site_page_analyses, site_crawl_tasks, site_issues`.execute(
        owner,
      ),
    );
    const [w, c] = [seed.workspaceId, seed.crawlId];
    const runningScans = {
      pages: await scanned((trx) => pages(trx, w, c, {}, 'status', paging)),
      issues_high: await scanned((trx) =>
        issues(trx, w, c, { ...unfilteredIssues(null), severity: 'high' }, paging),
      ),
      issue_fixes: await scanned((trx) => issueFixes(trx, w, c)),
    };
    await analyze(seed, PAGES);

    const metered = meter();
    const worker = new SiteHealthWorker(metered.db, {
      taskScope: { workspaceId: seed.workspaceId, crawlId: seed.crawlId },
    });
    const finalizeStarted = performance.now();
    expect(await fixtures.terminalize(seed, worker)).toBe(true);
    const finalizeMs = Math.round(performance.now() - finalizeStarted);
    const crawl = await harness.crawlRow(seed);
    expect(['completed', 'partially_completed']).toContain(crawl.status);
    const published = await db
      .selectFrom('site_health_snapshots as s')
      .innerJoin('site_health_snapshot_analyses as a', 'a.snapshot_id', 's.id')
      .select(sql<number>`count(*)::int`.as('count'))
      .where('s.crawl_id', '=', seed.crawlId)
      .executeTakeFirstOrThrow();
    expect(published.count).toBe(PAGES);
    const batch = policy.site_health.crawl.finalize;
    expect(metered.most.site_page_analyses).toBeLessThanOrEqual(
      Math.max(batch.projection_pages, batch.read_pages, batch.batch_pages),
    );

    const final = await timed(() =>
      issues(db, seed.workspaceId, seed.crawlId, unfilteredIssues(null), paging),
    );
    expect(
      final.value.items.find((item) => item.rule_id === 'technical.title_present')
        ?.affected_url_count,
    ).toBe(PAGES);
    const pageRead = await timed(() =>
      pages(db, seed.workspaceId, seed.crawlId, {}, 'status', paging),
    );
    expect(pageRead.value.items).toHaveLength(paging.limit);
    process.stdout.write(
      `SCALE ${JSON.stringify({
        scale_pages: PAGES,
        finalize_ms: finalizeMs,
        finalize_peak_heap_mb: Math.round(metered.peak.heap / 2 ** 20),
        most_rows_per_read: metered.most,
        running_issues_read_ms: running.ms,
        running_read_scans: runningScans,
        final_issues_read_ms: final.ms,
        pages_read_ms: pageRead.ms,
      })}\n`,
    );
  });
});
