import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';

import { policy } from '../src/config.ts';
import { extractPageFacts, factSettings } from '../src/site-health/analysis/facts.ts';
import { parseSitemapAsync } from '../src/site-health/analysis/off-thread.ts';
import { discoveryLinks } from '../src/site-health/discovery-links.ts';
import { classifyUrlAdmission } from '../src/site-health/url-admission.ts';
import { document } from '../src/web-evidence/html.ts';
import { parseSitemap, SitemapCollector, SitemapParseError } from '../src/web-evidence/sitemaps.ts';

const reasons = policy.site_health.crawl.exclusions;
const scope = { domain: 'example.test' };

describe('URL admission', () => {
  it('admits the registrable domain and its subdomains only', () => {
    expect(classifyUrlAdmission('https://blog.example.test/post', scope).accepted).toBe(true);
    expect(classifyUrlAdmission('https://example.test.evil/post', scope).reason).toBe(
      reasons.out_of_scope,
    );
  });

  it('separates hard exclusions and documents from ordinary pages', () => {
    expect(classifyUrlAdmission('https://example.test/search?q=x').reason).toBe(reasons.hard_query);
    expect(classifyUrlAdmission('https://account.example.test/').reason).toBe(reasons.hard_host);
    expect(classifyUrlAdmission('https://example.test/assets/app.js').reason).toBe(
      reasons.hard_asset,
    );
    const pdf = classifyUrlAdmission('https://example.test/Prospectus.PDF');
    expect(pdf).toMatchObject({
      accepted: true,
      disposition: 'inventory_only',
      itemKind: 'document',
    });
    // Sitemaps are the one asset extension crawler infrastructure may fetch.
    expect(classifyUrlAdmission('https://example.test/sitemap.xml').accepted).toBe(false);
    expect(
      classifyUrlAdmission('https://example.test/sitemap-1.xml.gz', { infrastructure: 'sitemap' })
        .accepted,
    ).toBe(true);
  });

  it('admits the tracking-stripped target of a tagged link under the same scope rules', () => {
    const base = 'https://www.example.test/blogs/news/simulators';
    const tagged = classifyUrlAdmission(
      '/products/simulator-series-12?srsltid=AfmBOo&utm_source=chatgpt.com&size=12',
      { ...scope, base },
    );
    expect([tagged.accepted, tagged.url]).toEqual([
      true,
      'https://www.example.test/products/simulator-series-12?size=12',
    ]);
    expect(tagged.hash).toBe(
      classifyUrlAdmission('https://www.example.test/products/simulator-series-12?size=12', scope)
        .hash,
    );
    expect(
      classifyUrlAdmission('https://other.test/products/x?utm_source=chatgpt.com', scope).reason,
    ).toBe(reasons.out_of_scope);
    expect(classifyUrlAdmission('https://example.test/search?q=x&utm_source=y').reason).toBe(
      reasons.hard_query,
    );
  });

  it('refuses hrefs that only look relative', () => {
    const base = 'https://example.test/blogs/post';
    expect(classifyUrlAdmission('twitter.com/brand', { ...scope, base }).reason).toBe(
      reasons.invalid,
    );
    expect(
      classifyUrlAdmission('allhttps://example.test/collections/all', { ...scope, base }).reason,
    ).toBe(reasons.invalid);
    expect(classifyUrlAdmission('index.html', { ...scope, base }).url).toBe(
      'https://example.test/blogs/index.html',
    );
  });

  it('orders by the most valuable kind a path names', () => {
    const priority = (url: string) => classifyUrlAdmission(url).priority;
    expect(classifyUrlAdmission('https://example.test/').valueKind).toBe('root');
    expect(priority('https://example.test/products/widget')).toBeGreaterThan(
      priority('https://example.test/blog/widget'),
    );
    const kind = (path: string) => classifyUrlAdmission(`https://example.test${path}`).valueKind;
    // Whole tokens and the section first, not any substring anywhere.
    expect(kind('/blog/product-review')).toBe('article');
    expect(kind('/about-us')).toBe('about');
    expect(kind('/help/getting-started')).toBe('guide');
    expect(kind('/productivity-tips')).toBe('other');
  });
});

it('keeps content about crawler paths while excluding platform redirectors', () => {
  const scope = { domain: 'example.com' };
  for (const path of [
    '/cdn-cgi/l/email-protection',
    '/customer_authentication/redirect',
    '/customer_identity/login',
    '/account_login',
  ]) {
    expect(classifyUrlAdmission(`https://example.com${path}`, scope)).toMatchObject({
      accepted: false,
      reason: 'hard_excluded_path',
    });
  }
  for (const path of ['/blog/cdn-cgi-explained', '/docs/how-cdn-cgi-works', '/cdn-cgifted']) {
    expect(classifyUrlAdmission(`https://example.com${path}`, scope).accepted).toBe(true);
  }
});

it('inventories readable documents while refusing binary downloads and oversized URLs', () => {
  for (const extension of ['pdf', 'docx', 'md']) {
    expect(classifyUrlAdmission(`https://example.com/download.${extension}`)).toMatchObject({
      accepted: true,
      disposition: 'inventory_only',
      itemKind: 'document',
    });
  }
  for (const extension of ['zip', 'exe', 'tar', 'deb', 'rpm', 'apk', 'dmg']) {
    expect(classifyUrlAdmission(`https://example.com/download.${extension}`)).toMatchObject({
      accepted: false,
      reason: 'hard_excluded_asset',
    });
  }
  expect(
    classifyUrlAdmission(`https://example.com/page?context=${'x'.repeat(2048)}`),
  ).toMatchObject({
    accepted: false,
    url: null,
    reason: 'invalid_url',
  });
});

it('keeps a public-suffix sibling outside the root site', () => {
  const scope = { domain: 'example.co.uk' };
  expect(classifyUrlAdmission('https://docs.example.co.uk/page', scope).accepted).toBe(true);
  for (const host of ['other.co.uk', 'example.co.uk.evil.com', 'notexample.co.uk']) {
    expect(classifyUrlAdmission(`https://${host}/page`, scope)).toMatchObject({
      accepted: false,
      reason: 'out_of_scope',
    });
  }
});

describe('discovery links', () => {
  it('keeps in-scope, canonical, first-seen links in order and repairs an encoded tracking query', () => {
    const root = document(
      Buffer.from(
        '<title> Home </title><a href="#top">x</a><a href="mailto:a@b">x</a>' +
          '<a href="/a">a</a><a href="/a#again">dup</a><a href="https://other.test/x">out</a>' +
          '<a href="/p%3Futm_source%3Dnews">p</a><a href="/b">b</a><a href="/c">c</a>',
      ),
    );
    const { title, links } = discoveryLinks(root, 'https://example.test/', scope, 3);
    expect(title).toBe('Home');
    expect(links.map((link) => [link.admission.url, link.ordinal, link.rewriteReason])).toEqual([
      ['https://example.test/a', 0, ''],
      ['https://example.test/p', 1, policy.site_health.crawl.link_rewrite.reason],
      ['https://example.test/b', 2, ''],
    ]);
  });

  it('resolves relative links against the document base, not the page URL', () => {
    const root = document(
      Buffer.from(
        '<head><base href="/shop/"></head><a href="boots">b</a><a href="/about">a</a>' +
          '<a href="../blog/news">n</a>',
      ),
    );
    const { links } = discoveryLinks(root, 'https://example.test/blog/post', scope, 10);
    expect(links.map((link) => link.admission.url)).toEqual([
      'https://example.test/shop/boots',
      'https://example.test/about',
      'https://example.test/blog/news',
    ]);
  });

  it('discovers a tagged link once, as its clean target', () => {
    const root = document(
      Buffer.from(
        '<a href="/products/net?srsltid=AfmBOo&utm_source=chatgpt.com">tagged</a>' +
          '<a href="/products/net">clean</a>',
      ),
    );
    const { links } = discoveryLinks(root, 'https://example.test/blogs/news/a', scope, 10);
    expect(links.map((link) => link.admission.url)).toEqual(['https://example.test/products/net']);
  });

  it('reads anchors the fact extractor prunes, keeps reserved escapes, and decodes the declared charset', () => {
    const root = document(
      Buffer.from(
        '<title>Café</title><a hidden href="/hidden">h</a><template><a href="/template">t</a></template>' +
          '<a href="/items/%3Ffaq">q</a><a href="/items/%3Fsku%3D42">s</a><a href="/items/%2Fpart">p</a>',
        'latin1',
      ),
      'ISO-8859-1',
    );
    const { title, links } = discoveryLinks(root, 'https://example.test/', scope, 10);
    expect(title).toBe('Café');
    expect(links.map((link) => [link.admission.url, link.rewriteReason])).toEqual([
      ['https://example.test/hidden', ''],
      ['https://example.test/template', ''],
      ['https://example.test/items/%3Ffaq', ''],
      ['https://example.test/items/%3Fsku%3D42', ''],
      ['https://example.test/items/%2Fpart', ''],
    ]);
  });

  it('shares one parse with fact extraction without escaping the fact byte cap', () => {
    const prefix = '<html><body><p>within budget</p>';
    const body = Buffer.from(`${prefix}<a href="/beyond">outside budget</a></body></html>`);
    const root = document(body);
    expect(discoveryLinks(root, 'https://example.test/', scope, 10).links).toHaveLength(1);
    const settings = { ...factSettings({}), maxHtmlBytes: prefix.length };
    const facts = extractPageFacts(body, { finalUrl: 'https://example.test/' }, settings, root);
    expect(facts.extraction.truncated).toBe(true);
    expect(facts.body.text).not.toContain('outside budget');
  });
});

describe('sitemaps', () => {
  const limits = { maxDecodedBytes: 4096, maxUrls: 3, maxIndexDepth: 1 };
  const urlset = (...locs: string[]) =>
    Buffer.from(
      `<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${locs
        .map((loc) => `<url><loc> ${loc} </loc></url>`)
        .join('')}</urlset>`,
    );
  const read = (body: Buffer) => parseSitemap(body, 'text/xml', limits);
  it('reads page URLs and index references, and decodes gzip under the cap', () => {
    expect(parseSitemap(urlset('https://example.test/a?x=1&amp;y=2'), 'text/xml', limits)).toEqual({
      urls: ['https://example.test/a?x=1&y=2'],
      lastmod: new Map(),
      refs: [],
      truncated: false,
    });
    const index = Buffer.from(
      '<sitemapindex><sitemap><loc>https://example.test/s1.xml</loc></sitemap></sitemapindex>',
    );
    expect(parseSitemap(gzipSync(index), 'application/gzip', limits)).toEqual({
      urls: [],
      lastmod: new Map(),
      refs: ['https://example.test/s1.xml'],
      truncated: false,
    });
  });

  it('flags a collected list a safety ceiling cut short, so its count is a lower bound', () => {
    const four = urlset('/1', '/2', '/3', '/4')
      .toString()
      .replaceAll('> /', '> https://example.test/');
    const capped = new SitemapCollector(limits);
    capped.add('https://example.test/sitemap.xml', read(Buffer.from(four)), 0);
    expect([capped.urls.length, capped.truncated]).toEqual([3, true]);
    const whole = new SitemapCollector(limits);
    whole.add('https://example.test/sitemap.xml', read(urlset('https://example.test/1')), 0);
    expect([whole.urls.length, whole.truncated]).toEqual([1, false]);
    // At the depth bound, a reference back to a read index leaves nothing unread.
    const looped = new SitemapCollector(limits);
    const index = (loc: string) =>
      Buffer.from(`<sitemapindex><sitemap><loc>${loc}</loc></sitemap></sitemapindex>`);
    looped.add('https://example.test/a.xml', read(index('https://example.test/b.xml')), 0);
    looped.add('https://example.test/b.xml', read(index('https://example.test/a.xml')), 1);
    expect(looped.truncated).toBe(false);
    looped.add('https://example.test/b.xml', read(index('https://example.test/c.xml')), 1);
    expect(looped.truncated).toBe(true);
  });

  it('keeps each page URL’s first declared lastmod through the collector', () => {
    const dated = Buffer.from(
      `<urlset><url><loc>https://example.test/a</loc><lastmod> 2026-09-01 </lastmod></url>
      <url><loc>https://example.test/b</loc></url>
      <url><loc>https://example.test/a</loc><lastmod>2020-01-01</lastmod></url></urlset>`,
    );
    const collector = new SitemapCollector(limits);
    collector.add('https://example.test/sitemap.xml', read(dated), 0);
    expect(collector.urls).toEqual([
      'https://example.test/a',
      'https://example.test/b',
      'https://example.test/a',
    ]);
    expect(collector.lastmod).toEqual(new Map([['https://example.test/a', '2026-09-01']]));
  });

  it('refuses entity declarations, malformed XML and decompression bombs', () => {
    const entity = Buffer.from(
      '<!DOCTYPE x [<!ENTITY a "aaaa">]><urlset><url><loc>&a;</loc></url></urlset>',
    );
    expect(() => parseSitemap(entity, 'text/xml', limits)).toThrow(SitemapParseError);
    expect(() => parseSitemap(Buffer.from('<urlset><url>'), 'text/xml', limits)).toThrow(
      SitemapParseError,
    );
    const bomb = gzipSync(Buffer.alloc(limits.maxDecodedBytes * 4, 'a'));
    expect(() => parseSitemap(bomb, 'application/gzip', limits)).toThrow(SitemapParseError);
  });

  it('caps collected URLs and stops following references at the depth bound or a loop', () => {
    const collector = new SitemapCollector(limits);
    const index = Buffer.from(
      '<sitemapindex><sitemap><loc>https://example.test/root.xml</loc></sitemap>' +
        '<sitemap><loc>https://example.test/child.xml</loc></sitemap></sitemapindex>',
    );
    expect(collector.add('https://example.test/root.xml', read(index), 0)).toEqual([
      'https://example.test/child.xml',
    ]);
    expect(collector.add('https://example.test/child.xml', read(index), 1)).toEqual([]);
    collector.add('https://example.test/u1.xml', read(urlset('a', 'b')), 1);
    collector.add('https://example.test/u2.xml', read(urlset('c', 'd')), 1);
    expect(collector.urls).toEqual(['a', 'b', 'c']);
    // A fragment or spelling variant of a visited sitemap is the same document.
    const again = Buffer.from(
      '<sitemapindex><sitemap><loc>https://EXAMPLE.test/root.xml#top</loc></sitemap></sitemapindex>',
    );
    expect(collector.add('https://example.test/other.xml', read(again), 0)).toEqual([]);
  });

  it('parses a sitemap off the event loop with the same answer and refusals', async () => {
    const dated = Buffer.from(
      '<urlset><url><loc>https://example.test/a</loc><lastmod>2026-09-01</lastmod></url></urlset>',
    );
    expect(await parseSitemapAsync(gzipSync(dated), 'application/gzip', limits)).toEqual({
      urls: ['https://example.test/a'],
      lastmod: new Map([['https://example.test/a', '2026-09-01']]),
      refs: [],
      truncated: false,
    });
    await expect(
      parseSitemapAsync(Buffer.from('<urlset><url>'), 'text/xml', limits),
    ).rejects.toThrow(new SitemapParseError('malformed sitemap XML'));
  });
});
