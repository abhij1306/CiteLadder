/**
 * Count-aware projections of one persisted aggregate: never a rescore.
 *
 * A `MetricSnapshot.metrics` object (or one engine's or cohort's slice of it)
 * is what every dashboard, trend and comparison reads, and the one place
 * ranking rows are built. A stored value of the wrong type fails loudly; an
 * absent one stays absent, never zero.
 */
import type { measurementCountsSchema, rankingRowSchema } from '@citeladder/contracts/visibility';
import type { z } from 'zod';

import { policy } from '../config.ts';
import { compareText } from '../text-order.ts';

export type Metrics = Readonly<Record<string, unknown>>;
export type MeasurementCounts = z.input<typeof measurementCountsSchema>;
export type RankingRow = z.input<typeof rankingRowSchema>;

/** A stored JSON object, `{}` when absent; anything else is a corrupt aggregate. */
export function metricObject(value: unknown): Metrics {
  if (value === null || value === undefined) return {};
  if (typeof value === 'object' && !Array.isArray(value)) return value as Metrics;
  throw new TypeError('stored metric is not an object');
}

/** A stored number, or null when it was never recorded. */
export function metricNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return value;
  throw new TypeError('stored metric is not a number');
}

/** A stored count; absent reads as none observed. */
export function metricCount(value: unknown): number {
  return Math.trunc(metricNumber(value) ?? 0);
}

/** `value` rounded to two decimals, as the stored composites are. */
export function round2(value: number): number {
  return Number(value.toFixed(2));
}

export function ratio(numerator: number | null, denominator: number): number | null {
  return numerator !== null && denominator ? numerator / denominator : null;
}

/** The stored per-entity mention counts, or null when the aggregate has none. */
function mentionCounts(metrics: Metrics): Record<string, number> | null {
  const counts = metricObject(metrics.share_of_voice).mention_counts;
  if (counts === null || counts === undefined) return null;
  return Object.fromEntries(
    Object.entries(metricObject(counts)).map(([name, value]) => [name, metricCount(value)]),
  );
}

function competitorNames(metrics: Metrics): string[] {
  return Object.keys(metricObject(metrics.competitor_mention_rate));
}

function sum(values: Iterable<number>): number {
  let total = 0;
  for (const value of values) total += value;
  return total;
}

export function measurementCounts(metrics: Metrics): MeasurementCounts {
  const completed = metricCount(metrics.total_completed);
  const counts = mentionCounts(metrics);
  const competitors = new Set(competitorNames(metrics));
  const brand =
    counts === null
      ? null
      : sum(
          Object.entries(counts)
            .filter(([name]) => !competitors.has(name))
            .map(([, value]) => value),
        );
  const coverage = metricObject(metrics.coverage);
  return {
    state: completed ? 'measured' : 'no_observations',
    responses: completed,
    brand_responses: Object.hasOwn(metrics, 'brand_mention_count')
      ? metricNumber(metrics.brand_mention_count)
      : brand,
    owned_citation_responses: metricNumber(metrics.owned_citation_response_count),
    entity_presences: counts === null ? null : sum(Object.values(counts)),
    expected: metricNumber(coverage.requested),
    failed: metricNumber(coverage.failed),
    not_run: metricNumber(coverage.not_run),
  };
}

/** Every expected response was observed; an unknown expectation is not complete. */
export function isComplete(counts: MeasurementCounts): boolean {
  return counts.expected !== null && counts.expected !== undefined
    ? counts.responses === counts.expected
    : false;
}

type HeadlineRate = 'brand_mention_rate' | 'owned_citation_rate';

/** A headline rate from its counts, falling back to the stored rate. */
export function observedRate(metrics: Metrics, key: HeadlineRate): number | null {
  if (!metricNumber(metrics.total_completed)) return null;
  const counts = measurementCounts(metrics);
  const numerator =
    key === 'brand_mention_rate' ? counts.brand_responses : counts.owned_citation_responses;
  if (numerator !== null && numerator !== undefined) return numerator / counts.responses;
  return metricNumber(metrics[key]);
}

/** The mean of the stored prompt composites, without changing their formula. */
export function promptPerformance(metrics: Metrics): number | null {
  const rows = metrics.per_prompt ?? [];
  if (!Array.isArray(rows)) throw new TypeError('stored per_prompt is not a list');
  const scores = rows.flatMap((row) => {
    const score = metricNumber(metricObject(row).composite_score);
    return score === null ? [] : [score];
  });
  return scores.length ? round2(sum(scores) / scores.length) : null;
}

type CompetitorRate = 'competitor_mention_rate' | 'competitor_citation_rate';

function competitorRate(metrics: Metrics, key: CompetitorRate, name: string): number | null {
  const total = metricNumber(metrics.total_completed);
  if (!total) return null;
  const counts = mentionCounts(metrics) ?? {};
  if (key === 'competitor_mention_rate' && Object.hasOwn(counts, name)) {
    return counts[name]! / total;
  }
  return metricNumber(metricObject(metrics[key])[name]);
}

/**
 * The brand's display name: the first mention-count key that is not a
 * competitor, or a stable label.
 */
export function brandName(metrics: Metrics): string {
  const competitors = new Set(competitorNames(metrics));
  return (
    Object.keys(mentionCounts(metrics) ?? {}).find((name) => !competitors.has(name)) ?? 'Brand'
  );
}

/** Mention-level share of voice over every brand key in `brandKeys`. */
export function mentionSov(
  counts: Readonly<Record<string, number>>,
  brandKeys: ReadonlySet<string>,
): number | null {
  const total = sum(Object.values(counts));
  if (total <= 0) return null;
  return sum([...brandKeys].map((name) => counts[name] ?? 0)) / total;
}

/** The brand's mention-level share, or null when no brand count was persisted (as the tile reads it). */
export function brandMentionSov(metrics: Metrics): number | null {
  const counts = mentionCounts(metrics);
  const brand = brandName(metrics);
  return counts && Object.hasOwn(counts, brand) ? mentionSov(counts, new Set([brand])) : null;
}

export function storedMentionCounts(metrics: Metrics): Record<string, number> {
  return mentionCounts(metrics) ?? {};
}

/** The four compared values of one aggregate. */
export function metricValues(metrics: Metrics): Record<string, number | null> {
  return {
    visibility: observedRate(metrics, 'brand_mention_rate'),
    owned_citation: observedRate(metrics, 'owned_citation_rate'),
    // The same mention-level share the Share of voice tile shows.
    sov: brandMentionSov(metrics),
    prompt_performance: promptPerformance(metrics),
  };
}

/** Movement in points, except the prompt composite, which is already a score. */
export function metricDeltas(current: Metrics, baseline: Metrics): Record<string, number | null> {
  const before = metricValues(baseline);
  return Object.fromEntries(
    Object.entries(metricValues(current)).map(([key, value]) => {
      const previous = before[key] ?? null;
      const scale = key === 'prompt_performance' ? 1 : 100;
      return [key, value !== null && previous !== null ? (value - previous) * scale : null];
    }),
  );
}

/** Highest share of voice first, then name, so ties are stable. */
export function sortRankings<Row extends { share_of_voice?: number | null; name: string }>(
  rows: Row[],
): Row[] {
  return rows.sort(
    (left, right) =>
      (right.share_of_voice ?? 0) - (left.share_of_voice ?? 0) ||
      compareText(left.name, right.name),
  );
}

/**
 * Brand and competitor rows from one aggregate.
 */
export function rankingRows(metrics: Metrics): RankingRow[] {
  const counts = storedMentionCounts(metrics);
  const presences = sum(Object.values(counts));
  const positions = metricObject(metrics.average_positions);
  const row = (
    name: string,
    isBrand: boolean,
    mentionRate: number | null,
    citationRate: number | null,
  ): RankingRow => ({
    name,
    is_brand: isBrand,
    logo_url: null,
    website_url: null,
    mention_rate: mentionRate,
    citation_rate: citationRate,
    share_of_voice: Object.hasOwn(counts, name) && presences ? counts[name]! / presences : null,
    mention_count: counts[name] ?? 0,
    visibility_delta: null,
    gap_count: null,
    matched_visibility_rate: null,
    matched_visibility_delta: null,
    matched_response_count: null,
    avg_position: metricNumber(positions[name]),
  });
  return sortRankings([
    row(
      brandName(metrics),
      true,
      observedRate(metrics, 'brand_mention_rate'),
      observedRate(metrics, 'owned_citation_rate'),
    ),
    ...competitorNames(metrics).map((name) =>
      row(
        name,
        false,
        competitorRate(metrics, 'competitor_mention_rate', name),
        competitorRate(metrics, 'competitor_citation_rate', name),
      ),
    ),
  ]);
}

/**
 * The aggregate for one cohort: core is the snapshot itself, and any other
 * cohort is its own block, empty when the run stored none for it.
 */
export function cohortMetrics(stored: unknown, cohort: string): Metrics {
  const metrics = metricObject(stored);
  return cohort === policy.visibility.core_cohort ? metrics : metricObject(metrics[cohort]);
}

/** One engine's slice of an aggregate, `{}` when that engine was not measured. */
export function engineMetrics(metrics: Metrics, engine: string): Metrics {
  return metricObject(metricObject(metrics.per_engine)[engine]);
}
