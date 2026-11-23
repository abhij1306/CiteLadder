import type { IssueValue } from '@citeladder/contracts';
import { Absence } from '@/components/ui/absence';
import { textRole } from '@/components/ui/typography';
import { formatCount } from '@/lib/format';
import type { Evidence } from '@/lib/site-health/evidence-values';

const LABELS = {
  title: 'Title',
  meta_description: 'Meta description',
  h1_count: 'H1s',
  word_count: 'Words',
} as const;

const lengthRange = (evidence: Evidence) =>
  `recommended ${String(evidence.min_chars)}–${String(evidence.max_chars)}`;

const RANGE_BY_RULE: Readonly<Record<string, (evidence: Evidence) => string | null>> = {
  'technical.single_h1': () => null,
  'technical.title_length': lengthRange,
  'technical.meta_description_length': lengthRange,
  'aeo.thin_content': (evidence) => `recommended ${String(evidence.minimum_words)}+`,
};

export const showsPageText = (value: IssueValue | undefined) =>
  value?.kind === 'title' || value?.kind === 'meta_description';

export function valueRange(
  ruleId: string,
  evidence: Evidence,
  value: IssueValue,
): { hint: string | null } | null {
  const range = RANGE_BY_RULE[ruleId];
  if (range === undefined || value.kind === 'none' || value.kind === 'unavailable') return null;
  return { hint: range(evidence) };
}

export function IssueValueLine({
  value,
  hint = null,
}: Readonly<{ value: IssueValue; hint?: string | null }>) {
  if (value.kind === 'none') return null;
  const line = textRole('caption', 'min-w-0 [overflow-wrap:anywhere]');
  switch (value.kind) {
    case 'unavailable':
      return (
        <p className={line}>
          Value: <Absence state="unavailable" />
        </p>
      );
    case 'title':
    case 'meta_description':
      return (
        <p className={line}>
          {LABELS[value.kind]} ({formatCount(value.length)} chars{hint ? `, ${hint}` : ''}):{' '}
          {value.text ? <q>{value.text}</q> : <Absence state="none" />}
        </p>
      );
    case 'h1_count':
    case 'word_count':
      return (
        <p className={line}>
          {LABELS[value.kind]}: <span className="tabular-nums">{formatCount(value.count)}</span>
          {hint ? ` (${hint})` : null}
        </p>
      );
    default: {
      const unhandled: never = value;
      return unhandled;
    }
  }
}
