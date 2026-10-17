import { getDomain } from 'tldts';
import { z } from 'zod';
import { record } from '../db/json.ts';
import { scalarText } from '../text-order.ts';
import {
  ProviderError,
  type Citation,
  type RetrievedSource,
  type SearchEvent,
} from '../answer-engines/contracts.ts';
import type { ExecutionResult } from '../audits/result-persistence.ts';
import { providerPolicy } from '../providers/config.ts';
import { classifySourceOrigin } from '../analysis/opportunities/source-patterns.ts';
import { citationIdentity } from '../source-pages/identity.ts';
import { providerCharge, searchPolicy, type SearchEngine } from './dataforseo.ts';
import { onlyOf } from '../lists.ts';

const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const objects = (value: unknown) =>
  list(value)
    .filter((item) => item && typeof item === 'object' && !Array.isArray(item))
    .map(record);
const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '');
const integer = (value: unknown) =>
  typeof value === 'number' && Number.isInteger(value) ? value : null;
const domain = (value: string) => getDomain(value) ?? '';
const pending = (status: unknown) =>
  typeof status === 'number' && searchPolicy.constants.pending_task_status_codes.includes(status);
type SurfaceLink = { url: string; domain: string; title: string; element_index: number };
type SurfaceReference = {
  url: string;
  domain: string;
  title: string;
  source_origin: string;
};
export type OverviewResult = {
  outcome: string;
  provider_status_code: number | null;
  error_code: string;
  aio_present: boolean | null;
  aio_serp_position: number | null;
  answer_text: string;
  aio_markdown: string;
  elements: Record<string, unknown>[];
  links: SurfaceLink[];
  references: SurfaceReference[];
  provider_cost_microusd: number | null;
  observed_at: Date | null;
  raw_payload: Record<string, unknown>;
};
export function surfaceFailure(errorCode: string): OverviewResult {
  if (!searchPolicy.surface.execution_failure_codes.includes(errorCode))
    throw new Error('Invalid surface failure code');
  return emptyOverview(searchPolicy.surface.outcome_execution_failure, {}, null, errorCode);
}
function emptyOverview(
  outcome: string,
  raw: Record<string, unknown>,
  status: number | null = null,
  errorCode = '',
): OverviewResult {
  return {
    outcome,
    raw_payload: raw,
    provider_status_code: status,
    error_code: errorCode,
    aio_present: null,
    aio_serp_position: null,
    answer_text: '',
    aio_markdown: '',
    elements: [],
    links: [],
    references: [],
    provider_cost_microusd: null,
    observed_at: null,
  };
}
function observedAt(page: Record<string, unknown>, task: Record<string, unknown>) {
  for (const source of [page, task]) {
    const raw = text(source.datetime || source.time).replace(' +00:00', 'Z');
    if (!raw) continue;
    const value = new Date(raw);
    if (Number.isFinite(value.getTime())) return value;
  }
  return null;
}
function elements(block: Record<string, unknown>): [number, Record<string, unknown>][] {
  if (block.items != null && !Array.isArray(block.items))
    throw new Error('Invalid overview elements');
  const result: [number, Record<string, unknown>][] = [];
  function descend(value: unknown, index: number, depth: number) {
    const node = record(value);
    if (
      depth > 128 ||
      !['ai_overview_element', 'ai_overview_expanded_element'].includes(scalarText(node.type))
    )
      throw new Error('Unknown overview element');
    result.push([index, node]);
    for (const child of objects(node.items)) descend(child, index, depth + 1);
  }
  list(block.items).forEach((node, index) => descend(node, index, 0));
  return result;
}
function fragments(element: Record<string, unknown>) {
  const table = record(element.table);
  const values = [
    text(element.title),
    text(element.text),
    ...list(table.table_header).map(text),
    ...list(table.table_content).map((row) => list(row).map(text).filter(Boolean).join(' ')),
    ...list(element.items).map(text),
  ].filter(Boolean);
  return values.length ? values : [text(element.markdown)].filter(Boolean);
}
type OverviewTask = {
  task: Record<string, unknown>;
  status: number;
  page: Record<string, unknown>;
};
/** The one task answering `expectedId` with a usable page, or the result that ends parsing. */
function resolveOverviewTask(
  envelope: Record<string, unknown>,
  expectedId: string,
): OverviewTask | { early: OverviewResult | 'still_pending' } {
  const envelopeStatus = integer(envelope.status_code),
    c = searchPolicy.constants,
    s = searchPolicy.surface;
  if (envelopeStatus !== null && envelopeStatus !== c.status_ok)
    return { early: emptyOverview(s.outcome_provider_error, envelope, envelopeStatus) };
  const matched = objects(envelope.tasks).filter((t) => scalarText(t.id) === expectedId);
  const task = onlyOf(matched);
  if (!task)
    return {
      early: emptyOverview(s.outcome_parser_error, {
        parse_error: 'task identity is missing or ambiguous',
        payload: envelope,
      }),
    };
  const status = integer(task.status_code);
  if (pending(status)) return { early: 'still_pending' };
  if (status === null) return { early: emptyOverview(s.outcome_parser_error, task) };
  if (status !== c.status_ok)
    return { early: emptyOverview(s.outcome_provider_error, task, status) };
  const pages = list(task.result),
    page = record(pages[0]);
  if (
    !pages.length ||
    !Object.keys(page).length ||
    (page.items != null && !Array.isArray(page.items))
  )
    return { early: emptyOverview(s.outcome_parser_error, task) };
  return { task, status, page };
}
/** Visible text fragments and links of the walked elements, each kept once in first-seen order. */
function overviewContent(walked: [number, Record<string, unknown>][]) {
  const seenText = new Set<string>(),
    parts: string[] = [];
  const links = new Map<string, SurfaceLink>();
  for (const [index, element] of walked) {
    for (const fragment of fragments(element)) {
      // Casefold and whitespace only; punctuation distinguishes visible fragments.
      const key = fragment
        .split(/\s+/u)
        .filter(Boolean)
        .join(' ')
        .replaceAll(
          /./gsu,
          (char) =>
            searchPolicy.casefold_overrides[char as keyof typeof searchPolicy.casefold_overrides] ??
            char.toLowerCase(),
        );
      if (!key || seenText.has(key)) continue;
      seenText.add(key);
      parts.push(fragment.trim());
    }
    for (const link of objects(element.links)) {
      const url = scalarText(link.url).trim();
      if (url && !links.has(url))
        links.set(url, {
          url,
          domain: domain(scalarText(link.domain) || url),
          title: scalarText(link.title),
          element_index: index,
        });
    }
  }
  return { parts, links };
}
function overviewReferences(block: Record<string, unknown>) {
  const references = new Map<string, SurfaceReference>();
  for (const ref of objects(block.references)) {
    const url = scalarText(ref.url).trim(),
      host = domain(scalarText(ref.domain) || url);
    if (url && !references.has(url))
      references.set(url, {
        url,
        domain: host,
        title: scalarText(ref.title),
        source_origin: classifySourceOrigin(host),
      });
  }
  return references;
}
/** Envelope and exact task identity precede every presence decision; cards never enter visible text. */
export function parseOverview(
  payload: unknown,
  expectedId: string,
): OverviewResult | 'still_pending' {
  const envelope = record(payload),
    s = searchPolicy.surface;
  const resolved = resolveOverviewTask(envelope, expectedId);
  if ('early' in resolved) return resolved.early;
  const { task, status, page } = resolved;
  const block = objects(page.items).find((item) => item.type === 'ai_overview');
  const base = {
    ...emptyOverview(
      block ? s.outcome_ai_overview_present : s.outcome_no_ai_overview,
      task,
      status,
    ),
    aio_present: Boolean(block),
    observed_at: observedAt(page, task),
    provider_cost_microusd: providerCharge(task.cost),
  };
  if (!block) return base;
  try {
    const walked = elements(block),
      { parts, links } = overviewContent(walked);
    const references = overviewReferences(block);
    return {
      ...base,
      answer_text: parts.join('\n\n'),
      aio_markdown: scalarText(block.markdown),
      aio_serp_position: integer(block.rank_absolute),
      elements: walked.map(([, e]) => e),
      links: [...links.values()],
      references: [...references.values()],
    };
  } catch {
    return emptyOverview(
      s.outcome_parser_error,
      { parse_error: 'unsupported overview structure', payload: task },
      status,
    );
  }
}
const emptyUsage = {
  uncached_input_tokens: null,
  cached_input_tokens: null,
  output_tokens: null,
  reasoning_tokens: null,
  total_tokens: null,
  web_search_requests: null,
  provider_cost_microusd: null,
};
export function overviewAnswer(result: OverviewResult): ExecutionResult {
  const route = providerPolicy.routes.google_ai_overview;
  return {
    logical_engine: 'google_ai_overview',
    transport_provider: 'dataforseo',
    transport_model: route.transport_model,
    answer_text: result.answer_text,
    search_used: false,
    search_events: [],
    citations: result.references.map((ref, index) => ({
      ordinal: index,
      url: ref.url,
      title: ref.title,
      domain: ref.domain,
      start_index: null,
      end_index: null,
      cited_text: '',
    })),
    // An AI Overview shows its references only; what it read is not exposed.
    retrieved_sources: null,
    finish_reason: 'unknown',
    raw_finish_reason: '',
    latency_ms: 0,
    normalized_usage: { ...emptyUsage, provider_cost_microusd: result.provider_cost_microusd },
    provider_metadata: {
      raw_response: result.raw_payload,
      search_surface_outcome: result.outcome,
      provider_status_code: result.provider_status_code,
      aio_serp_position: result.aio_serp_position,
      aio_markdown: result.aio_markdown,
      query_text_available: false,
      fanout_availability: 'unavailable',
    },
  };
}
const AD_ITEM_TYPE = 'chat_gpt_ad';
const isAd = (node: Record<string, unknown>) => node.type === AD_ITEM_TYPE;
/** Organic sources only: a paid placement is never a citation, whatever it carries. */
function scraperSources(node: Record<string, unknown>, depth = 0): Record<string, unknown>[] {
  if (depth > 128) throw new ProviderError('parse_error');
  if (isAd(node)) return [];
  return [
    ...objects(node.sources),
    ...objects(node.items).flatMap((child) => scraperSources(child, depth + 1)),
  ];
}
/**
 * The scraper's search results are what the engine read. A page without the
 * field exposes no retrieval, which is unknown rather than an empty read.
 */
function scraperRetrieved(results: unknown): RetrievedSource[] | null {
  if (!Array.isArray(results)) return null;
  const sources: RetrievedSource[] = [],
    seen = new Set<string>();
  for (const result of objects(results)) {
    if (isAd(result)) continue;
    const url = citationIdentity(text(result.url)).canonical_url;
    if (!url || seen.has(url)) continue;
    seen.add(url);
    sources.push({ ordinal: sources.length, url, title: text(result.title), domain: domain(url) });
  }
  return sources;
}
function adNodes(node: Record<string, unknown>, depth = 0): Record<string, unknown>[] {
  if (depth > 128) throw new ProviderError('parse_error');
  return objects(node.items).flatMap((child) =>
    isAd(child) ? [child] : adNodes(child, depth + 1),
  );
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
  /** Registrable domain of the advertiser URL, else the ad's own domain or landing URL. */
  advertiser_domain: string;
  landing_url_raw: string;
  /** The landing URL without its query string or fragment. */
  landing_url_canonical: string;
  title: string;
  snippet: string;
  /** Stored as evidence only; the product never renders it. */
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
function adItem(node: Record<string, unknown>): AdItem | null {
  const parsed = adItemSchema.safeParse(node);
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
/**
 * The ads in a stored ChatGPT Search Task GET envelope, one per rank;
 * malformed or repeated-rank items are skipped and counted. Null when the
 * envelope has no single result page, so no ads observation can be claimed.
 */
export function parseAds(envelope: unknown): { ads: AdItem[]; skipped: number } | null {
  const task = onlyOf(objects(record(envelope).tasks));
  const page = task ? onlyOf(objects(task.result)) : undefined;
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
export function parseScraper(
  payload: unknown,
  expectedId: string,
  engine: Exclude<SearchEngine, 'google_ai_overview'>,
): ExecutionResult | 'still_pending' {
  const envelope = record(payload);
  if (envelope.status_code !== searchPolicy.constants.status_ok)
    throw new ProviderError('parse_error');
  const matched = objects(envelope.tasks).filter((t) => t.id === expectedId);
  const task = onlyOf(matched);
  if (!task) throw new ProviderError('parse_error');
  if (pending(task.status_code)) return 'still_pending';
  const pages = objects(task.result),
    page = pages[0];
  const answer = page
    ? text(page.markdown) ||
      objects(page.items)
        .filter((item) => !isAd(item))
        .map((item) => text(item.markdown) || text(item.text))
        .filter(Boolean)
        .join('\n\n')
    : '';
  if (task.status_code !== searchPolicy.constants.status_ok || pages.length !== 1 || !answer)
    throw new ProviderError('parse_error');
  const rawFanout = page!.fan_out_queries;
  const valid =
    Array.isArray(rawFanout) &&
    rawFanout.every((value) => typeof value === 'string' && value.trim());
  const events: SearchEvent[] = valid
    ? rawFanout.map((query, index) => ({
        sequence: index,
        query,
        call_id: '',
        call_sequence: 0,
        query_sequence: index,
      }))
    : [];
  let availability: 'unavailable' | 'queries_available' | 'no_exposed_queries' = 'unavailable';
  if (valid) availability = events.length ? 'queries_available' : 'no_exposed_queries';
  const citations: Citation[] = [],
    seen = new Set<string>();
  for (const source of scraperSources(page!)) {
    const url = citationIdentity(text(source.url)).canonical_url;
    if (!url || seen.has(url)) continue;
    seen.add(url);
    citations.push({
      ordinal: citations.length,
      url,
      title: text(source.title),
      domain: domain(url),
      start_index: null,
      end_index: null,
      cited_text: '',
    });
  }
  const route = providerPolicy.routes[engine];
  return {
    logical_engine: engine,
    transport_provider: 'dataforseo',
    transport_model: route.transport_model,
    answer_text: answer,
    search_used: Boolean(
      events.length || list(page!.search_results).length || list(page!.sources).length,
    ),
    search_events: events,
    citations,
    retrieved_sources: scraperRetrieved(page!.search_results),
    finish_reason: 'stop',
    raw_finish_reason: '',
    latency_ms: 0,
    normalized_usage: { ...emptyUsage, provider_cost_microusd: providerCharge(task.cost) },
    provider_metadata: {
      raw_response: envelope,
      provider_reported_model: page!.model ?? null,
      fanout_availability: availability,
      query_text_available: valid,
      search_results: objects(page!.search_results),
    },
  };
}
