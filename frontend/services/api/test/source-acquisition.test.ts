import { gzipSync } from 'node:zlib';
import { expect, it, vi } from 'vitest';

import { createWebsiteFetcher, decodedBody, FetchError } from '../src/projects/safe-fetch.ts';
import {
  acquisitionSettings,
  HostPacer,
  PageAcquirer,
  robotsPolicy,
} from '../src/web-evidence/acquisition.ts';
import { extractSourcePage } from '../src/source-pages/extract.ts';
import { assessPage, urlFormat } from '../src/source-pages/assessment.ts';
import {
  compareContent,
  ownedFacts,
  type ComparisonPage,
} from '../src/source-pages/differentiation.ts';
import { canonicalIdentity, citationIdentity } from '../src/site-health/url-identity.ts';
import { policy } from '../src/config.ts';
import { organicResults } from '../src/source-pages/sync.ts';

const settings = { ...acquisitionSettings({}), defaultDelay: 0, maxDelay: 1, timeout: 0.02 };
const options = {
  maxBytes: 10000,
  timeoutSeconds: 0.02,
  redirects: 3,
  contentTypes: ['text/html'],
};
it.each(['https://[unclosed/page', `https://${'a'.repeat(70)}.example.test/`])(
  'rejects malformed destinations before policy lookup or network access: %s',
  async (url) => {
    const dns = vi.fn();
    const send = vi.fn();
    const authorize = vi.fn();
    const fetcher = createWebsiteFetcher(dns, send);
    await expect(fetcher(url, { ...options, authorize })).rejects.toMatchObject({
      code: 'invalid_url',
    });
    expect(authorize).not.toHaveBeenCalled();
    expect(dns).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  },
);
it.each(['https://first.test/private', 'https://second.test/private'])(
  'checks destination robots before downloading the redirected page %s',
  async (destination) => {
    const sent: string[] = [];
    const fetcher = createWebsiteFetcher(
      async () => [{ address: '93.184.216.34', family: 4 }],
      async (url) => {
        sent.push(url.href);
        return url.pathname === '/robots.txt'
          ? {
              status: 200,
              location: undefined,
              type: 'text/plain',
              body: Buffer.from('User-agent: *\nDisallow: /private'),
            }
          : { status: 302, location: destination, type: '', body: Buffer.alloc(0) };
      },
    );
    const acquirer = new PageAcquirer(async () => {}, fetcher, settings, 0);
    await expect(acquirer.fetch('https://first.test/', options)).rejects.toMatchObject({
      code: 'robots_disallowed',
    });
    expect(sent).not.toContain(destination);
  },
);
it('applies crawler-specific robots rules, longest allow, refusal and retryable unavailability', () => {
  const body =
    'User-agent: *\nDisallow: /private\nAllow: /private/public\nSitemap: https://example.test/map.xml';
  const policy = robotsPolicy('https://example.test', 200, body, settings);
  expect(policy.permits('https://example.test/private')).toBe(false);
  expect(policy.permits('https://example.test/private/public')).toBe(true);
  expect(policy.sitemaps).toEqual(['https://example.test/map.xml']);
  expect(
    robotsPolicy('https://example.test', 404, '', settings).permits('https://example.test/'),
  ).toBe(true);
  expect(robotsPolicy('https://example.test', 503, '', settings).unavailable).toBe(true);
  expect(
    robotsPolicy('https://example.test', 403, '', settings).permits('https://example.test/'),
  ).toBe(false);
  expect(
    robotsPolicy('https://example.test', 200, 'User-agent: *\nCrawl-delay: 2', settings).permits(
      'https://example.test/',
    ),
  ).toBe(false);
});
it('coalesces robots acquisition and checks destination robots and suppression before redirected DNS', async () => {
  const dns = vi.fn(async () => [{ address: '93.184.216.34', family: 4 }]);
  const sent: string[] = [];
  let stopped = false;
  const fetcher = createWebsiteFetcher(dns, async (url) => {
    sent.push(url.href);
    if (url.pathname === '/robots.txt')
      return {
        status: 200,
        location: undefined,
        type: 'text/plain',
        body: Buffer.from('User-agent: *\nAllow: /'),
      };
    if (url.hostname === 'first.test') {
      stopped = true;
      return { status: 302, location: 'https://second.test/page', type: '', body: Buffer.alloc(0) };
    }
    return {
      status: 200,
      location: undefined,
      type: 'text/html',
      body: Buffer.from('<p>Reading</p>'),
    };
  });
  const authorize = vi.fn(async (url: URL) => {
    if (stopped && url.hostname === 'second.test') throw new FetchError('acquisition_unavailable');
  });
  const acquirer = new PageAcquirer(authorize, fetcher, settings, 0);
  await Promise.all([acquirer.robots('https://first.test'), acquirer.robots('https://first.test')]);
  await expect(acquirer.fetch('https://first.test/page', options)).rejects.toMatchObject({
    code: 'robots_unavailable',
  });
  expect(sent).toEqual(['https://first.test/robots.txt', 'https://first.test/page']);
  expect(dns).toHaveBeenCalledTimes(2);
});
it('refuses a redirect to a private address after checking its own robots', async () => {
  const sent: string[] = [];
  const fetcher = createWebsiteFetcher(
    async (host) => [
      { address: host === 'private.test' ? '127.0.0.1' : '93.184.216.34', family: 4 },
    ],
    async (url) => {
      sent.push(url.href);
      return url.pathname === '/robots.txt'
        ? { status: 404, location: undefined, type: '', body: Buffer.alloc(0) }
        : { status: 302, location: 'https://private.test/page', type: '', body: Buffer.alloc(0) };
    },
  );
  const acquirer = new PageAcquirer(async () => {}, fetcher, settings, 0);
  await expect(acquirer.fetch('https://first.test/page', options)).rejects.toMatchObject({
    code: 'robots_unavailable',
  });
  expect(sent).toEqual(['https://first.test/robots.txt', 'https://first.test/page']);
});
it('starts a hop timeout after its host slot and aborts an unresolved DNS lookup', async () => {
  let release!: () => void;
  const pacer = new HostPacer();
  const held = pacer.slot(
    'https://example.test',
    0,
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  const send = vi.fn(async () => ({
    status: 200,
    location: undefined,
    type: 'text/html',
    body: Buffer.from('ok'),
  }));
  const fetcher = createWebsiteFetcher(async () => [{ address: '93.184.216.34', family: 4 }], send);
  const result = fetcher('https://example.test/', {
    ...options,
    gate: (url, dispatch, signal) => pacer.slot(url.origin, 0, dispatch, signal),
  });
  await new Promise((resolve) => {
    setTimeout(resolve, 35);
  });
  release();
  await held;
  expect((await result).body.toString()).toBe('ok');
  const stalled = createWebsiteFetcher(async () => new Promise(() => {}), send);
  await expect(stalled('https://example.test/', options)).rejects.toMatchObject({
    name: 'TimeoutError',
  });
});
it('hands a host slot past cancelled waiters so later callers still run', async () => {
  const pacer = new HostPacer();
  let release!: () => void;
  const held = pacer.slot(
    'https://example.test',
    0,
    () =>
      new Promise<string>((resolve) => {
        release = () => resolve('first');
      }),
  );
  const queued = new AbortController();
  const woken = new AbortController();
  const cancelledWhileQueued = pacer.slot(
    'https://example.test',
    0,
    async () => 'never',
    queued.signal,
  );
  const cancelledOnWake = pacer.slot('https://example.test', 0, async () => 'never', woken.signal);
  const last = pacer.slot('https://example.test', 0, async () => 'last');
  queued.abort(new Error('queued abort'));
  await expect(cancelledWhileQueued).rejects.toThrow('queued abort');
  release();
  woken.abort(new Error('woken abort'));
  expect(await held).toBe('first');
  await expect(cancelledOnWake).rejects.toThrow('woken abort');
  expect(await last).toBe('last');
});
it('enforces the decoded byte cap on compressed bodies', () => {
  expect(() => decodedBody(gzipSync(Buffer.alloc(10000)), 'gzip', 100)).toThrow(
    'response_too_large',
  );
});
it('extracts visible evidence and keeps schema, headings and table structure separate', () => {
  const page = extractSourcePage(
    Buffer.from(
      '<html><head><title>Review</title><script type="application/ld+json">{"@type":"Review"}</script></head><body><h1>Acme review</h1><p>Acme is measured here.</p><script>Hidden Rival</script><table><tr><th>Cost</th></tr></table></body></html>',
    ),
  );
  const result = assessPage(page, { brand_name: 'Acme', competitors: [{ name: 'Rival' }] });
  expect(result.format).toBe('review');
  expect(result.presences.map((row) => row.presence)).toEqual(['present', 'partial']);
  expect(result.passages[0]?.text).toContain('Acme');
  expect(page.text).not.toContain('Hidden Rival');
  expect(page.facts.table_headers).toEqual([['Cost']]);
  expect(extractSourcePage(Buffer.from('<p>Visible without a title</p>')).facts.title).toBe('');
});
it('matches names the way answers do, quoting spaced and joined spellings, and keeps absence distinct', () => {
  const spaced = extractSourcePage(Buffer.from('<p>Admissions open at Northwind Academy.</p>'));
  expect(assessPage(spaced, { brand_name: 'northwindacademy' }).presences[0]).toMatchObject({
    presence: 'present',
    match_method: 'normalized_alias',
    match_count: 1,
  });
  const compact = extractSourcePage(Buffer.from('<p>We love SummitWear shoes</p>'));
  expect(assessPage(compact, { brand_name: 'Summit Wear' }).presences[0]).toMatchObject({
    presence: 'present',
    first_offset: 8,
  });
  // Named, but only as "and" for "&": no raw window reproduces it, so it is not quoted.
  const spelled = extractSourcePage(Buffer.from('<p>A &amp; B uses a tool</p>'));
  expect(assessPage(spelled, { brand_name: 'A and B' }).presences[0]?.presence).toBe('ambiguous');
  // A mention rule that excludes a phrase applies on the page as it does in answers.
  const excluded = extractSourcePage(
    Buffer.from(`<p>Shop at Target stores. ${'Other words '.repeat(100)}</p>`),
  );
  const rules = (exclusion: string[]) => ({
    brand_name: 'Target',
    entity_matching: {
      entities: { target: { mode: 'always', context_terms: [], exclusion_phrases: exclusion } },
    },
  });
  expect(assessPage(excluded, rules(['target stores'])).presences[0]?.presence).toBe(
    'not_detected',
  );
  expect(assessPage(excluded, rules([])).presences[0]?.presence).toBe('present');
  const split = extractSourcePage(Buffer.from(`<p>bond sand ${'Other words '.repeat(100)}</p>`));
  expect(assessPage(split, { brand_name: 'Bonds' }).presences[0]?.presence).toBe('not_detected');
  const full = extractSourcePage(Buffer.from(`<p>${'Other words '.repeat(100)}</p>`));
  expect(assessPage(full, { brand_name: 'Acme' }).presences[0]?.presence).toBe('not_detected');
  expect(
    assessPage({ ...full, facts: { ...full.facts, text_truncated: true } }, { brand_name: 'Acme' })
      .presences[0]?.presence,
  ).toBe('partial');
  expect(assessPage(full, {}).presences).toEqual([]);
});
it('derives page formats from a page address and keeps redirect tokens unresolved', () => {
  expect(urlFormat('https://example.test/compare/tools').format).toBe('comparison');
  expect(urlFormat('https://example.test/notes')).toEqual({ format: 'unresolved', method: 'none' });
  expect(
    citationIdentity('https://vertexaisearch.cloud.google.com/grounding-api-redirect/token'),
  ).toBeNull();
  expect(
    canonicalIdentity('https://EXAMPLE.test:443/%7euser?utm_source=x&b=2&a=1#section').url,
  ).toBe('https://example.test/~user?a=1&b=2');
});
it('serializes canonical URLs so one page has one identity', () => {
  const vectors = {
    'https://Ex.com/a%2fb?q=a+b&x=%7e|^&utm_source=z#f': 'https://ex.com/a%2Fb?q=a+b&x=~%7C%5E',
    'https://ex.com/%e2%82%ac?x=€': 'https://ex.com/%E2%82%AC?x=%E2%82%AC',
    'https://ex.com/a|b^c`d{e}': 'https://ex.com/a%7Cb%5Ec%60d%7Be%7D',
    [`https://ex.com/a[1]b"c'e!f`]: "https://ex.com/a%5B1%5Db%22c'e!f",
    "https://ex.com/p?a=*&b='&c=!&d=(x)&e=~&f=%2a&g=%41":
      'https://ex.com/p?a=%2A&b=%27&c=%21&d=%28x%29&e=~&f=%2A&g=A',
    'https://ex.com/a?z=1&z=0&Z=2': 'https://ex.com/a?Z=2&z=0&z=1',
    'https://ex.com/a b?q=a b': 'https://ex.com/a%20b?q=a+b',
    'https://ex.com/a?a&b=1': 'https://ex.com/a?a=&b=1',
    'https://ex.com/p?utm_source=x': 'https://ex.com/p',
  };
  for (const [input, expected] of Object.entries(vectors)) {
    expect(canonicalIdentity(input).url, input).toBe(expected);
  }
});
it('compares owned outbound links by registrable domain, excluding the owned site', () => {
  const anchors = [
    'https://blog.example.co.uk/post',
    'https://example.org/source',
    'not a url',
  ].map((url) => ({ url, is_internal: false }));
  expect(ownedFacts('own', { links: { anchors } }, 'www.example.co.uk').domains).toEqual([
    'example.org',
  ]);
});
it('compares page-level feature sets with explicit inspected denominators and unknown evidence', () => {
  const page = (id: string, headings: string[]): ComparisonPage => ({
    id,
    headings,
    tables: [['Price']],
    domains: [],
  });
  const compared = [
    page('1', ['Acme pricing', 'Tool features']),
    page('2', ['Acme pricing', 'Tool features']),
    page('3', ['Other topic']),
  ];
  const result = compareContent(
    page('own', ['Acme pricing', 'Unique insight']),
    compared,
    ['1', '2', '3', '4'],
    ['s1', 's2', 's3'],
    {},
  );
  expect(result.parity).toContainEqual(
    expect.objectContaining({ value: 'acme pricing', observed_pages: 2, inspected_pages: 3 }),
  );
  expect(result.gaps).toContainEqual(expect.objectContaining({ value: 'features tool' }));
  expect(result.unique_contributions).toContainEqual(
    expect.objectContaining({ value: 'insight unique' }),
  );
  expect(result.provenance.unusable_page_count).toBe(1);
  expect(compareContent(null, compared, ['1', '2', '3'], [], {}).state).toBe(
    'insufficient_evidence',
  );
});
it('reads a list heading over generic Article markup and ignores nested entity types and hostile blocks', () => {
  const article = (heading: string) =>
    `<title>${heading}</title><script type="application/ld+json">${'['.repeat(20000)}${']'.repeat(20000)}</script>
    <script type="application/ld+json">{"@type":"https://schema.org/NewsArticle","publisher":{"@type":"Organization"}}</script><h1>${heading}</h1><p>Acme leads.</p>`;
  const format = (body: string) => {
    const { format: kind, method } = assessPage(extractSourcePage(Buffer.from(body)), {});
    return { kind, method };
  };
  expect(format(article('Best tools'))).toEqual({ kind: 'listicle', method: 'heading_evidence' });
  expect(format(article('Our spring update'))).toEqual({
    kind: 'article',
    method: 'structured_data',
  });
  expect(
    format(
      '<script type="application/ld+json">{"@type":"VideoObject"}</script><h1>Best tools</h1>',
    ),
  ).toEqual({ kind: 'video', method: 'structured_data' });
  expect(format('<h1>Versatile topical notes</h1>').kind).toBe('unresolved');
});
it('quotes every named entity even when one of them fills the page', () => {
  const page = extractSourcePage(
    Buffer.from(`<h1>Acme tools</h1><p>${'Acme leads. Rival follows. '.repeat(100)}</p>`),
  );
  const result = assessPage(page, {
    brand_name: 'Acme',
    competitors: [{ name: 'Rival' }, { name: 'AI' }],
  });
  expect(result.passages).toHaveLength(4);
  expect(
    result.passages.every((passage) => passage.text.length <= policy.source_pages.passage_chars),
  ).toBe(true);
  expect(result.presences.map((presence) => presence.presence)).toEqual([
    'present',
    'present',
    'not_detected',
  ]);
  expect(
    assessPage(
      extractSourcePage(Buffer.from(`<p>${'Acmetron supplies other tools. '.repeat(100)}</p>`)),
      { brand_name: 'Acme' },
    ).presences[0]?.presence,
  ).toBe('not_detected');
});
it('hashes prose and declared structure while ignoring markup noise and rotating outbound destinations', () => {
  const page = (text: string, href: string, type: string) =>
    extractSourcePage(
      Buffer.from(
        `<script type="application/ld+json">{"@type":"${type}"}</script><p>${text}</p><a href="${href}">Source</a>`,
      ),
    );
  const first = page('Acme leads.', 'https://one.com/a', 'Article');
  expect(first.content_hash).toBe(
    page('<span>Acme leads.</span>', 'https://two.com/b', 'Article').content_hash,
  );
  expect(first.content_hash).not.toBe(
    page('Acme follows.', 'https://one.com/a', 'Article').content_hash,
  );
  expect(first.content_hash).not.toBe(
    page('Acme leads.', 'https://one.com/a', 'ItemList').content_hash,
  );
  const truncated = extractSourcePage(
    Buffer.from(`<p>${'a'.repeat(policy.source_pages.max_text_chars + 1)}</p>`),
  );
  expect(truncated.facts.text_truncated).toBe(true);
  expect(truncated.extracted_chars).toBe(policy.source_pages.max_text_chars);
  expect('text' in truncated.facts).toBe(false);
});
it('ranks organic results while skipping unusable ranks and raw duplicate URLs', () => {
  const result = organicResults({
    result: [
      {
        items: [
          { type: 'organic', url: 'https://example.test/second', rank_absolute: 2 },
          { type: 'organic', url: 'https://example.test/first', rank_absolute: 1 },
          { type: 'organic', url: 'https://example.test/first', rank_absolute: 3 },
          { type: 'organic', url: 'https://example.test/bad', rank_absolute: 'invalid' },
          { type: 'paid', url: 'https://example.test/ad', rank_absolute: 1 },
        ],
      },
    ],
  });
  expect(result.map((item) => item.url)).toEqual([
    'https://example.test/first',
    'https://example.test/second',
  ]);
});
it.each([
  ['/', 'homepage'],
  ['/blog', 'category'],
  ['/en/news', 'category'],
  ['/blog/website-notes', 'article'],
  ['/us/blog/revolut-vs-wise', 'comparison'],
  ['/vs/wise', 'comparison'],
  ['/wise/vs', 'comparison'],
  ['/alternatives/revolut', 'alternative'],
  ['/how-to-send-money', 'how_to'],
  ['/best-credit-cards', 'listicle'],
  ['/r/fintech/comments/abc/title', 'discussion'],
  ['/pricing.html', 'product'],
  ['/category/banking', 'category'],
  ['/collections/best-sellers', 'category'],
  ['/collections/best-selling-mugs', 'category'],
  ['/2024/05/chip-item-shortage', 'article'],
  ['/versatile-tools', 'unresolved'],
  ['/a-p-q', 'unresolved'],
])('classifies the cited path %s from URL evidence as %s', (path, expected) => {
  expect(urlFormat(`https://example.test${path}`).format).toBe(expected);
});
