import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';

import type { FanoutQueryRow } from '@citeladder/contracts';
import { BrandsNamed } from '@/components/prompts/prompt-past-answers';
import { Absence } from '@/components/ui/absence';
import type { DataTableColumn } from '@/components/ui/data-table';
import type { DataTableState } from '@/components/ui/data-table-body';
import { Delta } from '@/components/ui/delta';
import { readErrorProps } from '@/components/ui/notice';
import { TableCell } from '@/components/ui/table';
import { Search } from '@/lib/icons';
import { visibilityQueries } from '@/lib/api/visibility-queries';
import { percentText } from '@/lib/format';
import { useProjectScope } from '@/lib/project/active-project-scope';

export type FanoutScope = Readonly<{
  audit_id?: string;
  audit_ids?: string[];
  engine?: string;
  topic?: string;
  cohort?: string;
  prompt_id?: string;
  outcome?: string;
  competitor?: string;
  domain?: string;
  url?: string;
}>;

export const FANOUT_VIEWS = [
  { value: 'top', label: 'Top' },
  { value: 'rising', label: 'Rising' },
  { value: 'falling', label: 'Falling' },
] as const;
export type FanoutView = (typeof FANOUT_VIEWS)[number]['value'];

export type LookupState = 'loading' | 'failed' | 'loaded';

const LOOKUP_LIMIT = 500;
const MOVED_LIMIT = 10;

export const METRIC_COLUMNS: readonly DataTableColumn[] = [
  {
    key: 'share',
    label: 'Share',
    width: 'figure',
    kind: 'number',
    hint: 'Share of all times engines ran a search',
  },
  { key: 'change', label: 'Change', width: 'figure', kind: 'number' },
  { key: 'brands', label: 'Brands matched', width: 'name' },
];

export function useFanoutQueries(scope: FanoutScope, enabled: boolean, view: FanoutView) {
  const { workspaceId, projectId } = useProjectScope();
  const params = useMemo(
    () => ({ ...scope, order: view, limit: view === 'top' ? LOOKUP_LIMIT : MOVED_LIMIT }),
    [scope, view],
  );
  const read = useQuery({
    ...visibilityQueries.fanout({ workspaceId, projectId }, params),
    enabled,
  });
  const byQuery = useMemo(
    () => new Map((read.data?.items ?? []).map((item) => [item.query, item])),
    [read.data],
  );
  return {
    read,
    byQuery,
    rows: read.data?.items ?? [],
    compared: read.data?.compared ?? false,
    isError: read.isError && !read.data,
    lookup: lookupState(read),
  };
}

function lookupState(read: Readonly<{ data: unknown; isError: boolean }>): LookupState {
  if (read.data) return 'loaded';
  return read.isError ? 'failed' : 'loading';
}

export function QueryMetricCells({
  row,
  lookup,
}: Readonly<{ row: FanoutQueryRow | undefined; lookup: LookupState }>) {
  if (!row) {
    const missing = missingMark(lookup);
    return (
      <>
        <TableCell numeric>{missing}</TableCell>
        <TableCell numeric>{missing}</TableCell>
        <TableCell>{missing}</TableCell>
      </>
    );
  }
  return (
    <>
      <TableCell numeric>{percentText(row.share)}</TableCell>
      <TableCell numeric>
        <Delta
          value={row.change === null ? null : row.change * 100}
          policy="neutral"
          unit=" pp"
          missingReason="Changes compare one run with the previous run that reported searches."
        />
      </TableCell>
      <TableCell>
        {row.brands === null ? (
          <Absence
            state="unavailable"
            label="Not counted"
            reason="This run finished before brands were matched to queries. The next run will have them."
          />
        ) : (
          <BrandsNamed brands={row.brands} />
        )}
      </TableCell>
    </>
  );
}

function missingMark(lookup: LookupState) {
  switch (lookup) {
    case 'loading':
      return null;
    case 'failed':
      return <Absence state="unavailable" reason="Couldn't load this query's share and brands." />;
    case 'loaded':
      return (
        <Absence
          state="unavailable"
          reason={`Outside the ${LOOKUP_LIMIT} most searched queries in this selection.`}
        />
      );
    default: {
      const unhandled: never = lookup;
      return unhandled;
    }
  }
}

const empty = (heading: string): DataTableState => ({
  kind: 'empty',
  headingLevel: 3,
  icon: Search,
  heading,
});

export function movedState(
  view: Exclude<FanoutView, 'top'>,
  queries: ReturnType<typeof useFanoutQueries>,
): DataTableState | undefined {
  if (queries.isError)
    return {
      kind: 'error',
      ...readErrorProps(queries.read),
      title: "Couldn't load query changes",
      fallback: 'The request failed or timed out.',
    };
  if (!queries.compared) return empty('Nothing to compare yet');
  if (queries.rows.length) return undefined;
  return view === 'rising' ? empty('No query rose') : empty('No query fell');
}
