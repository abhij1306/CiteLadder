import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it, vi } from 'vitest';

import { policy } from '../src/config.ts';
import { record } from '../src/db/json.ts';
import { setLogSink } from '../src/logging.ts';
import { FetchError } from '../src/safe-fetch.ts';
import { admitCandidates, candidate, lockRuntime } from '../src/site-health/frontier.ts';
import { orderedUnique } from '../src/site-health/tracked-set.ts';
import { duplicateAliases, markDuplicates } from '../src/site-health/canonical-alias.ts';
import type { Crawl } from '../src/site-health/site-task.ts';

const reconcileDuplicateAliases = async (crawl: Crawl) =>
  markDuplicates(db, crawl, await duplicateAliases(db, crawl));
import { crawlCoverage, valueKindCoverage } from '../src/site-health/coverage.ts';
import { reconcileCrawl } from '../src/site-health/lifecycle.ts';
import { taskCounters } from '../src/site-health/reads/crawl-counters.ts';
import { pages } from '../src/site-health/reads/pages.ts';
import { crawlCadences } from '../src/site-health/refresh-cadence.ts';
import { SitePageFetcher } from '../src/site-health/page-fetch.ts';
import { runSiteSetup, setupSettings } from '../src/site-health/site-setup-task.ts';
import { runSiteTask } from '../src/site-health/site-task.ts';
import { classifyUrlAdmission } from '../src/site-health/url-admission.ts';
import { canonicalIdentity } from '../src/site-health/url-identity.ts';
import { SiteHealthWorker } from '../src/workers/site-health-worker.ts';
import {
  acquisitionHarness,
  fetchSettings,
  html,
  links,
  url,
  workerSettings,
} from './site-health-acquisition-support.ts';
import { SiteFixtures, type SiteSeed } from './site-health-fixtures.ts';
import { testDatabase } from './support.ts';

const db = testDatabase();
const fixtures = new SiteFixtures(db);
afterAll(async () => {
  await fixtures.cleanup();
  await db.destroy();
});

const codes = policy.site_health.page_analysis.acquisition.error_codes;
const {
  crawl,
  queued,
  worker,
  lease,
  run,
  task,
  tasks,
  crawlRow,
  urlRow,
  memberships,
  observations,
  entries,
} = acquisitionHarness(db, fixtures);

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
  it('commits the artifact, observation, ordered frontier and the walked page’s tracking with the task', async () => {
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
    expect((await tasks(seed, 'discover')).map((row) => row.requested_url)).toEqual([
      url('/'),
      url('/blog/b'),
      url('/c'),
      url('/products/a'),
    ]);
    expect(await memberships(seed)).toEqual([
      { normalized_url: url('/'), active: true, selection_source: 'bootstrap' },
    ]);
    expect((await tasks(seed, 'analyze')).map((row) => [row.requested_url, row.priority])).toEqual([
      [url('/'), policy.site_health.crawl.analyze_priority_boost],
    ]);
    expect(await crawlRow(seed)).toMatchObject({ admitted_url_count: 3, discovered_url_count: 1 });

    const children = await tasks(seed, 'discover');
    const child = (path: string) => children.find((row) => row.requested_url === url(path))!.id;
    await run(site, child('/products/a'), child('/blog/b'));
    expect((await memberships(seed)).map((row) => row.normalized_url)).toEqual([
      url('/'),
      url('/products/a'),
    ]);
    expect((await tasks(seed, 'analyze')).map((row) => row.requested_url)).toEqual([
      url('/'),
      url('/products/a'),
    ]);
  });

  it('lists a link that fails to fetch as an error, with every page that links it', async () => {
    const seed = await crawl();
    const root = await queued(seed, 'discover');
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
    const counters = await taskCounters(db, await crawlRow(seed));
    expect(counters).toMatchObject({ errors: 2, failure_breakdown: { http_4xx: 2 } });
  });

  it('records a seed an earlier crawl knew as this crawl’s sighting when it is discovered again', async () => {
    const seed = await crawl();
    const earlier = await fixtures.sibling(seed);
    const identity = canonicalIdentity('/seeded', seed.root);
    const then = new Date(Date.now() - 86_400_000);
    await db
      .insertInto('site_urls')
      .values({
        id: randomUUID(),
        workspace_id: seed.workspaceId,
        project_id: seed.projectId,
        normalized_url: identity.url,
        url_hash: identity.hash,
        display_url: identity.url,
        host: 'example.test',
        depth: 3,
        corpus_disposition: 'exclude',
        disposition_reason: 'http_404',
        disposition_version: 'fixture',
        item_kind: 'page',
        latest_source_kind: 'sitemap',
        latest_title: '',
        latest_content_type: '',
        first_seen_crawl_id: earlier,
        last_seen_crawl_id: earlier,
        first_seen_at: then,
        last_seen_at: then,
      })
      .execute();
    const before = await urlRow(seed, '/seeded');
    const seeded = await queued(seed, 'discover', '/seeded', 1);

    await run(worker({ '/seeded': { body: links() } }), seeded);

    const after = await urlRow(seed, '/seeded');
    expect({
      id: after.id,
      depth: after.depth,
      disposition: after.corpus_disposition,
      source: after.latest_source_kind,
      first_seen: after.first_seen_crawl_id,
      last_seen: after.last_seen_crawl_id,
    }).toEqual({
      id: before.id,
      depth: 1,
      disposition: 'analyze',
      source: 'link',
      first_seen: earlier,
      last_seen: seed.crawlId,
    });
    const observations = await db
      .selectFrom('site_url_observations')
      .select(['crawl_id', 'source_kind', 'status_code'])
      .where('site_url_id', '=', before.id)
      .execute();
    expect(observations).toEqual([
      { crawl_id: seed.crawlId, source_kind: 'link', status_code: 200 },
    ]);
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

  it('analyzes an alias fetched before its target, excluding it at finalization only when the target ended active', async () => {
    const seed = await crawl({ config: { automatic_monitor_limit: 5 } });
    const root = await queued(seed, 'discover');
    const site = worker({
      '/': { body: links('/live', '/live-alias', '/dead', '/dead-alias') },
      '/live': { body: links() },
      '/live-alias': { body: html('', '<link rel="canonical" href="/live">') },
      '/dead': { status: 404, body: 'missing' },
      '/dead-alias': { body: html('', '<link rel="canonical" href="/dead">') },
    });
    await run(site, root);
    const children = await tasks(seed, 'discover');
    const child = (path: string) => children.find((row) => row.requested_url === url(path))!.id;
    await run(site, child('/live-alias'), child('/dead-alias'), child('/live'), child('/dead'));
    expect((await tasks(seed, 'analyze')).map((row) => row.requested_url)).toEqual([
      url('/'),
      url('/dead-alias'),
      url('/live'),
      url('/live-alias'),
    ]);

    await reconcileDuplicateAliases(await crawlRow(seed));
    expect(
      (await memberships(seed)).map((row) => [row.normalized_url.slice(20), row.active]),
    ).toEqual([
      ['/', true],
      ['/dead-alias', true],
      ['/live', true],
      ['/live-alias', true],
    ]);
    expect((await urlRow(seed, '/live-alias')).disposition_reason).toBe(
      policy.site_health.crawl.exclusions.duplicate,
    );
    expect((await urlRow(seed, '/dead-alias')).disposition_reason).not.toBe(
      policy.site_health.crawl.exclusions.duplicate,
    );
  });

  it('tracks only the walked links that proved to be pages, and excludes the rest', async () => {
    const seed = await crawl({ config: { automatic_monitor_limit: 6 } });
    const root = await queued(seed, 'discover');
    const site = worker({
      '/robots.txt': { body: 'User-agent: *\nDisallow: /private\n', contentType: 'text/plain' },
      '/': { body: links('/a', '/gone', '/size-chart', '/private', '/flaky') },
      '/a': { body: links() },
      '/gone': { status: 404, body: 'missing' },
      '/size-chart': { body: '{}', contentType: 'application/json' },
      '/flaky': { status: 500 },
    });
    await run(site, root);
    for (const child of (await tasks(seed, 'discover')).filter((row) => row.id !== root))
      do await run(site, child.id);
      while ((await task(child.id)).status === 'retry_wait');

    expect(
      (await memberships(seed)).map((row) => [row.normalized_url.slice(20), row.active]),
    ).toEqual([
      ['/', true],
      ['/a', true],
    ]);
    const chart = await urlRow(seed, '/size-chart');
    expect([chart.corpus_disposition, chart.disposition_reason]).toEqual([
      'exclude',
      codes.unsupported_content_type,
    ]);
  });

  it('keeps a tracked page tracked when it later fails to fetch (SH-B8)', async () => {
    const seed = await crawl({ config: { automatic_monitor_limit: 5 } });
    const gone = await fixtures.page(seed, '/gone', {});
    await fixtures.monitor(seed, [gone.id]);
    const page = await queued(seed, 'discover', '/gone', 1);
    await run(worker({ '/gone': { status: 404, body: 'missing' } }), page);
    expect(
      (await memberships(seed)).map((row) => [row.normalized_url.slice(20), row.active]),
    ).toEqual([['/gone', true]]);
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
    await reconcileDuplicateAliases(live);
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
      'an unreachable robots.txt',
      { '/robots.txt': { status: 503 } },
      'retry_wait',
      codes.robots_unavailable,
    ],
    [
      'a redirect to an origin whose robots.txt is access-blocked',
      {
        '/': { status: 301, redirect: 'https://shop.example.test/' },
        'shop.example.test/robots.txt': { status: 403 },
      },
      'failed',
      codes.access_blocked,
    ],
    [
      'a redirect to an origin whose robots.txt is refused',
      {
        '/': { status: 301, redirect: 'https://shop.example.test/' },
        'shop.example.test/robots.txt': { status: 301, redirect: '/robots.txt' },
      },
      'failed',
      codes.robots_unavailable,
    ],
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

  it('asks a redirect origin’s unreachable robots.txt no more than its transient attempts', async () => {
    const seed = await crawl();
    const root = await queued(seed, 'discover');
    const requests: string[] = [];
    const pages = {
      '/': { status: 301, redirect: 'https://shop.example.test/' },
      'shop.example.test/robots.txt': { status: 503 },
    };
    await run(worker(pages, requests), root);
    expect(await task(root)).toMatchObject({ error_code: codes.robots_unavailable });
    expect(requests.filter((key) => key === 'shop.example.test/robots.txt')).toHaveLength(3);
  });

  it('discovers past a robots disallow when the crawl ignores robots.txt, and records it', async () => {
    const seed = await crawl({ config: { robots: 'ignore' } });
    const root = await queued(seed, 'discover');
    const requests: string[] = [];
    await run(
      worker(
        {
          '/robots.txt': { body: 'User-agent: *\nDisallow: /\n', contentType: 'text/plain' },
          '/': { body: links('/a') },
        },
        requests,
      ),
      root,
    );
    const settled = await task(root);
    expect(settled).toMatchObject({ status: 'succeeded', error_code: '' });
    expect(requests).toEqual(['/robots.txt', '/']);
    const artifact = await db
      .selectFrom('site_fetch_artifacts')
      .select('acquisition_options')
      .where('id', '=', settled.result_artifact_id!)
      .executeTakeFirstOrThrow();
    expect(artifact.acquisition_options).toEqual({ robots_excluded: true });
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
  const runnerOf = (site: SiteHealthWorker) => ({
    db,
    owner: site.owner,
    queue: site.queue,
    fetcher: site.fetcher,
    settings: site.settings,
    cadence: crawlCadences(site.settings.scoreRefresh),
  });

  it('publishes robots, AI-crawler stance and llms.txt, then counts the sitemap and tracks its pages', async () => {
    const seed = await crawl({ discovery: 'pending', config: { automatic_monitor_limit: 5 } });
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
      file_count: 2,
      discovered_count: 1,
      discovered_complete: true,
      limit_reached: false,
      unread_count: 0,
      invalid_count: 0,
      invalid_documents: [],
    });
    expect(requests).toEqual([
      '/robots.txt',
      '/llms.txt',
      '/robots.txt',
      '/',
      '/index.xml',
      '/pages.xml',
    ]);
    expect(facts.http_origin).toEqual({
      state: 'answered',
      url: 'http://example.test/',
      status_code: 404,
      first_location: '',
      final_url: 'http://example.test/',
      final_status_code: 404,
    });
    expect(await observations(seed)).toEqual([
      { observed_url: url('/a'), source_kind: 'sitemap', depth: 1 },
    ]);
    expect(await entries(seed)).toEqual([{ listed_url: url('/a'), lastmod: '2026-09-01' }]);
    expect(await tasks(seed, 'discover')).toEqual([]);
    expect((await tasks(seed, 'analyze')).map((row) => row.requested_url)).toEqual([url('/a')]);
    expect((await memberships(seed)).map((row) => row.normalized_url)).toEqual([url('/a')]);
    expect(await crawlRow(seed)).toMatchObject({
      admitted_url_count: 1,
      discovered_url_count: 1,
      discovery_status: 'completed',
    });
  });

  it('saves every sitemap URL beyond the tracked set, and counts a lower bound at the ceiling', async () => {
    const seed = await crawl({ discovery: 'pending', config: { automatic_monitor_limit: 2 } });
    const setup = await queued(seed, 'site_setup');
    const site = worker({
      '/robots.txt': robots,
      '/index.xml': urlset(
        url('/products/manual.pdf'),
        url('/blog/x'),
        url('/about'),
        url('/products/a'),
        url('/c'),
      ),
    });
    await lease(setup, site.owner);
    await runSiteTask(runnerOf(site), await task(setup), {
      kind: 'acquire',
      run: (ctx, claimed) => {
        return runSiteSetup(ctx, claimed, { ...setupSettings({}), maxSiteUrls: 4 });
      },
    });
    expect(record(record((await crawlRow(seed)).site_facts).sitemap)).toMatchObject({
      discovered_count: 4,
      discovered_complete: false,
      limit_reached: true,
      unread_count: 0,
    });
    expect(await crawlRow(seed)).toMatchObject({ discovered_url_count: 4, admitted_url_count: 4 });
    expect((await memberships(seed)).map((row) => row.normalized_url)).toEqual([
      url('/about'),
      url('/products/a'),
    ]);
    const listed = [url('/about'), url('/blog/x'), url('/products/a'), url('/products/manual.pdf')];
    expect((await observations(seed)).map((row) => row.observed_url)).toEqual(listed);
    expect((await entries(seed)).map((row) => row.listed_url)).toEqual(listed);
    expect((await crawlCoverage(db, await crawlRow(seed))).evidence).toMatchObject({
      reasons: ['sitemap_limit_reached', 'tracked_pages_below_site'],
      sitemap: { discovered: 4, limitReached: true, unreadDocuments: 0, tracked: 2 },
    });
  });

  it('records a sitemap entry for a URL the crawl already observed without rewriting it', async () => {
    const seed = await crawl({ discovery: 'pending', config: { automatic_monitor_limit: 5 } });
    const root = await fixtures.page(seed, '/', {}, { observed: true });
    await fixtures.monitor(seed, [root.id]);
    const setup = await queued(seed, 'site_setup');
    await run(
      worker({
        '/robots.txt': { body: 'User-agent: *\n', contentType: 'text/plain' },
        '/sitemap.xml': {
          contentType: 'application/xml',
          body: `<urlset><url><loc>${url('/')}</loc><lastmod>2026-10-01</lastmod></url><url><loc>${url('/a')}</loc></url></urlset>`,
        },
      }),
      setup,
    );
    expect(await observations(seed)).toEqual([
      { observed_url: url('/'), source_kind: 'link', depth: 0 },
      { observed_url: url('/a'), source_kind: 'sitemap', depth: 1 },
    ]);
    expect(await entries(seed)).toEqual([
      { listed_url: url('/'), lastmod: '2026-10-01' },
      { listed_url: url('/a'), lastmod: null },
    ]);
    expect(await urlRow(seed, '/')).toMatchObject({ depth: 0, latest_source_kind: 'root' });
  });

  it('walks HTML links from the root when the site lists no sitemap URLs', async () => {
    const seed = await crawl({ discovery: 'pending', config: { automatic_monitor_limit: 5 } });
    const setup = await queued(seed, 'site_setup');
    await run(
      worker({ '/robots.txt': { body: 'User-agent: *\n', contentType: 'text/plain' } }),
      setup,
    );
    expect(record(record((await crawlRow(seed)).site_facts).sitemap)).toMatchObject({
      fetched: false,
      discovered_count: 0,
      unread_count: 0,
    });
    expect((await crawlRow(seed)).discovery_status).toBe('running');
    expect((await tasks(seed, 'discover')).map((row) => row.requested_url)).toEqual([url('/')]);
  });

  it('bounds the walk by its ceilings and domain, keeps an oversized document unread, and skips llms.txt for a sample', async () => {
    const seed = await crawl({ sample: true });
    const setup = await queued(seed, 'site_setup');
    const requests: string[] = [];
    await run(worker({ '/robots.txt': robots }, requests), setup);
    const facts = record((await crawlRow(seed)).site_facts);
    expect(facts.llms_txt).toMatchObject({ fetched: false, url: url('/llms.txt') });
    expect(facts.sitemap).toEqual({ fetched: false, file_count: 0 });
    expect(requests).toEqual(['/robots.txt', '/robots.txt', '/']);

    const full = await crawl();
    const resumed = await queued(full, 'site_setup');
    const walkedPaths: string[] = [];
    const site = worker(
      {
        '/index.xml': {
          contentType: 'application/xml',
          body: `<sitemapindex>${[
            url('/s1.xml'),
            'https://other.test/s4.xml',
            url('/s2.xml'),
            url('/s3.xml'),
          ]
            .map((loc) => `<sitemap><loc>${loc}</loc></sitemap>`)
            .join('')}</sitemapindex>`,
        },
        '/s2.xml': urlset(...Array.from({ length: 20 }, (_, index) => url(`/p${index}`))),
        '/s3.xml': urlset(url('/z')),
      },
      walkedPaths,
    );
    await db
      .updateTable('site_crawls')
      .set({
        site_facts: JSON.stringify({
          robots: { sitemaps: [url('/index.xml')] },
          sitemap: { fetched: false, file_count: 0, pending: true },
        }),
      })
      .where('id', '=', full.crawlId)
      .execute();
    await lease(resumed, site.owner);
    await runSiteTask(runnerOf(site), await task(resumed), {
      kind: 'acquire',
      run: (ctx, claimed) => {
        const settings = setupSettings({});
        return runSiteSetup(ctx, claimed, {
          ...settings,
          concurrency: 1,
          maxDocuments: 3,
          sitemap: { ...settings.sitemap, maxDecodedBytes: 400 },
        });
      },
    });
    const walked = record((await crawlRow(full)).site_facts);
    expect(walkedPaths).toEqual(['/robots.txt', '/index.xml', '/s1.xml', '/s2.xml']);
    expect(walked.sitemap).toEqual({
      fetched: true,
      file_count: 1,
      discovered_count: 0,
      discovered_complete: false,
      limit_reached: true,
      unread_count: 2,
      invalid_count: 0,
      invalid_documents: [],
    });
  });

  it('records an unreachable llms.txt as not fetched and logs why it failed', async () => {
    const seed = await crawl();
    const setup = await queued(seed, 'site_setup');
    const records: Record<string, unknown>[] = [];
    const restore = setLogSink((line) => records.push(JSON.parse(line) as Record<string, unknown>));
    try {
      await run(
        worker({
          '/robots.txt': robots,
          '/llms.txt': {
            onFetch: async () => {
              throw new FetchError('connect_timeout');
            },
          },
        }),
        setup,
      );
    } finally {
      setLogSink(restore);
    }
    const facts = record((await crawlRow(seed)).site_facts);
    expect(facts.llms_txt).toMatchObject({ fetched: false, present: false, status_code: null });
    expect(records.filter((entry) => entry.event === 'site_health_document_fetch_failed')).toEqual([
      expect.objectContaining({
        phase: 'llms_txt',
        error_class: 'FetchError',
        error_code: 'connect_timeout',
        elapsed_ms: expect.any(Number),
      }),
    ]);
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
    expect(requests).toEqual(['/robots.txt', '/llms.txt', '/robots.txt', '/']);
    expect(facts.sitemap).toMatchObject({ fetched: false, file_count: 0, discovered_count: 0 });
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

  it('stops a walk’s admission at its bound across batches, tracking nothing unfetched', async () => {
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
    expect(await memberships(seed)).toEqual([]);
    expect(await tasks(seed, 'discover')).toHaveLength(6);
    expect((await crawlRow(seed)).admitted_url_count).toBe(6);
  });

  it('counts a recrawl’s monitored pages once when it discovers them again', async () => {
    const seed = await crawl({ config: { automatic_monitor_limit: 0, requested_page_limit: 10 } });
    await queued(seed, 'discover');
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

  it('orders by value tier then URL hash, whatever the link position, and keeps one www/apex twin', () => {
    const pages = candidates(['/blog/x', '/about', '/products/a', '/page-1', '/page-2']);
    const order = (items: typeof pages) => orderedUnique(items).map((item) => item.url);
    const reversed = pages
      .toReversed()
      .map((item, index) => ({ ...item, linkOrdinal: pages.length - index }));
    const [first, second] = [canonicalIdentity(url('/page-1')), canonicalIdentity(url('/page-2'))];
    const others = first.hash < second.hash ? [first.url, second.url] : [second.url, first.url];
    expect(order(pages)).toEqual([url('/products/a'), url('/about'), url('/blog/x'), ...others]);
    expect(order(reversed)).toEqual(order(pages));
    const twin = candidates(['/page-0'])[0]!;
    expect(orderedUnique([twin, twinOf(twin)])).toHaveLength(1);
  });

  it('never lets an inadmissible twin displace its pair, and samples one twin per crawl', async () => {
    const full = await crawl({ config: { automatic_monitor_limit: 0 } });
    const [apex] = candidates(['/guide']);
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
    expect(await valueKindCoverage(db, sampled)).toEqual([]);
  });

  it('never admits a hard-excluded or out-of-scope candidate', async () => {
    const seed = await crawl({ config: { automatic_monitor_limit: 5 } });
    const result = await admit(seed, ['/checkout', '/cart']);
    expect(result.admitted).toBe(0);
    expect(await tasks(seed, 'discover')).toEqual([]);
  });
});
