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
import { TEST_SESSION_COOKIE, sessionToken, testConfig, testDatabase } from './support.ts';
import { SiteFixtures, type SiteSeed } from './site-health-fixtures.ts';
import { landFinalRevisions } from './site-health-finalize-fixtures.ts';
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

async function crawlAt(seed: SiteSeed, at: Date, rerun = false): Promise<SiteSeed> {
  const crawlId = await fixtures.sibling(seed, {
    created_at: at,
    started_at: at,
    configuration: rerun ? JSON.stringify({ page_rerun: true }) : null,
  });
  return { ...seed, crawlId };
}

async function audit(
  seed: SiteSeed,
  path: string,
  outcome: 'missing' | 'satisfied',
  siteUrlId?: string,
) {
  const page = await fixtures.page(seed, path, {}, { siteUrlId, observed: true });
  const evaluationId = await fixtures.evaluation(seed, page, SITEMAP, outcome);
  if (outcome === 'satisfied') return page;
  await fileIssue({ seed, page, evaluationId, ruleId: SITEMAP, evidence: {} });
  return page;
}

async function fileIssue({
  seed,
  page,
  evaluationId,
  ruleId,
  evidence,
}: {
  seed: SiteSeed;
  page: Awaited<ReturnType<SiteFixtures['page']>>;
  evaluationId: string;
  ruleId: string;
  evidence: unknown;
}) {
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
      evidence: JSON.stringify(evidence),
      description: rule.description,
      remediation: rule.remediation,
      analyzer_version: policy.site_health.versions.analyzer,
      rule_version: rule.rule_version,
      created_at: new Date(),
    })
    .execute();
}

async function groupOf(seed: SiteSeed, ruleId = SITEMAP) {
  const response = await request(seed, `/site-crawls/${seed.crawlId}/issues`);
  expect(response.status, await response.clone().text()).toBe(200);
  const page = siteIssuesPageSchema.parse(await response.json());
  return page.items.find((item) => item.rule_id === ruleId)!.group_id;
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
    expect(
      await db
        .selectFrom('site_issue_trend')
        .select('open_count')
        .where('project_id', '=', seed.projectId)
        .where('workspace_id', '=', seed.workspaceId)
        .execute(),
    ).toEqual([{ open_count: 2 }]);

    const before = await crawlAt(seed, at(5), true);
    await audit(before, '/a', 'missing', a.id);
    await land(before);
    expect(await stateOf(seed, a.id)).toBe('marked_fixed');

    const verify = await crawlAt(seed, afterMark(1), true);
    await audit(verify, '/a', 'satisfied', a.id);
    await land(verify);
    const recheck = await crawlAt(seed, afterMark(2), true);
    await audit(recheck, '/b', 'missing', b.id);
    await land(recheck);
    expect(await progress(full, groupId)).toEqual({ affected: 2, fixed: 1, verified: 1, rerun: 0 });
    expect(await stateOf(seed, b.id)).toBe('open');
  });

  it('counts a site-level finding by the pages its evidence names, not the homepage it is filed on', async () => {
    const rule = 'architecture.duplicate_titles';
    const seed = await fixtures.crawl('completed');
    const full = await crawlAt(seed, at(0));
    const home = await fixtures.page(full, '/', {}, { observed: true });
    await fileIssue({
      seed: full,
      page: home,
      evaluationId: await fixtures.evaluation(full, home, rule, 'missing'),
      ruleId: rule,
      evidence: {
        count: 16,
        duplicate_set_count: 3,
        duplicate_sets: [],
        page_kind_counts: { about_contact: 5, docs: 5, service: 6 },
        coverage_state: 'complete',
      },
    });
    await land(full);
    const groupId = await groupOf(full, rule);
    expect(await progress(full, groupId)).toEqual({
      affected: 16,
      fixed: 0,
      verified: 0,
      rerun: null,
    });
    const marked = await request(
      full,
      `/site-crawls/${full.crawlId}/issues/${groupId}/mark-fixed`,
      'POST',
    );
    expect(marked.status, await marked.clone().text()).toBe(200);
    expect(await progress(full, groupId)).toEqual({
      affected: 16,
      fixed: 16,
      verified: 0,
      rerun: null,
    });
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

    const rerun = await crawlAt(seed, at(10), true);
    await audit(rerun, '/a', 'satisfied', a.id);
    await audit(rerun, '/c', 'missing', c.id);
    await land(rerun);

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

    const again = await request(full, path, 'POST');
    expect(again.status).toBe(409);
    expect(await again.json()).toMatchObject({ error: { code: 'crawl_already_active' } });
  });
});
