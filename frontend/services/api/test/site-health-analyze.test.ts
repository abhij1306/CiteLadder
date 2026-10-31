import { readFileSync } from 'node:fs';
import { afterAll, describe, expect, it, vi } from 'vitest';

import { policy } from '../src/config.ts';
import { record } from '../src/db/json.ts';
import type { FetchedPage } from '../src/projects/safe-fetch.ts';
import { isBotBlock, SitePageFetcher, siteFetchSettings } from '../src/site-health/page-fetch.ts';
import { siteTaskSettings } from '../src/site-health/site-task.ts';
import { crawlCounters } from '../src/site-health/reads/crawl.ts';
import * as interpretation from '../src/site-health/analysis/off-thread.ts';
import { hardExcluded } from '../src/site-health/url-admission.ts';
import { siteWorkerSettings } from '../src/site-health/runtime.ts';
import { SiteHealthWorker } from '../src/workers/site-health-worker.ts';
import { testDatabase } from './support.ts';
import { recordedSite, SiteFixtures, type Served, type SiteSeed } from './site-health-fixtures.ts';

const db = testDatabase();
const fixtures = new SiteFixtures(db);
afterAll(async () => {
  await fixtures.cleanup();
  await db.destroy();
});

const codes = policy.site_health.page_analysis.acquisition.error_codes;
const workerSettings = {
  ...siteWorkerSettings({}),
  concurrency: 1,
  retryBase: 0,
  retryMax: 0,
  retryJitter: 0,
};
const fetchSettings = siteFetchSettings({
  SITE_HEALTH_PER_HOST_DELAY_SECONDS: '0',
  SITE_HEALTH_DEFAULT_CRAWL_DELAY_SECONDS: '0',
});
const RICH =
  "<html lang='en'><head><title>Rich page about widgets</title><meta name='description' content='Widgets.'></head>" +
  '<body><main><h1>Widgets</h1><p>Widgets are useful tools for small workshops.</p></main></body></html>';

const site = (pages: Record<string, Served>, requests: string[] = []) =>
  new SitePageFetcher(db, recordedSite(pages, requests), fetchSettings);
/** Lease exactly these tasks to one worker and execute them, as its claim would. */
async function analyze(fetcher: SitePageFetcher, ...taskIds: string[]) {
  const worker = new SiteHealthWorker(db, {
    owner: 'analyze-test',
    settings: workerSettings,
    fetcher,
  });
  for (const id of taskIds) await worker.execute(await lease(id, worker.owner));
}

async function running(values: Record<string, unknown> = {}) {
  const seed = await fixtures.crawl('running');
  await db
    .updateTable('site_crawls')
    .set({ completed_at: null, analysis_status: 'running', ...values })
    .where('id', '=', seed.crawlId)
    .execute();
  return seed;
}
const task = (id: string) =>
  db.selectFrom('site_crawl_tasks').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
const crawl = (seed: SiteSeed) =>
  db.selectFrom('site_crawls').selectAll().where('id', '=', seed.crawlId).executeTakeFirstOrThrow();
const analyses = (seed: SiteSeed, siteUrlId: string) =>
  db
    .selectFrom('site_page_analyses')
    .selectAll()
    .where('crawl_id', '=', seed.crawlId)
    .where('site_url_id', '=', siteUrlId)
    .orderBy('created_at')
    .execute();
const attempts = (taskId: string) =>
  db
    .selectFrom('site_fetch_attempts')
    .selectAll()
    .where('task_id', '=', taskId)
    .orderBy('request_ordinal')
    .execute();

describe('analyze acquisition', () => {
  it('retains the sitemap observation that establishes indexing intent', async () => {
    const seed = await running();
    const page = await fixtures.analyzable(seed, '/sitemap-page');
    const observationId = crypto.randomUUID();
    await db
      .insertInto('site_url_observations')
      .values({
        id: observationId,
        workspace_id: seed.workspaceId,
        project_id: seed.projectId,
        crawl_id: seed.crawlId,
        site_url_id: page.siteUrlId,
        observed_url: page.url,
        final_url: page.url,
        depth: 1,
        source_kind: 'sitemap',
        rewrite_reason: '',
        rewrite_version: '',
        title: '',
        content_type: '',
        value_kind: 'page',
        value_priority: 0,
        created_at: new Date(),
      })
      .execute();
    await analyze(
      site({
        '/sitemap-page': {
          body: RICH.replace('</head>', '<meta name="robots" content="noindex"></head>'),
        },
      }),
      page.taskId,
    );
    const [analysis] = await analyses(seed, page.siteUrlId);
    const evaluation = await db
      .selectFrom('site_rule_evaluations')
      .select(['evidence', 'outcome', 'extractor_version'])
      .where('analysis_id', '=', analysis!.id)
      .where('rule_id', '=', 'technical.indexable')
      .executeTakeFirstOrThrow();
    expect(evaluation).toMatchObject({
      outcome: 'missing',
      extractor_version: policy.site_health.versions.extractor,
    });
    expect(record(evaluation.evidence)).toMatchObject({
      intent_source: 'sitemap_membership',
      context_sources: { sitemap_crawl_id: seed.crawlId, sitemap_observation_id: observationId },
    });
  });

  it('acquires, analyzes and settles the page with its evidence in one commit', async () => {
    const seed = await running({ status: 'queued', started_at: null });
    const page = await fixtures.analyzable(seed, '/rich');
    // Outstanding sibling work keeps the crawl (and this provisional analysis) open.
    await fixtures.analyzable(seed, '/later');
    const requests: string[] = [];
    await analyze(site({ '/rich': { body: RICH } }, requests), page.taskId);

    const settled = await task(page.taskId);
    expect(settled).toMatchObject({
      status: 'succeeded',
      attempt_count: 1,
      classification_expected: true,
      error_code: '',
    });
    expect(requests).toEqual(['/robots.txt', '/rich']);
    const artifact = await db
      .selectFrom('site_fetch_artifacts')
      .selectAll()
      .where('id', '=', settled.result_artifact_id!)
      .executeTakeFirstOrThrow();
    expect(artifact).toMatchObject({
      fetch_purpose: 'analyze',
      status_code: 200,
      task_id: page.taskId,
    });
    expect(record(artifact.normalized_facts).title).toBe('Rich page about widgets');
    expect(await attempts(page.taskId)).toEqual([
      expect.objectContaining({
        request_ordinal: 0,
        outcome: 'success',
        status_code: 200,
        artifact_id: artifact.id,
      }),
    ]);

    const [analysis] = await analyses(seed, page.siteUrlId);
    expect(analysis).toMatchObject({
      artifact_id: artifact.id,
      status: 'completed',
      is_current: true,
      finalized_at: null,
      analyzer_version: policy.site_health.versions.analyzer,
    });
    expect(analysis!.web_fundamentals_score).not.toBeNull();
    const evaluations = await db
      .selectFrom('site_rule_evaluations')
      .select(['id', 'rule_id', 'outcome'])
      .where('analysis_id', '=', analysis!.id)
      .execute();
    expect(new Set(evaluations.map((row) => row.id))).toEqual(
      new Set(analysis!.source_evaluation_ids),
    );
    expect(evaluations.find((row) => row.rule_id === 'technical.canonical_present')!.outcome).toBe(
      'missing',
    );
    const issues = await db
      .selectFrom('site_issues')
      .select('rule_id')
      .where('analysis_id', '=', analysis!.id)
      .execute();
    expect(issues.map((row) => row.rule_id)).toContain('technical.canonical_present');

    const after = await crawl(seed);
    expect(after).toMatchObject({ status: 'running', analyzed_url_count: 1 });
    expect(after.started_at).not.toBeNull();
    const url = await db
      .selectFrom('site_urls')
      .selectAll()
      .where('id', '=', page.siteUrlId)
      .executeTakeFirstOrThrow();
    expect(url).toMatchObject({
      latest_title: 'Rich page about widgets',
      discovery_status: 'completed',
    });
  });

  it('reuses the discover artifact without refetching, and a rerun supersedes the current analysis', async () => {
    const seed = await running();
    const page = await fixtures.analyzable(seed, '/');
    await fixtures.analyzable(seed, '/later');
    const facts = {
      has_html: true,
      title: 'Home',
      delivery: { final_url: page.url, status_code: 200 },
    };
    const discovered = await fixtures.discover(seed, page.hash, 'succeeded', facts);
    const requests: string[] = [];
    const fetcher = site({}, requests);
    await analyze(fetcher, page.taskId);
    expect(await task(page.taskId)).toMatchObject({
      status: 'succeeded',
      result_artifact_id: discovered.artifactId,
      classification_expected: true,
    });
    expect(requests).toEqual([]);
    expect(await attempts(page.taskId)).toEqual([]);

    await analyze(fetcher, page.taskId);
    const rows = await analyses(seed, page.siteUrlId);
    expect(rows.map((row) => [row.artifact_id, row.is_current])).toEqual([
      [discovered.artifactId, false],
      [discovered.artifactId, true],
    ]);
    expect((await crawl(seed)).analyzed_url_count).toBe(2);
  });

  it.each(['product', 'category', 'other'])(
    'hands %s analyses to Commerce only for catalog pages',
    async (kind) => {
      const seed = await running();
      await fixtures.businessProfile(seed, { business_model: 'retail' });
      const path =
        kind === 'product'
          ? '/products/widget'
          : kind === 'category'
            ? '/collections/widgets'
            : '/plain';
      const page = await fixtures.analyzable(seed, path);
      const body =
        kind === 'product'
          ? readFileSync(new URL('./fixtures/site-health/multi_main_product.html', import.meta.url))
          : kind === 'category'
            ? readFileSync(
                new URL('./fixtures/site-health/category_faceted_canonical.html', import.meta.url),
              )
            : RICH;
      await analyze(site({ [path]: { body } }), page.taskId);
      const [analysis] = await analyses(seed, page.siteUrlId);
      expect(analysis!.page_kind).toBe(kind);
      const queued = await db
        .selectFrom('analytics_tasks')
        .select('payload')
        .where('workspace_id', '=', seed.workspaceId)
        .where('project_id', '=', seed.projectId)
        .where('task_kind', '=', 'commerce_catalog_projection')
        .execute();
      expect(queued.map((row) => record(row.payload).source_analysis_id)).toEqual(
        kind === 'other' ? [] : [analysis!.id],
      );
    },
  );

  it('waits for in-flight prerequisites without spending an attempt, then acquires past the bound', async () => {
    const seed = await running({ site_facts: null });
    const root = await fixtures.analyzable(seed, '/');
    await fixtures.discover(seed, root.hash, 'running', null);
    const requests: string[] = [];
    const fetcher = site({ '/': { body: RICH } }, requests);
    await analyze(fetcher, root.taskId);
    const deferred = await task(root.taskId);
    expect(deferred).toMatchObject({ status: 'queued', attempt_count: 0, lease_owner: null });
    expect(deferred.available_at.getTime()).toBeGreaterThan(Date.now());
    expect(requests).toEqual([]);

    // The root also waits for site setup, whose facts only its analysis reads.
    const other = await running({ site_facts: null });
    const otherRoot = await fixtures.analyzable(other, '/');
    await fixtures.task(other, 'site_setup');
    await analyze(fetcher, otherRoot.taskId);
    expect((await task(otherRoot.taskId)).status).toBe('queued');

    const old = new Date(Date.now() - (siteTaskSettings({}).dependencyMaxWait + 60) * 1000);
    await db
      .updateTable('site_crawl_tasks')
      .set({ created_at: old, available_at: new Date() })
      .where('id', '=', root.taskId)
      .execute();
    await analyze(fetcher, root.taskId);
    expect((await task(root.taskId)).status).toBe('succeeded');
    expect(requests).toEqual(['/robots.txt', '/']);
  });

  it('evaluates site-root rules on the root analysis only and never persists the injected site facts', async () => {
    const siteFacts = {
      robots: {
        fetched: true,
        status: 'fetched',
        status_code: 200,
        url: 'https://example.test/robots.txt',
      },
    };
    const seed = await running({ site_facts: JSON.stringify(siteFacts) });
    const root = await fixtures.analyzable(seed, '/');
    const child = await fixtures.analyzable(seed, '/a');
    const fetcher = site({ '/': { body: RICH }, '/a': { body: RICH } });
    await analyze(fetcher, root.taskId, child.taskId);
    const robotsRule = async (siteUrlId: string) => {
      const [analysis] = await analyses(seed, siteUrlId);
      return db
        .selectFrom('site_rule_evaluations')
        .select('outcome')
        .where('analysis_id', '=', analysis!.id)
        .where('rule_id', '=', 'technical.robots_txt_present')
        .executeTakeFirstOrThrow();
    };
    expect((await robotsRule(root.siteUrlId)).outcome).toBe('satisfied');
    expect((await robotsRule(child.siteUrlId)).outcome).toBe('not_applicable');
    const artifact = await db
      .selectFrom('site_fetch_artifacts')
      .select('normalized_facts')
      .where('task_id', '=', root.taskId)
      .executeTakeFirstOrThrow();
    expect(record(artifact.normalized_facts)).not.toHaveProperty('site');
  });
});

describe('analyze failures', () => {
  it('settles an exhausted retryable response as failed', async () => {
    const seed = await running();
    const page = await fixtures.analyzable(seed, '/exhausted');
    await db
      .updateTable('site_crawl_tasks')
      .set({ attempt_count: 2, max_attempts: 3 })
      .where('id', '=', page.taskId)
      .execute();
    await analyze(site({ '/exhausted': { status: 503 } }), page.taskId);
    expect(await task(page.taskId)).toMatchObject({ status: 'failed', attempt_count: 3 });
    expect((await task(page.taskId)).completed_at).not.toBeNull();
  });

  it.each(['45', '3600', 'invalid', '0', 'past-date', 'http-date'])(
    'persists a bounded retry window from Retry-After %s',
    async (advice) => {
      const seed = await running();
      const page = await fixtures.analyzable(seed, '/limited');
      const before = Date.now();
      const header =
        advice === 'http-date'
          ? new Date(before + 45_000).toUTCString()
          : advice === 'past-date'
            ? new Date(before - 45_000).toUTCString()
            : advice;
      await analyze(
        site({ '/limited': { status: 429, headers: { 'retry-after': header } } }),
        page.taskId,
      );
      const settled = await task(page.taskId);
      const settings = siteTaskSettings({});
      const expected =
        header === '45'
          ? 45
          : header === '3600'
            ? settings.retryMax
            : ['invalid', '0', 'past-date'].includes(advice)
              ? Math.min(settings.retryBase * 2, settings.retryMax) + 0.37 * settings.retryJitter
              : (Date.parse(header) - before) / 1000;
      expect(settled.status).toBe('retry_wait');
      expect(settled.available_at.getTime() - before).toBeGreaterThanOrEqual(
        expected * 1000 - 1000,
      );
      expect(settled.available_at.getTime() - before).toBeLessThan(expected * 1000 + 3000);
    },
  );
  it.each([
    [
      'a challenge interstitial',
      {
        status: 403,
        body: '<html><title>Just a moment...</title><div id="challenge-platform"></div></html>',
      },
      'failed',
      codes.bot_blocked,
    ],
    ['a plain 404', { status: 404, body: 'gone' }, 'failed', codes.http_4xx],
    ['a 429', { status: 429, body: '' }, 'retry_wait', codes.http_4xx],
    ['a 503', { status: 503, body: '' }, 'retry_wait', codes.http_5xx],
  ])(
    'settles %s without analysis and keeps the call as a failed attempt',
    async (_label, served, status, code) => {
      const seed = await running();
      const page = await fixtures.analyzable(seed, '/page');
      await analyze(site({ '/page': served }), page.taskId);
      const settled = await task(page.taskId);
      expect(settled).toMatchObject({
        status,
        error_code: code,
        attempt_count: 1,
        result_artifact_id: null,
      });
      expect(await attempts(page.taskId)).toEqual([
        expect.objectContaining({
          outcome: policy.site_health.reads.fetch_attempt_error_outcome,
          status_code: served.status,
          artifact_id: null,
        }),
      ]);
      expect(await analyses(seed, page.siteUrlId)).toEqual([]);
    },
  );

  it('honors robots before any page request and records one diagnostic attempt', async () => {
    const seed = await running();
    const page = await fixtures.analyzable(seed, '/private');
    const requests: string[] = [];
    await analyze(
      site(
        { '/robots.txt': { body: 'User-agent: *\nDisallow: /\n', contentType: 'text/plain' } },
        requests,
      ),
      page.taskId,
    );
    expect(await task(page.taskId)).toMatchObject({
      status: 'failed',
      error_code: codes.robots_denied,
    });
    expect(requests).toEqual(['/robots.txt']);
    expect(await attempts(page.taskId)).toEqual([
      expect.objectContaining({ error_code: codes.robots_denied, status_code: null }),
    ]);
  });

  it('never follows a redirect into a hard-excluded endpoint', async () => {
    const seed = await running();
    const page = await fixtures.analyzable(seed, '/promo');
    const requests: string[] = [];
    await analyze(site({ '/promo': { status: 302, redirect: '/cart' } }, requests), page.taskId);
    expect(await task(page.taskId)).toMatchObject({
      status: 'failed',
      error_code: codes.url_admission_rejected,
    });
    expect(requests).toEqual(['/robots.txt', '/promo']);
  });

  it('keeps a bodyless success out of the classification cohort', async () => {
    const seed = await running();
    const page = await fixtures.analyzable(seed, '/empty');
    await analyze(site({ '/empty': { status: 204, body: '' } }), page.taskId);
    expect(await task(page.taskId)).toMatchObject({
      status: 'succeeded',
      classification_expected: false,
    });
  });
});

async function lease(taskId: string, owner: string) {
  return db
    .updateTable('site_crawl_tasks')
    .set({ status: 'leased', lease_owner: owner, lease_expires_at: new Date(Date.now() + 60_000) })
    .where('id', '=', taskId)
    .returningAll()
    .executeTakeFirstOrThrow();
}

describe('analyze guards', () => {
  it('commits current setup facts even when context changes on the final allowed attempt', async () => {
    const seed = await running();
    const page = await fixtures.analyzable(seed, '/');
    await db
      .updateTable('site_crawl_tasks')
      .set({ max_attempts: 1 })
      .where('id', '=', page.taskId)
      .execute();
    const interpret = interpretation.analyzePageAsync;
    const changed = { robots: { fetched: true, status: 'fetched', status_code: 200 } };
    const spy = vi
      .spyOn(interpretation, 'analyzePageAsync')
      .mockImplementationOnce(async (...args) => {
        const result = await interpret(...args);
        await db
          .updateTable('site_crawls')
          .set({ site_facts: JSON.stringify(changed) })
          .where('id', '=', seed.crawlId)
          .execute();
        return result;
      });
    try {
      const fetcher = site({ '/': { body: RICH } });
      await analyze(fetcher, page.taskId);
      expect(await task(page.taskId)).toMatchObject({ status: 'succeeded', attempt_count: 1 });
      const [analysis] = await analyses(seed, page.siteUrlId);
      const evaluation = await db
        .selectFrom('site_rule_evaluations')
        .select(['outcome', 'evidence'])
        .where('analysis_id', '=', analysis!.id)
        .where('rule_id', '=', 'technical.robots_txt_present')
        .executeTakeFirstOrThrow();
      expect(evaluation.outcome).toBe('satisfied');
      expect(record(evaluation.evidence).context_sources).toMatchObject({
        site_facts_crawl_id: seed.crawlId,
      });
      expect(await attempts(page.taskId)).toHaveLength(1);
    } finally {
      spy.mockRestore();
    }
  });

  it('reports a held worker lease as active work, including while other pages await retries', async () => {
    const seed = await running();
    const page = await fixtures.analyzable(seed, '/held');
    const waiting = await fixtures.analyzable(seed, '/waiting');
    await lease(page.taskId, 'held-worker');
    await db
      .updateTable('site_crawl_tasks')
      .set({
        status: 'retry_wait',
        available_at: new Date(Date.now() + 60_000),
      })
      .where('id', '=', waiting.taskId)
      .execute();
    expect((await crawlCounters(db, await crawl(seed))).activity).toMatchObject({
      state: 'working',
      reason: 'active_work',
      queue_depth: 2,
    });
  });

  it('does not reuse foreign workspace evidence even when its crawl and URL match', async () => {
    const seed = await running();
    const foreign = await running();
    const page = await fixtures.analyzable(seed, '/isolated');
    const discovered = await fixtures.discover(foreign, page.hash, 'succeeded', {
      has_html: true,
      title: 'Foreign evidence',
      delivery: { final_url: page.url },
    });
    // Inconsistent persisted references must still fail closed at the read boundary.
    await db
      .updateTable('site_fetch_artifacts')
      .set({ crawl_id: seed.crawlId })
      .where('id', '=', discovered.artifactId!)
      .execute();
    const requests: string[] = [];
    await analyze(site({ '/isolated': { body: RICH } }, requests), page.taskId);
    const settled = await task(page.taskId);
    expect(settled.status).toBe('succeeded');
    expect(settled.result_artifact_id).not.toBe(discovered.artifactId);
    expect(requests).toEqual(['/robots.txt', '/isolated']);
    const [analysis] = await analyses(seed, page.siteUrlId);
    expect(analysis!.workspace_id).toBe(seed.workspaceId);
    expect(analysis!.source_artifact_ids).toEqual([settled.result_artifact_id]);
    expect(await analyses(foreign, page.siteUrlId)).toEqual([]);
  });

  it('cancels before fetching the page when the monitored-URL limit is 0', async () => {
    const seed = await running();
    const user = await fixtures.analyzable(seed, '/user', { monitoredLimit: 0 });
    const sample = await fixtures.analyzable(seed, '/sample', {
      monitoredLimit: 0,
      source: 'free_sample',
    });
    const requests: string[] = [];
    await analyze(site({ '/sample': { body: RICH } }, requests), user.taskId, sample.taskId);
    expect(await task(user.taskId)).toMatchObject({ status: 'cancelled', error_code: 'cancelled' });
    expect(await task(sample.taskId)).toMatchObject({
      status: 'cancelled',
      error_code: 'cancelled',
    });
    expect(requests).not.toContain('/user');
    expect(requests).not.toContain('/sample');
  });

  it.each([
    [
      'membership removed',
      (seed: SiteSeed, siteUrlId: string) =>
        db
          .updateTable('monitored_site_urls')
          .set({ active: false })
          .where('site_url_id', '=', siteUrlId)
          .execute(),
      'cancelled',
    ],
    [
      'lease lost',
      (_seed: SiteSeed, _siteUrlId: string, taskId: string) =>
        db
          .updateTable('site_crawl_tasks')
          .set({ lease_owner: 'another-worker' })
          .where('id', '=', taskId)
          .execute(),
      'running',
    ],
    [
      'crawl cancelled',
      (seed: SiteSeed) =>
        db
          .updateTable('site_crawls')
          .set({ status: 'cancelled' })
          .where('id', '=', seed.crawlId)
          .execute(),
      'cancelled',
    ],
  ])('writes no evidence when the %s during the fetch', async (_label, interrupt, status) => {
    const seed = await running();
    const page = await fixtures.analyzable(seed, '/page');
    const fetcher = site({
      '/page': {
        body: RICH,
        onFetch: async () => void (await interrupt(seed, page.siteUrlId, page.taskId)),
      },
    });
    await analyze(fetcher, page.taskId);
    expect(await task(page.taskId)).toMatchObject({ status, result_artifact_id: null });
    expect(await attempts(page.taskId)).toEqual([]);
    expect(await analyses(seed, page.siteUrlId)).toEqual([]);
    expect((await crawl(seed)).analyzed_url_count).toBe(0);
  });
});

describe('page fetch policy', () => {
  const page = (status: number, body: string): FetchedPage => ({
    url: 'https://example.test/',
    status,
    contentType: 'text/html',
    body: Buffer.from(body),
  });
  it('treats a challenge marker as a block unless the page carries real content', () => {
    const marker = '<div id="challenge-platform"></div>';
    expect(isBotBlock(page(403, `<html>${marker}</html>`))).toBe(true);
    expect(isBotBlock(page(200, `<html>${marker}</html>`))).toBe(true);
    expect(isBotBlock(page(200, `<html>${marker}<main><h1>Widgets</h1></main></html>`))).toBe(
      false,
    );
    expect(isBotBlock(page(200, '<html><main><h1>Widgets</h1></main></html>'))).toBe(false);
    // Cloudflare's rate-limit page loads the challenge platform; it is still a retryable 429.
    const limited = '<html><script src="/cdn-cgi/challenge-platform/scripts/jsd/main.js"></script>';
    expect(isBotBlock(page(429, limited))).toBe(false);
    expect(isBotBlock(page(403, limited))).toBe(true);
  });
  it('excludes non-content endpoints and tracking variants but not ordinary pages', () => {
    expect(hardExcluded(new URL('https://example.test/cart'))).toBe(true);
    expect(hardExcluded(new URL('https://example.test/products/widget?utm_source=x'))).toBe(true);
    expect(hardExcluded(new URL('https://example.test/assets/site.css'))).toBe(true);
    expect(hardExcluded(new URL('https://example.test/products/widget'))).toBe(false);
  });
});
