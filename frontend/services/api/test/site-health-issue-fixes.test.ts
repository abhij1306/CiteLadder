import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import {
  issueFixesSchema,
  issueRerunResponseSchema,
  siteIssuesPageSchema,
} from '@citeladder/contracts/site-health';
import { createApp } from '../src/app.ts';
import { policy } from '../src/config.ts';
import { record } from '../src/db/json.ts';
import { publishFinalPageAnalyses } from '../src/site-health/terminal-analysis.ts';
import { TEST_SESSION_COOKIE, sessionToken, testConfig, testDatabase } from './support.ts';
import { SiteFixtures, type SiteSeed } from './site-health-fixtures.ts';
import type { Tenant } from './visibility-fixtures.ts';

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
const config = testConfig();
const db = testDatabase(config);
const app = createApp(config, db);
const fixtures = new SiteFixtures(db);
afterEach(() => vi.unstubAllEnvs());
afterAll(async () => {
  await fixtures.cleanup();
  await db.destroy();
});

const SITEMAP = 'technical.sitemap_redirect';

async function request(tenant: Tenant, path: string, method = 'GET') {
  return app.request(`/api/v1${path}`, {
    method,
    headers: {
      cookie: `${TEST_SESSION_COOKIE}=${await sessionToken({ sub: tenant.userId, ver: 0 })}`,
      'x-workspace-id': tenant.workspaceId,
      'content-type': 'application/json',
    },
  });
}

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

/** Another crawl of the seed's project, audited at `at`. */
async function crawlAt(seed: SiteSeed, at: Date, rerun = false): Promise<SiteSeed> {
  const crawlId = await fixtures.sibling(seed, {
    created_at: at,
    started_at: at,
    configuration: rerun ? JSON.stringify({ page_rerun: true }) : null,
  });
  return { ...seed, crawlId };
}

/** The page analyzed in `seed`'s crawl; a `missing` sitemap evaluation is an issue. */
async function audit(
  seed: SiteSeed,
  path: string,
  outcome: 'missing' | 'satisfied',
  siteUrlId?: string,
) {
  const page = await fixtures.page(seed, path, {}, { siteUrlId, observed: true });
  const evaluationId = await fixtures.evaluation(seed, page, SITEMAP, outcome);
  if (outcome === 'satisfied') return page;
  const rule = policy.site_health.rule_catalog.find((item) => item.rule_id === SITEMAP)!;
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
      rule_id: SITEMAP,
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
  return page;
}

/** The issue group's id as the Issues list names it. */
async function groupOf(seed: SiteSeed) {
  const response = await request(seed, `/site-crawls/${seed.crawlId}/issues`);
  expect(response.status, await response.clone().text()).toBe(200);
  const page = siteIssuesPageSchema.parse(await response.json());
  return page.items.find((item) => item.rule_id === SITEMAP)!.group_id;
}

async function progress(seed: SiteSeed, groupId: string) {
  const response = await request(seed, `/site-crawls/${seed.crawlId}/issue-fixes`);
  expect(response.status, await response.clone().text()).toBe(200);
  const body = issueFixesSchema.parse(await response.json());
  const item = body.items.find((row) => row.group_id === groupId)!;
  return {
    affected: item.affected_url_count,
    fixed: item.fixed_url_count,
    verified: item.verified_url_count,
    rerun: item.rerun_url_count,
  };
}

async function stateOf(seed: SiteSeed, siteUrlId: string) {
  const row = await db
    .selectFrom('site_issue_states')
    .select('state')
    .where('workspace_id', '=', seed.workspaceId)
    .where('project_id', '=', seed.projectId)
    .where('site_url_id', '=', siteUrlId)
    .where('rule_id', '=', SITEMAP)
    .executeTakeFirstOrThrow();
  return row.state;
}

const at = (minutes: number) => new Date(Date.UTC(2026, 10, 1, 9, minutes));
/** After any mark a test makes now: an audit fetched once the person said it was fixed. */
const afterMark = (minutes: number) => new Date(Date.now() + minutes * 60_000);

describe('Mark fixed (SH-B12)', () => {
  it('marks an issue fixed on its open pages, and only a later audit resolves or reopens it', async () => {
    const seed = await fixtures.crawl('completed');
    const full = await crawlAt(seed, at(0));
    const a = await audit(full, '/a', 'missing');
    const b = await audit(full, '/b', 'missing');
    await land(full);
    const groupId = await groupOf(full);
    expect(await progress(full, groupId)).toEqual({ affected: 2, fixed: 0, verified: 0, rerun: 0 });

    const marked = await request(
      full,
      `/site-crawls/${full.crawlId}/issues/${groupId}/mark-fixed`,
      'POST',
    );
    expect(marked.status, await marked.clone().text()).toBe(200);
    expect(await marked.json()).toMatchObject({
      group_id: groupId,
      affected_url_count: 2,
      fixed_url_count: 2,
      verified_url_count: 0,
    });
    // Marked fixed is still open until an audit verifies it.
    expect(
      await db
        .selectFrom('site_issue_trend')
        .select('open_count')
        .where('project_id', '=', seed.projectId)
        .where('workspace_id', '=', seed.workspaceId)
        .execute(),
    ).toEqual([{ open_count: 2 }]);

    // A crawl that fetched /a before the mark finds the issue: the mark stands.
    const before = await crawlAt(seed, at(5), true);
    await audit(before, '/a', 'missing', a.id);
    await land(before);
    expect(await stateOf(seed, a.id)).toBe('marked_fixed');

    // Audits after the mark decide: /a passes and resolves, /b still fails and reopens.
    const verify = await crawlAt(seed, afterMark(1), true);
    await audit(verify, '/a', 'satisfied', a.id);
    await land(verify);
    const recheck = await crawlAt(seed, afterMark(2), true);
    await audit(recheck, '/b', 'missing', b.id);
    await land(recheck);
    expect(await progress(full, groupId)).toEqual({ affected: 2, fixed: 1, verified: 1, rerun: 0 });
    expect(await stateOf(seed, b.id)).toBe('open');
  });

  it('counts each tracked page at its latest audit, a page verified since the crawl still among M', async () => {
    const seed = await fixtures.crawl('completed');
    const full = await crawlAt(seed, at(0));
    const a = await audit(full, '/a', 'missing');
    const b = await audit(full, '/b', 'missing');
    const c = await audit(full, '/c', 'satisfied');
    await land(full);
    await fixtures.monitor(seed, [a.id, b.id, c.id]);
    const groupId = await groupOf(full);

    // A re-audit after the crawl verifies /a and finds the issue on /c.
    const rerun = await crawlAt(seed, at(10), true);
    await audit(rerun, '/a', 'satisfied', a.id);
    await audit(rerun, '/c', 'missing', c.id);
    await land(rerun);

    // The crawl now shows the issue on /b and /c; /a counts as fixed and verified.
    expect(await progress(full, groupId)).toEqual({ affected: 3, fixed: 1, verified: 1, rerun: 2 });
  });

  it('keeps marks and progress to the workspace that owns the crawl', async () => {
    const seed = await fixtures.crawl('completed');
    const full = await crawlAt(seed, at(0));
    await audit(full, '/a', 'missing');
    await land(full);
    const groupId = await groupOf(full);
    const foreign = await fixtures.crawl('completed');
    const paths: [string, string][] = [
      [`/site-crawls/${full.crawlId}/issue-fixes`, 'GET'],
      [`/site-crawls/${full.crawlId}/issues/${groupId}/mark-fixed`, 'POST'],
      [`/site-crawls/${full.crawlId}/issues/${groupId}/rerun`, 'POST'],
    ];
    for (const [path, method] of paths)
      expect((await request(foreign, path, method)).status).toBe(404);
    expect(await progress(full, groupId)).toMatchObject({ fixed: 0 });
    // An issue the crawl does not have is not found either.
    expect(
      (
        await request(
          full,
          `/site-crawls/${full.crawlId}/issues/${randomUUID()}/mark-fixed`,
          'POST',
        )
      ).status,
    ).toBe(404);
  });
});

describe('Re-run all (SH-B12)', () => {
  function allow() {
    vi.stubEnv('SITE_HEALTH_MONITORED_URL_LIMIT', '10');
  }

  /** /a and /b tracked and failing, /c failing but untracked, /d tracked and since resolved. */
  async function issueOnFourPages() {
    const seed = await fixtures.crawl('completed');
    const full = await crawlAt(seed, at(0));
    const a = await audit(full, '/a', 'missing');
    const b = await audit(full, '/b', 'missing');
    const c = await audit(full, '/c', 'missing');
    const d = await audit(full, '/d', 'missing');
    await land(full);
    const fixedLater = await crawlAt(seed, at(10), true);
    await audit(fixedLater, '/d', 'satisfied', d.id);
    await land(fixedLater);
    await fixtures.monitor(seed, [a.id, b.id, d.id]);
    return { seed, full, pages: { a, b, c, d }, groupId: await groupOf(full) };
  }

  it('re-audits every tracked page the issue is open on as one crawl, one fetch each', async () => {
    const { seed, full, pages, groupId } = await issueOnFourPages();
    allow();
    expect(await progress(full, groupId)).toEqual({ affected: 4, fixed: 1, verified: 1, rerun: 2 });

    const path = `/site-crawls/${full.crawlId}/issues/${groupId}/rerun`;
    const response = await request(full, path, 'POST');
    expect(response.status, await response.clone().text()).toBe(202);
    const rerun = issueRerunResponseSchema.parse(await response.json());
    expect(rerun.page_count).toBe(2);
    const crawl = await db
      .selectFrom('site_crawls')
      .select(['configuration', 'status'])
      .where('id', '=', rerun.crawl_id)
      .where('workspace_id', '=', seed.workspaceId)
      .executeTakeFirstOrThrow();
    expect(record(crawl.configuration)).toMatchObject({
      page_rerun: true,
      requested_page_limit: 2,
    });
    const tasks = await db
      .selectFrom('site_crawl_tasks')
      .select(['task_kind', 'site_url_id'])
      .where('crawl_id', '=', rerun.crawl_id)
      .where('workspace_id', '=', seed.workspaceId)
      .orderBy('site_url_id')
      .execute();
    expect(tasks).toEqual(
      [pages.a.id, pages.b.id]
        .sort()
        .map((siteUrlId) => ({ task_kind: 'analyze', site_url_id: siteUrlId })),
    );

    // While that re-audit runs, another is refused and adds no work (SH-B4).
    const again = await request(full, path, 'POST');
    expect(again.status).toBe(409);
    expect(await again.json()).toMatchObject({ error: { code: 'crawl_already_active' } });
  });
});
