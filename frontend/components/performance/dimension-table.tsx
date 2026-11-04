'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { SearchX } from 'lucide-react';

import { DataTable, type DataTableColumn } from '@/components/ui/data-table';
import { MissingValue } from '@/components/ui/unavailable-value';
import { ClampText, TableCell, TableRow } from '@/components/ui/table';
import {
  performanceQueries,
  type PerformanceDimension,
  type PerformanceTableParams,
} from '@/lib/api/performance';
import { useActiveWorkspaceId } from '@/lib/project/project-context';
import { warmQuery } from '@/lib/api/query-client';
import { TABLE_DEFAULT_PAGE_SIZE } from '@/lib/config/tables';
import { useCursorTableQuery } from '@/lib/table/use-cursor-table-query';
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
 * lays out identically and switching Queries -> Pages does not reflow the
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

type TableSnapshot = Readonly<{ snapshotId: string; compareSnapshotId: string | null }>;

function tableParams(
  snapshot: TableSnapshot,
  page: Readonly<{ dimension: PerformanceDimension; sort: string; cursor?: string; size: number }>,
): PerformanceTableParams {
  return {
    snapshot_id: snapshot.snapshotId,
    dimension: page.dimension,
    sort: page.sort,
    cursor: page.cursor,
    page_size: page.size,
    compare_snapshot_id: snapshot.compareSnapshotId ?? undefined,
  };
}

/**
 * Warm a tab's first page from intent (hover, focus), so clicking the tab
 * swaps in rows already in the cache instead of a loading state. It asks for
 * exactly the key a freshly opened table reads: the first page, the default
 * order, the default page size.
 */
export function useWarmDimensionTable(
  projectId: string,
): (snapshot: TableSnapshot, dimension: PerformanceDimension) => void {
  const queryClient = useQueryClient();
  const workspaceId = useActiveWorkspaceId();
  return (snapshot, dimension) => {
    if (workspaceId === null) return;
    warmQuery(
      queryClient,
      performanceQueries.table(
        workspaceId,
        projectId,
        tableParams(snapshot, {
          dimension,
          sort: defaultSort(dimension),
          size: TABLE_DEFAULT_PAGE_SIZE,
        }),
      ),
    );
  };
}

export function DimensionTable({
  projectId,
  dimension,
  snapshotId,
  compareSnapshotId,
  measuredRows,
  selectedLabel,
  compareLabel,
  activeMetrics,
  unavailable,
}: Readonly<{
  projectId: string;
  dimension: PerformanceDimension;
  snapshotId: string;
  compareSnapshotId: string | null;
  /**
   * The snapshot's persisted row count for this dimension, from the
   * dashboard. Known before the first page lands, so a freshly opened tab
   * reserves its pager and a full page from the first frame instead of
   * growing into them when the rows arrive.
   */
  measuredRows: number;
  selectedLabel: string;
  compareLabel: string;
  activeMetrics?: ReadonlySet<PerformanceMetricKey>;
  /** The provider report behind this table is never collected. */
  unavailable?: boolean;
}>) {
  const workspaceId = useActiveWorkspaceId();
  const tab = dimensionTab(dimension);
  const [sort, setSort] = useState(() => defaultSort(dimension));
  const comparing = compareSnapshotId !== null;
  const displayedMetrics = METRIC_CARDS.filter((card) =>
    activeMetrics ? activeMetrics.has(card.key) : true,
  );
  const activeSort = orderableSort(sort, dimension, displayedMetrics);

  // Every value the server binds the cursor to participates in the scope, so
  // switching any of them drops the stack instead of replaying a refused
  // cursor. It holds the applied sort and the shown metrics, so hiding the
  // sorted column drops the stack too — the page it points at was ordered by
  // the column just removed, and the server refuses its cursor. A page
  // turn, a sort or a new range keeps the rows on screen until the next page
  // replaces them. The snapshot's persisted per-dimension count is the exact
  // total, known before the first page lands, so a freshly opened tab
  // reserves its pager and a full page from the first frame.
  const { page, table } = useCursorTableQuery({
    workspaceId,
    scopeId: projectId,
    scope: [
      snapshotId,
      compareSnapshotId,
      dimension,
      sort,
      activeSort,
      displayedMetrics.map((card) => card.key),
    ],
    query: (request) =>
      performanceQueries.table(
        workspaceId,
        projectId,
        tableParams(
          { snapshotId, compareSnapshotId },
          { dimension, sort: activeSort, cursor: request.cursor, size: request.limit },
        ),
      ),
    noun: tab.noun,
    loading: `Loading ${tab.noun}…`,
    error: `Could not load ${tab.noun}. Check your connection and try again.`,
    empty: () => ({
      kind: 'empty',
      icon: SearchX,
      heading: `No ${tab.noun} measured for this range`,
    }),
    enabled: !unavailable,
    total: (current) => current?.total_count ?? measuredRows,
  });

  const columns = dimensionColumns({
    header: tab.header,
    metrics: displayedMetrics,
    activeSort,
    onSort: (key) => setSort(toggleSort(activeSort, key)),
    comparing,
    selectedLabel,
    compareLabel,
  });
  // Every tab holds one footprint, its pager and a page of rows (2026-11-03
  // app review): a breakdown that fits on one page, and its empty or
  // not-imported state, reserve the same, so switching tabs never resizes
  // the panel under the tab row.
  if (unavailable) {
    // Distinct from an empty table: Search Console does not serve this
    // breakdown in a form this project imports, so nothing was measured —
    // which is not the same as having measured nothing.
    return (
      <DataTable
        label={tab.header}
        columns={columns}
        minWidth={comparing ? 'md' : 'sm'}
        reserveRows
        {...table}
        state={{
          kind: 'empty',
          icon: SearchX,
          heading: `No ${tab.noun} imported`,
          description: `Search Console does not provide ${tab.noun} alongside a date range, so this breakdown is not imported. Every other tab is unaffected.`,
        }}
      />
    );
  }

  return (
    <DataTable
      label={tab.header}
      columns={columns}
      minWidth={comparing ? 'md' : 'sm'}
      pinFirstColumn
      reserveRows
      {...table}
    >
      {page?.items.map((row) => (
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
