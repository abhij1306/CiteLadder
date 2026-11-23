import { createHash } from 'node:crypto';

import { z } from 'zod';

import { policy } from '../config.ts';
import { extractPage, offeringLinks, type PageEvidence } from './html-evidence.ts';
import { publicUrl, type WebsiteFetcher } from '../safe-fetch.ts';
import { discoverySettings } from './discovery-inputs.ts';
import type { ResolvedSite } from './site-resolution.ts';
import type { Meter } from '../models/metering.ts';
import type { MeteredFeature } from '../models/pricing.ts';
import { assertMetered } from '../models/meter-scope.ts';
import { getLogger } from '../logging.ts';

const logger = getLogger('app.projects.research');
export type ResearchPage = { url: string; title: string; text: string };
type SearchResult = ResearchPage & {
  source_id: string;
  processing_version: string;
  provider: string;
  published_at: string;
  acquired_at: string;
};
type ResearchSettings = ReturnType<typeof discoverySettings>;
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
export function boundedPages(items: readonly ResearchPage[], maxChars: number): ResearchPage[] {
  const seen = new Set<string>();
  const unique = items.filter((item) => {
    const url = publicUrl(item.url).href;
    if (seen.has(url)) return false;
    seen.add(url);
    return true;
  });
  let remaining = maxChars;
  return unique.flatMap((item, index) => {
    if (remaining <= 0) return [];
    const text = item.text.slice(0, Math.max(1, Math.floor(remaining / (unique.length - index))));
    remaining -= text.length;
    return [{ url: item.url, title: item.title, text }];
  });
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
    url: page.url,
    title: page.title,
    text: [page.title, page.description, page.text].filter(Boolean).join('\n'),
  }));
  return {
    pages,
    items: boundedPages(items, cfg.max_total_chars),
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
  async function request(path: string, body: Record<string, unknown>) {
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
  return {
    async search(query: string, site: string | null, maximum: number): Promise<SearchResult[]> {
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
        try {
          publicUrl(item.url);
        } catch {
          return [];
        }
        return [
          {
            url: item.url,
            title: item.title,
            text: (item.snippet || item.description).slice(0, settings.keenable_snippet_max_chars),
            source_id:
              item.source_id ??
              String(item.id ?? createHash('sha256').update(JSON.stringify(raw)).digest('hex')),
            processing_version: policy.discovery.constants.keenable_research_version,
            provider: 'keenable',
            published_at: item.published_at,
            acquired_at: item.acquired_at,
          },
        ];
      });
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
      .map(([query, site]) => client.search(query, site, settings.identity_search_max_results)),
  );
  const failures = outcomes.flatMap((outcome) =>
    outcome.status === 'rejected' ? [outcome.reason] : [],
  );
  if (failures.length)
    logger.warning('brand_discovery.identity_search_failed', {
      failed: failures.length,
      attempted: outcomes.length,
      error_classes: [
        ...new Set(failures.map((error) => (error instanceof Error ? error.name : typeof error))),
      ],
    });
  const results = outcomes.flatMap((outcome) =>
    outcome.status === 'fulfilled' ? outcome.value : [],
  );
  if (!results.length)
    return { state: failures.length === outcomes.length ? 'failed' : 'no_results', items: [] };
  return {
    state: 'ready',
    items: boundedPages(results, settings.identity_external_evidence_max_chars),
  };
}
