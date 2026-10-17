import { createHash } from 'node:crypto';
import { policy } from '../config.ts';
import { compareText } from '../text-order.ts';
import type { CanonicalTarget } from './targets.ts';

export const si = policy.search_intelligence;
export type DatasetKind = keyof typeof si.endpoints;
/** A stored dataset kind, refused rather than priced as some other kind. */
export function datasetKind(value: unknown): DatasetKind {
  if (typeof value === 'string' && Object.hasOwn(si.endpoints, value)) return value as DatasetKind;
  throw new Error(`Unknown Search Intelligence dataset kind: ${String(value)}`);
}
type ResearchScope = 'exact_host' | 'domain_subdomains';
export type RequestOptions = {
  kind: DatasetKind;
  target: CanonicalTarget;
  comparison: CanonicalTarget | null;
  location: number | null;
  language: string;
  limit: number;
  offset: number;
  scope: ResearchScope;
  seed: string;
  grouping: string;
  order: string;
  minVolume: number | null;
  dateFrom: string;
  dateTo: string;
};
const includes = (values: readonly string[], value: string) => values.includes(value);
function backlinkFilters(target: CanonicalTarget, scope: ResearchScope): unknown[] {
  const exclusions = [
    ['domain_from', '<>', target.registrable_domain],
    'and',
    ['domain_from', 'not_like', `%.${target.registrable_domain}`],
  ];
  if (scope === 'domain_subdomains') return exclusions;
  const urls: unknown[] = [];
  for (const [operator, suffix] of [
    ['like', '/%'],
    ['=', ''],
  ])
    for (const scheme of ['https', 'http']) {
      if (urls.length) urls.push('or');
      urls.push(['url_to', operator, `${scheme}://${new URL(target.origin).host}${suffix}`]);
    }
  return [urls, 'and', ...exclusions];
}
function backlinkPayload(o: RequestOptions): Record<string, unknown> {
  const { kind, target, scope } = o;
  const filters = backlinkFilters(target, scope);
  const payload = {
    target: target.registrable_domain,
    include_subdomains:
      scope === 'domain_subdomains' || target.hostname !== target.registrable_domain,
    include_indirect_links: scope === 'domain_subdomains',
    backlinks_status_type: 'live',
    rank_scale: 'one_hundred',
  };
  if (kind === 'backlinks')
    return {
      ...payload,
      filters,
      mode: o.grouping,
      limit: o.limit,
      offset: o.offset,
      order_by: ['rank,desc', 'url_from,asc'],
    };
  if (kind === 'backlink_summary') return { ...payload, backlinks_filters: filters };
  return {
    ...payload,
    backlinks_filters: filters,
    limit: o.limit,
    offset: o.offset,
    order_by: ['backlinks,desc', `${kind === 'referring_domains' ? 'domain' : 'url'},asc`],
  };
}

function datasetPayload(o: RequestOptions): Record<string, unknown> {
  const { kind, target, comparison, scope } = o;
  const common = {
    location_code: o.location,
    language_code: o.language,
    limit: o.limit,
    offset: o.offset,
  };
  switch (kind) {
    case 'footprint':
      return {
        ...common,
        target: target.registrable_domain,
        filters: ['subdomain', '=', target.hostname],
        item_types: ['organic'],
        limit: 1,
        offset: 0,
      };
    case 'ranking_keywords':
      return {
        ...common,
        target: target.registrable_domain,
        item_types: ['organic'],
        filters: ['ranked_serp_element.serp_item.domain', '=', target.hostname],
      };
    case 'missing_keywords':
    case 'shared_keywords':
      if (!comparison) throw new Error('Comparison target is required');
      return {
        ...common,
        pages: {
          '1': `${comparison.origin}/*`,
          ...(kind === 'shared_keywords' ? { '2': `${target.origin}/*` } : {}),
        },
        intersection_mode: kind === 'missing_keywords' ? 'union' : 'intersect',
        include_subdomains: false,
        item_types: ['organic'],
        ...(kind === 'missing_keywords' ? { exclude_pages: [`${target.origin}/*`] } : {}),
      };
    case 'keyword_suggestions':
      return {
        ...common,
        keyword: o.seed.trim(),
        exact_match: true,
        include_seed_keyword: false,
        include_serp_info: false,
      };
    case 'organic_pages':
      return {
        ...common,
        target: target.registrable_domain,
        order_by: ['metrics.organic.etv,desc', 'page_address,asc'],
        ...(scope === 'exact_host'
          ? {
              filters: [
                ['page_address', 'like', `https://${new URL(target.origin).host}/%`],
                'or',
                ['page_address', 'like', `http://${new URL(target.origin).host}/%`],
              ],
            }
          : {}),
      };
    case 'backlink_history':
      if (scope !== 'domain_subdomains' || !o.dateFrom || !o.dateTo)
        throw new Error('History requires a bounded broad scope');
      return {
        target: target.registrable_domain,
        date_from: o.dateFrom,
        date_to: o.dateTo,
        rank_scale: 'one_hundred',
      };
    default:
      return backlinkPayload(o);
  }
}

function applyResearchScope(o: RequestOptions, payload: Record<string, unknown>): string {
  const { kind, target, comparison, scope } = o;
  let endpoint: string = si.endpoints[kind];
  if (scope !== 'domain_subdomains') return endpoint;
  if (kind in si.broad_endpoints)
    endpoint = si.broad_endpoints[kind as keyof typeof si.broad_endpoints];
  if (kind === 'footprint' || kind === 'ranking_keywords') delete payload.filters;
  if (kind === 'footprint') delete payload.item_types;
  if (kind === 'missing_keywords' || kind === 'shared_keywords') {
    if (!comparison) throw new Error('Comparison target is required');
    for (const key of ['pages', 'exclude_pages', 'intersection_mode', 'include_subdomains'])
      delete payload[key];
    Object.assign(payload, {
      target1: comparison.registrable_domain,
      target2: target.registrable_domain,
      intersections: kind === 'shared_keywords',
    });
  }
  return endpoint;
}

function applyKeywordOrder(o: RequestOptions, payload: Record<string, unknown>) {
  const { kind, scope } = o;
  if (
    !includes(
      ['ranking_keywords', 'missing_keywords', 'shared_keywords', 'keyword_suggestions'],
      kind,
    )
  )
    return;
  const prefix = kind === 'keyword_suggestions' ? '' : 'keyword_data.';
  let field: string;
  if (o.order in si.keyword_acquisition_fields)
    field =
      prefix + si.keyword_acquisition_fields[o.order as keyof typeof si.keyword_acquisition_fields];
  else if (kind === 'ranking_keywords')
    field = `ranked_serp_element.serp_item.${o.order === 'traffic' ? 'etv' : 'rank_group'}`;
  else if (scope === 'domain_subdomains' && kind !== 'keyword_suggestions')
    field = `first_domain_serp_element.${o.order === 'traffic' ? 'etv' : 'rank_group'}`;
  else throw new Error('Unsupported acquisition order');
  payload.order_by = [
    `${field},${['position', 'difficulty'].includes(o.order) ? 'asc' : 'desc'}`,
    `${prefix}keyword,asc`,
  ];
  if (o.minVolume !== null) {
    const condition = [`${prefix}keyword_info.search_volume`, '>=', o.minVolume];
    payload.filters = payload.filters ? [payload.filters, 'and', condition] : condition;
  }
}

/** Only reviewed domain/prefix constraints and policy-owned endpoints can reach a paid request. */
export function buildRequest(o: RequestOptions) {
  const payload = datasetPayload(o);
  const endpoint = applyResearchScope(o, payload);
  applyKeywordOrder(o, payload);
  return { endpoint, payload };
}
/** Compact, key-sorted JSON (ASCII-escaped by default) keeps stored scope identities stable. */
export function canonicalJson(value: unknown, ascii = true): string {
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item, ascii)).join(',')}]`;
  if (value !== null && typeof value === 'object')
    return `{${Object.entries(value)
      .sort(([a], [b]) => compareText(a, b))
      .map(([k, v]) => `${canonicalJson(k, ascii)}:${canonicalJson(v, ascii)}`)
      .join(',')}}`;
  if (!ascii) return JSON.stringify(value);
  return JSON.stringify(value).replace(
    /[\u0080-\uffff]/g,
    (char) => String.raw`\u${char.codePointAt(0)!.toString(16).padStart(4, '0')}`,
  );
}
export function scopeHash(o: RequestOptions, payload: Record<string, unknown>) {
  const backlink = includes(si.backlink_kinds, o.kind);
  return createHash('sha256')
    .update(
      canonicalJson({
        kind: o.kind,
        research_scope: o.scope,
        target: o.target,
        comparison: o.comparison,
        location_code: backlink ? null : o.location,
        language_code: backlink ? '' : o.language,
        provider: Object.fromEntries(
          Object.entries(payload).filter(([key]) => !['limit', 'offset'].includes(key)),
        ),
        parser_version: si.parser_version,
      }),
    )
    .digest('hex');
}
/** A stored decimal USD amount in exact 1e-8 units; a missing amount is zero. */
export function usdUnits(value: string | null | undefined): number {
  if (value === null || value === undefined) return 0;
  const [whole = '0', fraction = ''] = value.trim().split('.');
  return Number(BigInt(whole || '0') * 100_000_000n + BigInt(fraction.padEnd(8, '0').slice(0, 8)));
}
/** Integer microdollars keep quoted totals exact across pages. */
export function quoteDataset(kind: DatasetKind, rows: number) {
  if (!Number.isSafeInteger(rows) || rows < 1 || rows > si.max_depth)
    throw new Error('Unsupported dataset depth');
  const calls = includes(si.list_kinds, kind) ? Math.ceil(rows / si.page_size) : 1;
  const micro = (value: string) => Math.round(Number(value) * 1e6);
  const labs = includes(si.labs_kinds, kind);
  const requestRate = micro(labs ? si.rates.labs_task : si.rates.backlinks_request);
  const rowRate = micro(labs ? si.rates.labs_item : si.rates.backlinks_row);
  const cost =
    kind === 'backlink_history'
      ? micro(si.rates.backlinks_request) +
        micro(si.rates.backlinks_row) * si.history_max_observations
      : requestRate * calls + rowRate * rows;
  return { calls, rows, costMicrousd: cost };
}
/** One request's own estimate: a short final page costs less than a full one. */
export function pageEstimateMicrousd(kind: DatasetKind, pageRows: number) {
  return quoteDataset(kind, Math.max(1, Math.trunc(pageRows) || 1)).costMicrousd;
}
