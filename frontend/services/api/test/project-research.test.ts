import { gzipSync } from 'node:zlib';
import { createServer } from 'node:http';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { recordingMeter } from './meter-fixtures.ts';

import { ApiError } from '../src/errors.ts';
import { extractPage, offeringLinks } from '../src/projects/html-evidence.ts';
import { rasterType } from '../src/projects/logo-refresh.ts';
import {
  createWebsiteFetcher,
  decodedBody,
  FetchError,
  pinnedRequest,
  validateAddress,
  websiteIdentity,
} from '../src/safe-fetch.ts';
import { resolveSite } from '../src/projects/site-resolution.ts';
import { cleanSuggestions, competitorQueries, researchBrand } from '../src/projects/research.ts';
import { discoveryCreate, discoverySettings } from '../src/projects/discovery-inputs.ts';
import {
  boundedPages,
  createResearchClient,
  ResearchBudget,
} from '../src/projects/research-evidence.ts';
import { seedBrandAliases } from '../src/projects/discovery.ts';
import { createModelGateway } from '../src/models/gateway.ts';
import { policy } from '../src/config.ts';
import type { ResearchTransport } from '../src/projects/research-evidence.ts';

const options = { maxBytes: 1000, timeoutSeconds: 1, redirects: 3, contentTypes: ['text/html'] };
type Phase = 'identity' | 'themes' | 'competitors';
type ModelRequest = { messages: { content: string }[] };
function phaseOf(body: unknown): Phase {
  const system = (body as ModelRequest).messages[0]?.content ?? '';
  if (system === policy.discovery.constants.identity_research_system_prompt) return 'identity';
  if (system === policy.discovery.constants.theme_research_system_prompt) return 'themes';
  return 'competitors';
}
function recordedGateway(replies: Partial<Record<Phase, unknown[]>>) {
  const requests: { phase: Phase; body: ModelRequest }[] = [];
  const transport = vi.fn(async (_url: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as ModelRequest;
    const phase = phaseOf(body);
    requests.push({ phase, body });
    return Response.json({
      model: 'returned-test-model',
      choices: [{ message: { content: JSON.stringify(replies[phase]?.shift() ?? {}) } }],
      usage: { total_tokens: 50 },
    });
  });
  return {
    transport,
    requests,
    gateway: createModelGateway(
      {
        apiKey: 'test-only',
        baseUrl: 'https://model.example/v1',
        model: 'test-model',
        timeoutSeconds: 2,
        maxOutputTokens: 2000,
        attempts: 1,
        baseDelaySeconds: 0,
        maxDelaySeconds: 0,
      },
      { fetch: transport, sleep: async () => {} },
    ),
  };
}
const { meter } = recordingMeter();
const keenable = { meter, feature: 'research_evidence' } as const;
it('dials the pinned address through the native request boundary while preserving Host', async () => {
  let host: string | undefined;
  const server = createServer((request, response) => {
    host = request.headers.host;
    response.setHeader('content-type', 'text/html');
    response.end('<p>Recorded page</p>');
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  try {
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing test listener');
    const url = new URL(`http://recorded.example:${address.port}/`);
    const result = await pinnedRequest(
      url,
      { address: '127.0.0.1', family: 4 },
      options,
      AbortSignal.timeout(1000),
    );
    expect(result.body.toString()).toBe('<p>Recorded page</p>');
    expect(host).toBe(url.host);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});
it('keeps separate X-Robots-Tag header lines apart so each keeps its own agent scope', async () => {
  const server = createServer((_request, response) => {
    response.setHeader('content-type', 'text/html');
    response.setHeader('x-robots-tag', ['googlebot: noindex', 'nosnippet']);
    response.end('<p>Recorded page</p>');
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  try {
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing test listener');
    const result = await pinnedRequest(
      new URL(`http://recorded.example:${address.port}/`),
      { address: '127.0.0.1', family: 4 },
      options,
      AbortSignal.timeout(1000),
    );
    expect(result.headers).toMatchObject({
      'content-type': 'text/html',
      'x-robots-tag': 'googlebot: noindex\nnosnippet',
    });
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});
it('keeps recorded search provenance, drops unusable results and enforces a shared call budget before I/O', async () => {
  const settings = discoverySettings({ KEENABLE_API_KEY: 'test-only' });
  const budget = new ResearchBudget(1);
  const transport = vi.fn<ResearchTransport>(async () =>
    Response.json({
      results: [
        {
          source_id: 'recorded-source',
          url: 'https://acme.com/about',
          title: 'Acme',
          snippet: 'Recorded facts',
          published_at: '2025-01-01T00:00:00Z',
          acquired_at: '2026-03-01T00:00:00Z',
        },
        { url: 123 },
      ],
    }),
  );
  const client = createResearchClient(settings, budget, transport, keenable);
  const items = await client.search('Acme company', 'acme.com', 10);
  expect(items).toEqual([
    {
      url: 'https://acme.com/about',
      title: 'Acme',
      text: 'Recorded facts',
      source_id: 'recorded-source',
      processing_version: policy.discovery.constants.keenable_research_version,
      provider: 'keenable',
      published_at: '2025-01-01T00:00:00Z',
      acquired_at: '2026-03-01T00:00:00Z',
    },
  ]);
  expect(
    boundedPages(
      [
        { url: 'https://acme.com/about', title: 'Acme', text: 'Recorded facts' },
        { url: 'https://acme.com/about', title: 'Duplicate', text: 'Repeated page' },
        { url: 'https://acme.com/team', title: 'Team', text: 'Recorded team' },
      ],
      10,
    ),
  ).toEqual([
    { url: 'https://acme.com/about', title: 'Acme', text: 'Recor' },
    { url: 'https://acme.com/team', title: 'Team', text: 'Recor' },
  ]);
  await expect(client.search('over budget', null, 10)).rejects.toThrow(
    'external_research_unavailable',
  );
  expect(transport).toHaveBeenCalledTimes(1);
  expect(() =>
    createResearchClient(
      { ...settings, keenable_base_url: 'https://untrusted.example' },
      budget,
      transport,
      keenable,
    ),
  ).toThrow('canonical HTTPS');
});
it('caps expanded response bytes and rejects unsupported content encodings', () => {
  const compressed = gzipSync(Buffer.alloc(5000, 'a'));
  expect(() => decodedBody(compressed, 'gzip', 1000)).toThrow(FetchError);
  expect(decodedBody(gzipSync(Buffer.from('bounded')), 'gzip', 1000).toString()).toBe('bounded');
  expect(() => decodedBody(Buffer.from('text'), 'unknown', 1000)).toThrow(FetchError);
});
it('seeds recognizable domain spellings without expanding an unrelated brand', () => {
  expect(seedBrandAliases('Summit Wear', ['summitwear.com.au', 'shop-online.com'])).toEqual([
    'summitwear',
  ]);
  expect(
    seedBrandAliases('Harbor Denim', ['harbordenim.co.uk', 'harbordenim.com', 'harbor.shop']),
  ).toEqual(['harbordenim', 'harbor']);
  expect(seedBrandAliases('Art Supplies Co', ['cart-example.com'])).toEqual([]);
  expect(seedBrandAliases('summitwear', ['summitwear.com'])).toEqual([]);
});
it('keeps identity fixed while retrying malformed provisional competitors', async () => {
  const page = extractPage(
    Buffer.from('<title>Acme</title><p>Analytics services</p>'),
    'https://acme.com/',
  );
  const replies = {
    identity: [
      {
        status: 'ready',
        profile: { category: 'Analytics', description: 'Recorded business description' },
      },
    ],
    themes: [
      {
        themes: [
          ['Price', 'buyer_choice', 0.95],
          ['Funding and valuation', 'buyer_choice', 0.9],
          ['Company history', 'company_fact', 0.9],
          ['Ownership', 'buyer_choice', 0.9],
          ['Delivery  speed', 'buyer_choice', 0.9],
          ['Best value for families on a budget', 'buyer_choice', 0.9],
          ['Other', 'buyer_choice', 0.9],
          ['Product range', 'buyer_choice', 0.85],
          ['price', 'buyer_choice', 0.8],
          ['Returns', 'buyer_choice', 0.8],
          ['Store locations', 'buyer_choice', 0.8],
          ['Ease of use', 'buyer_choice', 0.8],
          ['Customer support', 'buyer_choice', 0.8],
          ['Quality', 'buyer_choice', 0.75],
          ['Sizing', 'buyer_choice', 0.75],
          ['Packaging', 'buyer_choice', 0.4],
        ].map(([name, kind, confidence]) => ({ name, kind, confidence })),
      },
    ],
    competitors: [
      { competitors: 'invalid' },
      { competitors: [{ name: 'Globex', domains: ['globex.com'], aliases: [] }] },
    ],
  };
  const { gateway, transport, requests } = recordedGateway(replies);
  const result = await researchBrand(
    discoveryCreate.parse({ brand_name: 'Acme', website_url: 'acme.com', primary_market: 'US' }),
    { url: page.url, domain: 'acme.com', page, warning: '' },
    {
      meter,
      gateway,
      env: { BRAND_DISCOVERY_IDENTITY_FIRST_PARTY_EVIDENCE_MAX_CHARS: '5' },
      fetcher: async () => {
        throw new Error('recorded missing page');
      },
    },
  );
  expect(transport).toHaveBeenCalledTimes(4);
  const identityRequest = requests.find((request) => request.phase === 'identity');
  const identityInput = JSON.parse(identityRequest!.body.messages[1]!.content.split('\n\n')[0]!);
  expect(identityInput.pages).toEqual([
    { url: 'https://acme.com/', title: 'Acme', text: 'Acme\n' },
  ]);
  expect(result.profile.description).toBe('Recorded business description');
  expect(result.competitors).toEqual([{ name: 'Globex', domains: ['globex.com'], aliases: [] }]);
  expect(
    result.snapshot.model_calls.map((call) => `${call.phase}:${call.outcome}`).toSorted(),
  ).toEqual([
    'competitor_suggestions:failed',
    'competitor_suggestions:succeeded',
    'identity:succeeded',
    'themes:succeeded',
  ]);
  expect(result.snapshot).not.toHaveProperty('evidence_manifest');
  expect(result.snapshot.themes).toEqual([
    'Price',
    'Delivery speed',
    'Product range',
    'Returns',
    'Store locations',
    'Ease of use',
    'Customer support',
    'Quality',
  ]);
});
it.each(['ready', 'failed'] as const)(
  'reports competitor search %s while retaining successful model suggestions',
  async (searchState) => {
    const { gateway } = recordedGateway({
      identity: [{ status: 'ready', profile: { category: 'Analytics' } }],
      competitors: [{ competitors: [{ name: 'Globex', domains: ['globex.com'] }] }],
    });
    const transport: ResearchTransport = async (_target, init) => {
      const query: unknown = JSON.parse(String(init?.body ?? '{}')).query;
      if (
        searchState === 'failed' &&
        typeof query === 'string' &&
        query.includes('alternatives competitors')
      )
        throw new Error('Recorded competitor search failure');
      return Response.json({
        results: [{ title: 'Acme', url: 'https://acme.com/about', snippet: 'Analytics services' }],
      });
    };
    const result = await researchBrand(
      discoveryCreate.parse({ brand_name: 'Acme', website_url: 'acme.com', primary_market: 'US' }),
      { url: 'https://acme.com/', domain: 'acme.com', page: null, warning: '' },
      { meter, gateway, transport, env: { KEENABLE_API_KEY: 'test-only' } },
    );
    expect(result.competitors.map((item) => item.name)).toEqual(['Globex']);
    expect(result.warnings).toEqual(searchState === 'failed' ? ['competitor_search_failed'] : []);
  },
);
it('rejects unsafe address classes, credentials, ports and mixed DNS before connecting', async () => {
  for (const ip of [
    '127.0.0.1',
    '10.0.0.1',
    '169.254.169.254',
    '100.64.0.1',
    '::1',
    '::ffff:127.0.0.1',
    'fd00:ec2::254',
    '2001:db8::1',
    '198.51.100.1',
    '192.0.0.8',
    '::ffff:192.0.0.8',
  ])
    expect(() => validateAddress(ip)).toThrow(FetchError);
  expect(() => websiteIdentity('https://user:secret@example.com')).toThrow();
  expect(() => websiteIdentity('https://example.com:8080')).toThrow();
  const send = vi.fn();
  const fetcher = createWebsiteFetcher(
    async () => [
      { address: '93.184.216.34', family: 4 },
      { address: '10.0.0.1', family: 4 },
    ],
    send,
  );
  await expect(fetcher('https://example.com', options)).rejects.toMatchObject({
    code: 'ssrf_blocked',
  });
  expect(send).not.toHaveBeenCalled();
});
it('pins validated IPs while retaining the hostname, then rechecks redirects', async () => {
  const send = vi.fn(async (_url: URL, _target: { address: string; family: number }) => ({
    status: 302,
    location: 'http://127.0.0.1/private',
    type: 'text/html',
    body: Buffer.alloc(0),
  }));
  const fetcher = createWebsiteFetcher(async () => [{ address: '93.184.216.34', family: 4 }], send);
  await expect(fetcher('https://example.com', options)).rejects.toMatchObject({
    code: 'ssrf_blocked',
  });
  expect(send).toHaveBeenCalledTimes(1);
  expect(send.mock.calls[0]?.[0].hostname).toBe('example.com');
  expect(send.mock.calls[0]?.[1].address).toBe('93.184.216.34');
});
it('keeps a proven oversized site reviewable despite a failed HTTP fallback', async () => {
  const fetcher = vi.fn(async (url: string) => {
    if (url.startsWith('https:')) throw new FetchError('response_too_large');
    return { url, status: 404, contentType: 'text/html', body: Buffer.alloc(0) };
  });
  await expect(resolveSite('example.com', fetcher)).resolves.toMatchObject({
    domain: 'example.com',
    page: null,
    warning: 'research_degraded',
  });
});
it('preserves transient transport errors and rejects unrelated first-party redirects', async () => {
  const error = new FetchError('dns_resolution_failed');
  await expect(
    resolveSite('example.com', async () => {
      throw error;
    }),
  ).rejects.toBe(error);
  const send = vi.fn(async () => ({
    status: 302,
    location: 'https://unrelated.com/',
    type: 'text/html',
    body: Buffer.alloc(0),
  }));
  const fetcher = createWebsiteFetcher(async () => [{ address: '93.184.216.34', family: 4 }], send);
  await expect(resolveSite('example.com', fetcher)).rejects.toMatchObject({ code: 'out_of_scope' });
  expect(send).toHaveBeenCalledTimes(1);
});
it('extracts visible text and ranks offering navigation while dropping active subtrees', () => {
  const page = extractPage(
    Buffer.from(
      '<html><head><title>Acme</title><link rel="icon" href="/icon.png"></head><body><script>Invented offer</script><p>Real analytics services</p><a href="/privacy">Privacy</a><a href="/services/analytics">Analytics</a><a href="/blog/news">Latest article</a></body></html>',
    ),
    'https://example.com/',
  );
  expect(page.text).toContain('Real analytics services');
  expect(page.text).not.toContain('Invented');
  expect(offeringLinks([page]).map((item) => item.label)).toEqual(['Analytics']);
  expect(offeringLinks([page])[0]).toMatchObject({
    source_id: page.source_id,
    processing_version: page.processing_version,
  });
  expect(extractPage(Buffer.from('Different capture'), page.url).source_id).not.toBe(
    page.source_id,
  );
  expect(page.icons).toEqual(['https://example.com/icon.png']);
  expect(rasterType(Buffer.from('<svg>script</svg>'))).toBeNull();
  expect(rasterType(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))).toBe('image/png');
});
it("ranks a retailer's departments above customer-service pages under services or store", () => {
  const labels = (nav: string[][]) =>
    offeringLinks([
      extractPage(
        Buffer.from(
          `<html><body>${nav.map(([href, label]) => `<a href="${href}">${label}</a>`).join('')}</body></html>`,
        ),
        'https://shop.example/',
      ),
    ]).map((item) => item.label);
  expect(
    labels([
      ['/services/gift-cards', 'Gift Cards'],
      ['/services/buy-now-pay-later', 'Buy Now Pay Later'],
      ['/store/finder', 'Store Finder'],
      ['/services/click-collect', 'Click & Collect'],
      ['/womens', 'Women'],
      ['/kids', 'Kids'],
      ['/baby', 'Baby'],
      ['/gift-hampers', 'Gift hampers'],
    ]),
  ).toEqual([
    'Women',
    'Kids',
    'Baby',
    'Gift hampers',
    'Gift Cards',
    'Buy Now Pay Later',
    'Store Finder',
    'Click & Collect',
  ]);
  expect(
    labels([
      ['/products/gift-cards', 'Gift Cards'],
      ['/products/employee-rewards', 'Employee rewards'],
    ]),
  ).toEqual(['Employee rewards', 'Gift Cards']);
});
it.each([
  [
    'John The Plumber',
    'Emergency Plumber Leeds | 24-Hour Call-Out | John The Plumber',
    ['John The Plumber alternatives competitors GB', 'Emergency Plumber Leeds 24-Hour Call-Out'],
  ],
  [
    'Lewis & Associates',
    'Lewis & Associates LLP: Refugee & Immigration Lawyers - Toronto',
    ['Lewis & Associates alternatives competitors GB', 'Refugee & Immigration Lawyers Toronto'],
  ],
  ['Acme', 'Acme Plumbing Leeds', ['Acme alternatives competitors GB', 'Plumbing Leeds']],
  ['Acme', null, ['Acme alternatives competitors GB']],
])(
  'searches competitors for %s by name and by the trade in its homepage title',
  (brand, title, queries) => {
    const page = title
      ? extractPage(Buffer.from(`<title>${title}</title><p>Recorded</p>`), 'https://acme.com/')
      : null;
    expect(
      competitorQueries(
        discoveryCreate.parse({ brand_name: brand, website_url: 'acme.com', primary_market: 'GB' }),
        { url: 'https://acme.com/', domain: 'acme.com', page, warning: '' },
      ),
    ).toEqual(queries);
  },
);
it('drops the brand itself and directory sites from competitor suggestions', () => {
  expect(
    cleanSuggestions(
      [
        { name: 'Acme', domains: ['acme.com'], aliases: [] },
        { name: 'Directory', domains: ['g2.com'], aliases: [] },
        { name: 'Globex', domains: ['globex.com'], aliases: [] },
      ],
      'Acme',
      'acme.com',
      10,
    ),
  ).toEqual([{ name: 'Globex', domains: ['globex.com'], aliases: [] }]);
});
it('keeps stores on a shared platform as separate sites (AR-5)', () => {
  expect(
    cleanSuggestions(
      [
        { name: 'Rival', domains: ['https://rival.myshopify.com/'], aliases: [] },
        { name: 'Other', domains: ['other.myshopify.com'], aliases: [] },
        { name: 'Blog', domains: ['www.blog.wordpress.com'], aliases: [] },
      ],
      'Acme',
      'acme.myshopify.com',
      10,
    ).map((item) => item.domains),
  ).toEqual([['rival.myshopify.com'], ['other.myshopify.com'], ['blog.wordpress.com']]);
});
it('refuses a first-party redirect to another store on the same platform', async () => {
  const send = vi.fn(async () => ({
    status: 302,
    location: 'https://rival.myshopify.com/',
    type: 'text/html',
    body: Buffer.alloc(0),
  }));
  const fetcher = createWebsiteFetcher(async () => [{ address: '93.184.216.34', family: 4 }], send);
  await expect(resolveSite('acme.myshopify.com', fetcher)).rejects.toMatchObject({
    code: 'out_of_scope',
  });
});
it('records the identity model finding too little evidence and warns the reviewer', async () => {
  const { gateway } = recordedGateway({
    identity: [{ status: 'insufficient_evidence', profile: { category: 'Analytics' } }],
    competitors: [{ competitors: [{ name: 'Globex', domains: ['globex.com'] }] }],
  });
  const result = await researchBrand(
    discoveryCreate.parse({ brand_name: 'Acme', website_url: 'acme.com', primary_market: 'US' }),
    { url: 'https://acme.com/', domain: 'acme.com', page: null, warning: '' },
    { meter, gateway, env: {} },
  );
  expect(result.snapshot.identity_status).toBe('insufficient_evidence');
  expect(result.warnings).toContain('insufficient_evidence');
});
it.each([
  ['an unusable answer', new Error('invalid output'), 'brand_identity_unavailable', true],
  [
    'a gateway refusal',
    new ApiError(403, 'The model gateway refused the request'),
    'brand_identity_unavailable',
    false,
  ],
])(
  'fails research on %s from the identity request instead of an empty review',
  async (_label, failure, code, retryable) => {
    const structured = vi.fn(async (_system: string) => {
      throw failure;
    });
    const gateway = {
      model: 'test-model',
      maxOutputTokens: 100,
      baseUrlHost: 'model.example',
      adapter: 'openai_compatible' as const,
      converse: vi.fn(),
      complete: vi.fn(),
      completeStructured: vi.fn(),
      structured,
    };
    await expect(
      researchBrand(
        discoveryCreate.parse({
          brand_name: 'Acme',
          website_url: 'acme.com',
          primary_market: 'US',
        }),
        { url: 'https://acme.com/', domain: 'acme.com', page: null, warning: 'research_degraded' },
        { meter, gateway, env: {} },
      ),
    ).rejects.toMatchObject({ code, retryable });
    expect(
      structured.mock.calls.filter(
        ([system]) => system === policy.discovery.constants.identity_research_system_prompt,
      ),
    ).toHaveLength(1);
  },
);
describe('identity deadline', () => {
  const acme = discoveryCreate.parse({
    brand_name: 'Acme',
    website_url: 'acme.com',
    primary_market: 'US',
  });
  const site = { url: 'https://acme.com/', domain: 'acme.com', page: null, warning: '' };
  const searchProvider: ResearchTransport = async () =>
    Response.json({
      results: [{ title: 'Acme', url: 'https://acme.com/about', snippet: 'Analytics services' }],
    });
  function slowIdentityGateway(identityMs: number) {
    const replies: Record<Phase, unknown> = {
      identity: { status: 'ready', profile: { category: 'Analytics' } },
      themes: { themes: [] },
      competitors: { competitors: [{ name: 'Globex', domains: ['globex.com'] }] },
    };
    const fetch = vi.fn<typeof globalThis.fetch>(
      (_url, init) =>
        new Promise((resolve, reject) => {
          const phase = phaseOf(JSON.parse(String(init?.body)));
          const reply = Response.json({
            choices: [{ message: { content: JSON.stringify(replies[phase]) } }],
          });
          const timer = setTimeout(() => resolve(reply), phase === 'identity' ? identityMs : 1_000);
          init?.signal?.addEventListener('abort', () => {
            clearTimeout(timer);
            reject(init.signal?.reason);
          });
        }),
    );
    return createModelGateway(
      {
        apiKey: 'test-only',
        baseUrl: 'https://model.example/v1',
        model: 'test-model',
        timeoutSeconds: 600,
        maxOutputTokens: 2000,
        attempts: 1,
        baseDelaySeconds: 0,
        maxDelaySeconds: 0,
      },
      { fetch, sleep: async () => {} },
    );
  }
  async function research(identityMs: number, budgetMs?: number) {
    const outcome = researchBrand(acme, site, {
      meter,
      gateway: slowIdentityGateway(identityMs),
      transport: searchProvider,
      env: { KEENABLE_API_KEY: 'test-only' },
      ...(budgetMs === undefined ? {} : { budgetEndsAt: performance.now() + budgetMs }),
    }).then(
      (result) => ({ result, error: null }),
      (error: unknown) => ({ result: null, error }),
    );
    await vi.advanceTimersByTimeAsync(identityMs + 2_000);
    return outcome;
  }
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });
  it('waits past the old 40-second cap for a slow identity and still suggests competitors', async () => {
    const { result, error } = await research(60_000);
    expect(error).toBeNull();
    expect(result?.competitors.map((item) => item.name)).toEqual(['Globex']);
    expect(result?.warnings).toEqual([]);
  });
  it('fails an identity that outlasts its deadline or the remaining budget', async () => {
    expect((await research(100_000)).error).toMatchObject({
      code: 'brand_identity_unavailable',
      retryable: true,
    });
    expect((await research(60_000, 50_000)).error).toMatchObject({
      code: 'brand_identity_unavailable',
    });
  });
});
