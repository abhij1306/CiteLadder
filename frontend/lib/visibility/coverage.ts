import type { Visibility } from '@/lib/api/types';
import { formatCount, pluralCount as plural } from '@/lib/format';

/**
 * What stands behind the headline tiles: how many answers they count, what
 * failed, and what the change line compares against. Every tile's denominator
 * and baseline are stated once here rather than guessed by the reader.
 */
export type CoverageSummary = { answers: string; change: string };

function answersLine(selected: Visibility): string {
  const counts = selected.counts;
  // Missing counts, no observations and observed failures are three different states.
  if (!counts) return 'Answer counts are unavailable for this selection.';
  if (counts.responses === 0) {
    const reasons = [
      counts.failed ? `${formatCount(counts.failed)} failed` : null,
      counts.not_run ? `${formatCount(counts.not_run)} not run` : null,
    ].filter(Boolean);
    return reasons.length
      ? `No answers were collected: ${reasons.join(', ')}.`
      : 'No answers were recorded for this selection.';
  }
  const engines = selected.per_engine.length;
  const base =
    counts.expected === null
      ? `Based on ${plural(counts.responses, 'answer')}`
      : `Based on ${formatCount(counts.responses)} of ${plural(counts.expected, 'expected answer')}`;
  const parts = [`${base} across ${plural(engines, 'engine')}`];
  if (counts.failed) parts.push(`${formatCount(counts.failed)} failed`);
  if (counts.not_run) parts.push(`${formatCount(counts.not_run)} not run`);
  return `${parts.join(', ')}.`;
}

/** Statuses whose change line is fixed: no change is shown, for this reason. */
const NO_CHANGE: Record<string, string> = {
  partial_coverage: 'the earlier or current measurement did not complete every answer.',
  coverage_unavailable:
    'the earlier or current measurement has no expected-answer count, so its coverage cannot be checked.',
  no_observations: 'one of the measurements recorded no answers.',
  changed_context: 'the chosen earlier run used different settings.',
  identity_unavailable: "this run's settings could not be identified.",
};

type Comparison = NonNullable<Visibility['comparison']>;

function matchedLine(comparison: Comparison, since: string | null): string {
  const shared = comparison.current_counts?.responses;
  const scope = shared == null ? 'the answers' : `the ${plural(shared, 'answer')}`;
  return `Change compares only ${scope} whose prompt and engine also ran on ${since ?? 'the earlier run'}; the settings differed.`;
}

function noBaselineLine(skipped: number): string {
  return skipped
    ? `No change shown: the ${plural(skipped, 'earlier run')} used different settings or scoring.`
    : 'No change shown: there is no earlier comparable run yet.';
}

function changeLine(selected: Visibility, formatDate: (iso: string) => string): string {
  const comparison = selected.comparison;
  if (!comparison) return noBaselineLine(0);
  const since = comparison.baseline_at ? formatDate(comparison.baseline_at) : null;
  const fixed = NO_CHANGE[comparison.status];
  if (fixed) return `No change shown: ${fixed}`;
  if (comparison.status === 'matched_subset') return matchedLine(comparison, since);
  if (comparison.status !== 'comparable' || !since) return noBaselineLine(comparison.skipped_runs);
  return selected.selection_mode === 'range'
    ? `Change compares this period with the previous one, from ${since}.`
    : `Change compares with the run on ${since}.`;
}

export function coverageSummary(
  selected: Visibility,
  formatDate: (iso: string) => string,
): CoverageSummary {
  return { answers: answersLine(selected), change: changeLine(selected, formatDate) };
}
