import { afterAll, describe, expect, it } from 'vitest';
import { record } from '../src/db/json.ts';
import { recomputeOpportunities } from '../src/opportunities/refresh.ts';
import { issueHistory } from '../src/site-health/reads/issue-history.ts';
import { issues, unfilteredIssues } from '../src/site-health/reads/issues.ts';
import { pageDetail, pages } from '../src/site-health/reads/pages.ts';
import { testDatabase } from './support.ts';
import { landFinalRevisions } from './site-health-finalize-fixtures.ts';
import { SiteFixtures, type SiteSeed } from './site-health-fixtures.ts';

const db = testDatabase();
const fixtures = new SiteFixtures(db);
afterAll(async () => {
  await fixtures.cleanup();
  await db.destroy();
});

const SITEMAP = 'technical.sitemap_redirect';
const CLIENT = 'technical.client_side_redirect';
const SITEWIDE = 'technical.sitewide_broken_link';
const minutes = (count: number) => new Date(Date.UTC(2026, 10, 1, 9, count));
const paging = { limit: 50, cursor: null };

async function land(seed: SiteSeed) {
  await db.transaction().execute(async (trx) => {
    const crawl = await trx
      .selectFrom('site_crawls')
      .selectAll()
      .where('id', '=', seed.crawlId)
      .where('workspace_id', '=', seed.workspaceId)
      .forUpdate()
      .executeTakeFirstOrThrow();
    await landFinalRevisions(trx, crawl);
  });
}

async function crawlAt(
  seed: SiteSeed,
  at: Date,
  options: { rerun?: boolean; status?: string } = {},
): Promise<SiteSeed> {
  const crawlId = await fixtures.sibling(seed, {
    created_at: at,
    started_at: at,
    status: options.status ?? 'completed',
    configuration: options.rerun ? JSON.stringify({ page_rerun: true }) : null,
  });
  return { ...seed, crawlId };
}

async function audit(
  seed: SiteSeed,
  path: string,
  ruleId: string,
  outcome: 'missing' | 'satisfied',
  siteUrlId?: string,
) {
  const page = await fixtures.page(seed, path, {}, { siteUrlId, observed: true });
  const evaluationId = await fixtures.evaluation(seed, page, ruleId, outcome);
  if (outcome === 'missing') await fixtures.issue(seed, page, ruleId, evaluationId);
  return page;
}

const groups = (page: Awaited<ReturnType<typeof issues>>) =>
  page.items.map((item) => [item.rule_id, item.affected_url_count]);

async function pageCounts(seed: SiteSeed) {
  const page = await pages(db, seed.workspaceId, seed.crawlId, {}, 'url', paging);
  return page.items.map((row) => [new URL(row.normalized_url).pathname, row.issue_count]);
}

describe("Site Health reads show each tracked page's latest audit", () => {
  it('moves a rerun page in Pages, Issues, history and the snapshot of the crawl it lands in', async () => {
    const seed = await fixtures.crawl('completed');
    const full = await crawlAt(seed, minutes(0));
    const a = await audit(full, '/a', SITEMAP, 'missing');
    const b = await audit(full, '/b', CLIENT, 'missing');
    await fixtures.monitor(seed, [a.id, b.id]);
    await land(full);
    await fixtures.snapshot(full);
    const all = unfilteredIssues('defect');
    expect(groups(await issues(db, seed.workspaceId, full.crawlId, all, paging))).toEqual([
      [CLIENT, 1],
      [SITEMAP, 1],
    ]);

    const rerun = await crawlAt(seed, minutes(10), { rerun: true });
    await db
      .updateTable('site_crawls')
      .set({ scoring_version: 'rerun-scoring' })
      .where('id', '=', rerun.crawlId)
      .execute();
    const fixed = await audit(rerun, '/a', SITEMAP, 'satisfied', a.id);
    await land(rerun);

    expect(groups(await issues(db, seed.workspaceId, full.crawlId, all, paging))).toEqual([
      [CLIENT, 1],
    ]);
    const bySitemap = { ...all, rule: SITEMAP };
    const sitemap = await issues(db, seed.workspaceId, full.crawlId, bySitemap, paging);
    expect(sitemap.summary.issue_count).toBe(0);
    expect(await pageCounts(full)).toEqual([
      ['/a', 0],
      ['/b', 1],
    ]);
    const detail = await pageDetail(db, seed.workspaceId, full.crawlId, a.id);
    expect(detail.issues).toEqual([]);
    expect(detail.scoring_version).toBe('rerun-scoring');
    const history = await issueHistory(db, seed.workspaceId, full.crawlId, a.id, paging);
    expect(history.items.map((item) => [item.rule_id, item.crawl_id])).toEqual([
      [SITEMAP, full.crawlId],
    ]);

    const snapshot = await db
      .selectFrom('site_health_snapshots')
      .select(['id', 'issue_count'])
      .where('crawl_id', '=', full.crawlId)
      .executeTakeFirstOrThrow();
    const analysisSet = await db
      .selectFrom('site_health_snapshot_analyses')
      .select('analysis_id')
      .where('snapshot_id', '=', snapshot.id)
      .execute();
    expect(snapshot.issue_count).toBe(1);
    const rerunAnalysis = await db
      .selectFrom('site_page_analyses')
      .select('id')
      .where('crawl_id', '=', rerun.crawlId)
      .where('site_url_id', '=', fixed.id)
      .where('is_current', '=', true)
      .executeTakeFirstOrThrow();
    expect(analysisSet.map((row) => row.analysis_id)).toContain(rerunAnalysis.id);
    const crawl = await db
      .selectFrom('site_crawls')
      .select('score_summary')
      .where('id', '=', full.crawlId)
      .executeTakeFirstOrThrow();
    expect(crawl.score_summary).toMatchObject({ issue_count: 1, selected_count: 2 });
  });

  it("keeps the earlier audit of a tracked page a cancelled crawl never reached, and the rerun's own view", async () => {
    const seed = await fixtures.crawl('completed');
    const first = await crawlAt(seed, minutes(0));
    const a = await audit(first, '/a', SITEMAP, 'missing');
    const b = await audit(first, '/b', CLIENT, 'missing');
    await fixtures.monitor(seed, [a.id, b.id]);
    await land(first);

    const cancelled = await crawlAt(seed, minutes(10), { status: 'cancelled' });
    await audit(cancelled, '/a', SITEMAP, 'satisfied', a.id);
    await land(cancelled);
    const all = unfilteredIssues('defect');
    expect(groups(await issues(db, seed.workspaceId, cancelled.crawlId, all, paging))).toEqual([
      [CLIENT, 1],
    ]);
    expect(groups(await issues(db, seed.workspaceId, first.crawlId, all, paging))).toEqual([
      [CLIENT, 1],
      [SITEMAP, 1],
    ]);

    const rerun = await crawlAt(seed, minutes(20), { rerun: true });
    await audit(rerun, '/b', CLIENT, 'missing', b.id);
    await land(rerun);
    expect(groups(await issues(db, seed.workspaceId, rerun.crawlId, all, paging))).toEqual([
      [CLIENT, 1],
    ]);
  });

  it("keeps the site crawl's site-level findings on the root after a rerun of the root", async () => {
    const seed = await fixtures.crawl('completed');
    const full = await crawlAt(seed, minutes(0));
    const root = await audit(full, '/', SITEWIDE, 'missing');
    await fixtures.monitor(seed, [root.id]);
    await land(full);
    const rerun = await crawlAt(seed, minutes(10), { rerun: true });
    await audit(rerun, '/', SITEMAP, 'satisfied', root.id);
    await land(rerun);

    const all = unfilteredIssues('defect');
    expect(groups(await issues(db, seed.workspaceId, full.crawlId, all, paging))).toEqual([
      [SITEWIDE, 1],
    ]);
    expect(await pageCounts(full)).toEqual([['/', 1]]);
    const detail = await pageDetail(db, seed.workspaceId, full.crawlId, root.id);
    expect(detail.issues.map((issue) => issue.rule_id)).toEqual([SITEWIDE]);
    const history = await issueHistory(db, seed.workspaceId, full.crawlId, root.id, paging);
    expect(history.items.map((item) => item.rule_id)).toEqual([]);
  });

  it('refreshes Opportunities once a rerun lands in the current crawl, and not before', async () => {
    const seed = await fixtures.crawl('completed');
    const full = await crawlAt(seed, new Date(Date.now() + 60_000));
    const a = await audit(full, '/a', SITEMAP, 'missing');
    await fixtures.monitor(seed, [a.id]);
    await land(full);
    const scope = { workspaceId: seed.workspaceId, projectId: seed.projectId };
    const first = await recomputeOpportunities(db, scope, { skipIfCurrent: true });
    expect((await recomputeOpportunities(db, scope, { skipIfCurrent: true })).id).toBe(first.id);

    const rerun = await crawlAt(seed, new Date(Date.now() + 120_000), { rerun: true });
    await audit(rerun, '/a', SITEMAP, 'satisfied', a.id);
    await land(rerun);
    const refreshed = await recomputeOpportunities(db, scope, { skipIfCurrent: true });
    expect(refreshed.id).not.toBe(first.id);
    expect(record(refreshed.coverage.source_identity)).toMatchObject({
      site_crawl_id: full.crawlId,
      site_rerun_id: rerun.crawlId,
    });
  });

  it('shows each tracked page a running crawl has not reached by its earlier audit', async () => {
    const seed = await fixtures.crawl('completed');
    const earlier = await crawlAt(seed, minutes(0));
    const tracked = [];
    for (let index = 0; index < PROBE_PAGES; index++)
      tracked.push(await audit(earlier, `/p-${index}`, SITEMAP, 'missing')); // NOSONAR -- Fixture pages in order.
    await fixtures.monitor(
      seed,
      tracked.map((page) => page.id),
    );
    await land(earlier);
    const running = await crawlAt(seed, minutes(10), { status: 'running' });
    const all = unfilteredIssues('defect');
    expect(groups(await issues(db, seed.workspaceId, running.crawlId, all, paging))).toEqual([
      [SITEMAP, PROBE_PAGES],
    ]);
  });
});

const PROBE_PAGES = 24;
