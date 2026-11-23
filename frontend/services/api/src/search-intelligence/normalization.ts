import { createHash } from 'node:crypto';
import { z } from 'zod';
import { isRecord, record } from '../db/json.ts';
import { canonicalJson } from '../canonical-json.ts';
import { scalarText as text } from '../text-order.ts';
import { lenient, list, nested, opaque, within, withRaw } from '../lenient-fields.ts';

const numeric = (value: unknown): string | null =>
  (typeof value === 'number' || typeof value === 'string') &&
  text(value).trim() &&
  Number.isFinite(Number(value))
    ? text(value)
    : null;
const integer = (value: unknown) =>
  numeric(value) !== null && Number.isSafeInteger(Number(value)) ? Number(value) : null;
const count = lenient(integer);
const decimal = lenient(numeric);
const label = lenient(text);
const passthrough = lenient((value) => value ?? null);
export const INT4_MAX = 2_147_483_647;
const INTENT_LENGTH = 32;
function intentLabel(values: string[]) {
  let label = '';
  for (const value of values) {
    const next = label ? `${label}, ${value}` : value;
    if (next.length > INTENT_LENGTH) break;
    label = next;
  }
  return label;
}
const serpResult = z
  .object({ type: opaque, url: label, rank_group: count, etv: decimal, rank_absolute: count })
  .transform(({ type, ...result }) =>
    !type || type === 'organic'
      ? result
      : { url: '', rank_group: null, etv: null, rank_absolute: null },
  );
const organic = lenient((value) => {
  const item = record(value);
  return serpResult.parse(record('serp_item' in item ? item.serp_item : item));
});
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
const backlinkDetails = z
  .object({
    referring_domains: count,
    referring_pages: count,
    broken_backlinks: count,
    broken_pages: count,
    backlinks_spam_score: count,
    rank: count,
    domain_from_rank: count,
    page_from_rank: count,
    page_to_rank: count,
    links_count: count,
    new_backlinks: count,
    lost_backlinks: count,
    new_referring_domains: count,
    lost_referring_domains: count,
    info: nested({ target_spam_score: count }),
    first_seen: passthrough,
  })
  .transform(({ info, ...details }) => ({ ...details, target_spam_score: info.target_spam_score }));
const withDetails = <S extends z.ZodRawShape>(shape: S) =>
  z.object(shape).and(backlinkDetails.transform((details) => ({ details })));
const keywordData = z
  .object({
    keyword: label,
    keyword_info: nested({ search_volume: count, cpc: decimal, last_updated_time: passthrough }),
    keyword_properties: nested({ keyword_difficulty: count }),
    search_intent_info: nested({ main_intent: opaque, foreign_intent: opaque }),
    serp_info: nested({ last_updated_time: passthrough }),
  })
  .transform((data) => {
    const intents = data.search_intent_info,
      intent = intents.main_intent || intents.foreign_intent || '';
    return {
      keyword: data.keyword,
      search_volume: data.keyword_info.search_volume,
      difficulty: data.keyword_properties.keyword_difficulty,
      intent: intentLabel(Array.isArray(intent) ? intent.map(text) : [text(intent)]),
      auxiliary: {
        cpc: data.keyword_info.cpc,
        cpc_currency: 'USD',
        provider_updated_at: data.keyword_info.last_updated_time,
        serp_updated_at: data.serp_info.last_updated_time,
      },
    };
  });
const keywordItem = lenient(record).pipe(keywordData);
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
const planSchema = nested({
  research_scope: label,
  target: nested({ origin: label, registrable_domain: label, hostname: opaque }),
  comparison: nested({ origin: label, registrable_domain: label }),
  request: nested({
    target: opaque,
    target1: opaque,
    target2: opaque,
    date_from: label,
    date_to: label,
  }),
});
type Plan = z.output<typeof planSchema>;
type RowContext = { plan: Plan; origin: string; domain: string };
type RowValues = Partial<NormalizedRow>;
const rowKind =
  <S extends z.ZodType>(schema: S, values: (item: z.output<S>, context: RowContext) => RowValues) =>
  (item: unknown, context: RowContext) =>
    values(schema.parse(item), context);
function assertExternalSource(source: string, root: string, message: string) {
  if (source === root || source.endsWith(`.${root}`)) throw new Error(message);
}
const rankingKeywordValues = rowKind(
  z.object({ keyword_data: keywordItem, ranked_serp_element: organic }),
  ({ keyword_data: data, ranked_serp_element: result }, { origin, domain }) => {
    if (result.url) assertUrl(result.url, origin, domain);
    return {
      ...data,
      url: result.url,
      rank_group: result.rank_group,
      etv: result.etv,
      auxiliary: { ...data.auxiliary, rank_absolute: result.rank_absolute },
    };
  },
);
const keywordGapValues = rowKind(
  z.object({
    keyword_data: keywordItem,
    intersection_result: nested({ '1': organic, '2': organic }),
    first_domain_serp_element: organic,
    second_domain_serp_element: organic,
  }),
  (item, { plan, origin, domain }) => {
    const competitor = domain ? item.first_domain_serp_element : item.intersection_result['1'],
      owned = domain ? item.second_domain_serp_element : item.intersection_result['2'],
      data = item.keyword_data;
    if (competitor.url)
      assertUrl(
        competitor.url,
        plan.comparison.origin,
        domain ? plan.comparison.registrable_domain : '',
      );
    if (owned.url) assertUrl(owned.url, origin, domain);
    return {
      ...data,
      url: competitor.url,
      rank_group: competitor.rank_group,
      owned_rank_group: owned.rank_group,
      etv: competitor.etv,
      auxiliary: {
        ...data.auxiliary,
        rank_absolute: competitor.rank_absolute,
        owned_url: owned.url,
        owned_etv: owned.etv,
      },
    };
  },
);
const keywordSuggestionValues = rowKind(keywordData, (data) => ({
  ...data,
  auxiliary: { ...data.auxiliary, position_status: 'not_checked' },
}));
const referringDomainValues = rowKind(
  withDetails({ domain: label, backlinks: count, rank: count }),
  (item, { plan }) => {
    const source = item.domain.toLowerCase();
    assertExternalSource(
      source,
      plan.target.registrable_domain,
      'Internal referring domain escaped filter',
    );
    return {
      domain: source,
      backlinks: item.backlinks,
      dataforseo_rank: item.rank,
      auxiliary: { ...item.details, rank_scale: 'one_hundred', object_type: 'referring_domain' },
    };
  },
);
const destinationPageValues = rowKind(
  withDetails({ url: label, backlinks: count, referring_main_domains: count, rank: count }),
  (item, { origin, domain }) => {
    assertUrl(item.url, origin, domain);
    return {
      url: item.url,
      backlinks: item.backlinks,
      referring_main_domains: item.referring_main_domains,
      dataforseo_rank: item.rank,
      auxiliary: { ...item.details, rank_scale: 'one_hundred', object_type: 'destination_page' },
    };
  },
);
const organicPageValues = rowKind(
  z.object({
    page_address: label,
    metrics: nested({ organic: nested({ etv: decimal, count }) }),
    last_updated_time: passthrough,
  }),
  (item, { origin, domain }) => {
    assertUrl(item.page_address, origin, domain);
    const result = item.metrics.organic;
    return {
      url: item.page_address,
      etv: result.etv,
      auxiliary: { organic_keywords: result.count, provider_updated_at: item.last_updated_time },
    };
  },
);
const backlinkLink = z
  .object({
    url_from: passthrough,
    anchor: passthrough,
    item_type: passthrough,
    attributes: passthrough,
    dofollow: passthrough,
    last_seen: passthrough,
    prev_seen: passthrough,
    last_visited: passthrough,
    lost_date: passthrough,
    is_new: passthrough,
    is_lost: passthrough,
    is_broken: passthrough,
  })
  .transform((link) => ({ link }));
const backlinkValues = rowKind(
  withDetails({ url_to: label, domain_from: label, rank: count }).and(backlinkLink),
  (item, { plan, origin, domain }) => {
    assertUrl(item.url_to, origin, domain);
    const source = item.domain_from.toLowerCase();
    assertExternalSource(
      source,
      plan.target.registrable_domain,
      'Internal backlink escaped filter',
    );
    return {
      url: item.url_to,
      domain: source,
      dataforseo_rank: item.rank,
      auxiliary: {
        ...item.details,
        rank_scale: 'one_hundred',
        object_type: 'backlink',
        ...item.link,
      },
    };
  },
);
const backlinkHistoryValues = rowKind(
  withDetails({ date: label, backlinks: count, referring_main_domains: count }),
  (item, { plan }) => {
    const { date } = item,
      day = date.slice(0, 10);
    if (
      !/^\d{4}-\d{2}-\d{2}$/u.test(day) ||
      !Number.isFinite(Date.parse(day)) ||
      new Date(day).toISOString().slice(0, 10) !== day ||
      day < plan.request.date_from ||
      day > plan.request.date_to
    )
      throw new Error('History observation escaped reviewed dates');
    return {
      backlinks: item.backlinks,
      referring_main_domains: item.referring_main_domains,
      auxiliary: { ...item.details, date },
    };
  },
);
const ROW_VALUES: Record<string, (item: unknown, context: RowContext) => RowValues> = {
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
function normalizeRow(kind: string, item: unknown, plan: Plan): NormalizedRow {
  const origin = plan.target.origin,
    domain = plan.research_scope === 'domain_subdomains' ? plan.target.registrable_domain : '';
  const rowValues = Object.hasOwn(ROW_VALUES, kind) ? ROW_VALUES[kind] : undefined;
  if (!rowValues) throw new Error('Unsupported dataset kind');
  const values = rowValues(item, { plan, origin, domain });
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
const footprintItem = lenient(record).pipe(
  z.object({
    subdomain: label,
    metrics: nested({
      organic: within(
        z.object({ count, etv: decimal, pos_1: count, pos_2_3: count, pos_4_10: count }).and(
          z.record(z.string(), z.unknown()).transform((metrics) => ({
            ranking_buckets: Object.fromEntries(
              Object.entries(metrics)
                .filter(([key]) => key.startsWith('pos_'))
                .map(([key, bucket]) => [key, integer(bucket)]),
            ),
          })),
        ),
      ),
    }),
  }),
);
function footprintSummary(items: unknown[], plan: Plan): Record<string, unknown> {
  const matches = items
    .map((item) => footprintItem.parse(item))
    .filter(
      (item) =>
        plan.research_scope === 'domain_subdomains' ||
        item.subdomain.toLowerCase() === plan.target.hostname,
    );
  if (matches.length > 1) throw new Error('Provider returned duplicate footprint rows');
  const match = matches[0];
  if (!match) return {};
  const metrics = match.metrics.organic,
    { count } = metrics,
    buckets = [metrics.pos_1, metrics.pos_2_3, metrics.pos_4_10],
    top10 = buckets.every((v) => v !== null)
      ? buckets.reduce<number>((sum, v) => sum + (v ?? 0), 0)
      : null;
  return {
    organic_keywords: count,
    estimated_monthly_traffic: metrics.etv,
    top_10_keywords: top10,
    top_10_percentage:
      top10 !== null && count !== null && count > 0 ? String((top10 * 100) / count) : null,
    ranking_buckets: metrics.ranking_buckets,
  };
}
const reported = lenient((value) => (value == null ? undefined : integer(value)));
const first = <S extends z.ZodType>(schema: S) =>
  lenient((value) => schema.parse(record(Array.isArray(value) ? value[0] : null)));
const bodySchema = nested({
  tasks: first(
    z.object({
      result: first(
        withRaw(
          withDetails({
            target: opaque,
            target1: opaque,
            target2: opaque,
            items: lenient(list),
            total_count: count,
            backlinks: reported,
            referring_main_domains: reported,
            rank: reported,
          }),
        ),
      ),
    }),
  ),
});
type Aggregate = z.output<typeof bodySchema>['tasks']['result'];
function backlinkSummary(result: Aggregate): Record<string, unknown> {
  return {
    ...result.details,
    backlinks: result.backlinks ?? null,
    referring_main_domains: result.referring_main_domains ?? null,
    rank: result.rank ?? null,
    rank_scale: 'one_hundred',
    object_type: 'analyzed_domain',
  };
}
export function normalizeResponse(kind: string, body: unknown, rawPlan: unknown) {
  const result = bodySchema.parse(body).tasks.result,
    plan = planSchema.parse(rawPlan),
    { request } = plan;
  for (const [requested, answered] of [
    [request.target, result.target],
    [request.target1, result.target1],
    [request.target2, result.target2],
  ])
    if (requested != null && answered != null && requested !== answered)
      throw new Error('Provider aggregate escaped reviewed target scope');
  const { items } = result,
    total = result.total_count;
  let summary: Record<string, unknown> = {},
    rows: NormalizedRow[] = [];
  if (kind === 'footprint') summary = footprintSummary(items, plan);
  else if (kind === 'backlink_summary') summary = backlinkSummary(result);
  else rows = items.filter(isRecord).map((item) => normalizeRow(kind, item, plan));
  const received =
    kind === 'backlink_summary' &&
    [result.backlinks, result.referring_main_domains, result.rank].some(
      (value) => value !== undefined,
    )
      ? 1
      : items.length;
  return {
    summary: {
      ...summary,
      result_available: Object.keys(result.raw).length > 0,
      provider_items_received: received,
      ...(total !== null && total > INT4_MAX ? { provider_total: total } : {}),
    },
    rows,
    total,
    received,
  };
}
