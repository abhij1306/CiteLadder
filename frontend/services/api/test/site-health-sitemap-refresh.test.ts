import { afterAll, describe, expect, it } from 'vitest';

import { policy } from '../src/config.ts';
import { record } from '../src/db/json.ts';
import { sitemapPresent, sitemapValid } from '../src/site-health/analysis/finalize.ts';
import { crawlCoverage } from '../src/site-health/coverage.ts';
import { setupSettings } from '../src/site-health/site-setup-task.ts';
import { acquisitionHarness, url, urlset } from './site-health-acquisition-support.ts';
import { SiteFixtures } from './site-health-fixtures.ts';
import { testDatabase } from './support.ts';

const db = testDatabase();
const fixtures = new SiteFixtures(db);
afterAll(async () => {
  await fixtures.cleanup();
  await db.destroy();
});

const { crawl, queued, worker, walkSetup, task, tasks, crawlRow, entries } = acquisitionHarness(
  db,
  fixtures,
);
const index = (...paths: string[]) => ({
  contentType: 'application/xml',
  body: `<sitemapindex>${paths.map((path) => `<sitemap><loc>${url(path)}</loc></sitemap>`).join('')}</sitemapindex>`,
});

describe('stale sitemap index', () => {
  it('walks a stale sitemap again, then audits what it knows without an HTML walk', async () => {
    const seed = await crawl({ discovery: 'pending', config: { automatic_monitor_limit: 5 } });
    const setup = await queued(seed, 'site_setup');
    const requests: string[] = [];
    const site = worker(
      {
        '/robots.txt': { body: 'User-agent: *\n', contentType: 'text/plain' },
        '/sitemap.xml': index('/gone.xml'),
      },
      requests,
    );
    const settings = { ...setupSettings({}), walkRetries: 1, walkRetryDelay: 0 };
    await walkSetup(site, setup, settings);
    expect(await task(setup)).toMatchObject({ status: 'queued' });
    expect(record(record((await crawlRow(seed)).site_facts).sitemap)).toMatchObject({
      pending: true,
      retries: 1,
    });
    await walkSetup(site, setup, settings);
    expect(requests.filter((path) => path.endsWith('.xml'))).toEqual([
      '/sitemap.xml',
      '/gone.xml',
      '/sitemap.xml',
      '/sitemap.xml',
      '/gone.xml',
      '/sitemap.xml',
    ]);
    expect(record(record((await crawlRow(seed)).site_facts).sitemap)).toEqual({
      fetched: true,
      file_count: 1,
      discovered_count: 0,
      discovered_complete: false,
      limit_reached: false,
      unread_count: 1,
      invalid_count: 0,
      invalid_documents: [],
      retries: 1,
    });
    expect(await task(setup)).toMatchObject({ status: 'succeeded' });
    expect((await crawlRow(seed)).discovery_status).toBe('completed');
    expect(await tasks(seed, 'discover')).toEqual([]);
    expect((await crawlCoverage(db, await crawlRow(seed))).evidence.reasons).toEqual([
      'sitemap_documents_unread',
    ]);
  });

  it('records a served sitemap that does not parse as invalid, not as no sitemap', async () => {
    const seed = await crawl({ discovery: 'pending', config: { automatic_monitor_limit: 5 } });
    const setup = await queued(seed, 'site_setup');
    const site = worker({
      '/robots.txt': { body: 'User-agent: *\n', contentType: 'text/plain' },
      '/sitemap.xml': {
        contentType: 'application/xml',
        body: `<urlset><url><loc>${url('/a')}</loc></urlset>`,
      },
    });
    await walkSetup(site, setup, { ...setupSettings({}), walkRetries: 0 });
    const sitemap = record(record((await crawlRow(seed)).site_facts).sitemap);
    expect(sitemap).toMatchObject({
      fetched: false,
      unread_count: 0,
      invalid_count: 1,
      invalid_documents: [{ url: url('/sitemap.xml') }],
    });
    const judged = { sampleMode: false, sitemap };
    expect([sitemapPresent(judged).outcome, sitemapPresent(judged).reason_code]).toEqual([
      'not_applicable',
      'sitemap_invalid',
    ]);
    expect(sitemapValid(judged)).toMatchObject({
      outcome: 'missing',
      evidence: { invalid_document_count: 1, sitemap_file_count: 0 },
    });
  });

  it.each([
    { shared: false, unread: 0 },
    { shared: true, unread: 1 },
  ])(
    're-fetches a cached index whose children are all gone, past the cache (shared child: $shared)',
    async ({ shared, unread }) => {
      const seed = await crawl({ discovery: 'pending', config: { automatic_monitor_limit: 5 } });
      const setup = await queued(seed, 'site_setup');
      const requests: string[] = [];
      const busted = `/sitemap.xml?${policy.site_health.crawl.sitemap_index_refetch.cache_bust_param}`;
      const site = worker(
        {
          '/robots.txt': {
            body: `User-agent: *\nAllow: /\nSitemap: ${url('/sitemap.xml')}\nSitemap: ${url('/fine.xml')}\n`,
            contentType: 'text/plain',
          },
          '/fine.xml': shared ? index('/pages.xml', '/gone-a.xml') : index('/pages.xml'),
          '/pages.xml': urlset(url('/a')),
          '/sitemap.xml': index('/gone-a.xml', '/gone-b.xml'),
          [busted]: index('/fresh.xml'),
          '/fresh.xml': urlset(url('/b'), url('/c')),
        },
        requests,
      );
      await walkSetup(site, setup, { ...setupSettings({}), concurrency: 1, walkRetries: 0 });
      expect(requests.filter((path) => path.includes('.xml'))).toEqual([
        '/sitemap.xml',
        '/fine.xml',
        '/gone-a.xml',
        '/gone-b.xml',
        '/pages.xml',
        busted,
        '/fresh.xml',
      ]);
      expect(record(record((await crawlRow(seed)).site_facts).sitemap)).toEqual({
        fetched: true,
        file_count: 4,
        discovered_count: 3,
        discovered_complete: !unread,
        limit_reached: false,
        unread_count: unread,
        invalid_count: 0,
        invalid_documents: [],
      });
      expect((await entries(seed)).map((row) => row.listed_url)).toEqual([
        url('/a'),
        url('/b'),
        url('/c'),
      ]);
      expect(await task(setup)).toMatchObject({ status: 'succeeded' });
    },
  );
});
