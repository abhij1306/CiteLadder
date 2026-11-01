import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it, vi } from 'vitest';

import { policy } from '../src/config.ts';
import { record } from '../src/db/json.ts';
import {
  admitCandidates,
  candidate,
  lockRuntime,
  orderedUnique,
} from '../src/site-health/frontier.ts';
import { reconcileDuplicateAliases } from '../src/site-health/canonical-alias.ts';
import { valueKindCoverage } from '../src/site-health/coverage.ts';
import { reconcileCrawl } from '../src/site-health/lifecycle.ts';
import { crawlCounters } from '../src/site-health/reads/crawl.ts';
import { pages } from '../src/site-health/reads/pages.ts';
import { SitePageFetcher, siteFetchSettings } from '../src/site-health/page-fetch.ts';
import { siteWorkerSettings } from '../src/site-health/runtime.ts';
import { runSiteSetup, setupSettings } from '../src/site-health/site-setup-task.ts';
import { classifyUrlAdmission } from '../src/site-health/url-admission.ts';
import { canonicalIdentity } from '../src/site-health/url-identity.ts';
import { SiteHealthWorker } from '../src/workers/site-health-worker.ts';
import { recordedSite, SiteFixtures, type Served, type SiteSeed } from './site-health-fixtures.ts';
import { testDatabase } from './support.ts';

const db = testDatabase();
const fixtures = new SiteFixtures(db);
afterAll(async () => {
  await fixtures.cleanup();
  await db.destroy();
});

const codes = policy.site_health.page_analysis.acquisition.error_codes;
const fetchSettings = siteFetchSettings({
  SITE_HEALTH_PER_HOST_DELAY_SECONDS: '0',
  SITE_HEALTH_DEFAULT_CRAWL_DELAY_SECONDS: '0',
});
const workerSettings = {
  ...siteWorkerSettings({}),
  concurrency: 1,
  retryBase: 0,
  retryMax: 0,
  retryJitter: 0,
};
const html = (body: string, head = '') =>
  `<html><head><title>Page</title>${head}</head><body><main>${body}</main></body></html>`;
const links = (...paths: string[]) => html(paths.map((path) => `<a href="${path}">x</a>`).join(''));

type CrawlOptions = { sample?: boolean; config?: Record<string, unknown>; siteFacts?: unknown };
async function crawl(options: CrawlOptions = {}, limits = { monitored: 50, sample: 10 }) {
  const seed = await fixtures.crawl('running');
  await db
    .updateTable('site_crawls')
    .set({
      completed_at: null,
      discovery_status: 'running',
      analysis_status: 'running',
      sample_mode: options.sample ?? false,
      site_facts: options.siteFacts === undefined ? null : JSON.stringify(options.siteFacts),
      configuration: JSON.stringify({
        root_registrable_domain: 'example.test',
        count_disclosure: true,
        ...options.config,
      }),
    })
    .where('id', '=', seed.crawlId)
    .execute();
  const now = new Date();
  await db
    .insertInto('workspace_site_health_runtime')
    .values({
      id: randomUUID(),
      workspace_id: seed.workspaceId,
      monitored_url_limit: limits.monitored,
      sample_url_limit: limits.sample,
      discovery_mode: 'full',
      count_disclosure: true,
      resolved_entitlement_lifecycle_version: 1,
      resolved_registry_revision: 'fixture',
      created_at: now,
      updated_at: now,
    })
    .execute();
  return seed;
}
/** A queued task of `kind` for the path, as crawl creation or admission would seed it. */
async function queued(seed: SiteSeed, kind: 'discover' | 'site_setup', path = '/', depth = 0) {
  const identity = canonicalIdentity(path, seed.root);
  const id = await fixtures.task(seed, kind);
  await db
    .updateTable('site_crawl_tasks')
    .set({ url_hash: identity.hash, requested_url: identity.url, depth, site_url_id: null })
    .where('id', '=', id)
    .execute();
  return id;
}
function worker(pages: Record<string, Served>, requests: string[] = []) {
  return new SiteHealthWorker(db, {
    owner: 'acquisition-test',
    settings: workerSettings,
    fetcher: new SitePageFetcher(db, recordedSite(pages, requests), fetchSettings),
  });
}
async function lease(taskId: string, owner: string) {
  return db
    .updateTable('site_crawl_tasks')
    .set({ status: 'leased', lease_owner: owner, lease_expires_at: new Date(Date.now() + 60_000) })
    .where('id', '=', taskId)
    .returningAll()
    .executeTakeFirstOrThrow();
}
async function run(site: SiteHealthWorker, ...taskIds: string[]) {
  for (const id of taskIds) await site.execute(await lease(id, site.owner));
}
const task = (id: string) =>
  db.selectFrom('site_crawl_tasks').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
const tasks = (seed: SiteSeed, kind: string) =>
  db
    .selectFrom('site_crawl_tasks')
    .selectAll()
    .where('crawl_id', '=', seed.crawlId)
    .where('task_kind', '=', kind)
    .orderBy('requested_url')
    .execute();
const crawlRow = (seed: SiteSeed) =>
  db.selectFrom('site_crawls').selectAll().where('id', '=', seed.crawlId).executeTakeFirstOrThrow();
const urlRow = (seed: SiteSeed, path: string) =>
  db
    .selectFrom('site_urls')
    .selectAll()
    .where('project_id', '=', seed.projectId)
    .where('url_hash', '=', canonicalIdentity(path, seed.root).hash)
    .executeTakeFirstOrThrow();
const memberships = (seed: SiteSeed) =>
  db
    .selectFrom('monitored_site_urls as m')
    .innerJoin('site_urls as u', 'u.id', 'm.site_url_id')
    .select(['u.normalized_url', 'm.active', 'm.selection_source'])
    .where('m.project_id', '=', seed.projectId)
    .orderBy('u.normalized_url')
    .execute();
const url = (path: string) => `https://example.test${path}`;

describe('discover', () => {
  it('interrupts request-bound acquisition and leaves durable work for background retry', async () => {
    const seed = await crawl();
    const id = await queued(seed, 'discover');
    const controller = new AbortController();
    const site = new SiteHealthWorker(db, {
      taskScope: { workspaceId: seed.workspaceId, crawlId: seed.crawlId },
      settings: workerSettings,
      signal: controller.signal,
      fetcher: new SitePageFetcher(
        db,
        async (_url, options) => {
          controller.abort(new Error('interactive deadline'));
          options?.signal?.throwIfAborted();
          throw new Error('request should be aborted');
        },
        fetchSettings,
      ),
    });
    await run(site, id);
    expect(await task(id)).toMatchObject({ status: 'retry_wait', lease_owner: null });
    expect((await crawlRow(seed)).status).not.toBe('completed');
  });
  it('settles concurrent discovers that link each other without a lock conflict', async () => {
    const seed = await crawl({ siteFacts: {}, config: { automatic_monitor_limit: 2 } });
    const a = await queued(seed, 'discover', '/a');
    const b = await queued(seed, 'discover', '/b');
    const site = worker({ '/a': { body: links('/b') }, '/b': { body: links('/a') } });
    const claims = await Promise.all([lease(a, site.owner), lease(b, site.owner)]);
    await Promise.all(claims.map((claim) => site.execute(claim)));
    expect((await task(a)).status).toBe('succeeded');
    expect((await task(b)).status).toBe('succeeded');
    expect(await memberships(seed)).toHaveLength(2);
  });
  it.each([
    ['https://elsewhere.test/landing', 'failed', ['/robots.txt', '/']],
    [
      'https://www.example.test/landing',
      'succeeded',
      ['/robots.txt', '/', '/robots.txt', '/landing'],
    ],
  ])(
    'screens redirect %s before fetching its robots or page',
    async (destination, status, sent) => {
      const seed = await crawl();
      const root = await queued(seed, 'discover');
      const requests: string[] = [];
      await run(
        worker(
          { '/': { status: 301, redirect: destination as string }, '/landing': { body: links() } },
          requests,
        ),
        root,
      );
      expect(await task(root)).toMatchObject({ status });
      expect(requests).toEqual(sent);
    },
  );
  it('commits the artifact, observation, ordered frontier and selected analysis with the task', async () => {
    const seed = await crawl({ config: { automatic_monitor_limit: 2 } });
    const root = await queued(seed, 'discover');
    const requests: string[] = [];
    const site = worker(
      {
        '/': { body: links('/c', '/blog/b', '/products/a', '/cart', 'https://other.test/x') },
        '/products/a': { body: links('/') },
        '/blog/b': { body: links() },
      },
      requests,
    );
    await run(site, root);

    const settled = await task(root);
    expect(settled).toMatchObject({ status: 'succeeded', attempt_count: 1 });
    const artifact = await db
      .selectFrom('site_fetch_artifacts')
      .selectAll()
      .where('id', '=', settled.result_artifact_id!)
      .executeTakeFirstOrThrow();
    expect(artifact.fetch_purpose).toBe('discover');
    expect(record(artifact.normalized_facts).title).toBe('Page');
    expect(requests).toEqual(['/robots.txt', '/']);

    const frontier = await db
      .selectFrom('site_discovery_frontier')
      .select(['normalized_url', 'status'])
      .where('crawl_id', '=', seed.crawlId)
      .orderBy('value_priority', 'desc')
      .execute();
    expect(frontier.map((row) => row.normalized_url)).toEqual([
      url('/'),
      url('/products/a'),
      url('/blog/b'),
      url('/c'),
    ]);
    expect(new Set(frontier.map((row) => row.status))).toEqual(new Set(['admitted']));
    // The root already has its discover task; each new link gets one.
    expect((await tasks(seed, 'discover')).map((row) => row.requested_url)).toEqual([
      url('/'),
      url('/blog/b'),
      url('/c'),
      url('/products/a'),
    ]);
    // The automatic allowance selects the two most valuable URLs; only the fetched root is analyzed yet.
    expect(await memberships(seed)).toEqual([
      { normalized_url: url('/'), active: true, selection_source: 'bootstrap' },
      { normalized_url: url('/products/a'), active: true, selection_source: 'bootstrap' },
    ]);
    expect((await tasks(seed, 'analyze')).map((row) => [row.requested_url, row.priority])).toEqual([
      [url('/'), policy.site_health.crawl.analyze_priority_boost],
    ]);
    expect(await crawlRow(seed)).toMatchObject({ admitted_url_count: 3, discovered_url_count: 1 });
    expect((await urlRow(seed, '/')).discovery_status).toBe('completed');

    // A selected child is handed its analysis by its own fetch; an unselected one is inventory only.
    const children = await tasks(seed, 'discover');
    const child = (path: string) => children.find((row) => row.requested_url === url(path))!.id;
    await run(site, child('/products/a'), child('/blog/b'));
    expect((await tasks(seed, 'analyze')).map((row) => row.requested_url)).toEqual([
      url('/'),
      url('/products/a'),
    ]);
  });

  it('lists a link that fails to fetch as an error, with every page that links it', async () => {
    const seed = await crawl();
    const root = await queued(seed, 'discover');
    // A seeded URL (exact-URL input) starts without an identity, and nothing links it.
    const seeded = await queued(seed, 'discover', '/seeded');
    const site = worker({
      '/': { body: links('/a', '/gone') },
      '/a': { body: links('/gone', '/') },
      '/gone': { status: 404, body: 'missing' },
      '/seeded': { status: 410, body: 'gone' },
    });
    await run(site, root, seeded);
    const children = await tasks(seed, 'discover');
    const child = (path: string) => children.find((row) => row.requested_url === url(path))!.id;
    await run(site, child('/a'), child('/gone'));

    const errors = await pages(
      db,
      seed.workspaceId,
      seed.crawlId,
      { status: 'error_or_blocked' },
      'url',
      { limit: 10, cursor: null },
    );
    expect(
      errors.items.map((item) => ({
        url: item.normalized_url,
        status: item.analysis_status,
        code: item.error_code,
        linked_from: item.linked_from.map((referrer) => referrer.url),
      })),
    ).toEqual([
      { url: url('/gone'), status: 'error', code: 'http_4xx', linked_from: [url('/'), url('/a')] },
      { url: url('/seeded'), status: 'error', code: 'http_4xx', linked_from: [] },
    ]);
    const counters = await crawlCounters(db, await crawlRow(seed));
    expect(counters).toMatchObject({ errors: 2, failure_breakdown: { http_4xx: 2 } });
  });

  it('keeps a document as inventory and excludes a canonical alias of an active page', async () => {
    const seed = await crawl({ config: { automatic_monitor_limit: 5 } });
    const root = await queued(seed, 'discover');
    const site = worker({
      '/': { body: links('/guide.pdf', '/a', '/a-alias') },
      '/guide.pdf': { body: '%PDF-1.4', contentType: 'application/pdf' },
      '/a': { body: links() },
      '/a-alias': { body: html('', '<link rel="canonical" href="/a">') },
    });
    await run(site, root);
    const children = await tasks(seed, 'discover');
    await run(site, ...children.filter((row) => row.id !== root).map((row) => row.id));

    expect(await urlRow(seed, '/guide.pdf')).toMatchObject({
      corpus_disposition: 'inventory_only',
      item_kind: 'document',
    });
    expect(await urlRow(seed, '/a-alias')).toMatchObject({
      corpus_disposition: 'exclude',
      disposition_reason: policy.site_health.crawl.exclusions.duplicate,
    });
    const active = (await memberships(seed))
      .filter((row) => row.active)
      .map((row) => row.normalized_url);
    expect(active).toEqual([url('/'), url('/a')]);
    expect((await tasks(seed, 'analyze')).map((row) => row.requested_url)).toEqual([
      url('/'),
      url('/a'),
    ]);
  });

  it('never resolves the crawl root as a canonical alias, so its site checks stay current', async () => {
    const seed = await crawl({ config: { automatic_monitor_limit: 5 } });
    const root = await queued(seed, 'discover');
    const site = worker({
      '/': { body: html('<a href="/home">x</a>', '<link rel="canonical" href="/home">') },
      '/home': { body: links() },
    });
    await run(site, root);
    await run(
      site,
      ...(await tasks(seed, 'discover')).filter((row) => row.id !== root).map((row) => row.id),
    );
    const live = await db
      .selectFrom('site_crawls')
      .selectAll()
      .where('id', '=', seed.crawlId)
      .executeTakeFirstOrThrow();
    await reconcileDuplicateAliases(db, live);
    expect((await urlRow(seed, '/')).corpus_disposition).not.toBe('exclude');
  });

  it('admits a sample directly up to the workspace allowance and closes discovery', async () => {
    const seed = await crawl({ sample: true }, { monitored: 0, sample: 2 });
    const root = await queued(seed, 'discover');
    await run(worker({ '/': { body: links('/a', '/b', '/c') } }), root);
    expect((await memberships(seed)).map((row) => row.selection_source)).toEqual([
      'free_sample',
      'free_sample',
    ]);
    expect(await tasks(seed, 'analyze')).toHaveLength(2);
    expect((await tasks(seed, 'discover')).map((row) => row.id)).toEqual([root]);
    expect((await crawlRow(seed)).discovery_status).toBe('sample_completed');
  });

  it.each([
    [
      'robots disallow',
      { '/robots.txt': { body: 'User-agent: *\nDisallow: /\n', contentType: 'text/plain' } },
      'failed',
      codes.robots_denied,
    ],
    ['a 503', { '/': { status: 503 } }, 'retry_wait', codes.http_5xx],
    [
      'a redirect off the crawl scope',
      { '/': { status: 301, redirect: 'https://elsewhere.test/' } },
      'failed',
      codes.url_admission_rejected,
    ],
  ])('settles %s with an attempt and no evidence', async (_label, pages, status, code) => {
    const seed = await crawl();
    const root = await queued(seed, 'discover');
    await run(worker(pages), root);
    expect(await task(root)).toMatchObject({ status, error_code: code, result_artifact_id: null });
    const attempts = await db
      .selectFrom('site_fetch_attempts')
      .select('error_code')
      .where('task_id', '=', root)
      .execute();
    expect(attempts.at(-1)?.error_code).toBe(code);
    expect(await crawlRow(seed)).toMatchObject({ admitted_url_count: 0, discovered_url_count: 0 });
  });

  it.each([
    ['lost', { lease_owner: 'another-worker' }],
    ['expired', { lease_expires_at: new Date(Date.now() - 1000) }],
  ])('writes nothing when the lease is %s during the fetch', async (_label, values) => {
    const seed = await crawl();
    const root = await queued(seed, 'discover');
    const site = worker({
      '/': {
        body: links('/a'),
        onFetch: async () =>
          void (await db
            .updateTable('site_crawl_tasks')
            .set(values)
            .where('id', '=', root)
            .execute()),
      },
    });
    await run(site, root);
    const artifacts = await db
      .selectFrom('site_fetch_artifacts')
      .select('id')
      .where('task_id', '=', root)
      .execute();
    expect(artifacts).toEqual([]);
    const frontier = await db
      .selectFrom('site_discovery_frontier')
      .select('id')
      .where('crawl_id', '=', seed.crawlId)
      .execute();
    expect(frontier).toEqual([]);
  });
});

describe('site setup', () => {
  const robots = {
    body: 'User-agent: GPTBot\nDisallow: /\n\nUser-agent: *\nAllow: /\n\nSitemap: https://example.test/index.xml\n',
    contentType: 'text/plain',
  };
  const urlset = (...paths: string[]) => ({
    contentType: 'application/xml',
    body: `<urlset>${paths.map((path) => `<url><loc>${path}</loc></url>`).join('')}</urlset>`,
  });

  it('publishes robots, AI-crawler stance and llms.txt, then walks and admits the sitemap', async () => {
    const seed = await crawl();
    const setup = await queued(seed, 'site_setup');
    const requests: string[] = [];
    await run(
      worker(
        {
          '/robots.txt': robots,
          '/llms.txt': { body: '# Example', contentType: 'text/markdown' },
          '/index.xml': {
            contentType: 'application/xml',
            body: '<sitemapindex><sitemap><loc>https://example.test/pages.xml</loc></sitemap></sitemapindex>',
            onFetch: async () => {
              const initial = await crawlRow(seed);
              expect(initial.robots_snapshot_id).not.toBeNull();
              expect(record(initial.site_facts).robots).toMatchObject({
                bots: expect.arrayContaining([
                  expect.objectContaining({
                    label: 'GPTBot',
                    root_access: 'disallowed',
                    policy: 'unknown',
                  }),
                ]),
              });
            },
          },
          '/pages.xml': {
            contentType: 'application/xml',
            body: `<urlset><url><loc>${url('/a')}</loc><lastmod>2026-09-01</lastmod></url><url><loc>${url('/cart')}</loc><lastmod>2026-09-02</lastmod></url><url><loc>https://other.test/b</loc></url><url><loc>${url('/a')}</loc></url></urlset>`,
          },
        },
        requests,
      ),
      setup,
    );
    expect(await task(setup)).toMatchObject({ status: 'succeeded', attempt_count: 1 });
    const facts = record((await crawlRow(seed)).site_facts);
    expect(record(facts.robots)).toMatchObject({
      fetched: true,
      status: 'fetched',
      status_code: 200,
      sitemaps: [url('/index.xml')],
    });
    expect(record(facts.robots).bots).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: 'GPTBot',
          root_access: 'disallowed',
          policy: 'all_disallowed',
          evaluated_url_count: 2,
        }),
        expect.objectContaining({
          label: 'ClaudeBot',
          root_access: 'allowed',
          policy: 'all_allowed',
        }),
      ]),
    );
    expect(facts.llms_txt).toMatchObject({ fetched: true, present: true, status_code: 200 });
    expect(facts.sitemap).toEqual({
      fetched: true,
      files: [url('/index.xml'), url('/pages.xml')],
      urls: [url('/a')],
      // Only admitted URLs keep their declared lastmod; the cart URL is refused.
      lastmod: { [url('/a')]: '2026-09-01' },
    });
    expect(requests).toEqual(['/robots.txt', '/llms.txt', '/index.xml', '/pages.xml']);
    const observations = await db
      .selectFrom('site_url_observations')
      .select(['observed_url', 'source_kind'])
      .where('crawl_id', '=', seed.crawlId)
      .execute();
    expect(observations).toEqual([{ observed_url: url('/a'), source_kind: 'sitemap' }]);
    expect((await tasks(seed, 'discover')).map((row) => row.requested_url)).toEqual([url('/a')]);
    expect((await crawlRow(seed)).admitted_url_count).toBe(1);
  });

  it('counts failed documents against the walk budget and skips llms.txt for a sample', async () => {
    const seed = await crawl({ sample: true });
    const setup = await queued(seed, 'site_setup');
    const requests: string[] = [];
    await run(worker({ '/robots.txt': robots }, requests), setup);
    const facts = record((await crawlRow(seed)).site_facts);
    expect(facts.llms_txt).toMatchObject({ fetched: false, url: url('/llms.txt') });
    expect(facts.sitemap).toEqual({ fetched: false, files: [] });
    expect(requests).toEqual(['/robots.txt']);

    const full = await crawl();
    const resumed = await queued(full, 'site_setup');
    const site = worker({
      '/index.xml': {
        contentType: 'application/xml',
        body: `<sitemapindex>${['/s1.xml', '/s2.xml', '/s3.xml']
          .map((path) => `<sitemap><loc>${url(path)}</loc></sitemap>`)
          .join('')}</sitemapindex>`,
      },
      '/s3.xml': urlset(url('/z')),
    });
    // Published facts still marked pending resume at the walk, without re-probing robots.
    await db
      .updateTable('site_crawls')
      .set({
        site_facts: JSON.stringify({
          robots: { sitemaps: [url('/index.xml')] },
          sitemap: { fetched: false, files: [], pending: true },
        }),
      })
      .where('id', '=', full.crawlId)
      .execute();
    await lease(resumed, site.owner);
    await runSiteSetup(site.acquisition, await task(resumed), {
      ...setupSettings({}),
      maxDocuments: 3,
    });
    const walked = record((await crawlRow(full)).site_facts);
    expect(walked.sitemap).toEqual({
      fetched: true,
      files: [url('/index.xml')],
      urls: [],
      lastmod: {},
    });
  });

  it('preserves an overlong sitemap declaration without fetching a truncated URL', async () => {
    const declared = url(`/${'a'.repeat(policy.site_health.crawl.max_url_chars)}.xml`);
    const seed = await crawl();
    const setup = await queued(seed, 'site_setup');
    const requests: string[] = [];
    await run(
      worker(
        { '/robots.txt': { ...robots, body: `User-agent: *\nSitemap: ${declared}\n` } },
        requests,
      ),
      setup,
    );
    const facts = record((await crawlRow(seed)).site_facts);
    expect(record(facts.robots).sitemaps).toEqual([declared]);
    expect(requests).toEqual(['/robots.txt', '/llms.txt']);
    expect(facts.sitemap).toMatchObject({ fetched: false, files: [], urls: [] });
  });
});

describe('frontier admission', () => {
  it('folds storefront quick-view and search-tracking params into the page they decorate', () => {
    const page = canonicalIdentity('https://shop.example/products/net');
    for (const decorated of [
      'https://shop.example/products/net?qv=wtOxjLNNI',
      'https://shop.example/products/net?_pos=1&_psq=net&_ss=e&_v=1.0&_sid=abc',
      'https://shop.example/products/net?srsltid=AfmBOo',
    ])
      expect(canonicalIdentity(decorated)).toEqual(page);
    // A parameter that selects different content still names a different page.
    expect(canonicalIdentity('https://shop.example/products/net?page=2').url).toBe(
      'https://shop.example/products/net?page=2',
    );
  });

  const candidates = (paths: string[]) =>
    paths.map((path, ordinal) => {
      const admission = classifyUrlAdmission(url(path));
      return candidate(admission, {
        url: admission.url ?? url(path),
        hash: admission.hash || canonicalIdentity(url(path)).hash,
        depth: 1,
        sourceKind: 'link',
        parentPosition: 0,
        linkOrdinal: ordinal,
      });
    });
  const twinOf = (item: ReturnType<typeof candidates>[number]) => {
    const wwwUrl = item.url.replace('://', '://www.');
    return { ...item, url: wwwUrl, hash: canonicalIdentity(wwwUrl).hash };
  };
  const admit = (seed: SiteSeed, paths: string[] | ReturnType<typeof candidates>, options = {}) =>
    db.transaction().execute(async (trx) => {
      const live = await trx
        .selectFrom('site_crawls')
        .selectAll()
        .where('id', '=', seed.crawlId)
        .executeTakeFirstOrThrow();
      const runtime = await lockRuntime(trx, seed.workspaceId);
      const items = paths.map((path) => (typeof path === 'string' ? candidates([path])[0]! : path));
      const result = await admitCandidates(trx, live, items, runtime, options);
      await trx
        .updateTable('site_crawls')
        .set((eb) => ({ admitted_url_count: eb('admitted_url_count', '+', result.admitted) }))
        .where('id', '=', seed.crawlId)
        .execute();
      return result;
    });

  it('spends the sample allowance only on a new activation, and reactivates a released URL', async () => {
    const seed = await crawl({ sample: true }, { monitored: 0, sample: 10 });
    await admit(seed, ['/page']);
    await admit(seed, ['/page']);
    expect(await memberships(seed)).toEqual([
      { normalized_url: url('/page'), active: true, selection_source: 'free_sample' },
    ]);
    await db
      .updateTable('monitored_site_urls')
      .set({ active: false })
      .where('project_id', '=', seed.projectId)
      .execute();
    await admit(seed, ['/page']);
    expect(await memberships(seed)).toEqual([
      { normalized_url: url('/page'), active: true, selection_source: 'free_sample' },
    ]);
  });

  it('stops automatic selection and admission at the frozen limits across batches', async () => {
    const seed = await crawl({ config: { automatic_monitor_limit: 4, requested_page_limit: 6 } });
    const page = (index: number) => `/page-${index}`;
    await admit(
      seed,
      Array.from({ length: 5 }, (_, index) => page(index)),
    );
    await admit(
      seed,
      Array.from({ length: 5 }, (_, index) => page(index + 5)),
    );
    expect((await memberships(seed)).filter((row) => row.active)).toHaveLength(4);
    expect(await tasks(seed, 'discover')).toHaveLength(6);
    expect((await crawlRow(seed)).admitted_url_count).toBe(6);
  });

  it('counts a recrawl’s monitored pages once when it discovers them again', async () => {
    const seed = await crawl({ config: { automatic_monitor_limit: 0, requested_page_limit: 10 } });
    await queued(seed, 'discover');
    // A recrawl seeds an observation for each monitored page before it fetches anything.
    for (const path of ['/a', '/b', '/c']) await fixtures.page(seed, path, {}, { observed: true });
    await reconcileCrawl(db, seed.workspaceId, seed.crawlId);
    await admit(seed, ['/a', '/b', '/c']);
    expect((await crawlRow(seed)).admitted_url_count).toBe(3);
  });

  it('skips an already-discovering URL without spending the ceiling on it', async () => {
    const seed = await crawl({ config: { automatic_monitor_limit: 0, requested_page_limit: 2 } });
    await admit(seed, ['/known']);
    const result = await admit(seed, ['/known', '/a', '/b']);
    expect(result.admitted).toBe(1);
    expect(await tasks(seed, 'discover')).toHaveLength(2);
    expect((await crawlRow(seed)).admitted_url_count).toBe(2);
  });

  it('admits a batch in a fixed number of statements, whatever its size', async () => {
    const statements = async (count: number) => {
      const seed = await crawl({ config: { automatic_monitor_limit: count } });
      const paths = Array.from({ length: count }, (_, index) => `/page-${index}`);
      return db.transaction().execute(async (trx) => {
        const live = await trx
          .selectFrom('site_crawls')
          .selectAll()
          .where('id', '=', seed.crawlId)
          .executeTakeFirstOrThrow();
        const runtime = await lockRuntime(trx, seed.workspaceId);
        const executor = trx.getExecutor();
        const spy = vi.spyOn(executor, 'executeQuery');
        const result = await admitCandidates(trx, live, candidates(paths), runtime);
        spy.mockRestore();
        expect(result.admitted).toBe(count);
        return spy.mock.calls.length;
      });
    };
    expect(await statements(40)).toBe(await statements(4));
  });

  it('samples each value tier in a seeded order that ignores link position, and keeps one www/apex twin', () => {
    const pages = candidates(Array.from({ length: 12 }, (_, index) => `/page-${index}`));
    const order = (items: typeof pages, seed: string) =>
      orderedUnique(items, seed).map((item) => item.url);
    const reversed = pages.map((item, index) => ({ ...item, linkOrdinal: pages.length - index }));
    expect(order(reversed, 'crawl-a')).toEqual(order(pages, 'crawl-a'));
    expect(order(pages, 'crawl-b')).not.toEqual(order(pages, 'crawl-a'));
    const twin = candidates(['/page-0'])[0]!;
    const wwwUrl = twin.url.replace('://', '://www.');
    const www = { ...twin, url: wwwUrl, hash: canonicalIdentity(wwwUrl).hash };
    expect(orderedUnique([twin, www], 'crawl-a')).toHaveLength(1);
  });

  it('filters by page kind, never lets an inadmissible twin displace its pair, and samples one twin per crawl', async () => {
    const filtered = await crawl({
      config: { automatic_monitor_limit: 0, page_kinds: ['about_contact'] },
    });
    // About and contact are separate value tiers of the one `about_contact` page kind.
    expect((await admit(filtered, ['/about-us', '/contact', '/products/widget'])).admitted).toBe(2);

    const full = await crawl({ config: { automatic_monitor_limit: 0 } });
    const [apex] = candidates(['/guide']);
    // Ranked first but too deep to admit: the admissible twin must still get the slot.
    const deep = { ...twinOf(apex!), depth: 999, priority: 1000 };
    expect((await admit(full, [deep, apex!])).admitted).toBe(1);

    const sample = await crawl({ sample: true, config: { automatic_monitor_limit: 0 } });
    expect((await admit(sample, [apex!])).admitted).toBe(1);
    expect((await admit(sample, [twinOf(apex!)])).admitted).toBe(0);
  });

  it('reports found and analyzed pages per value tier, and the expected tiers it never found', async () => {
    const seed = await crawl({ config: { automatic_monitor_limit: 0 } });
    await admit(seed, ['/products/a', '/products/b', '/about-us']);
    const live = await db
      .selectFrom('site_crawls')
      .selectAll()
      .where('id', '=', seed.crawlId)
      .executeTakeFirstOrThrow();
    expect(await valueKindCoverage(db, live)).toEqual([
      { kind: 'product', found: 2, analyzed: 0 },
      { kind: 'pricing', found: 0, analyzed: 0 },
      { kind: 'about', found: 1, analyzed: 0 },
      { kind: 'contact', found: 0, analyzed: 0 },
    ]);
    const sample = await crawl({ sample: true, config: { automatic_monitor_limit: 0 } });
    await admit(sample, ['/products/a']);
    const sampled = await db
      .selectFrom('site_crawls')
      .selectAll()
      .where('id', '=', sample.crawlId)
      .executeTakeFirstOrThrow();
    // A sample admits without a frontier: no funnel, rather than "nothing found".
    expect(await valueKindCoverage(db, sampled)).toEqual([]);
  });

  it('never admits a hard-excluded or out-of-scope candidate', async () => {
    const seed = await crawl({ config: { automatic_monitor_limit: 5 } });
    const result = await admit(seed, ['/checkout', '/cart']);
    expect(result.admitted).toBe(0);
    expect(await tasks(seed, 'discover')).toEqual([]);
  });
});
