import type { SiteHealthOverview } from '@/lib/api/types';
import { pageKindLabel } from '@/lib/site-health/page-kinds';
import { textRole } from '@/components/ui/typography';
import { panelClasses } from '@/components/ui/panel';
import { Stack } from '@/components/ui/layout';

type CohortComposition = SiteHealthOverview['trend']['cohort_composition'];

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
    'Score movement is not split into quality versus cohort effects.',
  ].filter((clause) => clause !== null);

  return (
    <Stack gap="item" className={panelClasses({ tone: 'tonal' }, 'type-caption')}>
      <p className={textRole('emphasis', 'text-ink')}>Scored cohort composition changed.</p>
      <p className="text-ink-secondary">{clauses.join(' ')}</p>
      <Stack as="dl" gap="item">
        <CompositionRow label="Previous counts" counts={composition.previous_page_count_by_kind} />
        <CompositionRow label="Current counts" counts={composition.current_page_count_by_kind} />
      </Stack>
    </Stack>
  );
}

/** An empty kind list says nothing, so its clause is omitted rather than reading "None". */
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
      <dt className="text-ink-muted">{label}</dt>
      <dd className="text-ink-secondary tabular-nums">
        {rows.length === 0
          ? 'No scored page kinds'
          : rows.map(([kind, count]) => `${pageKindLabel(kind)} ${count}`).join(' · ')}
      </dd>
    </Stack>
  );
}
