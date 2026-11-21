import { SearchX } from '@/lib/icons';
import type { DataTableState } from '@/components/ui/data-table';
import { textRole } from '@/components/ui/typography';

export type FanoutSummary = Readonly<{
  distinctQueries: number | null;
  eventCount: number | null;
  matchedQueries: number | null;
}>;

function isSelectionWide(summary: FanoutSummary): boolean {
  return summary.distinctQueries !== null && summary.eventCount !== null;
}

export function selectionMatchedQueries(summary: FanoutSummary): number | null {
  return isSelectionWide(summary) ? summary.matchedQueries : null;
}

export function SearchScopeNote({
  search,
  matched,
}: Readonly<{ search: string | null; matched: number | null }>) {
  if (!search || matched == null) return null;
  const noun = matched === 1 ? 'search' : 'searches';
  return (
    <span className={textRole('body', 'text-ink-2')}>
      {matched === 0
        ? 'No searches match in this run set'
        : `${matched} matching ${noun} in this run set`}
    </span>
  );
}

export function noSearchMatchState(search: string | null, matched: number | null): DataTableState {
  const verb = matched === 1 ? 'match sits' : 'matches sit';
  const elsewhere = matched ? `. ${matched} ${verb} elsewhere in the run set.` : '.';
  return {
    kind: 'empty',
    icon: SearchX,
    headingLevel: 3,
    heading: `No search matches “${search}” on this page${elsewhere}`,
  };
}
