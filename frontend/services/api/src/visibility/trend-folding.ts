/**
 * Folding measured runs into visibility trend points. Pure: no I/O.
 *
 * A raw point projects one
 * run; a day/week/month bucket folds the runs of one folding identity (frozen
 * comparison key and versions), weighting every rate by the responses behind
 * it and never substituting zero for a rate a run did not record.
 */
import type { visibilityTrendPointSchema } from '@citeladder/contracts/visibility-trends';
import type { z } from 'zod';

import { buildModelProvenance } from '../analysis/provenance.ts';
import { wireUtc } from '../db/timestamps.ts';
import { compareText } from '../text-order.ts';
import {
  brandMentionSov,
  brandName,
  measurementCounts,
  mentionSov,
  metricNumber,
  metricObject,
  observedRate,
  rankingRows,
  round2,
  sortRankings,
  storedMentionCounts,
  type MeasurementCounts,
  type Metrics,
  type RankingRow,
} from './metrics.ts';
import type { TrendSource } from './runs.ts';

export type TrendPoint = z.input<typeof visibilityTrendPointSchema>;
type TrendRankingRow = Omit<
  RankingRow,
  | 'visibility_delta'
  | 'gap_count'
  | 'matched_visibility_rate'
  | 'matched_visibility_delta'
  | 'matched_response_count'
>;

/** A completion-weighted mean that ignores sources with no recorded rate. */
class WeightedRate {
  private weighted = 0;
  private weight = 0;

  add(rate: number | null, completions: number): void {
    if (rate === null || completions <= 0) return;
    this.weighted += rate * completions;
    this.weight += completions;
  }

  value(): number | null {
    return this.weight > 0 ? this.weighted / this.weight : null;
  }
}

export function rawPoint(source: TrendSource): TrendPoint {
  const { metrics } = source;
  const visibilityRate = observedRate(metrics, 'brand_mention_rate');
  return {
    audit_id: source.auditId,
    completed_at: wireUtc(source.completedAt),
    logical_engine: source.logicalEngine,
    visibility_score: source.visibilityScore,
    visibility_rate: visibilityRate,
    prompt_performance_score: source.promptPerformanceScore,
    counts: measurementCounts(metrics),
    comparison_key: source.comparisonKey,
    run_count: 1,
    source_audit_ids: [source.auditId],
    brand_mention_rate: visibilityRate,
    owned_citation_rate: observedRate(metrics, 'owned_citation_rate'),
    sov: { mention: brandMentionSov(metrics) },
    rankings: rankingRows(metrics).map(trendRow),
    avg_position: metricNumber(metrics.avg_position),
    transport_model: source.transportModel,
    retrieval_enabled: source.retrievalEnabled,
    model_provenance: source.modelProvenance,
    source_snapshot_ids: [source.snapshotId],
    analyzer_versions: [source.analyzerVersion],
    scoring_rule_versions: [source.scoringRuleVersion],
    spans_version_boundary: false,
  };
}

function trendRow(row: RankingRow): TrendRankingRow {
  const {
    visibility_delta: _delta,
    gap_count: _gaps,
    matched_visibility_rate: _rate,
    matched_visibility_delta: _matchedDelta,
    matched_response_count: _matched,
    ...rest
  } = row;
  return rest;
}

const DAY_MS = 86_400_000;

/** The UTC start of the bucket holding `at`; weeks start on ISO Monday. */
export function bucketStart(at: string, granularity: string): string {
  if (granularity === 'month') return `${at.slice(0, 7)}-01T00:00:00.000000`;
  const day = `${at.slice(0, 10)}T00:00:00.000000`;
  if (granularity === 'day') return day;
  const midnight = Date.parse(`${at.slice(0, 10)}T00:00:00Z`);
  const monday = midnight - ((new Date(midnight).getUTCDay() + 6) % 7) * DAY_MS;
  return `${new Date(monday).toISOString().slice(0, 10)}T00:00:00.000000`;
}

function isMixedVersion(bucket: readonly TrendSource[]): boolean {
  return (
    new Set(bucket.map((source) => source.analyzerVersion)).size > 1 ||
    new Set(bucket.map((source) => source.scoringRuleVersion)).size > 1
  );
}

const RETRIEVAL_ORDER = new Map<boolean | null, number>([
  [false, 0],
  [null, 1],
  [true, 2],
]);

function retrievalOrder(value: boolean | null): number {
  return RETRIEVAL_ORDER.get(value)!;
}

/**
 * Fold sources into UTC buckets, one point per (bucket, folding identity).
 * The identity carries the analyzer and scoring versions, so a bucket never
 * blends two formulas: runs of another version fold into their own point.
 */
export function bucketPoints(sources: readonly TrendSource[], granularity: string): TrendPoint[] {
  const grouped = new Map<string, { start: string; sources: [TrendSource, ...TrendSource[]] }>();
  for (const source of sources) {
    const start = bucketStart(source.completedAt, granularity);
    const key = JSON.stringify([
      start,
      source.comparisonKey || source.snapshotId,
      source.analyzerVersion,
      source.scoringRuleVersion,
    ]);
    const group = grouped.get(key);
    if (group) group.sources.push(source);
    else grouped.set(key, { start, sources: [source] });
  }
  const buckets = [...grouped.values()];
  // Partitions sharing a boundary order by what a reader can see: the model
  // and whether retrieval was on, never by the comparison hash.
  return buckets
    .toSorted((left, right) => {
      const [a, b] = [left.sources[0], right.sources[0]];
      return (
        compareText(left.start, right.start) ||
        compareText(a.transportModel ?? '', b.transportModel ?? '') ||
        retrievalOrder(a.retrievalEnabled) - retrievalOrder(b.retrievalEnabled)
      );
    })
    .map((bucket) => foldBucket(bucket.start, bucket.sources));
}

type EntityFold = {
  isBrand: boolean;
  mentions: number;
  mentionRate: WeightedRate;
  citationRate: WeightedRate;
  // A mean rank averages over the answers that named the entity, so it folds
  // weighted by that count, not by completions.
  position: WeightedRate;
};

function sumKnown(
  rows: readonly MeasurementCounts[],
  field:
    | 'brand_responses'
    | 'owned_citation_responses'
    | 'entity_presences'
    | 'expected'
    | 'failed'
    | 'not_run',
): number | null {
  let total = 0;
  for (const row of rows) {
    const value = row[field];
    if (value === null || value === undefined) return null;
    total += value;
  }
  return total;
}

/** Answers that named the brand: what a run's mean rank averages over. */
function rankedResponses(metrics: Metrics): number {
  const counts = metrics.counts;
  if (counts !== null && typeof counts === 'object' && !Array.isArray(counts)) {
    return Math.trunc(metricNumber(metricObject(counts).brand_responses) ?? 0);
  }
  return storedMentionCounts(metrics)[brandName(metrics)] ?? 0;
}

function foldedPosition(bucket: readonly TrendSource[]): number | null {
  const position = new WeightedRate();
  for (const source of bucket) {
    position.add(metricNumber(source.metrics.avg_position), rankedResponses(source.metrics));
  }
  const value = position.value();
  return value === null ? null : round2(value);
}

/** Fold one bucket's sources, which share one folding identity. */
export function foldBucket(start: string, bucket: readonly TrendSource[]): TrendPoint {
  const [first] = bucket;
  if (first === undefined) throw new Error('an empty bucket has no point');
  const brandRate = new WeightedRate();
  const ownedRate = new WeightedRate();
  const mentionTotals: Record<string, number> = {};
  const entities = new Map<string, EntityFold>();
  const brandKeys = new Set<string>();
  const addEntity = (
    name: string,
    isBrand: boolean,
    mentions: number,
    rates: { mention: number | null; citation: number | null; position: number | null },
    completions: number,
  ) => {
    const entity = entities.get(name) ?? {
      isBrand,
      mentions: 0,
      mentionRate: new WeightedRate(),
      citationRate: new WeightedRate(),
      position: new WeightedRate(),
    };
    entity.isBrand ||= isBrand;
    entity.mentions += mentions;
    entity.position.add(rates.position, mentions);
    entity.mentionRate.add(rates.mention, completions);
    entity.citationRate.add(rates.citation, completions);
    entities.set(name, entity);
    mentionTotals[name] = (mentionTotals[name] ?? 0) + mentions;
  };
  for (const source of bucket) {
    const { metrics } = source;
    const completions = source.totalCompleted;
    brandRate.add(observedRate(metrics, 'brand_mention_rate'), completions);
    ownedRate.add(observedRate(metrics, 'owned_citation_rate'), completions);
    const counts = storedMentionCounts(metrics);
    const positions = metricObject(metrics.average_positions);
    const brand = brandName(metrics);
    brandKeys.add(brand);
    addEntity(
      brand,
      true,
      counts[brand] ?? 0,
      {
        mention: observedRate(metrics, 'brand_mention_rate'),
        citation: observedRate(metrics, 'owned_citation_rate'),
        position: metricNumber(positions[brand]),
      },
      completions,
    );
    const mentionRates = metricObject(metrics.competitor_mention_rate);
    const citationRates = metricObject(metrics.competitor_citation_rate);
    for (const name of Object.keys(mentionRates)) {
      addEntity(
        name,
        false,
        counts[name] ?? 0,
        {
          mention: metricNumber(mentionRates[name]),
          citation: metricNumber(citationRates[name]),
          position: metricNumber(positions[name]),
        },
        completions,
      );
    }
  }
  const totalMentions = Object.values(mentionTotals).reduce((total, value) => total + value, 0);
  const rankings: TrendRankingRow[] = sortRankings(
    [...entities.entries()].map(([name, entity]) => ({
      name,
      is_brand: entity.isBrand,
      logo_url: null,
      website_url: null,
      mention_rate: entity.mentionRate.value(),
      citation_rate: entity.citationRate.value(),
      share_of_voice: totalMentions > 0 ? (mentionTotals[name] ?? 0) / totalMentions : null,
      mention_count: entity.mentions,
      avg_position: entity.position.value(),
    })),
  );
  const counts = bucket.map((source) => measurementCounts(source.metrics));
  const responses = counts.reduce((total, row) => total + row.responses, 0);
  return {
    audit_id: null,
    completed_at: wireUtc(start),
    logical_engine: first.logicalEngine,
    visibility_score: null,
    visibility_rate: brandRate.value(),
    comparison_key: first.comparisonKey,
    run_count: bucket.length,
    source_audit_ids: bucket.map((source) => source.auditId),
    counts: {
      state: responses ? 'measured' : 'no_observations',
      responses,
      brand_responses: sumKnown(counts, 'brand_responses'),
      owned_citation_responses: sumKnown(counts, 'owned_citation_responses'),
      entity_presences: sumKnown(counts, 'entity_presences'),
      expected: sumKnown(counts, 'expected'),
      failed: sumKnown(counts, 'failed'),
      not_run: sumKnown(counts, 'not_run'),
    },
    brand_mention_rate: brandRate.value(),
    owned_citation_rate: ownedRate.value(),
    sov: { mention: mentionSov(mentionTotals, brandKeys) },
    rankings,
    avg_position: foldedPosition(bucket),
    transport_model: first.transportModel,
    retrieval_enabled: first.retrievalEnabled,
    model_provenance: buildModelProvenance(bucket.flatMap((source) => source.modelProvenance)),
    source_snapshot_ids: bucket.map((source) => source.snapshotId),
    analyzer_versions: [...new Set(bucket.map((source) => source.analyzerVersion))].sort(
      compareText,
    ),
    scoring_rule_versions: [...new Set(bucket.map((source) => source.scoringRuleVersion))].sort(
      compareText,
    ),
    spans_version_boundary: isMixedVersion(bucket),
  };
}
