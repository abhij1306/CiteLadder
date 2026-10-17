import { z } from 'zod';
import type { ExpectedCheck } from '@citeladder/contracts/opportunities';
import { policy } from '../config.ts';
import { round } from '../demand/projection.ts';
import { record } from '../db/json.ts';
import { epochMicros, parseDatetime } from '../http/datetimes.ts';
import { compareText } from '../text-order.ts';
const o = policy.opportunity.opportunities;

const windowDays: Partial<Record<ExpectedCheck['kind'], number>> = o.CHECK_KIND_WINDOW_DAYS;

/** How long after go-live new evidence still answers a check of this kind. */
export function checkWindowDays(kind: ExpectedCheck['kind']): number {
  return windowDays[kind] ?? o.VERIFICATION_WINDOW_DAYS;
}

/** The longest window any check kind has; a source never looks further back. */
export const MAX_WINDOW_DAYS = Math.max(
  o.VERIFICATION_WINDOW_DAYS,
  ...Object.values(o.CHECK_KIND_WINDOW_DAYS),
);

/**
 * One expected check's reading from one source. `met` and `unmet` answer the
 * check; `waiting` was read but is not final;
 * `unavailable` could not answer and says why.
 */
export type CheckOutcome = {
  state: 'met' | 'unmet' | 'waiting' | 'unavailable';
  reason: string | null;
  observed_at: string;
  source_kind: string;
  source_id: string;
};
export type Evaluation = {
  /** Outcomes by expected-check index, for the checks this source can read. */
  outcomes: Map<number, CheckOutcome>;
  analysis_ids: Set<string>;
  rule_evaluation_ids: Set<string>;
  metric_ids: Set<string>;
};
export const evaluation = (): Evaluation => ({
  outcomes: new Map(),
  analysis_ids: new Set(),
  rule_evaluation_ids: new Set(),
  metric_ids: new Set(),
});
export type Reading = Pick<CheckOutcome, 'observed_at' | 'source_kind' | 'source_id'>;
export const outcome = (
  reading: Reading,
  state: CheckOutcome['state'],
  reason: string | null = null,
): CheckOutcome => ({ ...reading, state, reason });

const checkOutcome = z.object({
  index: z.number().int(),
  state: z.enum(['met', 'unmet', 'waiting', 'unavailable']),
  reason: z.string().nullable(),
  observed_at: z.string(),
  source_kind: z.string(),
  source_id: z.string(),
});

/** Per-check states recorded by the declaration's latest observation. */
export function storedOutcomes(result: unknown): Map<number, CheckOutcome> {
  const parsed = z.array(checkOutcome).safeParse(record(result).checks);
  return new Map((parsed.success ? parsed.data : []).map(({ index, ...item }) => [index, item]));
}

const answered = (item: CheckOutcome | undefined) =>
  item?.state === 'met' || item?.state === 'unmet';

/**
 * Fold a source's outcomes into the previous per-check states. An answer is
 * never replaced by a reading that could not answer, and between two answers
 * (or two non-answers) the later reading wins, whichever order they arrive in.
 */
export function mergeOutcomes(
  previous: ReadonlyMap<number, CheckOutcome>,
  current: ReadonlyMap<number, CheckOutcome>,
): Map<number, CheckOutcome> {
  const merged = new Map(previous);
  for (const [index, next] of current) {
    const prior = merged.get(index);
    const replaces =
      !prior ||
      (answered(next) && !answered(prior)) ||
      (answered(next) === answered(prior) && next.observed_at >= prior.observed_at);
    if (replaces) merged.set(index, next);
  }
  return merged;
}

/** The observation over merged states: any unmet check contradicts; all met verifies. */
export function observationKind(
  merged: ReadonlyMap<number, CheckOutcome>,
  total: number,
): 'observed' | 'verified' | 'contradicted' {
  const states = [...merged.values()].map((item) => item.state);
  if (states.includes('unmet')) return 'contradicted';
  const met = states.filter((state) => state === 'met').length;
  return total > 0 && met === total ? 'verified' : 'observed';
}

/**
 * Whether a source's reading is worth an appended observation: it read the
 * check (even if not finally), or it changed what a reader is told.
 */
export function worthRecording(
  previous: ReadonlyMap<number, CheckOutcome>,
  current: ReadonlyMap<number, CheckOutcome>,
  merged: ReadonlyMap<number, CheckOutcome>,
): boolean {
  if ([...current.values()].some((item) => item.state !== 'unavailable')) return true;
  return [...merged].some(([index, item]) => {
    const prior = previous.get(index);
    return prior?.state !== item.state || prior?.reason !== item.reason;
  });
}

function metricMatches(
  direction: unknown,
  value: number,
  expected: number,
  tolerance: number,
): boolean {
  if (direction === 'increase') return value >= expected - tolerance;
  if (direction === 'decrease') return value <= expected + tolerance;
  return direction === 'equal' && Math.abs(value - expected) <= tolerance;
}
const numeric = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

/** A declared rule expectation in the evaluation vocabulary it is compared with. */
export function expectedRuleOutcome(expected: unknown) {
  if (expected === 'pass') return 'satisfied';
  if (expected === 'fail') return 'missing';
  return expected;
}

/** A per-prompt composite score in a metric snapshot, or null. */
export function promptScore(metrics: unknown, index: number): number | null {
  const rows = record(metrics).per_prompt;
  const value = Array.isArray(rows)
    ? rows.map(record).find((row) => row.prompt_index === index)?.composite_score
    : null;
  return numeric(value) ? value : null;
}

/** A frozen baseline against a later reading, under the check's direction. */
export function compareMetric(
  check: Record<string, unknown>,
  baseline: unknown,
  value: number | null,
  reading: Reading,
  missing: string,
): CheckOutcome {
  if (!numeric(baseline)) return outcome(reading, 'unavailable', 'no_frozen_baseline');
  if (value === null) return outcome(reading, 'unavailable', missing);
  if (!['increase', 'decrease', 'equal'].includes(String(check.direction)))
    return outcome(reading, 'unavailable', 'unsupported_direction');
  const matched = metricMatches(
    check.direction,
    value - baseline,
    Number(check.min_delta || 0),
    Number(check.tolerance || 0),
  );
  return outcome(reading, matched ? 'met' : 'unmet');
}

export function valueState(value: number | null): string {
  if (value === null) return 'unavailable';
  return value === 0 ? 'observed_zero' : 'available';
}
export function leg(
  state: string,
  options: {
    baselineId?: string | null;
    postId?: string | null;
    baseline?: number | null;
    post?: number | null;
    versions?: Record<string, unknown>;
    limitations?: string[];
  } = {},
) {
  const {
    baselineId,
    postId,
    baseline = null,
    post = null,
    versions = {},
    limitations = [],
  } = options;
  return {
    state,
    baseline_source_ids: baselineId ? [baselineId] : [],
    post_source_ids: postId ? [postId] : [],
    baseline_value: baseline,
    post_value: post,
    delta: baseline !== null && post !== null ? round(post - baseline, 4) : null,
    versions,
    limitations,
  };
}
export function gapChanges(before: string[], after: string[], hasLatest: boolean) {
  if (!hasLatest) return { no_longer_observed: [], persistent: [], new: [], state: 'not_run' };
  const a = new Set(before);
  const b = new Set(after);
  return {
    no_longer_observed: [...a].filter((k) => !b.has(k)).sort(compareText),
    persistent: [...a].filter((k) => b.has(k)).sort(compareText),
    new: [...b].filter((k) => !a.has(k)).sort(compareText),
    state: 'available',
  };
}

type VisibilityMeasurement = {
  id: string;
  analyzer_version: string;
  scoring_rule_version: string;
  visibility_score: number | null;
};
export function visibilityMeasurementLeg(
  before: VisibilityMeasurement | null,
  after: VisibilityMeasurement | null,
) {
  if (!before || !after)
    return leg('unavailable', { limitations: ['Visibility metric snapshot is unavailable.'] });
  const versions = {
    baseline_analyzer: before.analyzer_version,
    post_analyzer: after.analyzer_version,
  };
  if (
    before.analyzer_version !== after.analyzer_version ||
    before.scoring_rule_version !== after.scoring_rule_version
  )
    return leg('non_comparable', { limitations: ['Analysis or scoring version changed.'] });
  if (before.visibility_score === null || after.visibility_score === null)
    return leg('unavailable', {
      baselineId: before.id,
      postId: after.id,
      versions,
      limitations: ['Visibility metric is unavailable.'],
    });
  return leg(valueState(Number(after.visibility_score)), {
    baselineId: before.id,
    postId: after.id,
    baseline: Number(before.visibility_score),
    post: Number(after.visibility_score),
    versions,
  });
}

type ReferralMeasurement = {
  id: string;
  granularity: string;
  start_text: string;
  end_text: string;
  metrics: unknown;
  analyzer_version: string;
  formula_version: string;
};
export function referralMeasurementLeg(
  before: ReferralMeasurement | null,
  after: ReferralMeasurement | null,
) {
  if (!after) return leg('not_run', { limitations: ['No post-action AI referral snapshot.'] });
  if (!before)
    return leg('unavailable', {
      postId: after.id,
      limitations: ['No baseline AI referral snapshot.'],
    });
  const duration = (row: ReferralMeasurement) =>
    epochMicros(parseDatetime(row.end_text)!) - epochMicros(parseDatetime(row.start_text)!);
  if (before.granularity !== after.granularity || duration(before) !== duration(after))
    return leg('non_comparable', {
      baselineId: before.id,
      postId: after.id,
      limitations: ['Referral windows or granularity differ.'],
    });
  const value = (metrics: unknown) => {
    const m = record(metrics);
    const totals = record(m.totals);
    return Object.hasOwn(totals, 'ai_referrals') ? totals.ai_referrals : m.ai_referrals;
  };
  const a = value(before.metrics);
  const b = value(after.metrics);
  if (!numeric(a) || !numeric(b))
    return leg('unavailable', {
      baselineId: before.id,
      postId: after.id,
      limitations: ['AI referral metric is unavailable.'],
    });
  return leg(valueState(Number(b)), {
    baselineId: before.id,
    postId: after.id,
    baseline: Number(a),
    post: Number(b),
    versions: { analyzer: after.analyzer_version, formula: after.formula_version },
  });
}
