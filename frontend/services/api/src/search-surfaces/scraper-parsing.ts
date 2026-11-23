import { z } from 'zod';
import { isRecord } from '../db/json.ts';
import type { Citation, RetrievedSource, SearchEvent } from '../answer-engines/contracts.ts';
import { ProviderError } from '../providers/errors.ts';
import type { ExecutionResult } from '../audits/result-persistence.ts';
import { providerPolicy } from '../providers/config.ts';
import { citationIdentity } from '../source-pages/identity.ts';
import { lenient, list, opaque, recordsOf, withRaw } from '../lenient-fields.ts';
import { searchPolicy, type ScraperEngine } from './dataforseo.ts';
import { domain, emptyUsage, envelopeSchema, kind, pending, text } from './payload.ts';
import { onlyOf } from '../lists.ts';

const sourceSchema = withRaw(z.object({ type: kind, url: lenient(text), title: lenient(text) }));
const nodeShape = {
  type: kind,
  markdown: lenient(text),
  text: lenient(text),
  sources: lenient((value) => ({
    count: list(value).length,
    entries: recordsOf(sourceSchema, value),
  })),
  items: lenient((value): unknown[] => list(value).filter(isRecord)),
};
const nodeSchema = withRaw(z.object(nodeShape));
type SerpNode = z.output<typeof nodeSchema>;
const pageSchema = withRaw(
  z.object({
    ...nodeShape,
    fan_out_queries: lenient((value) =>
      Array.isArray(value) &&
      value.every((query): query is string => typeof query === 'string' && query.trim() !== '')
        ? value
        : null,
    ),
    search_results: lenient((value) => ({
      exposed: Array.isArray(value),
      count: list(value).length,
      entries: recordsOf(sourceSchema, value),
    })),
    model: opaque,
  }),
);
const children = (node: SerpNode) => node.items.map((child) => nodeSchema.parse(child));
const AD_ITEM_TYPE = 'chat_gpt_ad';
const isAd = (node: { type: string }) => node.type === AD_ITEM_TYPE;
function scraperSources(node: SerpNode, depth = 0): SerpNode['sources']['entries'] {
  if (depth > 128) throw new ProviderError('parse_error');
  if (isAd(node)) return [];
  return [
    ...node.sources.entries,
    ...children(node).flatMap((child) => scraperSources(child, depth + 1)),
  ];
}
type SearchResults = z.output<typeof pageSchema>['search_results'];
function scraperRetrieved(results: SearchResults): RetrievedSource[] | null {
  if (!results.exposed) return null;
  const sources: RetrievedSource[] = [],
    seen = new Set<string>();
  for (const result of results.entries) {
    if (isAd(result)) continue;
    const url = citationIdentity(result.url).canonical_url;
    if (!url || seen.has(url)) continue;
    seen.add(url);
    sources.push({ ordinal: sources.length, url, title: result.title, domain: domain(url) });
  }
  return sources;
}
function adNodes(node: SerpNode, depth = 0): SerpNode[] {
  if (depth > 128) throw new ProviderError('parse_error');
  return children(node).flatMap((child) => (isAd(child) ? [child] : adNodes(child, depth + 1)));
}
const optionalText = z
  .string()
  .nullish()
  .transform((value) => value?.trim() ?? '');
const adItemSchema = z.object({
  rank_absolute: z.number().int().nonnegative(),
  rank_group: z.number().int().nullish(),
  title: optionalText,
  snippet: optionalText,
  url: z.string().trim().min(1),
  domain: optionalText,
  image_url: optionalText,
  advertiser: z
    .object({ name: optionalText, url: optionalText })
    .nullish()
    .transform((value) => value ?? { name: '', url: '' }),
});
export type AdItem = {
  rank_absolute: number;
  rank_group: number | null;
  advertiser_name: string;
  advertiser_domain: string;
  landing_url_raw: string;
  landing_url_canonical: string;
  title: string;
  snippet: string;
  image_url: string | null;
};
function webUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url : null;
  } catch {
    return null;
  }
}
function adItem(node: SerpNode): AdItem | null {
  const parsed = adItemSchema.safeParse(node.raw);
  if (!parsed.success) return null;
  const item = parsed.data,
    landing = webUrl(item.url);
  if (!landing) return null;
  const advertiserDomain =
    [item.advertiser.url, item.domain, landing.hostname].map(domain).find(Boolean) ?? '';
  if (!advertiserDomain) return null;
  return {
    rank_absolute: item.rank_absolute,
    rank_group: item.rank_group ?? null,
    advertiser_name: item.advertiser.name || advertiserDomain,
    advertiser_domain: advertiserDomain,
    landing_url_raw: item.url,
    landing_url_canonical: `${landing.protocol}//${landing.host}${landing.pathname}`,
    title: item.title,
    snippet: item.snippet,
    image_url: item.image_url || null,
  };
}
function onlyPage(payload: unknown) {
  const task = onlyOf(envelopeSchema.parse(payload).tasks);
  return task ? onlyOf(recordsOf(nodeSchema, task.result)) : undefined;
}
export function parseAds(envelope: unknown): { ads: AdItem[]; skipped: number } | null {
  const page = onlyPage(envelope);
  if (!page) return null;
  const ads: AdItem[] = [],
    ranks = new Set<number>();
  let skipped = 0;
  for (const node of adNodes(page)) {
    const item = adItem(node);
    if (!item || ranks.has(item.rank_absolute)) {
      skipped += 1;
      continue;
    }
    ranks.add(item.rank_absolute);
    ads.push(item);
  }
  return { ads, skipped };
}
const PRODUCTS_ITEM_TYPE = 'chat_gpt_products';
const PRODUCT_CARD_TYPE = 'chat_gpt_products_element';
const lenientText = lenient(text);
const productCardSchema = z.object({
  type: z.literal(PRODUCT_CARD_TYPE),
  title: z.string().trim().min(1),
  tag: lenientText,
  price: lenient((value) =>
    typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null,
  ),
  currency: lenientText,
  merchants: lenientText,
  url: lenientText,
  domain: lenientText,
  product_id: lenientText,
  images: lenient((value) => list(value).filter((image) => typeof image === 'string')),
});
export type ShoppingResult = {
  position: number;
  title: string;
  tag: string | null;
  price: number | null;
  currency: string;
  merchant_name: string | null;
  url: string;
  domain: string;
  external_product_id: string | null;
  image_url: string | null;
};
function shoppingResult(node: SerpNode, position: number): ShoppingResult | null {
  const parsed = productCardSchema.safeParse(node.raw);
  if (!parsed.success) return null;
  const card = parsed.data,
    link = webUrl(card.url),
    currency = card.currency.toUpperCase();
  const image = card.images.find((value) => webUrl(value) !== null);
  return {
    position,
    title: card.title,
    tag: card.tag || null,
    price: card.price,
    currency: /^[A-Z]{3}$/u.test(currency) ? currency : '',
    merchant_name: card.merchants || null,
    url: link ? card.url : '',
    domain: (link?.hostname ?? card.domain).toLowerCase(),
    external_product_id: card.product_id || null,
    image_url: image ?? null,
  };
}
function productBlocks(node: SerpNode, depth = 0): SerpNode[] {
  if (depth > 128) return [];
  return children(node).flatMap((child) => {
    if (isAd(child)) return [];
    return child.type === PRODUCTS_ITEM_TYPE ? [child] : productBlocks(child, depth + 1);
  });
}
export function parseShoppingResults(envelope: unknown): ShoppingResult[] {
  const page = onlyPage(envelope);
  if (!page) return [];
  return productBlocks(page).flatMap((block) => {
    const organic = children(block).filter((node) => !isAd(node));
    return organic.flatMap((node, index) => {
      const card = shoppingResult(node, index + 1);
      return card ? [card] : [];
    });
  });
}
function fanout(queries: string[] | null) {
  const events: SearchEvent[] = (queries ?? []).map((query, index) => ({
    sequence: index,
    query,
    call_id: '',
    call_sequence: 0,
    query_sequence: index,
  }));
  let availability: 'unavailable' | 'queries_available' | 'no_exposed_queries' = 'unavailable';
  if (queries) availability = events.length ? 'queries_available' : 'no_exposed_queries';
  return { events, availability };
}
function scraperCitations(page: SerpNode) {
  const citations: Citation[] = [],
    seen = new Set<string>();
  for (const source of scraperSources(page)) {
    const url = citationIdentity(source.url).canonical_url;
    if (!url || seen.has(url)) continue;
    seen.add(url);
    citations.push({
      ordinal: citations.length,
      url,
      title: source.title,
      domain: domain(url),
      start_index: null,
      end_index: null,
      cited_text: '',
    });
  }
  return citations;
}
const scraperAnswer = (page: SerpNode) =>
  page.markdown ||
  children(page)
    .filter((item) => !isAd(item))
    .map((item) => item.markdown || item.text)
    .filter(Boolean)
    .join('\n\n');
export function parseScraper(
  payload: unknown,
  expectedId: string,
  engine: ScraperEngine,
): ExecutionResult | 'still_pending' {
  const envelope = envelopeSchema.parse(payload),
    ok = searchPolicy.constants.status_ok;
  if (envelope.status_code !== ok) throw new ProviderError('parse_error');
  const task = onlyOf(envelope.tasks.filter((t) => t.id === expectedId));
  if (!task) throw new ProviderError('parse_error');
  if (pending(task.status_code)) return 'still_pending';
  const pages = recordsOf(pageSchema, task.result),
    page = pages[0],
    answer = page ? scraperAnswer(page) : '';
  if (!page || task.status_code !== ok || pages.length !== 1 || !answer)
    throw new ProviderError('parse_error');
  const { events, availability } = fanout(page.fan_out_queries);
  const route = providerPolicy.routes[engine];
  return {
    logical_engine: engine,
    transport_provider: 'dataforseo',
    transport_model: route.transport_model,
    answer_text: answer,
    search_used: Boolean(events.length || page.search_results.count || page.sources.count),
    search_events: events,
    citations: scraperCitations(page),
    retrieved_sources: scraperRetrieved(page.search_results),
    finish_reason: 'stop',
    raw_finish_reason: '',
    latency_ms: 0,
    normalized_usage: { ...emptyUsage, provider_cost_microusd: task.cost },
    provider_metadata: {
      raw_response: envelope.raw,
      provider_reported_model: page.model ?? null,
      fanout_availability: availability,
      query_text_available: page.fan_out_queries !== null,
      search_results: page.search_results.entries.map((result) => result.raw),
    },
  };
}
