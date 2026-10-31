'use client';

import { useQuery } from '@tanstack/react-query';
import { TrendingUp } from 'lucide-react';
import type { z } from 'zod';

import { DataTable, type DataTableColumn, type DataTableState } from '@/components/ui/data-table';
import { ClampText, TableCell, TableRow } from '@/components/ui/table';
import { Delta } from '@/components/ui/delta';
import { Stack } from '@/components/ui/layout';
import { EditorialSectionHeader, splitPaneClasses } from '@/components/ui/workspace';
import type { SourceFilters } from '@/components/visibility/source-rows';
import { queryKeys } from '@/lib/api/query-keys';
import { visibilityApi } from '@/lib/api/visibility';
import { pathOf, percent } from '@/lib/visibility/sources';
import { selectionParams, type SourceQueries } from '@/lib/visibility/use-source-analysis';
import type { visibilitySourceMoversSchema } from '@citeladder/contracts/visibility-evidence';

type Movers = z.infer<typeof visibilitySourceMoversSchema>;
type Mover = Movers['risers'][number];

/** Each list reserves this many rows, so a short list never shortens the card. */
const MOVER_ROWS = 5;

/**
 * Sources ranked by change in citation share against the dashboard's
 * comparison, which is the previous comparable period. Without a comparable
 * baseline there is no movement to rank.
 */
export function useSourceMovers(
  filters: SourceFilters,
  queries: SourceQueries,
  { dimension, enabled }: Readonly<{ dimension: 'domain' | 'url'; enabled: boolean }>,
) {
  const comparison = queries.visibilityQuery.data?.comparison;
  const baseline = comparison?.status === 'comparable' ? comparison.baseline_audit_ids : undefined;
  const params = {
    ...selectionParams(filters, queries),
    baseline_audit_ids: baseline,
    dimension,
    limit: MOVER_ROWS,
  };
  return useQuery({
    queryKey: queryKeys.visibility.sourceMovers(queries.projectId ?? '', params),
    queryFn: ({ signal }) =>
      visibilityApi.getSourceMovers(queries.projectId!, params, {
        signal,
        workspaceId: queries.workspaceId,
      }),
    enabled: enabled && Boolean(queries.projectId && queries.activeRunId && baseline?.length),
  });
}

const NO_BASELINE = 'No comparable earlier period to compare this one with yet.';
const IDENTITY_UNAVAILABLE = 'The earlier period cannot be matched to this one.';

const STATUS_COPY: Record<string, string> = {
  no_baseline: NO_BASELINE,
  no_observations: 'The earlier period has no answers to compare with.',
  partial_coverage: 'One of the periods did not finish every answer, so shares would mislead.',
  changed_context: 'The earlier period was measured differently, so it is not comparable.',
  invalid_baseline: 'The earlier period does not finish before this one starts.',
  identity_unavailable: IDENTITY_UNAVAILABLE,
};

const MOVER_COLUMNS: readonly DataTableColumn[] = [
  { key: 'source', label: 'Source' },
  { key: 'share', label: 'Share', width: 'status', numeric: true },
  { key: 'change', label: 'Change', width: 'figure', numeric: true },
];

/**
 * What both lists show instead of rows: no comparable period, a failed read,
 * the first load, or a comparison the server could not make. Undefined once
 * there are movers to list.
 */
function moversState(
  query: ReturnType<typeof useSourceMovers>,
  comparable: boolean,
): DataTableState | undefined {
  const empty = (heading: string): DataTableState => ({
    kind: 'empty',
    headingLevel: 3,
    icon: TrendingUp,
    heading,
  });
  if (!comparable) return empty(NO_BASELINE);
  if (query.isError) {
    return {
      kind: 'error',
      error: query.error,
      fallback: 'Could not load top movers.',
      onRetry: () => void query.refetch(),
      pending: query.isFetching,
    };
  }
  const data = query.data;
  if (!data) return { kind: 'loading', label: 'Loading top movers…' };
  if (data.comparison_status !== 'comparable') {
    return empty(STATUS_COPY[data.comparison_status] ?? IDENTITY_UNAVAILABLE);
  }
  return undefined;
}

function MoverTable({
  title,
  movers,
  dimension,
  state,
  busy,
}: Readonly<{
  title: string;
  movers: Mover[];
  dimension: 'domain' | 'url';
  state: DataTableState | undefined;
  busy: boolean;
}>) {
  return (
    <DataTable
      title={title}
      columns={MOVER_COLUMNS}
      pageSize={MOVER_ROWS}
      rowCount={movers.length}
      busy={{ active: busy, label: 'Updating top movers' }}
      state={
        state ??
        (movers.length
          ? undefined
          : {
              kind: 'empty',
              headingLevel: 3,
              icon: TrendingUp,
              heading: 'No source moved this way',
            })
      }
    >
      {movers.map((mover) => (
        <TableRow key={mover.key}>
          <TableCell>
            <ClampText lines={1}>{dimension === 'url' ? pathOf(mover.key) : mover.key}</ClampText>
          </TableCell>
          <TableCell numeric className="text-secondary">
            {`${percent(mover.previous_share, 1)} → ${percent(mover.current_share, 1)}`}
          </TableCell>
          <TableCell numeric>
            <Delta value={mover.delta} policy="neutral" unit=" pp" />
          </TableCell>
        </TableRow>
      ))}
    </DataTable>
  );
}

/** Risers and fallers by citation share, current period against the previous one. */
export function TopMoversCard({
  dimension,
  query,
  comparable,
}: Readonly<{
  dimension: 'domain' | 'url';
  query: ReturnType<typeof useSourceMovers>;
  /** Whether the dashboard found a comparable earlier period at all. */
  comparable: boolean;
}>) {
  const state = moversState(query, comparable);
  const shared = { dimension, state, busy: query.isFetching };
  return (
    <Stack as="section" aria-label="Top movers">
      <EditorialSectionHeader
        title="Top movers"
        description={`The ${dimension === 'url' ? 'pages' : 'domains'} whose share of citations changed most against the previous comparable period, in percentage points.`}
      />
      <div className={splitPaneClasses('peers')}>
        <MoverTable title="Rising" movers={query.data?.risers ?? []} {...shared} />
        <MoverTable title="Falling" movers={query.data?.fallers ?? []} {...shared} />
      </div>
    </Stack>
  );
}
