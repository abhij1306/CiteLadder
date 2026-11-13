import { randomUUID } from 'node:crypto';
import { sql, type Insertable } from 'kysely';
import { afterAll, describe, expect, it, vi } from 'vitest';
import type { SiteCrawls } from '../src/generated/db-schema.ts';
import { record } from '../src/db/json.ts';
import { analyzePage } from '../src/site-health/analysis/analyze-page.ts';
import { extractPageFacts } from '../src/site-health/analysis/facts.ts';
import { pageAnalysisContext, writePageAnalysis } from '../src/site-health/analysis-rows.ts';
import { finalizeCrawlAnalyses } from '../src/site-health/lifecycle-finalize.ts';
import { issues } from '../src/site-health/reads/issues.ts';
import { addArchitectureIssues, persistCrawlSnapshot } from '../src/site-health/snapshot.ts';
import {
  publishCancelledCrawls,
  reconcileAfterTask,
  reconcileCrawl,
  reconcileOverdue,
  ScoreRefreshCadence,
} from '../src/site-health/lifecycle.ts';
import { siteWorkerSettings } from '../src/site-health/runtime.ts';
import { SiteHealthWorker } from '../src/workers/site-health-worker.ts';
import { testDatabase } from './support.ts';
import { SiteFixtures, type SiteSeed } from './site-health-fixtures.ts';

const db = testDatabase();
const fixtures = new SiteFixtures(db);
afterAll(async () => {
  await fixtures.cleanup();
  await db.destroy();
});
async function finalize(seed: SiteSeed) {
  return db.transaction().execute(async (trx) => {
    const crawl = await trx
      .selectFrom('site_crawls')
      .selectAll()
      .where('id', '=', seed.crawlId)
      .where('workspace_id', '=', seed.workspaceId)
      .forUpdate()
      .executeTakeFirstOrThrow();
    await finalizeCrawlAnalyses(trx, crawl);
  });
}

describe('terminal analysis publication', () => {
  it('terminalizes an empty plan exactly once with a null-score snapshot', async () => {
    const seed = await fixtures.crawl('running');
    await Promise.all([
      reconcileCrawl(db, seed.workspaceId, seed.crawlId),
      reconcileCrawl(db, seed.workspaceId, seed.crawlId),
    ]);
    const crawl = await db
      .selectFrom('site_crawls')
      .selectAll()
      .where('id', '=', seed.crawlId)
      .executeTakeFirstOrThrow();
    expect(crawl.status).toBe('failed');
    const snapshots = await db
      .selectFrom('site_health_snapshots')
      .selectAll()
      .where('crawl_id', '=', seed.crawlId)
      .execute();
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]!.web_fundamentals_score).toBeNull();
    expect(
      await db
        .selectFrom('site_crawl_events')
        .select('id')
        .where('crawl_id', '=', seed.crawlId)
        .where('event_type', '=', 'crawl.failed')
        .execute(),
    ).toHaveLength(1);
  });

  it('replaying snapshot publication cannot diverge the frozen summary', async () => {
    const seed = await fixtures.crawl();
    const crawl = await db
      .selectFrom('site_crawls')
      .selectAll()
      .where('id', '=', seed.crawlId)
      .executeTakeFirstOrThrow();
    const publish = () =>
      db.transaction().execute(async (trx) => {
        await trx
          .selectFrom('site_crawls')
          .select('id')
          .where('id', '=', seed.crawlId)
          .forUpdate()
          .execute();
        return persistCrawlSnapshot(trx, crawl, true);
      });
    expect(await publish()).toBe(true);
    const first = await db
      .selectFrom('site_crawls')
      .select('score_summary')
      .where('id', '=', seed.crawlId)
      .executeTakeFirstOrThrow();
    expect(await publish()).toBe(false);
    expect(
      await db
        .selectFrom('site_crawls')
        .select('score_summary')
        .where('id', '=', seed.crawlId)
        .executeTakeFirstOrThrow(),
    ).toEqual(first);
  });
  it('compares only with earlier usable, non-empty site crawls of the same scope', async () => {
    const seed = await fixtures.crawl('completed');
    const publish = async (values: Partial<Insertable<SiteCrawls>>) => {
      const crawlId = await fixtures.sibling(seed, { analyzed_url_count: 1, ...values });
      await persistCrawlSnapshot(db, await crawlRow(crawlId), true);
      return crawlId;
    };
    const changeOf = async (crawlId: string) =>
      record(
        (
          await db
            .selectFrom('site_health_snapshots')
            .select('change_summary')
            .where('crawl_id', '=', crawlId)
            .executeTakeFirstOrThrow()
        ).change_summary,
      );
    // Each earlier snapshot reads a distinct AEO Readiness score, so the compared one shows.
    const scored = async (values: Partial<Insertable<SiteCrawls>>, score: number) => {
      const crawlId = await publish(values);
      await db
        .updateTable('site_health_snapshots')
        .set({ aeo_readiness_score: score })
        .where('crawl_id', '=', crawlId)
        .execute();
      return crawlId;
    };
    const comparable = await scored({}, 70);
    await scored({ status: 'failed' }, 11);
    await scored({ analyzed_url_count: 0 }, 12);
    await scored({ configuration: JSON.stringify({ root_registrable_domain: 'blog.test' }) }, 13);
    // A rerun snapshot written before reruns stopped writing them.
    const rerun = await scored({}, 14);
    await db
      .updateTable('site_crawls')
      .set({ configuration: JSON.stringify({ page_rerun: true }) })
      .where('id', '=', rerun)
      .execute();
    const current = await publish({});
    const change = await changeOf(current);
    expect(change).toMatchObject({ state: 'measured', reason: 'comparable_snapshot' });
    expect(change.metrics).toContainEqual(
      expect.objectContaining({ key: 'aeo_readiness_score', previous: 70 }),
    );

    // The first crawl of a scope has nothing to compare with.
    expect(await changeOf(comparable)).toMatchObject({
      state: 'unavailable',
      reason: 'no_comparable_snapshot',
    });
    const otherScope = await publish({
      configuration: JSON.stringify({ root_registrable_domain: 'other.test' }),
    });
    expect(await changeOf(otherScope)).toMatchObject({
      state: 'unavailable',
      reason: 'no_comparable_snapshot',
    });
    // A crawl older than all of them, published late, has no earlier crawl to compare with.
    const late = await publish({ created_at: LONG_AGO });
    expect(await changeOf(late)).toMatchObject({
      state: 'unavailable',
      reason: 'no_comparable_snapshot',
    });
  });

  it('serializes concurrent finalization and preserves initial evaluation ownership', async () => {
    const seed = await fixtures.crawl('running');
    const page = await fixtures.page(
      seed,
      '/',
      {
        canonical_declarations: ['/'],
        links: { anchors: [] },
        hreflang_alternates: [],
      },
      { observed: true },
    );
    await Promise.all([finalize(seed), finalize(seed)]);
    const analyses = await db
      .selectFrom('site_page_analyses')
      .selectAll()
      .where('crawl_id', '=', seed.crawlId)
      .execute();
    expect(analyses).toHaveLength(2);
    const final = analyses.find((row) => row.is_current)!;
    expect(final.supersedes_analysis_id).toBe(page.analysisId);
    expect(final.finalized_at).not.toBeNull();
    const evaluations = await db
      .selectFrom('site_rule_evaluations')
      .selectAll()
      .where('analysis_id', '=', page.analysisId)
      .execute();
    expect(new Set(final.source_evaluation_ids)).toEqual(new Set(evaluations.map((row) => row.id)));
    expect(
      evaluations.find((row) => row.rule_id === 'technical.canonical_integrity')?.outcome,
    ).toBe('unknown');
    expect(final.source_artifact_ids).toEqual([page.artifactId]);
  });

  it('rolls back evaluations and revisions with the enclosing publication transaction', async () => {
    const seed = await fixtures.crawl('running');
    const page = await fixtures.page(seed, '/', { canonical_declarations: ['/a', '/b'] });
    await expect(
      db.transaction().execute(async (trx) => {
        const crawl = await trx
          .selectFrom('site_crawls')
          .selectAll()
          .where('id', '=', seed.crawlId)
          .forUpdate()
          .executeTakeFirstOrThrow();
        await finalizeCrawlAnalyses(trx, crawl);
        throw new Error('snapshot write failed');
      }),
    ).rejects.toThrow('snapshot write failed');
    const rows = await db
      .selectFrom('site_page_analyses')
      .selectAll()
      .where('crawl_id', '=', seed.crawlId)
      .execute();
    expect(rows.map((row) => [row.id, row.is_current, row.finalized_at])).toEqual([
      [page.analysisId, true, null],
    ]);
    expect(
      await db
        .selectFrom('site_rule_evaluations')
        .select('id')
        .where('analysis_id', '=', page.analysisId)
        .execute(),
    ).toEqual([]);
  });

  it('counts graph-scope architecture issues in the snapshot and crawl summary', async () => {
    const seed = await fixtures.crawl();
    await fixtures.snapshot(seed, 'complete');
    await fixtures.page(seed, '/', {});
    await fixtures.page(seed, '/orphan/product', {});
    await fixtures.task(seed, 'link_metrics');
    await db
      .updateTable('site_crawls')
      .set({ score_summary: JSON.stringify({ issue_count: 0 }) })
      .where('id', '=', seed.crawlId)
      .execute();
    const settings = { ...siteWorkerSettings({}), concurrency: 1 };
    const worker = fixtures.worker(seed, { settings });
    // Link metrics, then architecture, which folds its issues into the snapshot.
    expect(await worker.runOnce()).toBe(1);
    expect(await worker.runOnce()).toBe(1);
    const crawl = await db
      .selectFrom('site_crawls')
      .selectAll()
      .where('id', '=', seed.crawlId)
      .executeTakeFirstOrThrow();
    // A replay adds nothing and leaves one count per persisted issue.
    expect(await addArchitectureIssues(db, crawl)).toBe(false);
    const snapshot = await db
      .selectFrom('site_health_snapshots')
      .select(['issue_count', 'top_issues'])
      .where('crawl_id', '=', seed.crawlId)
      .executeTakeFirstOrThrow();
    expect(snapshot.issue_count).toBe(2);
    expect(
      (snapshot.top_issues as { rule_id: string }[]).map((row) => row.rule_id).toSorted(),
    ).toEqual(['architecture.orphan_pages', 'architecture.parentless_detail_pages']);
    const summary = await db
      .selectFrom('site_crawls')
      .select('score_summary')
      .where('id', '=', seed.crawlId)
      .executeTakeFirstOrThrow();
    expect(summary.score_summary).toEqual({ issue_count: 2 });
    // The issue list a top issue opens holds the same site-level findings.
    const listed = await issues(
      db,
      seed.workspaceId,
      seed.crawlId,
      {
        query: null,
        severity: null,
        category: null,
        dimension: null,
        rule: null,
        siteUrlId: null,
        pageKind: null,
        findingClass: 'defect',
      },
      { limit: 10, cursor: null },
    );
    expect(listed.items.map((group) => group.rule_id).toSorted()).toEqual([
      'architecture.orphan_pages',
      'architecture.parentless_detail_pages',
    ]);
  });

  it('does not wait on internal links the crawler can never fetch', async () => {
    const seed = await fixtures.crawl('running');
    const anchor = (url: string) => ({ url, is_internal: true });
    const neverFetched = [anchor('https://app.example.test/'), anchor('/data/manifest.json')];
    const excludedOnly = await fixtures.page(seed, '/about', {
      links: { anchors: neverFetched },
    });
    const withPage = await fixtures.page(seed, '/guide', {
      links: { anchors: [...neverFetched, anchor('/pricing')] },
    });
    const hiddenMenu = await fixtures.page(seed, '/menu', {
      links: { anchors: [], unrendered_anchors: [anchor('/pricing')] },
    });
    const shell = await fixtures.page(seed, '/app-shell', {
      links: { anchors: [] },
      extraction: { state: 'unavailable', reason: 'client_rendering_required' },
    });
    await finalize(seed);
    const brokenLinks = async (analysisId: string) => {
      const row = await db
        .selectFrom('site_rule_evaluations')
        .select(['outcome', 'evidence', 'reason_code'])
        .where('analysis_id', '=', analysisId)
        .where('rule_id', '=', 'technical.broken_internal_link')
        .executeTakeFirstOrThrow();
      const evidence = row.evidence as { total_count: number };
      return [row.outcome, evidence.total_count, row.reason_code];
    };
    expect(await brokenLinks(excludedOnly.analysisId)).toEqual(['satisfied', 0, '']);
    // A client-rendered shell shows no links at all: nothing was checked, so nothing passes.
    expect(await brokenLinks(shell.analysisId)).toEqual([
      'unknown',
      0,
      'client_rendering_required',
    ]);
    // A fetchable target that was never checked still leaves the check open.
    expect(await brokenLinks(withPage.analysisId)).toEqual(['unknown', 1, 'insufficient_evidence']);
    // A link in a hidden menu is a link crawlers follow, so it is checked too.
    expect(await brokenLinks(hiddenMenu.analysisId)).toEqual([
      'unknown',
      1,
      'insufficient_evidence',
    ]);
  });

  it('judges duplicate content and redirects from the persisted crawl evidence', async () => {
    const seed = await fixtures.crawl('running');
    const text = Array.from({ length: 80 }, (_, i) => `topic${i % 13} detail${i}`).join(' ');
    const page = (links: string[]) => ({
      has_html: true,
      delivery: { status_code: 200 },
      robots: { noindex: false },
      primary_content_text: text,
      links: { anchors: links.map((url) => ({ url, is_internal: true })) },
    });
    const root = await fixtures.page(seed, '/', { has_html: true, links: { anchors: [] } });
    const first = await fixtures.page(seed, '/a', page(['/old']));
    const copy = await fixtures.page(seed, '/b', page([]));
    await fixtures.redirect(seed, '/old', '/new');
    await fixtures.redirect(seed, '/loop');
    await finalize(seed);
    const evaluation = async (analysisId: string, ruleId: string) => {
      const row = await db
        .selectFrom('site_rule_evaluations')
        .select(['outcome', 'evidence'])
        .where('analysis_id', '=', analysisId)
        .where('rule_id', '=', ruleId)
        .executeTakeFirstOrThrow();
      const evidence = row.evidence as Record<string, unknown>;
      return [row.outcome, evidence.duplicates ?? evidence.failing_targets];
    };
    const url = (path: string) => `https://example.test${path}`;
    expect(await evaluation(first.analysisId, 'technical.duplicate_content')).toEqual([
      'missing',
      [{ url: url('/b'), match: 'exact', distance: 0 }],
    ]);
    expect(await evaluation(copy.analysisId, 'technical.duplicate_content')).toEqual([
      'missing',
      [{ url: url('/a'), match: 'exact', distance: 0 }],
    ]);
    expect(await evaluation(first.analysisId, 'technical.internal_link_redirect')).toEqual([
      'missing',
      [{ url: url('/old'), final_url: url('/new'), hops: 1 }],
    ]);
    // The crawl root carries the crawl-wide chain check: one hop passes, a loop fails.
    expect(await evaluation(root.analysisId, 'technical.redirect_chain')).toEqual([
      'missing',
      [{ url: url('/loop'), reason: 'redirect_limit' }],
    ]);
  });

  it('files a redirecting link every page shares as one root issue keyed by the link', async () => {
    const seed = await fixtures.crawl('running');
    const page = (links: string[]) => ({
      has_html: true,
      links: { anchors: links.map((url) => ({ url, is_internal: true, region: 'footer' })) },
    });
    const root = await fixtures.page(seed, '/', page(['/screens']));
    const paths = ['/a', '/b', '/c', '/d', '/e'];
    const others = [];
    for (const path of paths)
      others.push(
        await fixtures.page(seed, path, page(path === '/a' ? ['/screens', '/old'] : ['/screens'])),
      ); // NOSONAR: sequential fixtures.
    await fixtures.redirect(seed, '/screens', '/simulation');
    await fixtures.redirect(seed, '/old', '/new');
    await finalize(seed);
    const crawlIssues = await db
      .selectFrom('site_issues')
      .select(['rule_id', 'site_url_id'])
      .where('crawl_id', '=', seed.crawlId)
      .where('rule_id', 'in', [
        'technical.internal_link_redirect',
        'technical.sitewide_link_redirect',
      ])
      .orderBy('rule_id')
      .execute();
    // The page-specific redirect stays on its page; the shared one is one root issue.
    expect(crawlIssues).toEqual([
      { rule_id: 'technical.internal_link_redirect', site_url_id: others[0]!.id },
      { rule_id: 'technical.sitewide_link_redirect', site_url_id: root.id },
    ]);
    const catalog = await issues(
      db,
      seed.workspaceId,
      seed.crawlId,
      {
        query: null,
        severity: null,
        category: null,
        dimension: null,
        rule: null,
        siteUrlId: null,
        pageKind: null,
        findingClass: 'defect',
      },
      { limit: 50, cursor: null },
    );
    const counts = catalog.items
      .filter((item) => item.rule_id.includes('link_redirect'))
      .map((item) => [item.rule_id, item.affected_url_count]);
    expect(counts).toEqual([
      ['technical.sitewide_link_redirect', 6],
      ['technical.internal_link_redirect', 1],
    ]);
    // Two rows, but the summary's pages are at least the six the shared link is on.
    expect([catalog.summary.occurrence_count, catalog.summary.affected_url_count]).toEqual([2, 6]);
  });

  it('keeps the persisted issue currency equal to the current analyses’ evaluations across a re-analysis', async () => {
    const seed = await fixtures.crawl('running');
    const text = Array.from({ length: 80 }, (_, i) => `topic${i % 13} detail${i}`).join(' ');
    const copy = {
      has_html: true,
      delivery: { status_code: 200 },
      robots: { noindex: false },
      primary_content_text: text,
      links: { anchors: [] },
    };
    await fixtures.page(seed, '/', { has_html: true, links: { anchors: [] } });
    const first = await fixtures.page(seed, '/a', copy);
    const second = await fixtures.page(seed, '/b', copy);
    // How the Issues reads derived currency before the flag existed: every
    // evaluation a current, finalized analysis names, plus architecture findings.
    const derived = async () => {
      const { rows } = await sql<{ id: string }>`
        select i.id from site_issues i
        where i.workspace_id = ${seed.workspaceId} and i.crawl_id = ${seed.crawlId}
          and i.evaluation_id in (
            select unnest(a.source_evaluation_ids) from site_page_analyses a
            where a.workspace_id = ${seed.workspaceId} and a.crawl_id = ${seed.crawlId}
              and a.is_current and a.finalized_at is not null
            union all
            select e.id from site_rule_evaluations e
            join site_observed_architectures o
              on o.id = e.source_architecture_id and o.workspace_id = e.workspace_id
            where o.workspace_id = ${seed.workspaceId} and o.crawl_id = ${seed.crawlId})
        order by i.id`.execute(db);
      return rows.map((row) => row.id);
    };
    const flagged = async () =>
      (
        await db
          .selectFrom('site_issues')
          .select('id')
          .where('crawl_id', '=', seed.crawlId)
          .where('is_current', '=', true)
          .orderBy('id')
          .execute()
      ).map((row) => row.id);
    const currentDuplicates = async () =>
      (
        await db
          .selectFrom('site_issues')
          .select('site_url_id')
          .where('crawl_id', '=', seed.crawlId)
          .where('rule_id', '=', 'technical.duplicate_content')
          .where('is_current', '=', true)
          .orderBy('site_url_id')
          .execute()
      ).map((row) => row.site_url_id);

    // The persisted catalog's duplicate group, as the unfiltered Issues read serves it.
    const catalogDuplicates = async () => {
      const rows = await db
        .selectFrom('site_issue_catalogs')
        .select('items')
        .where('crawl_id', '=', seed.crawlId)
        .execute();
      const group = rows
        .flatMap((row) => (Array.isArray(row.items) ? row.items : []))
        .map((item) => record(item))
        .find((item) => item.rule_id === 'technical.duplicate_content');
      return group?.affected_url_count ?? null;
    };

    await finalize(seed);
    expect(await flagged()).toEqual(await derived());
    expect(await currentDuplicates()).toEqual([first.id, second.id].toSorted());
    expect(await catalogDuplicates()).toBe(2);

    // `/a` is analyzed again over its finalized analysis: its findings stop
    // being current, and the new provisional analysis names none yet.
    const crawl = await db
      .selectFrom('site_crawls')
      .selectAll()
      .where('id', '=', seed.crawlId)
      .executeTakeFirstOrThrow();
    const task = await db
      .selectFrom('site_crawl_tasks')
      .selectAll()
      .where('id', '=', first.taskId)
      .executeTakeFirstOrThrow();
    const facts = extractPageFacts(Buffer.from('<html><head><title>A</title></head></html>'), {
      finalUrl: 'https://example.test/a',
      contentType: 'text/html',
      statusCode: 200,
    });
    const scope = { ...task, site_url_id: first.id };
    await db.transaction().execute(async (trx) => {
      const result = analyzePage(facts, await pageAnalysisContext(trx, crawl, scope));
      await writePageAnalysis(trx, crawl, scope, first.artifactId, facts, result);
    });
    expect(await flagged()).toEqual(await derived());
    expect(await currentDuplicates()).toEqual([second.id]);
    // The re-analysis rewrote the catalog in its own transaction.
    expect(await catalogDuplicates()).toBe(1);

    await finalize(seed);
    expect(await flagged()).toEqual(await derived());
    expect(await currentDuplicates()).toEqual([second.id]);
  });

  it('does not publish another workspace through a mismatched crawl scope', async () => {
    const seed = await fixtures.crawl('running');
    const foreign = await fixtures.crawl('running');
    const page = await fixtures.page(seed, '/', {});
    const crawl = await db
      .selectFrom('site_crawls')
      .selectAll()
      .where('id', '=', seed.crawlId)
      .executeTakeFirstOrThrow();
    await db
      .transaction()
      .execute((trx) =>
        finalizeCrawlAnalyses(trx, { ...crawl, workspace_id: foreign.workspaceId }),
      );
    const saved = await db
      .selectFrom('site_page_analyses')
      .selectAll()
      .where('id', '=', page.analysisId)
      .executeTakeFirstOrThrow();
    expect(saved.is_current).toBe(true);
    expect(saved.finalized_at).toBeNull();
  });
});

const LONG_AGO = new Date('2000-01-01T00:00:00Z');
const crawlRow = (id: string) =>
  db.selectFrom('site_crawls').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
const tasksOf = (id: string, kind: string) =>
  db
    .selectFrom('site_crawl_tasks')
    .selectAll()
    .where('crawl_id', '=', id)
    .where('task_kind', '=', kind)
    .execute();
const snapshots = (id: string) =>
  db.selectFrom('site_health_snapshots').select('id').where('crawl_id', '=', id).execute();
const events = (id: string, type: string) =>
  db
    .selectFrom('site_crawl_events')
    .select('payload')
    .where('crawl_id', '=', id)
    .where('event_type', '=', type)
    .execute();
async function running(changes: Partial<Insertable<SiteCrawls>> = {}) {
  const seed = await fixtures.crawl('running');
  await db
    .updateTable('site_crawls')
    .set({ analysis_status: 'running', discovered_url_count: 2, completed_at: null, ...changes })
    .where('id', '=', seed.crawlId)
    .execute();
  return seed;
}
/** A completed analysis of an active monitored page, settled by its own analyze task. */
async function monitoredPage(seed: SiteSeed, path: string, facts: Record<string, unknown> = {}) {
  const member = await fixtures.analyzable(seed, path);
  await db.deleteFrom('site_crawl_tasks').where('id', '=', member.taskId).execute();
  const page = await fixtures.page(seed, path, facts, { siteUrlId: member.siteUrlId });
  await fixtures.evaluation(seed, page, 'technical.indexable', 'satisfied');
  return page;
}
const settled = (seed: SiteSeed, taskId: string) => ({
  id: taskId,
  crawl_id: seed.crawlId,
  workspace_id: seed.workspaceId,
});
const cadence = () => new ScoreRefreshCadence(siteWorkerSettings({}).scoreRefresh);

describe('crawl lifecycle', () => {
  it('refreshes the live summary while work remains, then terminalizes exactly once', async () => {
    const seed = await running();
    const done = await monitoredPage(seed, '/');
    const pending = await fixtures.analyzable(seed, '/pending');
    await reconcileAfterTask(db, settled(seed, done.taskId), cadence());
    const live = await crawlRow(seed.crawlId);
    expect(live.status).toBe('running');
    expect(live.score_summary).toMatchObject({
      analyzed_count: 1,
      aeo_measurement_state: 'limited_evidence',
    });
    expect(await snapshots(seed.crawlId)).toHaveLength(0);

    await db
      .updateTable('site_crawl_tasks')
      .set({ status: 'failed', error_code: 'task_failed' })
      .where('id', '=', pending.taskId)
      .execute();
    await reconcileAfterTask(db, settled(seed, pending.taskId), cadence());
    await reconcileCrawl(db, seed.workspaceId, seed.crawlId);
    expect(await crawlRow(seed.crawlId)).toMatchObject({
      status: 'partially_completed',
      partial_reason: 'analysis_incomplete',
      analysis_status: 'partially_completed',
      analyzed_url_count: 1,
      failed_url_count: 1,
    });
    expect(await snapshots(seed.crawlId)).toHaveLength(1);
    // The terminalization transaction persisted what the dashboard counts from now on.
    expect((await crawlRow(seed.crawlId)).terminal_counters).toMatchObject({
      analyzed: 1,
      errors: 1,
      queued: 0,
      activity: { state: 'terminal', reason: 'terminal' },
    });
    expect(await events(seed.crawlId, 'crawl.completed')).toHaveLength(1);
    expect((await tasksOf(seed.crawlId, 'change_intel')).map((task) => task.status)).toEqual([
      'queued',
    ]);
    expect(await tasksOf(seed.crawlId, 'link_metrics')).toHaveLength(1);
  });

  it('settles discovery without rebuilding a score only analyses can change', async () => {
    const seed = await running({ discovery_status: 'running' });
    const done = await monitoredPage(seed, '/');
    await fixtures.analyzable(seed, '/pending');
    const discover = await fixtures.task(seed, 'discover');
    await db
      .updateTable('site_crawl_tasks')
      .set({ status: 'succeeded' })
      .where('id', '=', discover)
      .execute();
    await reconcileAfterTask(db, settled(seed, discover), cadence());
    expect(await crawlRow(seed.crawlId)).toMatchObject({
      status: 'running',
      discovery_status: 'completed',
      score_summary: null,
    });
    await reconcileAfterTask(db, settled(seed, done.taskId), cadence());
    expect((await crawlRow(seed.crawlId)).score_summary).toMatchObject({ analyzed_count: 1 });
  });

  it('does not count a policy exclusion as an incomplete analysis', async () => {
    const seed = await running();
    await monitoredPage(seed, '/');
    const excluded = await fixtures.analyzable(seed, '/account');
    await db
      .updateTable('site_crawl_tasks')
      .set({ status: 'failed', error_code: 'url_admission_rejected' })
      .where('id', '=', excluded.taskId)
      .execute();
    await reconcileCrawl(db, seed.workspaceId, seed.crawlId);
    expect(await crawlRow(seed.crawlId)).toMatchObject({
      status: 'completed',
      partial_reason: '',
      failed_url_count: 0,
    });
  });

  it('does not call discovery failed for robots exclusions, pages that are gone, or non-HTML links', async () => {
    const seed = await running();
    await monitoredPage(seed, '/');
    const failedDiscovery = async (
      path: string,
      error_code: string,
      status_code: number | null,
    ) => {
      const page = await fixtures.analyzable(seed, path);
      await db
        .updateTable('site_crawl_tasks')
        .set({ task_kind: 'discover', status: 'failed', error_code })
        .where('id', '=', page.taskId)
        .execute();
      await db
        .insertInto('site_fetch_attempts')
        .values({
          id: randomUUID(),
          workspace_id: seed.workspaceId,
          crawl_id: seed.crawlId,
          task_id: page.taskId,
          attempt_number: 1,
          request_ordinal: 0,
          method: 'GET',
          outcome: 'error',
          error_code,
          status_code,
          target_host: 'example.test',
          acquisition_policy_version: 'fixture',
          acquisition_transport: 'recorded',
          acquisition_trigger: 'fixture',
          impersonation_profile: '',
          created_at: new Date(),
        })
        .execute();
    };
    await failedDiscovery('/policies/privacy-policy', 'robots_denied', null);
    await failedDiscovery('/products/retired', 'http_4xx', 404);
    await failedDiscovery('/size-chart', 'unsupported_content_type', null);
    await reconcileCrawl(db, seed.workspaceId, seed.crawlId);
    expect(await crawlRow(seed.crawlId)).toMatchObject({ status: 'completed', partial_reason: '' });
    const snapshot = await db
      .selectFrom('site_health_snapshots')
      .select('coverage_evidence')
      .where('crawl_id', '=', seed.crawlId)
      .executeTakeFirstOrThrow();
    expect(
      (snapshot.coverage_evidence as { reasons: string[]; failed_discovery_task_count: number })
        .failed_discovery_task_count,
    ).toBe(0);

    // A server error is a real discovery failure.
    const other = await running();
    await monitoredPage(other, '/');
    const page = await fixtures.analyzable(other, '/broken');
    await db
      .updateTable('site_crawl_tasks')
      .set({ task_kind: 'discover', status: 'failed', error_code: 'http_5xx' })
      .where('id', '=', page.taskId)
      .execute();
    await reconcileCrawl(db, other.workspaceId, other.crawlId);
    expect((await crawlRow(other.crawlId)).status).toBe('partially_completed');
  });

  it('counts a page whose fetch failed as an error or exclusion, never as pending', async () => {
    const seed = await running();
    await monitoredPage(seed, '/');
    // The fetch fails at discovery, so no analyze task is ever planned for these pages.
    const failedFetch = async (path: string, error_code: string) => {
      const page = await fixtures.analyzable(seed, path);
      await db
        .updateTable('site_crawl_tasks')
        .set({ task_kind: 'discover', status: 'failed', error_code })
        .where('id', '=', page.taskId)
        .execute();
    };
    await failedFetch('/rate-limited', 'http_4xx');
    await failedFetch('/policies/privacy-policy', 'robots_denied');
    await reconcileCrawl(db, seed.workspaceId, seed.crawlId);
    const snapshot = await db
      .selectFrom('site_health_snapshots')
      .select(['status_counts', 'eligibility_totals'])
      .where('crawl_id', '=', seed.crawlId)
      .executeTakeFirstOrThrow();
    expect(snapshot).toEqual({
      status_counts: { audited: 1, blocked: 0, excluded: 1, error: 1, pending: 0 },
      eligibility_totals: { eligible: 1, blocked: 0, unknown: 1, excluded: 1 },
    });
  });

  it('fails a page rerun or a site crawl whose every analysis failed', async () => {
    const failAnalysis = async (seed: SiteSeed, path: string) => {
      const page = await fixtures.analyzable(seed, path);
      await db
        .updateTable('site_crawl_tasks')
        .set({ status: 'failed', error_code: 'task_failed' })
        .where('id', '=', page.taskId)
        .execute();
    };
    const rerun = await running({
      configuration: JSON.stringify({ page_rerun: true }),
      discovery_status: 'completed',
      discovered_url_count: 1,
    });
    await failAnalysis(rerun, '/rerun');
    const site = await running();
    const root = await fixtures.task(site, 'discover');
    await db
      .updateTable('site_crawl_tasks')
      .set({ status: 'succeeded' })
      .where('id', '=', root)
      .execute();
    await failAnalysis(site, '/a');
    await failAnalysis(site, '/b');
    await reconcileCrawl(db, rerun.workspaceId, rerun.crawlId);
    await reconcileCrawl(db, site.workspaceId, site.crawlId);
    for (const seed of [rerun, site]) {
      expect(await crawlRow(seed.crawlId)).toMatchObject({
        status: 'failed',
        analysis_status: 'failed',
        analyzed_url_count: 0,
      });
      expect(await events(seed.crawlId, 'crawl.failed')).toHaveLength(1);
      expect(await tasksOf(seed.crawlId, 'change_intel')).toHaveLength(0);
    }
  });

  it('drains a page rerun without a project snapshot or a one-page score summary', async () => {
    const rerun = await running({
      configuration: JSON.stringify({ page_rerun: true }),
      discovery_status: 'completed',
      discovered_url_count: 1,
    });
    const page = await monitoredPage(rerun, '/');
    const pending = await fixtures.analyzable(rerun, '/pending');
    await reconcileAfterTask(db, settled(rerun, page.taskId), cadence());
    expect((await crawlRow(rerun.crawlId)).score_summary).toBeNull();
    await db
      .updateTable('site_crawl_tasks')
      .set({ status: 'failed', error_code: 'task_failed' })
      .where('id', '=', pending.taskId)
      .execute();
    await reconcileCrawl(db, rerun.workspaceId, rerun.crawlId);
    expect(await crawlRow(rerun.crawlId)).toMatchObject({
      status: 'partially_completed',
      analyzed_url_count: 1,
      score_summary: null,
    });
    expect(await snapshots(rerun.crawlId)).toHaveLength(0);
    // The rerun still hands its page on.
    expect(await tasksOf(rerun.crawlId, 'change_intel')).toHaveLength(1);

    const site = await running();
    await monitoredPage(site, '/');
    await reconcileCrawl(db, site.workspaceId, site.crawlId);
    expect((await crawlRow(site.crawlId)).score_summary).toMatchObject({ analyzed_count: 1 });
    expect(await snapshots(site.crawlId)).toHaveLength(1);
  });

  it('counts a rerun page once, by its latest generation', async () => {
    const seed = await running();
    const page = await monitoredPage(seed, '/');
    const earlier = await fixtures.task(seed, 'analyze');
    const latest = await db
      .updateTable('site_crawl_tasks')
      .set({ generation: 1 })
      .where('id', '=', page.taskId)
      .returning(['url_hash', 'site_url_id'])
      .executeTakeFirstOrThrow();
    await db
      .updateTable('site_crawl_tasks')
      .set({ ...latest, status: 'failed', error_code: 'task_failed' })
      .where('id', '=', earlier)
      .execute();
    await reconcileCrawl(db, seed.workspaceId, seed.crawlId);
    expect(await crawlRow(seed.crawlId)).toMatchObject({
      status: 'completed',
      analysis_status: 'completed',
      partial_reason: '',
      analyzed_url_count: 1,
      failed_url_count: 0,
    });
  });

  it('marks the inventory complete only when no page limit cut discovery short', async () => {
    const discovered = async (changes: Partial<Insertable<SiteCrawls>>, pending = false) => {
      const seed = await running({ discovery_status: 'running', ...changes });
      const root = await fixtures.task(seed, 'discover');
      await db
        .updateTable('site_crawl_tasks')
        .set({ status: 'succeeded' })
        .where('id', '=', root)
        .execute();
      await fixtures.page(seed, '/', {}, { observed: true });
      if (pending)
        await db
          .insertInto('site_discovery_frontier')
          .values({
            id: randomUUID(),
            workspace_id: seed.workspaceId,
            crawl_id: seed.crawlId,
            url_hash: 'left-behind',
            normalized_url: 'https://example.test/left-behind',
            status: 'pending',
            depth: 1,
            link_ordinal: 0,
            parent_position: 0,
            referrer_site_url_ids: [],
            rewrite_reason: '',
            rewrite_version: '',
            source_kind: 'link',
            value_kind: 'other',
            value_priority: 0,
            admitted_at: null,
            created_at: new Date(),
          })
          .execute();
      await reconcileCrawl(db, seed.workspaceId, seed.crawlId);
      return crawlRow(seed.crawlId);
    };
    expect(await discovered({})).toMatchObject({ status: 'completed', inventory_complete: true });
    // A site with exactly the requested page count exhausted its frontier.
    expect(await discovered({ discovery_requested_count: 1 })).toMatchObject({
      status: 'completed',
      inventory_complete: true,
    });
    expect(await discovered({ discovery_requested_count: 1 }, true)).toMatchObject({
      inventory_complete: false,
    });
  });

  it('hands analytics the crawl identity when no page was analyzed', async () => {
    const seed = await running({ analysis_status: 'pending' });
    await reconcileCrawl(db, seed.workspaceId, seed.crawlId);
    expect((await crawlRow(seed.crawlId)).status).toBe('completed');
    expect(await tasksOf(seed.crawlId, 'change_intel')).toHaveLength(0);
    const handoff = await db
      .selectFrom('analytics_tasks')
      .select(['task_kind', 'payload'])
      .where('project_id', '=', seed.projectId)
      .execute();
    expect(handoff).toContainEqual({
      task_kind: 'opportunity_refresh',
      payload: expect.objectContaining({ trigger_kind: 'site_crawl', trigger_id: seed.crawlId }),
    });
  });

  it('ignores a settled task named under another workspace', async () => {
    const seed = await running();
    const foreign = await running();
    const page = await monitoredPage(seed, '/');
    await reconcileAfterTask(
      db,
      { ...settled(seed, page.taskId), workspace_id: foreign.workspaceId },
      cadence(),
    );
    expect(await crawlRow(seed.crawlId)).toMatchObject({ status: 'running', score_summary: null });
  });

  it('fails the tasks of an overdue crawl and settles it on its evidence, sparing a young crawl', async () => {
    const overdue = await running({ started_at: LONG_AGO, created_at: LONG_AGO });
    await monitoredPage(overdue, '/');
    const wedged = await fixtures.analyzable(overdue, '/wedged');
    await db
      .updateTable('site_crawl_tasks')
      .set({
        status: 'running',
        lease_owner: 'live',
        lease_expires_at: new Date(Date.now() + 60_000),
      })
      .where('id', '=', wedged.taskId)
      .execute();
    const young = await running({ started_at: new Date() });
    const queued = await fixtures.task(young, 'analyze');
    await reconcileOverdue(db, { stalledSeconds: 0, overdueSeconds: 3600, batch: 50 });
    expect(
      (await tasksOf(overdue.crawlId, 'analyze')).find((task) => task.id === wedged.taskId),
    ).toMatchObject({ status: 'failed', error_code: 'crawl_overdue', lease_owner: null });
    expect((await crawlRow(overdue.crawlId)).status).toBe('partially_completed');
    expect((await crawlRow(young.crawlId)).status).toBe('running');
    expect(
      (await tasksOf(young.crawlId, 'analyze')).find((task) => task.id === queued)?.status,
    ).toBe('queued');
  });

  it('a drain over an empty queue still terminalizes a stalled crawl', async () => {
    const stalled = await running({ updated_at: LONG_AGO });
    const worker = new SiteHealthWorker(db, {
      settings: { ...siteWorkerSettings({}), concurrency: 1, poll: 0 },
    });
    // The shared test database holds other suites' due work; this drain sees none.
    vi.spyOn(worker.queue, 'claim').mockResolvedValue([]);
    expect(await worker.runUntilIdle(new AbortController().signal)).toBe(0);
    expect((await crawlRow(stalled.crawlId)).status).toBe('completed');
    expect(await snapshots(stalled.crawlId)).toHaveLength(1);
  });

  it('publishes a cancelled run once and leaves a cancel without evidence unpublished', async () => {
    const seed = await fixtures.crawl('cancelled');
    const page = await monitoredPage(seed, '/', { canonical_url: 'https://example.test/' });
    const plain = await fixtures.crawl('cancelled');
    await monitoredPage(plain, '/');
    const empty = await fixtures.crawl('cancelled');
    await publishCancelledCrawls(db, 50);
    await publishCancelledCrawls(db, 50);
    expect(await snapshots(seed.crawlId)).toHaveLength(1);
    const final = (crawlId: string) =>
      db
        .selectFrom('site_page_analyses')
        .selectAll()
        .where('crawl_id', '=', crawlId)
        .where('is_current', '=', true)
        .executeTakeFirstOrThrow();
    const canonicalCheck = (analysis: { expected_checkpoint_profile: unknown }) =>
      (analysis.expected_checkpoint_profile as { check_id: string }[]).find(
        (entry) => entry.check_id === 'technical.canonical_integrity',
      );
    const current = await final(seed.crawlId);
    expect(current.supersedes_analysis_id).toBe(page.analysisId);
    expect(current.finalized_at).not.toBeNull();
    // The skipped crawl-finalize canonical check is unknown, not silently absent,
    // unless the page declared no canonical for it to judge.
    expect(canonicalCheck(current)).toMatchObject({
      outcome: 'unknown',
      reason: 'crawl_not_finalized',
      web_membership: true,
    });
    expect(canonicalCheck(await final(plain.crawlId))).toMatchObject({
      outcome: 'not_applicable',
      reason: 'no_canonical',
    });
    expect((await crawlRow(seed.crawlId)).score_summary).toMatchObject({
      analyzed_count: 1,
      selected_count: 1,
    });
    expect(await tasksOf(seed.crawlId, 'change_intel')).toHaveLength(1);
    expect(await snapshots(empty.crawlId)).toHaveLength(0);
    expect((await crawlRow(empty.crawlId)).score_summary).toBeNull();
  });

  it('publishes a cancelled page rerun once, without a snapshot or score summary', async () => {
    const rerun = await fixtures.crawl('cancelled');
    await db
      .updateTable('site_crawls')
      .set({ configuration: JSON.stringify({ page_rerun: true }) })
      .where('id', '=', rerun.crawlId)
      .execute();
    const page = await monitoredPage(rerun, '/');
    await publishCancelledCrawls(db, 50);
    await publishCancelledCrawls(db, 50);
    const current = await db
      .selectFrom('site_page_analyses')
      .select(['supersedes_analysis_id'])
      .where('crawl_id', '=', rerun.crawlId)
      .where('is_current', '=', true)
      .executeTakeFirstOrThrow();
    expect(current.supersedes_analysis_id).toBe(page.analysisId);
    expect(await tasksOf(rerun.crawlId, 'change_intel')).toHaveLength(1);
    expect(await snapshots(rerun.crawlId)).toHaveLength(0);
    expect((await crawlRow(rerun.crawlId)).score_summary).toBeNull();
  });
});
