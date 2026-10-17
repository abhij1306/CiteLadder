/**
 * The AI Referrals snapshot projection: pure folds over referral facts.
 *
 * It shares its calendar buckets with the traffic projection.
 * PostgreSQL worker tests cover the persisted projection. Every formula:
 *
 * - One fact per canonical source/medium metric row, keeping the highest
 *   `resync_seq` per row identity; a fact with no row identity (its metric
 *   row was deleted) never folds in.
 * - `referral_volume` = AI sessions when the bucket has any fact, else null.
 * - `referral_share` = AI sessions / all sessions when that total is positive,
 *   else null. A bucket holding an unclassified fact is unmeasured (null in
 *   both series), and any unclassified fact in the window empties `sources`.
 * - `sources`: per AI source, sessions and share of the window total; only
 *   positive sessions, ordered sessions desc then source asc.
 *
 * Dates are ISO `YYYY-MM-DD` strings, which also order correctly as text.
 */
import { policy } from '../config.ts';
import { compareText } from '../text-order.ts';

const { analytics } = policy;

export type ReferralFact = {
  classification_id: string | null;
  is_ai_referral: boolean | null;
  ai_source: string;
  occurred_date: string;
  sessions: number;
  /** `(property_ref, provider, dataset, date, dimension_key)`, or null. */
  row_identity: readonly [string, string, string, string, string] | null;
  resync_seq: number;
};

type SeriesPoint = { date: string; value: number | null };
type SourceRow = { ai_source: string; sessions: number; share: number | null };

export type AiReferralsProjection = {
  metrics: { referral_volume: SeriesPoint[]; referral_share: SeriesPoint[]; sources: SourceRow[] };
  source_classification_ids: string[];
};

class ProjectionError extends Error {}

const DAY_MS = 86_400_000;
const toDate = (day: string) => new Date(`${day}T00:00:00Z`);
const toDay = (date: Date) => date.toISOString().slice(0, 10);

export function addDays(day: string, days: number): string {
  return toDay(new Date(toDate(day).getTime() + days * DAY_MS));
}

/** The calendar bucket holding `day`: itself, its ISO Monday, or the 1st. */
export function bucketStart(day: string, granularity: string): string {
  if (granularity === 'day') return day;
  if (granularity === 'week') return addDays(day, -((toDate(day).getUTCDay() + 6) % 7));
  if (granularity === 'month') return `${day.slice(0, 7)}-01`;
  throw new ProjectionError(`unknown granularity: ${granularity}`);
}

function nextBucket(start: string, granularity: string): string {
  if (granularity !== 'month') return addDays(start, granularity === 'day' ? 1 : 7);
  const date = toDate(start);
  date.setUTCMonth(date.getUTCMonth() + 1);
  return toDay(date);
}

/** Series labels: every bucket start in the window, the first clamped to it. */
function bucketLabels(windowStart: string, windowEnd: string, granularity: string): string[] {
  const labels: string[] = [];
  for (
    let start = bucketStart(windowStart, granularity);
    start <= windowEnd;
    start = nextBucket(start, granularity)
  ) {
    labels.push(start > windowStart ? start : windowStart);
  }
  return labels;
}

/** The highest revision per metric-row identity, ordered by date then id. */
function latestFacts(facts: readonly ReferralFact[]): ReferralFact[] {
  const latest = new Map<string, ReferralFact>();
  for (const fact of facts) {
    if (fact.row_identity === null) continue;
    const key = JSON.stringify(fact.row_identity);
    const existing = latest.get(key);
    if (existing === undefined || fact.resync_seq > existing.resync_seq) latest.set(key, fact);
  }
  const idKey = (fact: ReferralFact) => fact.classification_id ?? '';
  return [...latest.values()].sort(
    (a, b) => compareText(a.occurred_date, b.occurred_date) || compareText(idKey(a), idKey(b)),
  );
}

const add = (map: Map<string, number>, key: string, value: number) =>
  map.set(key, (map.get(key) ?? 0) + value);

/** Fold the facts into one window's metrics and provenance. */
export function buildAiReferralsProjection(options: {
  facts: readonly ReferralFact[];
  windowStart: string;
  windowEnd: string;
  granularity: string;
}): AiReferralsProjection {
  const { facts, windowStart, windowEnd, granularity } = options;
  if (!analytics.snapshot_granularities.includes(granularity)) {
    throw new ProjectionError(`unknown AI Referrals granularity: ${granularity}`);
  }
  if (windowEnd < windowStart) {
    throw new ProjectionError('AI Referrals window_end before window_start');
  }
  const inWindow = latestFacts(facts).filter(
    (fact) => windowStart <= fact.occurred_date && fact.occurred_date <= windowEnd,
  );

  const bucketAi = new Map<string, number>();
  const bucketTotal = new Map<string, number>();
  const unclassified = new Set<string>();
  const sourceSessions = new Map<string, number>();
  let windowTotal = 0;
  for (const fact of inWindow) {
    const bucket = bucketStart(fact.occurred_date, granularity);
    add(bucketTotal, bucket, fact.sessions);
    windowTotal += fact.sessions;
    if (fact.is_ai_referral === null) unclassified.add(bucket);
    else if (fact.is_ai_referral) {
      add(bucketAi, bucket, fact.sessions);
      add(sourceSessions, fact.ai_source, fact.sessions);
    }
  }

  const referralVolume: SeriesPoint[] = [];
  const referralShare: SeriesPoint[] = [];
  for (const label of bucketLabels(windowStart, windowEnd, granularity)) {
    const bucket = bucketStart(label, granularity);
    if (!bucketTotal.has(bucket) || unclassified.has(bucket)) {
      referralVolume.push({ date: label, value: null });
      referralShare.push({ date: label, value: null });
      continue;
    }
    const ai = bucketAi.get(bucket) ?? 0;
    const total = bucketTotal.get(bucket)!;
    referralVolume.push({ date: label, value: ai });
    referralShare.push({ date: label, value: total > 0 ? ai / total : null });
  }

  const sources: SourceRow[] =
    unclassified.size > 0
      ? []
      : [...sourceSessions]
          .filter(([, sessions]) => sessions > 0)
          .map(([aiSource, sessions]) => ({
            ai_source: aiSource,
            sessions,
            share: windowTotal > 0 ? sessions / windowTotal : null,
          }))
          .sort((a, b) => b.sessions - a.sessions || compareText(a.ai_source, b.ai_source));

  return {
    metrics: { referral_volume: referralVolume, referral_share: referralShare, sources },
    // Provenance is the evidence THIS window folded.
    source_classification_ids: inWindow
      .flatMap((fact) => (fact.classification_id === null ? [] : [fact.classification_id]))
      .sort(compareText),
  };
}
