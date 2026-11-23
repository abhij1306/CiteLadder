import { randomUUID } from 'node:crypto';
import { pagesPageSchema } from '@citeladder/contracts/site-health';
import { sql } from 'kysely';
import { afterAll, expect, it, vi } from 'vitest';

import { createApp } from '../src/app.ts';
import { policy } from '../src/config.ts';
import { refreshIssueCurrency } from '../src/site-health/issue-currency.ts';
import { loadCrawl } from '../src/site-health/reads/crawl.ts';
import { sessionToken, testConfig, testDatabase } from './support.ts';
import { SiteFixtures, type SiteSeed } from './site-health-fixtures.ts';

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
const config = testConfig();
const db = testDatabase(config);
const app = createApp(config, db);
const fixtures = new SiteFixtures(db);

afterAll(async () => {
  await fixtures.cleanup();
  await db.destroy();
});

type Page = Awaited<ReturnType<SiteFixtures['page']>>;
type Measures = { indexable: boolean; web: number; aeo: number | null; depth: number };

async function get(seed: SiteSeed, path: string) {
  return app.request(`/api/v1${path}`, {
    headers: {
      cookie: `${config.session.cookieName}=${await sessionToken({ sub: seed.userId, ver: 0 })}`,
      'x-workspace-id': seed.workspaceId,
    },
  });
}

async function list(seed: SiteSeed, query: string) {
  const response = await get(seed, `/site-crawls/${seed.crawlId}/pages?${query}`);
  expect(response.status, await response.clone().text()).toBe(200);
  return pagesPageSchema.parse(await response.json());
}

async function measuredPage(seed: SiteSeed, path: string, measures: Measures) {
  const page = await fixtures.page(seed, path, {}, { observed: true });
  const { extractor_version } = await loadCrawl(db, seed.workspaceId, seed.crawlId);
  await db
    .updateTable('site_page_analyses')
    .set({
      finalized_at: new Date(),
      source_evaluation_ids: [],
      web_fundamentals_state: 'measured',
      aeo_measurement_state: 'not_measured',
      main_content_indexable: measures.indexable,
      web_fundamentals_score: measures.web,
      aeo_readiness_score: measures.aeo,
    })
    .where('id', '=', page.analysisId)
    .execute();
  await db
    .insertInto('site_page_link_metrics')
    .values({
      id: randomUUID(),
      workspace_id: seed.workspaceId,
      project_id: seed.projectId,
      crawl_id: seed.crawlId,
      site_url_id: page.id,
      inbound_count: 10 - measures.depth,
      outbound_count: 0,
      main_content_inbound_count: 0,
      main_content_outbound_count: 0,
      nofollow_inbound_count: 0,
      depth_from_home: measures.depth,
      source_page_count: 1,
      authority_share: 0,
      authority_rank: 1,
      extractor_version,
      formula_version: policy.site_health.link_metrics.formula_version,
      created_at: new Date(),
    })
    .execute();
  return page;
}

async function currentIssue(seed: SiteSeed, page: Page, ruleId: string) {
  const { source_evaluation_ids: named } = await db
    .selectFrom('site_page_analyses')
    .select('source_evaluation_ids')
    .where('id', '=', page.analysisId)
    .executeTakeFirstOrThrow();
  const evaluationId = await fixtures.evaluation(seed, page, ruleId, 'missing');
  await fixtures.issue(seed, page, ruleId, evaluationId);
  await db
    .updateTable('site_page_analyses')
    .set({
      source_evaluation_ids: sql<string[]>`${named ?? []}::uuid[] || ${[evaluationId]}::uuid[]`,
    })
    .where('id', '=', page.analysisId)
    .execute();
  await refreshIssueCurrency(db, await loadCrawl(db, seed.workspaceId, seed.crawlId));
}

it('filter pages by current issue, indexability, depth and score in the list, its cursor and its export', async () => {
  const seed = await fixtures.crawl();
  const outsider = await fixtures.crawl();
  const home = await measuredPage(seed, '/', { indexable: true, web: 90, aeo: 49.4, depth: 0 });
  const deep = await measuredPage(seed, '/a/b/c', {
    indexable: false,
    web: 40,
    aeo: null,
    depth: 3,
  });
  await measuredPage(seed, '/clean', { indexable: true, web: 79.4, aeo: 80, depth: 1 });
  const stranger = await measuredPage(outsider, '/', { indexable: true, web: 0, aeo: 0, depth: 0 });
  await currentIssue(seed, home, 'technical.indexable');
  await currentIssue(seed, deep, 'technical.indexable');
  await currentIssue(seed, deep, 'web.accessibility_form_names');
  await currentIssue(outsider, stranger, 'technical.indexable');

  const paths = async (query: string) =>
    (await list(seed, `sort=url&${query}`)).items.map(
      (item) => new URL(item.normalized_url).pathname,
    );
  expect(await paths('rule=technical.indexable')).toEqual(['/', '/a/b/c']);
  expect(await paths('rule=web.accessibility_form_names')).toEqual(['/a/b/c']);
  expect(await paths('with_issues=true')).toEqual(['/', '/a/b/c']);
  expect(await paths('indexable=false')).toEqual(['/a/b/c']);
  expect(await paths('indexable=true')).toEqual(['/', '/clean']);
  expect(await paths('min_depth=1&max_depth=2')).toEqual(['/clean']);
  expect(await paths('min_depth=1')).toEqual(['/a/b/c', '/clean']);
  expect(await paths('max_depth=0')).toEqual(['/']);
  expect(await paths('score_role=web_fundamentals&max_score=79')).toEqual(['/a/b/c', '/clean']);
  expect(await paths('score_role=aeo_readiness&max_score=49')).toEqual(['/']);
  expect((await get(seed, `/site-crawls/${seed.crawlId}/pages?max_score=49`)).status).toBe(422);
  expect(
    (await list(outsider, 'rule=technical.indexable')).items.map((item) => item.site_url_id),
  ).toEqual([stranger.id]);

  const first = await list(seed, 'rule=technical.indexable&sort=url&limit=1');
  const resume = (query: string) =>
    get(
      seed,
      `/site-crawls/${seed.crawlId}/pages?sort=url&limit=1&cursor=${first.next_cursor}&${query}`,
    );
  const next = await resume('rule=technical.indexable');
  expect(next.status).toBe(200);
  expect(pagesPageSchema.parse(await next.json()).items.map((item) => item.site_url_id)).toEqual([
    deep.id,
  ]);
  for (const other of [
    'rule=web.accessibility_form_names',
    'rule=technical.indexable&with_issues=true',
    'rule=technical.indexable&indexable=true',
    'rule=technical.indexable&min_depth=0',
    'rule=technical.indexable&max_depth=9',
    'rule=technical.indexable&score_role=web_fundamentals&max_score=100',
  ])
    expect((await resume(other)).status, other).toBe(400);

  const filters = 'rule=technical.indexable&indexable=true&max_depth=2';
  const csv = await (
    await get(seed, `/site-crawls/${seed.crawlId}/export.csv?view=pages&${filters}`)
  ).text();
  const exported = csv
    .trim()
    .split(/\r?\n/u)
    .slice(1)
    .map((line) => line.split(',')[0]);
  expect(exported).toEqual((await list(seed, filters)).items.map((item) => item.site_url_id));
  expect(exported).toEqual([home.id]);
});
