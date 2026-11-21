import { useQuery } from '@tanstack/react-query';
import type { z } from 'zod';

import { AppGrid } from '@/components/ui/app-grid';
import { DataTable, type DataTableColumn, type DataTableState } from '@/components/ui/data-table';
import { readErrorProps } from '@/components/ui/notice';
import { TitledSection } from '@/components/ui/section';
import { ClampText } from '@/components/ui/clamp-text';
import { TableCell, TableRow } from '@/components/ui/table';
import { Delta } from '@/components/ui/delta';
import { Stack } from '@/components/ui/layout';
import { EditorialSectionHeader } from '@/components/ui/workspace';
import type { SourceFilters } from '@/components/visibility/source-rows';
import { TrendingUp } from '@/lib/icons';
import { visibilityQueries } from '@/lib/api/visibility-queries';
import { pathOf, percent } from '@/lib/visibility/sources';
import { topicSelectionParams, type SourceQueries } from '@/lib/visibility/use-source-analysis';
import type { visibilitySourceMoversSchema } from '@citeladder/contracts/visibility-evidence';

type Movers = z.infer<typeof visibilitySourceMoversSchema>;
type Mover = Movers['risers'][number];

const MOVER_ROWS = 5;

export function useSourceMovers(
  filters: SourceFilters,
  queries: SourceQueries,
  { dimension, enabled }: Readonly<{ dimension: 'domain' | 'url'; enabled: boolean }>,
) {
  const comparison = queries.visibilityQuery.data?.comparison;
  const baseline = comparison?.status === 'comparable' ? comparison.baseline_audit_ids : undefined;
  const params = {
    ...topicSelectionParams(filters, queries),
    baseline_audit_ids: baseline,
    dimension,
    limit: MOVER_ROWS,
  };
  return useQuery({
    ...visibilityQueries.sourceMovers(
      { workspaceId: queries.workspaceId, projectId: queries.projectId },
      params,
    ),
    enabled: enabled && Boolean(queries.activeRunId && baseline?.length),
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
  { key: 'share', label: 'Share', width: 'status', kind: 'number' },
  { key: 'change', label: 'Change', width: 'figure', kind: 'number' },
];

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
      ...readErrorProps(query),
      title: "Couldn't load the top movers",
      fallback: 'The request failed or timed out.',
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
    <TitledSection title={title}>
      <DataTable
        label={title}
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
            <TableCell numeric className="text-ink-2">
              {`${percent(mover.previous_share)} → ${percent(mover.current_share)}`}
            </TableCell>
            <TableCell numeric>
              <Delta value={mover.delta} policy="neutral" unit=" pp" />
            </TableCell>
          </TableRow>
        ))}
      </DataTable>
    </TitledSection>
  );
}

export function TopMoversCard({
  dimension,
  query,
  comparable,
}: Readonly<{
  dimension: 'domain' | 'url';
  query: ReturnType<typeof useSourceMovers>;
  comparable: boolean;
}>) {
  const state = moversState(query, comparable);
  const shared = { dimension, state, busy: query.isFetching };
  return (
    <Stack as="section" aria-label="Top movers">
      <EditorialSectionHeader title="Top movers" />
      <AppGrid layout="halves">
        <MoverTable title="Rising" movers={query.data?.risers ?? []} {...shared} />
        <MoverTable title="Falling" movers={query.data?.fallers ?? []} {...shared} />
      </AppGrid>
    </Stack>
  );
}
