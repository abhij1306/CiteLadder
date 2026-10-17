import { gzipSync } from 'node:zlib';
import { createServer } from 'node:http';

import { expect, it, vi } from 'vitest';
import { recordingMeter } from './meter-fixtures.ts';

import { extractPage, offeringLinks } from '../src/projects/html-evidence.ts';
import { rasterType } from '../src/projects/logo-refresh.ts';
import {
  createWebsiteFetcher,
  decodedBody,
  FetchError,
  pinnedRequest,
  validateAddress,
  websiteIdentity,
} from '../src/projects/safe-fetch.ts';
import { resolveSite } from '../src/projects/site-resolution.ts';
import {
  identityEnvelope,
  validateIdentity,
  cleanSuggestions,
  researchBrand,
} from '../src/projects/research.ts';
import { discoveryCreate, discoverySettings } from '../src/projects/discovery-inputs.ts';
import {
  boundedEvidence,
  createResearchClient,
  ResearchBudget,
} from '../src/projects/research-evidence.ts';
import { seedBrandAliases } from '../src/projects/discovery.ts';
import { createModelGateway } from '../src/models/gateway.ts';
import type { ResearchEvidence, ResearchTransport } from '../src/projects/research-evidence.ts';

const options = { maxBytes: 1000, timeoutSeconds: 1, redirects: 3, contentTypes: ['text/html'] };
function recordedGateway(replies: unknown[]) {
  const transport = vi.fn(async () =>
    Response.json({
      model: 'returned-test-model',
      choices: [{ message: { content: JSON.stringify(replies.shift()) } }],
      usage: { total_tokens: 50 },
    }),
  );
  return {
    transport,
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
it('preserves recorded research metadata and enforces a shared call budget before I/O', async () => {
  const settings = discoverySettings({ KEENABLE_API_KEY: 'test-only' });
  const budget = new ResearchBudget(2);
  const replies = [
    {
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
    },
    {
      data: {
        source_id: 'recorded-page',
        url: 'https://acme.com/company',
        title: 'Company',
        markdown: 'Recorded full page',
        acquired_at: '2026-03-02T00:00:00Z',
      },
    },
  ];
  const transport = vi.fn(async () => Response.json(replies.shift()));
  const client = createResearchClient(settings, budget, transport, keenable);
  const items = await client.search('Acme company', 'acme.com', 10, 'recorded-query');
  expect(items).toHaveLength(1);
  const page = await client.page(items[0]!, false);
  expect(page).toMatchObject({
    source_url: 'https://acme.com/company',
    published_at: '2025-01-01T00:00:00Z',
    acquired_at: '2026-03-02T00:00:00Z',
    query_ref: 'recorded-query',
    source_id: 'recorded-page',
    parent_source_id: 'recorded-source',
    live: false,
  });
  expect(
    boundedEvidence([page, { ...items[0]!, source_url: page.source_url }], 1000),
  ).toMatchObject([{ source_kind: 'external_fetch', text: 'Recorded full page' }]);
  await expect(client.search('over budget', null, 10, 'more')).rejects.toThrow(
    'external_research_unavailable',
  );
  expect(transport).toHaveBeenCalledTimes(2);
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
  const ref = `fp-${page.source_id}`;
  const replies = [
    {
      status: 'ready',
      profile: { category: 'Analytics', description: 'Recorded business evidence' },
      signature: { category: 'Analytics' },
      field_evidence_refs: { description: [ref] },
    },
    { competitors: 'invalid' },
    { competitors: [{ name: 'Globex', domains: ['globex.com'], aliases: [] }] },
  ];
  const { gateway, transport } = recordedGateway(replies);
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
  expect(transport).toHaveBeenCalledTimes(3);
  expect(result.snapshot.evidence_manifest[0]?.text).toHaveLength(5);
  expect(result.profile.description).toBe('Recorded business evidence');
  expect(result.competitors).toEqual([{ name: 'Globex', domains: ['globex.com'], aliases: [] }]);
  expect(result.snapshot.model_calls.map((call) => [call.phase, call.outcome])).toEqual([
    ['identity', 'succeeded'],
    ['competitor_suggestions', 'failed'],
    ['competitor_suggestions', 'succeeded'],
  ]);
  expect(result.snapshot.field_evidence_refs).toEqual({ description: [ref] });
});
it.each(['ready', 'failed'] as const)(
  'reports competitor search %s while retaining successful model suggestions',
  async (searchState) => {
    const { gateway } = recordedGateway([
      { status: 'ready', profile: { category: 'Analytics' }, signature: { category: 'Analytics' } },
      { competitors: [{ name: 'Globex', domains: ['globex.com'] }] },
    ]);
    const transport: ResearchTransport = async (target, init) => {
      const url = new URL(String(target));
      if (url.pathname === '/v1/fetch')
        return Response.json({ markdown: 'Recorded company evidence' });
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
it('retains supported field citations but refuses a field citing only unknown evidence', () => {
  const evidence = [{ evidence_ref: 'fp-1' }] as ResearchEvidence[];
  const identity = identityEnvelope.parse({
    status: 'ready',
    profile: {},
    field_evidence_refs: { description: ['fp-1', 'unknown'] },
  });
  expect(validateIdentity(identity, evidence).field_evidence_refs).toEqual({
    description: ['fp-1'],
  });
  const bad = identityEnvelope.parse({
    status: 'ready',
    profile: {},
    field_evidence_refs: { description: ['unknown'] },
  });
  expect(() => validateIdentity(bad, evidence)).toThrow();
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
it('bounds model attempts and records failed research without fabricating identity', async () => {
  const structured = vi.fn(async () => {
    throw new Error('invalid output');
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
  const result = await researchBrand(
    discoveryCreate.parse({ brand_name: 'Acme', website_url: 'acme.com', primary_market: 'US' }),
    { url: 'https://acme.com/', domain: 'acme.com', page: null, warning: 'research_degraded' },
    { meter, gateway, env: {} },
  );
  expect(structured).toHaveBeenCalledTimes(1);
  expect(result.profile.description).toBe('');
  expect(result.competitors).toEqual([]);
  expect(result.snapshot.model_calls).toMatchObject([{ phase: 'identity', outcome: 'failed' }]);
});
