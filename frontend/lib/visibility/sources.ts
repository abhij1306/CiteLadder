import type { z } from 'zod';
import { formatCount, formatMean, percentText } from '@/lib/format';
import type { UrlCodec } from '@/lib/navigation/url-state';

import type {
  visibilitySourceSeriesSchema,
  visibilitySourcesSchema,
} from '@citeladder/contracts/visibility-evidence';
import { URL_TYPES, urlTypeLabel } from '@citeladder/contracts/page-labels';
import { domainTypeLabel, DOMAIN_TYPES } from '@/lib/visibility/vocabulary';

export type SourcesData = z.infer<typeof visibilitySourcesSchema>;
export type SourceItem = SourcesData['items'][number];
export type SeriesData = z.infer<typeof visibilitySourceSeriesSchema>;

export function itemType(item: SourceItem): string | null {
  return item.categories.length === 1 ? (item.categories[0] ?? null) : null;
}

export function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, '') || null;
  } catch {
    return null;
  }
}

export function pathOf(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.hostname.replace(/^www\./, '')}${parsed.pathname}`.replace(/\/$/, '');
  } catch {
    return url;
  }
}

export function typeSlices(
  totals: Record<string, number> | undefined,
  dimension: 'domain' | 'url',
) {
  const source = totals ?? {};
  const catalog = dimension === 'url' ? URL_TYPES : DOMAIN_TYPES;
  return catalog
    .map((type) => ({
      key: type.token,
      label: type.label,
      value: source[type.token] ?? 0,
    }))
    .filter((slice) => slice.value > 0);
}

export function availableTypes(
  totals: Record<string, number> | undefined,
  dimension: 'domain' | 'url',
) {
  const source = totals ?? {};
  const catalog = dimension === 'url' ? URL_TYPES : DOMAIN_TYPES;
  return catalog.filter((type) => (source[type.token] ?? 0) > 0);
}

export function typeLabel(token: string | null | undefined, dimension: 'domain' | 'url') {
  return dimension === 'url' ? urlTypeLabel(token) : domainTypeLabel(token);
}

export function toChartSeries(data: SeriesData | undefined) {
  if (!data?.series.length) return [];
  return data.series.map((series) => ({
    key: series.key,
    label: series.key,
    points: series.points.map((point) => ({
      value: point.share === null ? null : point.share * 100,
      label: point.at,
    })),
  }));
}

export function seriesCeiling(series: ReturnType<typeof toChartSeries>): number {
  const peak = Math.max(
    0,
    ...series.flatMap((one) => one.points.map((point) => (point.value === null ? 0 : point.value))),
  );
  if (peak <= 10) return 10;
  return Math.min(100, Math.ceil(peak / 10) * 10);
}

export function percent(value: number | null | undefined): string | null {
  if (value === null || value === undefined || Number.isNaN(value)) return null;
  return percentText(value);
}

export function ratio(value: number | null | undefined): string | null {
  if (value === null || value === undefined || Number.isNaN(value)) return null;
  return formatMean(value);
}

export function count(value: number | null | undefined): string | null {
  return value === null || value === undefined ? null : formatCount(value);
}

export function sinceLabel(value: string | null | undefined, now = Date.now()): string | null {
  if (!value) return null;
  const at = Date.parse(value);
  if (Number.isNaN(at)) return null;
  const days = Math.floor((now - at) / 86_400_000);
  if (days <= 0) return 'Today';
  if (days === 1) return '1 day ago';
  if (days < 30) return `${days} days ago`;
  const months = Math.floor(days / 30);
  return months === 1 ? '1 month ago' : `${months} months ago`;
}

export function matchesSearch(item: SourceItem, search: string): boolean {
  const needle = search.trim().toLowerCase();
  if (!needle) return true;
  return (
    item.key.toLowerCase().includes(needle) || (item.title ?? '').toLowerCase().includes(needle)
  );
}

type SortDirection = 'asc' | 'desc';
export type SortState = { column: string; direction: SortDirection } | null;

const SORT_VALUES: Record<string, (item: SourceItem) => number | string> = {
  key: (item) => item.key,
  responses: (item) => item.responses,
  retrieved: (item) => item.retrieved ?? -1,
  response_rate: (item) => item.response_rate ?? -1,
  retrieval_rate: (item) => item.retrieval_rate ?? -1,
  annotations: (item) => item.annotations,
  citation_share: (item) => item.citation_share ?? -1,
  citation_rate: (item) => item.citation_rate ?? -1,
  mentions: (item) => item.mentions,
  last_cited_at: (item) => (item.last_cited_at ? Date.parse(item.last_cited_at) : -1),
};

export type DimensionSort = Readonly<{ dimension: 'domain' | 'url'; sort: NonNullable<SortState> }>;

export const SOURCE_SORT_CODEC: UrlCodec<DimensionSort | null> = {
  parse: (raw) => {
    const match = /^(domain|url):(-?)([a-z_]+)$/u.exec(raw ?? '');
    if (!match?.[1] || !match[3] || !Object.hasOwn(SORT_VALUES, match[3])) return null;
    return {
      dimension: match[1] === 'domain' ? 'domain' : 'url',
      sort: { column: match[3], direction: match[2] ? 'desc' : 'asc' },
    };
  },
  serialize: (value) => {
    if (!value) return null;
    const sign = value.sort.direction === 'desc' ? '-' : '';
    return `${value.dimension}:${sign}${value.sort.column}`;
  },
};

export function sortItems(items: readonly SourceItem[], sort: SortState): SourceItem[] {
  const value = sort ? SORT_VALUES[sort.column] : undefined;
  if (!sort || !value) return [...items];
  const sign = sort.direction === 'asc' ? 1 : -1;
  return [...items].sort((a, b) => {
    const left = value(a);
    const right = value(b);
    if (typeof left === 'string' || typeof right === 'string') {
      return sign * String(left).localeCompare(String(right));
    }
    return sign * (left - right);
  });
}
