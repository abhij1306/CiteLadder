'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { SearchX } from 'lucide-react';

import { Alert } from '@/components/ui/alert';
import { DataTable, type DataTableColumn, type DataTableState } from '@/components/ui/data-table';
import { readErrorProps } from '@/components/ui/read-error';
import { MissingValue } from '@/components/ui/unavailable-value';
import { ClampText, TableCell, TableRow } from '@/components/ui/table';
import { performanceApi, type PerformanceDimension } from '@/lib/api/performance';
import { useActiveWorkspaceId } from '@/lib/project/project-context';
import { queryKeys } from '@/lib/api/query-keys';
import { retainPreviousDataForScope } from '@/lib/api/query-client';
import { cursorControls, pageRange, useCursorTable } from '@/lib/table/use-cursor-table';
import {
  METRIC_CARDS,
  DIMENSION_SORT_KEY,
  defaultSort,
  differenceTone,
  dimensionTab,
  formatDifference,
  formatDimensionValue,
  formatMetric,
  measured,
  metricDifference,
  sortDirection,
  sortKey,
  toggleSort,
  type PerformanceMetricKey,
} from '@/lib/performance/performance';
import { cn } from '@/lib/utils';

/**
 * One of the six Performance tables.
 *
 * With a comparison active every metric widens to THREE columns — the
 * selected period, the comparison period, and their absolute difference —
 * exactly as Search Console renders it. Twelve numeric columns will not fit
 * most viewports, so the table scrolls horizontally inside its own frame
 * with the dimension column pinned left: the row's identity stays readable
 * while the reader scrolls the measures, and the page body never scrolls
 * sideways.
 *
 * Rows are paged by keyset against the SNAPSHOT the dashboard resolved, so
 * this table and the chart above it always read the same persisted
 * projection. The exact total comes from that snapshot's persisted
 * per-dimension count — no `COUNT(*)` runs on a page navigation.
 */

const TONE_CLASS: Record<'up' | 'down' | 'flat', string> = {
  up: 'text-secondary',
  down: 'text-secondary',
  flat: 'text-muted',
};

/**
 * The sort ACTUALLY applied, given which columns are on screen.
 *
 * Deselecting a metric removes its header, so an ordering by that column
 * would have no visible indicator and no way back to it — the rows would just
 * be in an order the reader cannot explain. The row-identity column is always
 * present, so ordering by that is never orphaned.
 */
function orderableSort(
  sort: string,
  dimension: PerformanceDimension,
  displayed: readonly { key: PerformanceMetricKey }[],
): string {
  const key = sortKey(sort);
  if (key === DIMENSION_SORT_KEY) return sort;
  return displayed.some((card) => card.key === key) ? sort : defaultSort(dimension);
}

/**
 * The header row: the row identity (a quarter of the table, so every tab
 * lays out identically and switching QUERIES -> PAGES does not reflow the
 * metric columns under the pointer), then each metric. Search Console groups
 * each metric with its own comparison and difference rather than appending
 * all comparisons at the end, so a reader compares adjacent columns. The
 * derived columns are not stored, so they do not sort.
 */
function dimensionColumns({
  header,
  metrics,
  activeSort,
  onSort,
  comparing,
  selectedLabel,
  compareLabel,
}: Readonly<{
  header: string;
  metrics: readonly { key: PerformanceMetricKey; label: string }[];
  activeSort: string;
  onSort: (key: PerformanceMetricKey) => void;
  comparing: boolean;
  selectedLabel: string;
  compareLabel: string;
}>): DataTableColumn[] {
  return [
    { key: 'dimension', label: header, width: 'lead' },
    ...metrics.flatMap((metric): DataTableColumn[] => {
      const label = metric.label.replace(/^(Total|Average) /, '');
      const selected: DataTableColumn = {
        key: metric.key,
        label,
        width: 'figure',
        numeric: true,
        sort: {
          active: sortKey(activeSort) === metric.key,
          descending: sortDirection(activeSort) === 'descending',
          onSort: () => onSort(metric.key),
        },
        // The range is stated once, in the toolbar. Repeating it under every
        // column earns its place only when a comparison makes the columns
        // ambiguous (selected vs comparison vs difference).
        sublabel: comparing ? selectedLabel : undefined,
      };
      if (!comparing) return [selected];
      return [
        selected,
        {
          key: `${metric.key}-comparison`,
          label,
          width: 'figure',
          numeric: true,
          sublabel: compareLabel,
        },
        {
          key: `${metric.key}-difference`,
          label,
          width: 'figure',
          numeric: true,
          sublabel: 'Difference',
        },
      ];
    }),
  ];
}

export function DimensionTable({
  projectId,
  dimension,
  snapshotId,
  compareSnapshotId,
  selectedLabel,
  compareLabel,
  activeMetrics,
  unavailable,
}: Readonly<{
  projectId: string;
  dimension: PerformanceDimension;
  snapshotId: string;
  compareSnapshotId: string | null;
  selectedLabel: string;
  compareLabel: string;
  activeMetrics?: ReadonlySet<PerformanceMetricKey>;
  /** The provider report behind this table is never collected. */
  unavailable?: boolean;
}>) {
  const workspaceId = useActiveWorkspaceId();
  const tab = dimensionTab(dimension);
  const [sort, setSort] = useState(() => defaultSort(dimension));
  // Every value the server binds the cursor to participates, so switching
  // any of them drops the stack instead of replaying a refused cursor.
  const table = useCursorTable(`${projectId}|${snapshotId}|${dimension}|${sort}`);
  // NOTE: keyed on the raw `sort` so hiding a column drops the cursor stack
  // too — the page it points at was ordered by the column just removed.
  const comparing = compareSnapshotId !== null;
  const displayedMetrics = METRIC_CARDS.filter((card) =>
    activeMetrics ? activeMetrics.has(card.key) : true,
  );
  const activeSort = orderableSort(sort, dimension, displayedMetrics);

  const params = {
    snapshot_id: snapshotId,
    dimension,
    sort: activeSort,
    cursor: table.cursor,
    page_size: table.pageSize,
    compare_snapshot_id: compareSnapshotId ?? undefined,
  };
  const query = useQuery({
    queryKey: queryKeys.performance.table(projectId, params),
    queryFn: ({ signal }) => performanceApi.getTable(projectId, params, { signal, workspaceId }),
    enabled: !unavailable && workspaceId !== null,
    placeholderData: (previousData, previousQuery) =>
      retainPreviousDataForScope(projectId, previousData, previousQuery),
  });

  const rows = query.data?.items ?? [];
  const nextCursor = query.data?.next_cursor ?? null;
  const total = query.data?.total_count;
  const { from, to } = pageRange(table.page, table.pageSize, rows.length);

  if (unavailable) {
    // Distinct from an empty table: Search Console does not serve this
    // breakdown in a form this project imports, so nothing was measured —
    // which is not the same as having measured nothing.
    return (
      <Alert tone="info">
        Search Console does not provide {tab.noun} alongside a date range, so this breakdown is not
        imported. Every other tab is unaffected.
      </Alert>
    );
  }

  let state: DataTableState | undefined;
  if (query.isError)
    state = {
      kind: 'error',
      ...readErrorProps(query),
      fallback: `Could not load ${tab.noun}. Check your connection and try again.`,
    };
  // Empty is a settled successful read; a pending, paused or disabled query
  // has not measured anything yet.
  else if (!query.isSuccess) state = { kind: 'loading', label: `Loading ${tab.noun}…` };
  else if (rows.length === 0)
    state = { kind: 'empty', icon: SearchX, heading: `No ${tab.noun} measured for this range.` };

  return (
    <DataTable
      label={tab.header}
      columns={dimensionColumns({
        header: tab.header,
        metrics: displayedMetrics,
        activeSort,
        onSort: (key) => {
          setSort(toggleSort(activeSort, key));
          table.reset();
        },
        comparing,
        selectedLabel,
        compareLabel,
      })}
      minWidth={comparing ? 'md' : 'sm'}
      pinFirstColumn
      state={state}
      pageSize={table.pageSize}
      rowCount={rows.length}
      pager={{
        range: { from, to, total, noun: tab.noun },
        pageSize: { value: table.pageSize, onChange: table.setPageSize },
        ...cursorControls(table, nextCursor),
        busy: query.isFetching,
      }}
    >
      {rows.map((row) => (
        <TableRow key={row.dimension_key}>
          <TableCell>
            <ClampText
              className={cn(
                dimension === 'page' && 'tabular-nums break-all',
                dimension === 'day' && 'tabular-nums',
              )}
            >
              {formatDimensionValue(dimension, row.display_value)}
            </ClampText>
          </TableCell>
          {displayedMetrics.flatMap((metric) => {
            const selectedCell = (
              <TableCell key={metric.key} numeric>
                {measured(formatMetric(metric.key, row.metrics[metric.key])) ?? <MissingValue />}
              </TableCell>
            );
            if (!comparing) return [selectedCell];
            const comparisonValue = row.comparison_metrics
              ? row.comparison_metrics[metric.key]
              : null;
            const difference = metricDifference(
              row.metrics[metric.key],
              row.comparison_metrics ? comparisonValue : undefined,
            );
            return [
              selectedCell,
              <TableCell key={`${metric.key}-comparison`} numeric className="text-muted">
                {measured(formatMetric(metric.key, comparisonValue)) ?? <MissingValue />}
              </TableCell>,
              <TableCell
                key={`${metric.key}-difference`}
                numeric
                className={TONE_CLASS[differenceTone(metric.key, difference)]}
              >
                {measured(formatDifference(metric.key, difference)) ?? <MissingValue />}
              </TableCell>,
            ];
          })}
        </TableRow>
      ))}
    </DataTable>
  );
}
