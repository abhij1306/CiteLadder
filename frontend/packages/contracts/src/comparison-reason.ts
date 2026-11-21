export type ComparisonBasis =
  | Readonly<{ kind: 'comparable' }>
  | Readonly<{ kind: 'matched_subset'; note: string }>
  | Readonly<{ kind: 'declined'; reason: string }>;

export type ComparedAnswers = Readonly<{ matched: number; total: number }>;

const DECLINED: Readonly<Record<string, string>> = {
  changed_context: 'The earlier run used different settings.',
  matched_subset: 'Only some answers match the earlier run, so this is not compared.',
  identity_unavailable: "This run's settings could not be identified, so it is not compared.",
  partial_coverage:
    'The latest or earlier run did not finish every answer, so shares would mislead.',
  coverage_unavailable:
    'The latest or earlier run has no expected-answer count, so its coverage cannot be checked.',
  no_observations: 'The latest or earlier run recorded no answers to compare.',
  invalid_baseline: 'The earlier run does not finish before the latest one starts.',
  baseline_pending: 'The comparison with an earlier run is still being prepared.',
};

export function comparisonDeclinedReason(status: string, skippedRuns = 0): string | null {
  if (status === 'comparable') return null;
  if (status === 'no_baseline') {
    if (!skippedRuns) return 'No earlier run to compare with yet.';
    const runs = skippedRuns === 1 ? 'earlier run' : `${skippedRuns} earlier runs`;
    return `The ${runs} used different settings or scoring.`;
  }
  return DECLINED[status] ?? 'The latest run cannot be compared with an earlier one.';
}

function answersNote(answers: ComparedAnswers | null): string {
  if (!answers) return 'Only the answers both runs share are comparable';
  return `${answers.matched} of ${answers.total} ${answers.total === 1 ? 'answer' : 'answers'} comparable`;
}

export function comparisonBasis({
  status,
  skippedRuns = 0,
  answers = null,
}: Readonly<{
  status: string;
  skippedRuns?: number;
  answers?: ComparedAnswers | null;
}>): ComparisonBasis {
  if (status === 'comparable') return { kind: 'comparable' };
  if (status === 'matched_subset') return { kind: 'matched_subset', note: answersNote(answers) };
  return {
    kind: 'declined',
    reason: comparisonDeclinedReason(status, skippedRuns) ?? DECLINED.baseline_pending!,
  };
}
