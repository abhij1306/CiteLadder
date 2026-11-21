import type { Visibility } from '@citeladder/contracts';
import { comparisonBasis } from '@citeladder/contracts/comparison-reason';
import { formatCount, pluralCount as plural } from '@/lib/format';

export function answerShortfall(selected: Visibility): string | null {
  const counts = selected.counts;
  if (!counts || (!counts.failed && !counts.not_run)) return null;
  const answered =
    counts.expected === null
      ? plural(counts.responses, 'answer')
      : `${formatCount(counts.responses)} of ${plural(counts.expected, 'answer')}`;
  return [
    answered,
    counts.failed ? `${formatCount(counts.failed)} failed` : null,
    counts.not_run ? `${formatCount(counts.not_run)} not run` : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

export function subsetChangeNote(selected: Visibility): string | null {
  const comparison = selected.comparison;
  if (comparison?.status !== 'matched_subset') return null;
  const basis = comparisonBasis({
    status: comparison.status,
    answers: { matched: comparison.matched_cells, total: comparison.current_cells },
  });
  return basis.kind === 'matched_subset' ? basis.note : null;
}

export function selectionBasis(selected: Visibility): string | null {
  return (
    [answerShortfall(selected), subsetChangeNote(selected)].filter(Boolean).join(' · ') || null
  );
}
