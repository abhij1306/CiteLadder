import { createHash } from 'node:crypto';

import { z } from 'zod';

import { policy } from '../config.ts';
import { extractPage, offeringLinks, type PageEvidence } from './html-evidence.ts';
import { publicUrl, type WebsiteFetcher } from './safe-fetch.ts';
import { discoverySettings } from './discovery-inputs.ts';
import type { ResolvedSite } from './site-resolution.ts';
import type { Meter } from '../models/metering.ts';
import type { MeteredFeature } from '../models/pricing.ts';
import { assertMetered } from '../models/meter-scope.ts';

export type ResearchEvidence = {
  source_id: string;
  processing_version: string;
  parent_source_id: string | null;
  evidence_ref: string;
  source_url: string;
  title: string;
  text: string;
  source_kind: 'first_party' | 'external_search' | 'external_fetch';
  provider: string;
  query_ref: string;
  published_at: string;
  acquired_at: string;
  live: boolean | null;
  supports: string[];
};
export type ResearchSettings = ReturnType<typeof discoverySettings>;
export type ResearchTransport = typeof fetch;
export class ResearchBudget {
  used = 0;
  readonly cap: number;
  constructor(cap: number) {
    this.cap = cap;
  }
  take(count: number) {
    const admitted = Math.min(count, this.cap - this.used);
    this.used += admitted;
    return admitted;
  }
}
export function boundedEvidence(items: readonly ResearchEvidence[], maxChars: number) {
  const seen = new Set<string>();
  const unique = items.filter((item) => {
    const url = publicUrl(item.source_url).href;
    if (seen.has(url)) return false;
    seen.add(url);
    return true;
  });
  let remaining = maxChars;
  return unique.flatMap((item, index) => {
    if (remaining <= 0) return [];
    const text = item.text.slice(0, Math.max(1, Math.floor(remaining / (unique.length - index))));
    remaining -= text.length;
    return [{ ...item, text }];
  });
}
function evidence(
  ref: string,
  url: string,
  title: string,
  text: string,
  kind: ResearchEvidence['source_kind'],
): ResearchEvidence {
  return {
    source_id: ref,
    processing_version:
      kind === 'first_party'
        ? policy.brand_evidence.version
        : policy.discovery.constants.keenable_research_version,
    parent_source_id: null,
    evidence_ref: ref,
    source_url: url,
    title,
    text,
    source_kind: kind,
    provider: kind === 'first_party' ? '' : 'keenable',
    query_ref: '',
    published_at: '',
    acquired_at: new Date().toISOString(),
    live: kind === 'external_fetch' ? false : null,
    supports: ['profile'],
  };
}

export async function collectFirstParty(site: ResolvedSite, fetcher: WebsiteFetcher) {
  const pages: PageEvidence[] = site.page ? [site.page] : [];
  if (!site.page) return { pages, items: [], offerings: [] };
  const cfg = policy.brand_evidence;
  const signal = AbortSignal.timeout(cfg.total_timeout_seconds * 1000);
  const selected = offeringLinks(pages).map((link) => link.url);
  const fallback = cfg.fallback_paths.map((path) => new URL(path, site.url).href);
  const urls = [...new Set([...selected, ...fallback])]
    .filter((url) => url !== site.url)
    .slice(0, cfg.max_pages - 1);
  const outcomes = await Promise.allSettled(
    urls.map(async (url) => {
      const result = await fetcher(url, {
        domain: site.domain,
        maxBytes: cfg.max_html_bytes,
        timeoutSeconds: cfg.request_timeout_seconds,
        redirects: cfg.max_redirects,
        contentTypes: cfg.content_types,
        signal,
      });
      return result.status >= 200 && result.status < 300 && result.url.startsWith('https:')
        ? extractPage(result.body, result.url)
        : null;
    }),
  );
  for (const outcome of outcomes)
    if (outcome.status === 'fulfilled' && outcome.value) pages.push(outcome.value);
  const items = pages.map((page) => ({
    ...evidence(
      `fp-${page.source_id}`,
      page.url,
      page.title,
      [page.title, page.description, page.text].filter(Boolean).join('\n'),
      'first_party',
    ),
    source_id: page.source_id,
    processing_version: page.processing_version,
  }));
  return {
    pages,
    items: boundedEvidence(items, cfg.max_total_chars),
    offerings: offeringLinks(pages),
  };
}
const searchResult = z.object({
  source_id: z.string().optional(),
  id: z.union([z.string(), z.number()]).optional(),
  title: z.string().default(''),
  url: z.string(),
  snippet: z.string().default(''),
  description: z.string().default(''),
  published_at: z.string().default(''),
  acquired_at: z.string().default(''),
});

export function createResearchClient(
  settings: ResearchSettings,
  budget: ResearchBudget,
  transport: ResearchTransport,
  meter: { meter: Meter; feature: MeteredFeature },
) {
  const base = new URL(settings.keenable_base_url);
  if (
    base.protocol !== 'https:' ||
    base.hostname !== 'api.keenable.ai' ||
    (base.port && base.port !== '443') ||
    base.username ||
    base.password ||
    base.search ||
    base.hash
  )
    throw new Error('Keenable base URL must use canonical HTTPS');
  async function request(path: string, body?: Record<string, unknown>) {
    if (!settings.keenable_api_key || !budget.take(1))
      throw new Error('external_research_unavailable');
    const response = await meter.meter.call(
      meter.feature,
      { provider: 'keenable', model: 'keenable' },
      async () => {
        assertMetered('keenable');
        return { value: await send(path, body), usage: null };
      },
    );
    if (!response.ok) throw new Error('external_research_failed');
    return z.record(z.string(), z.unknown()).parse(await response.json());
  }
  function send(path: string, body?: Record<string, unknown>) {
    return transport(new URL(path, base), {
      method: body ? 'POST' : 'GET',
      headers: {
        'X-API-Key': settings.keenable_api_key,
        accept: 'application/json',
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      redirect: 'error',
      signal: AbortSignal.timeout(settings.keenable_request_timeout_seconds * 1000),
    });
  }
  return {
    async search(
      query: string,
      site: string | null,
      maximum: number,
      prefix: string,
    ): Promise<ResearchEvidence[]> {
      const body = await request('/v1/search', {
        query,
        ...(site ? { site } : {}),
        max_results: maximum,
        snippet_max_length: settings.keenable_snippet_max_chars,
      });
      const results = z
        .array(z.unknown())
        .parse(body.results ?? body.data)
        .slice(0, maximum);
      return results.flatMap((raw) => {
        const parsed = searchResult.safeParse(raw);
        if (!parsed.success) return [];
        const item = parsed.data;
        const sourceId =
          item.source_id ??
          String(item.id ?? createHash('sha256').update(JSON.stringify(raw)).digest('hex'));
        try {
          publicUrl(item.url);
        } catch {
          return [];
        }
        return [
          {
            ...evidence(
              `keenable-${sourceId}`,
              item.url,
              item.title,
              (item.snippet || item.description).slice(0, settings.keenable_snippet_max_chars),
              'external_search',
            ),
            published_at: item.published_at,
            acquired_at: item.acquired_at,
            source_id: sourceId,
            query_ref: prefix,
          },
        ];
      });
    },
    async page(item: ResearchEvidence, live: boolean) {
      const params = new URLSearchParams({
        url: item.source_url,
        live: String(live),
        max: String(settings.keenable_fetch_max_chars),
      });
      const raw = await request(`/v1/fetch?${params}`);
      const body = z.record(z.string(), z.unknown()).parse(raw.data ?? raw);
      const text = z.string().parse(body.markdown ?? body.content ?? body.text ?? '');
      const sourceUrl = z.string().parse(body.url ?? item.source_url);
      publicUrl(sourceUrl);
      const sourceId = z
        .union([z.string(), z.number()])
        .transform(String)
        .parse(
          body.source_id ??
            body.id ??
            createHash('sha256').update(JSON.stringify(body)).digest('hex'),
        );
      return {
        ...item,
        source_url: sourceUrl,
        title: z.string().parse(body.title ?? item.title),
        published_at: z.string().parse(body.published_at ?? item.published_at),
        acquired_at: z.string().parse(body.acquired_at ?? item.acquired_at),
        source_id: sourceId,
        parent_source_id: item.source_id,
        evidence_ref: `keenable-fetch-${sourceId}`,
        text: text.slice(0, settings.keenable_fetch_max_chars),
        source_kind: 'external_fetch' as const,
        live,
      };
    },
  };
}
export type ResearchClient = ReturnType<typeof createResearchClient>;
export async function collectIdentityResearch(
  client: ResearchClient,
  settings: ResearchSettings,
  brand: string,
  domain: string,
) {
  const queries: [string, string | null][] = [
    ['About company products services customers and how the offering is delivered', domain],
    [
      `Independent description of ${brand} ${domain}: what it sells, customers, business model and market`,
      null,
    ],
    [`${brand} ${domain} category positioning use cases alternatives`, null],
  ];
  const outcomes = await Promise.allSettled(
    queries
      .slice(0, settings.identity_search_count)
      .map(([query, site], index) =>
        client.search(query, site, settings.identity_search_max_results, `ki-search-${index + 1}`),
      ),
  );
  const searches = outcomes.flatMap((outcome) =>
    outcome.status === 'fulfilled' ? outcome.value : [],
  );
  if (!searches.length)
    return {
      state: outcomes.every((outcome) => outcome.status === 'rejected') ? 'failed' : 'no_results',
      items: [],
    };
  const pages: ResearchEvidence[] = [];
  const selected = searches.slice(0, settings.identity_fetch_max_pages);
  // Await each batch so provider requests never exceed the configured concurrency.
  for (let offset = 0; offset < selected.length; offset += settings.keenable_concurrency) {
    const fetched = await Promise.allSettled(
      selected
        .slice(offset, offset + settings.keenable_concurrency)
        .map((item) =>
          client.page(item, new URL(item.source_url).hostname.replace(/^www\./u, '') === domain),
        ),
    );
    for (const result of fetched) if (result.status === 'fulfilled') pages.push(result.value);
  }
  return {
    state: 'ready',
    items: boundedEvidence([...pages, ...searches], settings.identity_external_evidence_max_chars),
  };
}
