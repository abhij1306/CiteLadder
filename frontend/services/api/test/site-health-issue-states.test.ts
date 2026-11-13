import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { policy } from '../src/config.ts';
import { publishFinalPageAnalyses } from '../src/site-health/terminal-analysis.ts';
import { testDatabase } from './support.ts';
import { SiteFixtures, type SiteSeed } from './site-health-fixtures.ts';

const db = testDatabase();
const fixtures = new SiteFixtures(db);
afterAll(async () => {
  await fixtures.cleanup();
  await db.destroy();
});

const SITEMAP = 'technical.sitemap_redirect';
const CLIENT = 'technical.client_side_redirect';
const minutes = (count: number) => new Date(Date.UTC(2026, 10, 1, 9, count));

/** Land the crawl's audit the way terminal publication does: under its lock. */
async function land(seed: SiteSeed) {
  await db.transaction().execute(async (trx) => {
    const crawl = await trx
      .selectFrom('site_crawls')
      .selectAll()
      .where('id', '=', seed.crawlId)
      .where('workspace_id', '=', seed.workspaceId)
      .forUpdate()
      .executeTakeFirstOrThrow();
    await publishFinalPageAnalyses(trx, crawl);
  });
}

/** Another crawl of the seed's project, audited at `at`; a rerun when `rerun`. */
async function crawlAt(seed: SiteSeed, at: Date, rerun = false): Promise<SiteSeed> {
  const crawlId = await fixtures.sibling(seed, {
    created_at: at,
    started_at: at,
    configuration: rerun ? JSON.stringify({ page_rerun: true }) : null,
  });
  return { ...seed, crawlId };
}

/** The page analyzed in `seed`'s crawl with one evaluation per rule; a failing one is an issue. */
async function audit(
  seed: SiteSeed,
  path: string,
  outcomes: Record<string, 'missing' | 'satisfied' | 'unknown'>,
  siteUrlId?: string,
) {
  const page = await fixtures.page(seed, path, {}, { siteUrlId });
  for (const [ruleId, outcome] of Object.entries(outcomes)) {
    const evaluationId = await fixtures.evaluation(seed, page, ruleId, outcome);
    if (outcome !== 'missing') continue;
    const rule = policy.site_health.rule_catalog.find((item) => item.rule_id === ruleId)!;
    await db
      .insertInto('site_issues')
      .values({
        id: randomUUID(),
        workspace_id: seed.workspaceId,
        project_id: seed.projectId,
        crawl_id: seed.crawlId,
        site_url_id: page.id,
        analysis_id: page.analysisId,
        evaluation_id: evaluationId,
        source_artifact_id: page.artifactId,
        rule_id: ruleId,
        dimension: rule.dimension,
        category: rule.category,
        severity: rule.severity,
        finding_class: rule.finding_class,
        evidence: JSON.stringify({}),
        description: rule.description,
        remediation: rule.remediation,
        analyzer_version: policy.site_health.versions.analyzer,
        rule_version: rule.rule_version,
        created_at: new Date(),
      })
      .execute();
  }
  return page;
}

/** The page's analyze task in `seed`'s crawl failed on a 404. */
async function notFound(seed: SiteSeed, siteUrlId: string) {
  const taskId = await fixtures.task(seed, 'analyze');
  await db
    .updateTable('site_crawl_tasks')
    .set({ status: 'failed', error_code: 'http_4xx', site_url_id: siteUrlId })
    .where('id', '=', taskId)
    .execute();
  const attemptId = randomUUID();
  await db
    .insertInto('site_fetch_attempts')
    .values({
      id: attemptId,
      task_id: taskId,
      crawl_id: seed.crawlId,
      workspace_id: seed.workspaceId,
      attempt_number: 1,
      request_ordinal: 0,
      method: 'GET',
      target_host: 'example.test',
      outcome: 'error',
      error_code: 'http_4xx',
      status_code: 404,
      acquisition_transport: 'recorded',
      acquisition_trigger: 'fixture',
      impersonation_profile: '',
      acquisition_policy_version: 'fixture',
      created_at: new Date(),
    })
    .execute();
  return attemptId;
}

async function states(seed: SiteSeed) {
  const rows = await db
    .selectFrom('site_issue_states')
    .select(['rule_id', 'state'])
    .where('workspace_id', '=', seed.workspaceId)
    .where('project_id', '=', seed.projectId)
    .orderBy('rule_id')
    .execute();
  return Object.fromEntries(rows.map((row) => [row.rule_id, row.state]));
}

async function trend(seed: SiteSeed) {
  return db
    .selectFrom('site_issue_trend')
    .select(['open_count', 'source_crawl_id'])
    .where('workspace_id', '=', seed.workspaceId)
    .where('project_id', '=', seed.projectId)
    .execute();
}

describe('issue state and trend', () => {
  it('opens, resolves and regresses page issues as each audit lands, a rerun included', async () => {
    const seed = await fixtures.crawl('completed');
    const full = await crawlAt(seed, minutes(0));
    const page = await audit(full, '/a', {
      [SITEMAP]: 'missing',
      [CLIENT]: 'missing',
    });
    await land(full);
    expect(await states(seed)).toEqual({ [CLIENT]: 'open', [SITEMAP]: 'open' });
    expect(await trend(seed)).toEqual([{ open_count: 2, source_crawl_id: full.crawlId }]);
    const opened = await db
      .selectFrom('site_issue_states')
      .innerJoin('site_issues', 'site_issues.id', 'site_issue_states.source_issue_id')
      .select(['site_issues.crawl_id', 'site_issues.site_url_id'])
      .where('site_issue_states.rule_id', '=', SITEMAP)
      .where('site_issue_states.project_id', '=', seed.projectId)
      .executeTakeFirstOrThrow();
    expect(opened).toMatchObject({
      crawl_id: full.crawlId,
      site_url_id: page.id,
    });

    // A single-page re-audit passes one rule and cannot judge the other.
    const rerun = await crawlAt(seed, minutes(10), true);
    await audit(rerun, '/a', { [SITEMAP]: 'satisfied', [CLIENT]: 'unknown' }, page.id);
    await land(rerun);
    expect(await states(seed)).toEqual({
      [CLIENT]: 'open',
      [SITEMAP]: 'resolved',
    });
    expect(await trend(seed)).toEqual([{ open_count: 1, source_crawl_id: rerun.crawlId }]);

    const again = await crawlAt(seed, minutes(20), true);
    await audit(again, '/a', { [SITEMAP]: 'missing', [CLIENT]: 'satisfied' }, page.id);
    await land(again);
    expect(await states(seed)).toEqual({
      [CLIENT]: 'resolved',
      [SITEMAP]: 'regressed',
    });

    // An older audit landing late, or a replayed landing, changes nothing.
    const late = await crawlAt(seed, minutes(5));
    await audit(late, '/a', { [SITEMAP]: 'satisfied', [CLIENT]: 'missing' }, page.id);
    await land(late);
    await land(again);
    expect(await states(seed)).toEqual({
      [CLIENT]: 'resolved',
      [SITEMAP]: 'regressed',
    });
    expect((await trend(seed))[0]!.open_count).toBe(1);
  });

  it('marks a 404 page unavailable, never resolved, and recovers when it answers', async () => {
    const seed = await fixtures.crawl('completed');
    const full = await crawlAt(seed, minutes(0));
    const page = await audit(full, '/gone', { [SITEMAP]: 'missing' });
    await land(full);

    const rerun = await crawlAt(seed, minutes(10), true);
    const attemptId = await notFound(rerun, page.id);
    await land(rerun);
    expect(await states(seed)).toEqual({
      [SITEMAP]: 'page_unavailable',
      'technical.page_not_found': 'open',
    });
    const missing = await db
      .selectFrom('site_issue_states')
      .select(['source_attempt_id', 'evidence'])
      .where('project_id', '=', seed.projectId)
      .where('workspace_id', '=', seed.workspaceId)
      .where('rule_id', '=', 'technical.page_not_found')
      .executeTakeFirstOrThrow();
    expect(missing).toEqual({
      source_attempt_id: attemptId,
      evidence: { status_code: 404 },
    });
    expect((await trend(seed))[0]!.open_count).toBe(1);

    const back = await crawlAt(seed, minutes(20), true);
    await audit(back, '/gone', { [CLIENT]: 'satisfied' }, page.id);
    await land(back);
    expect(await states(seed)).toEqual({
      [SITEMAP]: 'open',
      'technical.page_not_found': 'resolved',
    });
  });

  it('opens a redirect issue on a tracked page that answers at another URL', async () => {
    const seed = await fixtures.crawl('completed');
    const full = await crawlAt(seed, minutes(0));
    const page = await audit(full, '/old', { [SITEMAP]: 'missing' });
    await land(full);

    const next = await crawlAt(seed, minutes(10));
    // The tracked /old page's fetch ended at /new.
    await audit(next, '/new', { [SITEMAP]: 'satisfied' }, page.id);
    await land(next);
    expect(await states(seed)).toEqual({
      [SITEMAP]: 'page_unavailable',
      'technical.page_redirects': 'open',
    });
  });

  it('reads a page that left the tracked set as no longer tracked until an audit lands on it', async () => {
    const seed = await fixtures.crawl('completed');
    const full = await crawlAt(seed, minutes(0));
    const kept = await audit(full, '/kept', { [CLIENT]: 'missing' });
    const dropped = await audit(full, '/dropped', { [SITEMAP]: 'missing' });
    await fixtures.monitor(seed, [kept.id, dropped.id]);
    await land(full);
    expect((await trend(seed))[0]!.open_count).toBe(2);

    // A downgrade keeps the first page; the next crawl audits only it.
    await fixtures.monitor(seed, [kept.id]);
    const next = await crawlAt(seed, minutes(10));
    await audit(next, '/kept', { [CLIENT]: 'missing' }, kept.id);
    await land(next);
    expect(await states(seed)).toEqual({ [CLIENT]: 'open', [SITEMAP]: 'no_longer_tracked' });
    expect(await trend(seed)).toEqual([{ open_count: 1, source_crawl_id: next.crawlId }]);

    // An upgrade tracks it again: an audit that cannot judge the rule reopens it.
    await fixtures.monitor(seed, [kept.id, dropped.id]);
    const back = await crawlAt(seed, minutes(20), true);
    await audit(back, '/dropped', { [SITEMAP]: 'unknown' }, dropped.id);
    await land(back);
    expect(await states(seed)).toEqual({ [CLIENT]: 'open', [SITEMAP]: 'open' });
    expect((await trend(seed))[0]!.open_count).toBe(2);
  });

  it("keeps each project's states and trend to its own workspace", async () => {
    const first = await fixtures.crawl('completed');
    const second = await fixtures.crawl('completed');
    const one = await crawlAt(first, minutes(0));
    await audit(one, '/a', { [SITEMAP]: 'missing' });
    await land(one);
    const two = await crawlAt(second, minutes(0));
    const foreign = await audit(two, '/a', { [SITEMAP]: 'satisfied', [CLIENT]: 'missing' });
    await land(two);

    expect(await states(first)).toEqual({ [SITEMAP]: 'open' });
    expect(await states(second)).toEqual({ [CLIENT]: 'open' });
    expect(await trend(first)).toEqual([{ open_count: 1, source_crawl_id: one.crawlId }]);
    expect(await trend(second)).toEqual([{ open_count: 1, source_crawl_id: two.crawlId }]);

    // PostgreSQL refuses a state that names another project's page.
    const own = await db
      .selectFrom('site_issue_states')
      .selectAll()
      .where('workspace_id', '=', first.workspaceId)
      .where('project_id', '=', first.projectId)
      .executeTakeFirstOrThrow();
    await expect(
      db
        .insertInto('site_issue_states')
        .values({ ...own, id: randomUUID(), site_url_id: foreign.id, rule_id: CLIENT })
        .execute(),
    ).rejects.toMatchObject({ code: '23503' });
  });
});
