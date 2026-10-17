/**
 * Shaping the Sources reads for the charts and tables that draw them.
 *
 * Pure and framework-free. The components decide what to render; this decides
 * what the numbers mean, so the same rule cannot be spelled two ways in two
 * files — which is how a share ended up computed over the loaded page in one
 * place and over the selection in another.
 */
import type { z } from 'zod';
import { formatCount } from '@/lib/format';
import { chartToken } from '@/lib/visibility/chart-tokens';

import type {
  visibilitySourceSeriesSchema,
  visibilitySourcesSchema,
} from '@citeladder/contracts/visibility-evidence';
import {
  domainTypeLabel,
  DOMAIN_TYPES,
  urlTypeLabel,
  URL_TYPES,
} from '@/lib/visibility/vocabulary';

export type SourcesData = z.infer<typeof visibilitySourcesSchema>;
export type SourceItem = SourcesData['items'][number];
export type SeriesData = z.infer<typeof visibilitySourceSeriesSchema>;

/** A source's own type token — one per row, so it can also be a filter value. */
export function itemType(item: SourceItem): string | null {
  return item.categories.length === 1 ? (item.categories[0] ?? null) : null;
}

/**
 * The domain shown for a URL row, for the favicon beside it.
 *
 * Parsed from the URL rather than carried on the row: the URL table is already
 * scoped to whatever the reader filtered to, and a malformed URL should lose
 * its icon rather than its row.
 */
export function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, '') || null;
  } catch {
    return null;
  }
}

/** The path a reader reads under a page title, without the scheme or host. */
export function pathOf(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.hostname.replace(/^www\./, '')}${parsed.pathname}`.replace(/\/$/, '');
  } catch {
    return url;
  }
}

/**
 * The ring's segments, in taxonomy order rather than by size.
 *
 * A mix that reorders itself every time the period moves cannot be compared
 * across two screenshots, and the order the types are declared in is the order
 * a reader should reason about a source mix anyway.
 */
export function typeSlices(
  totals: Record<string, number> | undefined,
  dimension: 'domain' | 'url',
) {
  const source = totals ?? {};
  const catalog = dimension === 'url' ? URL_TYPES : DOMAIN_TYPES;
  return catalog
    .map((type, index) => ({
      key: type.token,
      label: type.label,
      value: source[type.token] ?? 0,
      ...chartToken(index),
    }))
    .filter((slice) => slice.value > 0);
}

/** The type filter's options, limited to types the selection actually holds. */
export function availableTypes(
  totals: Record<string, number> | undefined,
  dimension: 'domain' | 'url',
) {
  const source = totals ?? {};
  const catalog = dimension === 'url' ? URL_TYPES : DOMAIN_TYPES;
  return catalog.filter((type) => (source[type.token] ?? 0) > 0);
}

/** The label a type token renders as, whichever dimension is showing. */
export function typeLabel(token: string | null | undefined, dimension: 'domain' | 'url') {
  return dimension === 'url' ? urlTypeLabel(token) : domainTypeLabel(token);
}

/**
 * The usage chart's lines, as shares of the responses in each bucket.
 *
 * Scaled to whole percent here rather than in the chart: the y axis formats
 * whatever it is handed, and a component that both scaled and formatted was
 * how a 38% point once rendered as "3800%".
 */
export function toChartSeries(data: SeriesData | undefined) {
  if (!data?.series.length) return [];
  return data.series.map((series, index) => ({
    key: series.key,
    label: series.key,
    ...chartToken(index),
    points: series.points.map((point) => ({
      value: point.share === null ? null : point.share * 100,
      label: point.at,
    })),
  }));
}

/**
 * The tallest share drawn, rounded up to a sensible ceiling.
 *
 * A fixed 100% axis flattens five lines that all sit under 40% into a band at
 * the bottom of the plot. The ceiling never drops below 10% so a quiet period
 * does not magnify noise into a mountain range.
 */
export function seriesCeiling(series: ReturnType<typeof toChartSeries>): number {
  const peak = Math.max(
    0,
    ...series.flatMap((one) => one.points.map((point) => (point.value === null ? 0 : point.value))),
  );
  if (peak <= 10) return 10;
  return Math.min(100, Math.ceil(peak / 10) * 10);
}

/**
 * The formatters return `null` for "there is nothing to show".
 *
 * Never a placeholder glyph: an em dash in a numeric cell says nothing about
 * WHY the number is missing, and the product has a vocabulary for that. The
 * caller renders `UnavailableValue` instead, which names the state.
 */

/** A ratio as a percentage. */
export function percent(value: number | null | undefined, digits = 0): string | null {
  if (value === null || value === undefined || Number.isNaN(value)) return null;
  return `${(value * 100).toFixed(digits)}%`;
}

/** A plain ratio (citations per response), which is NOT a percentage. */
export function ratio(value: number | null | undefined): string | null {
  if (value === null || value === undefined || Number.isNaN(value)) return null;
  return value.toFixed(1);
}

/** A count, grouped. */
export function count(value: number | null | undefined): string | null {
  return value === null || value === undefined ? null : formatCount(value);
}

/**
 * How long ago, in the coarsest unit that is still true.
 *
 * Coarse on purpose: "4 days ago" is what a reader needs from a Last seen
 * column, and a timestamp to the minute invites a precision the run schedule
 * does not support.
 */
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

/** Client-side search over the loaded rows, matching key and page title. */
export function matchesSearch(item: SourceItem, search: string): boolean {
  const needle = search.trim().toLowerCase();
  if (!needle) return true;
  return (
    item.key.toLowerCase().includes(needle) || (item.title ?? '').toLowerCase().includes(needle)
  );
}

type SortDirection = 'asc' | 'desc';
export type SortState = { column: string; direction: SortDirection } | null;

/**
 * What each sortable column compares on.
 *
 * A lookup rather than a switch: every column is one line, adding one is one
 * line, and the accessor stays a table instead of growing a branch per metric.
 * A null metric sorts as -1 so "not measured" lands below an observed zero
 * rather than above it.
 */
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

/**
 * Sort the loaded rows by one column.
 *
 * Client-side, and only over what is loaded — which is why the table's footer
 * says how many of the total are on screen. Sorting server-side would be the
 * honest version and is a larger change to the projection's ordering contract
 * than this surface needs.
 */
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
