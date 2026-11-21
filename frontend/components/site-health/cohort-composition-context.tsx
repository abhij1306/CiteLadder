import type { SiteHealthOverview } from '@citeladder/contracts';
import { pageKindLabel } from '@/lib/site-health/page-kinds';
import { textRole } from '@/components/ui/typography';
import { Stack } from '@/components/ui/layout';
import { wellClasses } from '@/components/ui/slip';

type CohortComposition = SiteHealthOverview['change_summary']['cohort_composition'];

export function CohortCompositionContext({
  reason,
  composition,
}: Readonly<{
  reason: string;
  composition: CohortComposition;
}>) {
  if (reason !== 'cohort_composition_changed') return null;
  const clauses = [
    kindClause('Added page kinds', composition.added_page_kinds),
    kindClause('Removed page kinds', composition.removed_page_kinds),
  ].filter((clause) => clause !== null);

  return (
    <Stack gap="item" className={wellClasses('type-caption')}>
      <p className={textRole('emphasis', 'text-ink')}>Scored cohort composition changed.</p>
      {clauses.length > 0 ? <p className="text-ink-2">{clauses.join(' ')}</p> : null}
      <Stack as="dl" gap="item">
        <CompositionRow label="Previous counts" counts={composition.previous_page_count_by_kind} />
        <CompositionRow label="Current counts" counts={composition.current_page_count_by_kind} />
      </Stack>
    </Stack>
  );
}

function kindClause(label: string, kinds: readonly string[]) {
  return kinds.length === 0 ? null : `${label}: ${kinds.map(pageKindLabel).join(', ')}.`;
}

function CompositionRow({
  label,
  counts,
}: Readonly<{ label: string; counts: Readonly<Partial<Record<string, number>>> }>) {
  const rows = Object.entries(counts).sort(([left], [right]) => left.localeCompare(right));
  return (
    <Stack gap="tight">
      <dt className="text-ink-2">{label}</dt>
      <dd className="text-ink-2 tabular-nums">
        {rows.length === 0
          ? 'No scored page kinds'
          : rows.map(([kind, count]) => `${pageKindLabel(kind)} ${count}`).join(' · ')}
      </dd>
    </Stack>
  );
}
