import { createHash } from 'node:crypto';
import { record } from '../db/json.ts';
import { canonicalJson } from './requests.ts';
import { scalarText as text } from '../text-order.ts';

const numeric = (value: unknown): string | null =>
  (typeof value === 'number' || typeof value === 'string') &&
  text(value).trim() &&
  Number.isFinite(Number(value))
    ? text(value)
    : null;
const integer = (value: unknown) =>
  numeric(value) !== null && Number.isSafeInteger(Number(value)) ? Number(value) : null;
/** The typed integer columns are 32-bit; a larger provider count lives in the summary instead. */
export const INT4_MAX = 2_147_483_647;
const INTENT_LENGTH = 32;
/** Whole intents only, as many as the intent column holds. */
function intentLabel(values: string[]) {
  let label = '';
  for (const value of values) {
    const next = label ? `${label}, ${value}` : value;
    if (next.length > INTENT_LENGTH) break;
    label = next;
  }
  return label;
}
const organic = (value: unknown) => {
  const item = record(value),
    result = record('serp_item' in item ? item.serp_item : item);
  return !result.type || result.type === 'organic' ? result : {};
};
function scopedUrl(url: string, origin: string, domain: string) {
  try {
    const actual = new URL(url),
      expected = new URL(origin);
    return (
      ['http:', 'https:'].includes(actual.protocol) &&
      (domain
        ? actual.hostname === domain || actual.hostname.endsWith(`.${domain}`)
        : actual.hostname === expected.hostname && actual.port === expected.port)
    );
  } catch {
    return false;
  }
}
const assertUrl = (url: string, origin: string, domain: string) => {
  if (!scopedUrl(url, origin, domain))
    throw new Error('Provider row escaped reviewed website scope');
};
const backlinkFields = [
  'referring_domains',
  'referring_pages',
  'broken_backlinks',
  'broken_pages',
  'backlinks_spam_score',
  'rank',
  'domain_from_rank',
  'page_from_rank',
  'page_to_rank',
  'links_count',
  'new_backlinks',
  'lost_backlinks',
  'new_referring_domains',
  'lost_referring_domains',
];
function backlinkDetails(item: Record<string, unknown>) {
  return {
    ...Object.fromEntries(backlinkFields.map((key) => [key, integer(item[key])])),
    target_spam_score: integer(record(item.info).target_spam_score),
    first_seen: item.first_seen ?? null,
  };
}
function keyword(item: Record<string, unknown>, suggestion = false) {
  const data = suggestion ? item : record(item.keyword_data),
    info = record(data.keyword_info),
    properties = record(data.keyword_properties),
    intents = record(data.search_intent_info);
  const intent = intents.main_intent || intents.foreign_intent || '';
  return {
    keyword: text(data.keyword),
    search_volume: integer(info.search_volume),
    difficulty: integer(properties.keyword_difficulty),
    intent: intentLabel(Array.isArray(intent) ? intent.map(text) : [text(intent)]),
    auxiliary: {
      cpc: numeric(info.cpc),
      cpc_currency: 'USD',
      provider_updated_at: info.last_updated_time ?? null,
      serp_updated_at: record(data.serp_info).last_updated_time ?? null,
    },
  };
}
export type NormalizedRow = {
  keyword: string;
  domain: string;
  url: string;
  intent: string;
  search_volume: number | null;
  difficulty: number | null;
  rank_group: number | null;
  owned_rank_group: number | null;
  etv: string | null;
  backlinks: number | null;
  referring_main_domains: number | null;
  dataforseo_rank: number | null;
  auxiliary: Record<string, unknown>;
  provider_row_key: string;
};
type RowContext = {
  item: Record<string, unknown>;
  plan: Record<string, unknown>;
  target: Record<string, unknown>;
  comparison: Record<string, unknown>;
  origin: string;
  domain: string;
};
type RowValues = Partial<NormalizedRow>;
const BACKLINK_FIELDS = [
  'url_from',
  'anchor',
  'item_type',
  'attributes',
  'dofollow',
  'last_seen',
  'prev_seen',
  'last_visited',
  'lost_date',
  'is_new',
  'is_lost',
  'is_broken',
];
function assertExternalSource(source: string, root: string, message: string) {
  if (source === root || source.endsWith(`.${root}`)) throw new Error(message);
}
function rankingKeywordValues({ item, origin, domain }: RowContext): RowValues {
  const result = organic(item.ranked_serp_element),
    data = keyword(item),
    url = text(result.url);
  if (url) assertUrl(url, origin, domain);
  return {
    ...data,
    url,
    rank_group: integer(result.rank_group),
    etv: numeric(result.etv),
    auxiliary: { ...data.auxiliary, rank_absolute: integer(result.rank_absolute) },
  };
}
function keywordGapValues({ item, comparison, origin, domain }: RowContext): RowValues {
  const intersections = record(item.intersection_result),
    competitor = organic(domain ? item.first_domain_serp_element : intersections['1']),
    owned = organic(domain ? item.second_domain_serp_element : intersections['2']);
  const url = text(competitor.url),
    ownedUrl = text(owned.url),
    data = keyword(item);
  if (url)
    assertUrl(url, text(comparison.origin), domain ? text(comparison.registrable_domain) : '');
  if (ownedUrl) assertUrl(ownedUrl, origin, domain);
  return {
    ...data,
    url,
    rank_group: integer(competitor.rank_group),
    owned_rank_group: integer(owned.rank_group),
    etv: numeric(competitor.etv),
    auxiliary: {
      ...data.auxiliary,
      rank_absolute: integer(competitor.rank_absolute),
      owned_url: ownedUrl,
      owned_etv: numeric(owned.etv),
    },
  };
}
function keywordSuggestionValues({ item }: RowContext): RowValues {
  const data = keyword(item, true);
  return { ...data, auxiliary: { ...data.auxiliary, position_status: 'not_checked' } };
}
function referringDomainValues({ item, target }: RowContext): RowValues {
  const source = text(item.domain).toLowerCase();
  assertExternalSource(
    source,
    text(target.registrable_domain),
    'Internal referring domain escaped filter',
  );
  return {
    domain: source,
    backlinks: integer(item.backlinks),
    dataforseo_rank: integer(item.rank),
    auxiliary: {
      ...backlinkDetails(item),
      rank_scale: 'one_hundred',
      object_type: 'referring_domain',
    },
  };
}
function destinationPageValues({ item, origin, domain }: RowContext): RowValues {
  const url = text(item.url);
  assertUrl(url, origin, domain);
  return {
    url,
    backlinks: integer(item.backlinks),
    referring_main_domains: integer(item.referring_main_domains),
    dataforseo_rank: integer(item.rank),
    auxiliary: {
      ...backlinkDetails(item),
      rank_scale: 'one_hundred',
      object_type: 'destination_page',
    },
  };
}
function organicPageValues({ item, origin, domain }: RowContext): RowValues {
  const url = text(item.page_address);
  assertUrl(url, origin, domain);
  const result = record(record(item.metrics).organic);
  return {
    url,
    etv: numeric(result.etv),
    auxiliary: {
      organic_keywords: integer(result.count),
      provider_updated_at: item.last_updated_time ?? null,
    },
  };
}
function backlinkValues({ item, target, origin, domain }: RowContext): RowValues {
  const url = text(item.url_to);
  assertUrl(url, origin, domain);
  const source = text(item.domain_from).toLowerCase();
  assertExternalSource(source, text(target.registrable_domain), 'Internal backlink escaped filter');
  return {
    url,
    domain: source,
    dataforseo_rank: integer(item.rank),
    auxiliary: {
      ...backlinkDetails(item),
      rank_scale: 'one_hundred',
      object_type: 'backlink',
      ...Object.fromEntries(BACKLINK_FIELDS.map((key) => [key, item[key] ?? null])),
    },
  };
}
function backlinkHistoryValues({ item, plan }: RowContext): RowValues {
  const date = text(item.date),
    request = record(plan.request),
    day = date.slice(0, 10);
  if (
    !/^\d{4}-\d{2}-\d{2}$/u.test(day) ||
    !Number.isFinite(Date.parse(day)) ||
    new Date(day).toISOString().slice(0, 10) !== day ||
    day < text(request.date_from) ||
    day > text(request.date_to)
  )
    throw new Error('History observation escaped reviewed dates');
  return {
    backlinks: integer(item.backlinks),
    referring_main_domains: integer(item.referring_main_domains),
    auxiliary: { ...backlinkDetails(item), date },
  };
}
const ROW_VALUES: Record<string, (context: RowContext) => RowValues> = {
  ranking_keywords: rankingKeywordValues,
  missing_keywords: keywordGapValues,
  shared_keywords: keywordGapValues,
  keyword_suggestions: keywordSuggestionValues,
  referring_domains: referringDomainValues,
  destination_pages: destinationPageValues,
  organic_pages: organicPageValues,
  backlinks: backlinkValues,
  backlink_history: backlinkHistoryValues,
};
function normalizeRow(
  kind: string,
  item: Record<string, unknown>,
  plan: Record<string, unknown>,
): NormalizedRow {
  const target = record(plan.target),
    comparison = record(plan.comparison),
    origin = text(target.origin),
    domain = plan.research_scope === 'domain_subdomains' ? text(target.registrable_domain) : '';
  const rowValues = Object.hasOwn(ROW_VALUES, kind) ? ROW_VALUES[kind] : undefined;
  if (!rowValues) throw new Error('Unsupported dataset kind');
  const values = rowValues({ item, plan, target, comparison, origin, domain });
  const row: NormalizedRow = {
    keyword: '',
    domain: '',
    url: '',
    intent: '',
    search_volume: null,
    difficulty: null,
    rank_group: null,
    owned_rank_group: null,
    etv: null,
    backlinks: null,
    referring_main_domains: null,
    dataforseo_rank: null,
    auxiliary: {},
    provider_row_key: '',
    ...values,
  };
  // Missing row fields use null in the historical key, rather than the DB defaults.
  row.provider_row_key = createHash('sha256')
    .update(
      canonicalJson([
        kind,
        values.keyword ?? null,
        values.domain ?? null,
        values.url ?? null,
        row.auxiliary.url_from ?? null,
        row.auxiliary.date ?? null,
        row.auxiliary.anchor ?? null,
        row.auxiliary.item_type ?? null,
      ]),
    )
    .digest('hex');
  return row;
}
function footprintSummary(
  items: unknown[],
  plan: Record<string, unknown>,
  target: Record<string, unknown>,
): Record<string, unknown> {
  const matches = items
    .map(record)
    .filter(
      (item) =>
        plan.research_scope === 'domain_subdomains' ||
        text(item.subdomain).toLowerCase() === target.hostname,
    );
  if (matches.length > 1) throw new Error('Provider returned duplicate footprint rows');
  if (!matches.length) return {};
  const metrics = record(record(matches[0]?.metrics).organic),
    count = integer(metrics.count),
    buckets = [metrics.pos_1, metrics.pos_2_3, metrics.pos_4_10].map(integer),
    top10 = buckets.every((v) => v !== null)
      ? buckets.reduce<number>((sum, v) => sum + (v ?? 0), 0)
      : null;
  return {
    organic_keywords: count,
    estimated_monthly_traffic: numeric(metrics.etv),
    top_10_keywords: top10,
    top_10_percentage:
      top10 !== null && count !== null && count > 0 ? String((top10 * 100) / count) : null,
    ranking_buckets: Object.fromEntries(
      Object.entries(metrics)
        .filter(([key]) => key.startsWith('pos_'))
        .map(([key, value]) => [key, integer(value)]),
    ),
  };
}
function backlinkSummary(result: Record<string, unknown>): Record<string, unknown> {
  return {
    ...backlinkDetails(result),
    backlinks: integer(result.backlinks),
    referring_main_domains: integer(result.referring_main_domains),
    rank: integer(result.rank),
    rank_scale: 'one_hundred',
    object_type: 'analyzed_domain',
  };
}
/** Normalize only one verified provider task, retaining unavailable and empty separately. */
export function normalizeResponse(
  kind: string,
  body: Record<string, unknown>,
  plan: Record<string, unknown>,
) {
  const task = record(Array.isArray(body.tasks) ? body.tasks[0] : null),
    result = record(Array.isArray(task.result) ? task.result[0] : null),
    request = record(plan.request),
    target = record(plan.target);
  for (const key of ['target', 'target1', 'target2'])
    if (request[key] != null && result[key] != null && request[key] !== result[key])
      throw new Error('Provider aggregate escaped reviewed target scope');
  const items = Array.isArray(result.items) ? result.items : [],
    total = integer(result.total_count);
  let summary: Record<string, unknown> = {},
    rows: NormalizedRow[] = [];
  if (kind === 'footprint') summary = footprintSummary(items, plan, target);
  else if (kind === 'backlink_summary') summary = backlinkSummary(result);
  else
    rows = items
      .filter((item) => item !== null && typeof item === 'object' && !Array.isArray(item))
      .map((item) => normalizeRow(kind, record(item), plan));
  const received =
    kind === 'backlink_summary' &&
    ['backlinks', 'referring_main_domains', 'rank'].some((key) => result[key] != null)
      ? 1
      : items.length;
  return {
    summary: {
      ...summary,
      result_available: Object.keys(result).length > 0,
      provider_items_received: received,
      ...(total !== null && total > INT4_MAX ? { provider_total: total } : {}),
    },
    rows,
    total,
    received,
  };
}
