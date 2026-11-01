import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';

import { policy } from '../src/config.ts';
import { extractPageFacts, factSettings } from '../src/site-health/analysis/facts.ts';
import { discoveryLinks } from '../src/site-health/discovery-links.ts';
import { classifyUrlAdmission } from '../src/site-health/url-admission.ts';
import { document } from '../src/web-evidence/html.ts';
import { parseSitemap, SitemapCollector, SitemapParseError } from '../src/web-evidence/sitemaps.ts';

const reasons = policy.site_health.crawl.exclusions;
const scope = { domain: 'example.test' };

describe('URL admission', () => {
  it('admits the registrable domain and its subdomains, and only narrows with globs', () => {
    expect(classifyUrlAdmission('https://blog.example.test/post', scope).accepted).toBe(true);
    expect(classifyUrlAdmission('https://example.test.evil/post', scope).reason).toBe(
      reasons.out_of_scope,
    );
    const narrowed = {
      ...scope,
      include: ['https://example.test/docs/*'],
      exclude: ['*/docs/private*'],
    };
    expect(classifyUrlAdmission('https://example.test/docs/a/b', narrowed).accepted).toBe(true);
    expect(classifyUrlAdmission('https://example.test/blog', narrowed).reason).toBe(
      reasons.narrowed,
    );
    expect(classifyUrlAdmission('https://example.test/docs/private-x', narrowed).reason).toBe(
      reasons.narrowed,
    );
  });

  it('translates fnmatch globs, including hyphens and literal brackets, without throwing', () => {
    const admitted = (path: string, include: string[]) =>
      classifyUrlAdmission(`https://example.test${path}`, { ...scope, include }).accepted;
    expect(admitted('/blog-posts/a', ['*/blog-posts/*'])).toBe(true);
    // A `]` right after `[` or `[!` is a set member, not the close.
    expect(admitted('/axb', ['*/a[]x]b'])).toBe(true);
    expect(admitted('/ayb', ['*/a[!]x]b'])).toBe(true);
    expect(admitted('/axb', ['*/a[!]x]b'])).toBe(false);
    // A reversed range cannot compile; the glob then matches only itself.
    expect(admitted('/x', ['*[z-a]*'])).toBe(false);
    expect(admitted('/archive-7/x', ['*/archive-[0-9]/?'])).toBe(true);
    expect(admitted('/archive-x/x', ['*/archive-[0-9]/?'])).toBe(false);
  });

  it('matches many-star globs in linear time on long near-miss URLs', () => {
    const glob = `https://example.test/${'*a'.repeat(200)}*b`;
    const url = `https://example.test/${'a'.repeat(900)}`;
    const started = performance.now();
    const decision = classifyUrlAdmission(url, { ...scope, include: [glob] });
    expect(decision.reason).toBe(reasons.narrowed);
    expect(classifyUrlAdmission(`${url}b`, { ...scope, include: [glob] }).accepted).toBe(true);
    expect(performance.now() - started).toBeLessThan(1000);
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

it('keeps content about crawler paths while excluding platform redirectors despite includes', () => {
  const scope = { domain: 'example.com', include: ['*'] };
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

it('keeps a public-suffix sibling outside the root site even with an unrestricted include', () => {
  const scope = { domain: 'example.co.uk', include: ['*'] };
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
  it('reads page URLs and index references, and decodes gzip under the cap', () => {
    expect(parseSitemap(urlset('https://example.test/a?x=1&amp;y=2'), 'text/xml', limits)).toEqual({
      urls: ['https://example.test/a?x=1&y=2'],
      lastmod: new Map(),
      refs: [],
    });
    const index = Buffer.from(
      '<sitemapindex><sitemap><loc>https://example.test/s1.xml</loc></sitemap></sitemapindex>',
    );
    expect(parseSitemap(gzipSync(index), 'application/gzip', limits)).toEqual({
      urls: [],
      lastmod: new Map(),
      refs: ['https://example.test/s1.xml'],
    });
  });

  it('keeps each page URL’s first declared lastmod through the collector', () => {
    const dated = Buffer.from(
      `<urlset><url><loc>https://example.test/a</loc><lastmod> 2026-09-01 </lastmod></url>
      <url><loc>https://example.test/b</loc></url>
      <url><loc>https://example.test/a</loc><lastmod>2020-01-01</lastmod></url></urlset>`,
    );
    const collector = new SitemapCollector(limits);
    collector.add('https://example.test/sitemap.xml', dated, 'text/xml', 0);
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
    expect(collector.add('https://example.test/root.xml', index, 'text/xml', 0)).toEqual([
      'https://example.test/child.xml',
    ]);
    expect(collector.add('https://example.test/child.xml', index, 'text/xml', 1)).toEqual([]);
    collector.add('https://example.test/u1.xml', urlset('a', 'b'), 'text/xml', 1);
    collector.add('https://example.test/u2.xml', urlset('c', 'd'), 'text/xml', 1);
    expect(collector.urls).toEqual(['a', 'b', 'c']);
    // A fragment or spelling variant of a visited sitemap is the same document.
    const again = Buffer.from(
      '<sitemapindex><sitemap><loc>https://EXAMPLE.test/root.xml#top</loc></sitemap></sitemapindex>',
    );
    expect(collector.add('https://example.test/other.xml', again, 'text/xml', 0)).toEqual([]);
  });
});
