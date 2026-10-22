'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';

import { Alert } from '@/components/ui/alert';
import { Card } from '@/components/ui/card';
import { QueryState } from '@/components/ui/query-state';
import { Pager } from '@/components/ui/pager';
import { ReadError, readErrorProps } from '@/components/ui/read-error';
import { Skeleton } from '@/components/ui/skeleton';
import { MissingValue } from '@/components/ui/unavailable-value';
import {
  ClampText,
  SortableTableHead,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { textRole } from '@/components/ui/typography';
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
 * most viewports, so the table scrolls horizontally inside its own container
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

/** A header cell for a derived column — not sortable, since it is not stored. */
function StaticHead({ label, sublabel }: Readonly<{ label: string; sublabel: string }>) {
  return (
    <TableHead numeric className="min-w-[7.5rem]">
      <span className="inline-flex w-full flex-col items-center gap-0.5 text-center">
        <span>{label}</span>
        <span className={textRole('caption', 'max-w-full truncate')} title={sublabel}>
          {sublabel}
        </span>
      </span>
    </TableHead>
  );
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
  const columnCount = 1 + displayedMetrics.length * (comparing ? 3 : 1);

  const onSort = (key: PerformanceMetricKey) => {
    setSort(toggleSort(activeSort, key));
    table.reset();
  };

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
  if (query.isError) {
    return (
      <ReadError
        {...readErrorProps(query)}
        fallback={`Could not load ${tab.noun}. Check your connection and try again.`}
      />
    );
  }

  return (
    <Card className="overflow-hidden">
      {/* 12px for the data inside the tab: these tables are dense and read
          as a block of figures, so the smaller size fits more of a row on
          screen without shrinking the tab labels that head them. */}
      <Table
        wrapperClassName="overflow-x-auto"
        // Fixed layout with an explicit first column: every tab then lays
        // out identically, so switching QUERIES -> PAGES does not reflow
        // the metric columns under the pointer. Without it each tab sizes
        // to its own longest cell and the whole table jumps.
        minWidth={comparing ? 'md' : 'sm'}
        className="w-full table-fixed"
      >
        <colgroup>
          <col className="w-[32%] min-w-[14rem]" />
          {Array.from({ length: columnCount - 1 }, (_, index) => (
            <col key={index} className={comparing ? 'min-w-[7.5rem]' : 'min-w-[6rem]'} />
          ))}
        </colgroup>
        <TableHeader>
          <TableRow>
            {/* Pinned so the row identity survives horizontal scrolling. */}
            <TableHead className="bg-panel sticky left-0 z-10">{tab.header}</TableHead>
            {displayedMetrics.flatMap((metric) => {
              const label = metric.label.replace(/^(Total|Average) /, '');
              const head = (
                <SortableTableHead
                  key={metric.key}
                  label={label}
                  numeric
                  active={sortKey(activeSort) === metric.key}
                  descending={sortDirection(activeSort) === 'descending'}
                  onSort={() => onSort(metric.key)}
                  className={comparing ? 'min-w-[7.5rem]' : undefined}
                  // The range is stated once, in the toolbar. Repeating it
                  // under every column adds no information — it only earns
                  // its place when a comparison makes the columns AMBIGUOUS
                  // (selected vs comparison vs difference).
                  sublabel={comparing ? selectedLabel : undefined}
                />
              );
              // Search Console groups each metric with its own comparison
              // and difference rather than appending all comparisons at the
              // end, so a reader compares adjacent columns.
              return comparing
                ? [
                    head,
                    <StaticHead
                      key={`${metric.key}-comparison`}
                      label={label}
                      sublabel={compareLabel}
                    />,
                    <StaticHead
                      key={`${metric.key}-difference`}
                      label={label}
                      sublabel="Difference"
                    />,
                  ]
                : [head];
            })}
          </TableRow>
        </TableHeader>
        <TableBody>
          {query.isLoading
            ? // As many rows as a full page holds, so the table does not
              // resize when the real ones arrive.
              Array.from({ length: table.pageSize }, (_, index) => (
                <TableRow key={`skeleton-${index}`}>
                  {Array.from({ length: columnCount }, (_, cell) => (
                    <TableCell key={cell} numeric={cell > 0}>
                      <Skeleton className={cell === 0 ? 'h-4 w-3/4' : 'mx-auto h-4 w-16'} />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            : null}
          {!query.isLoading && rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={columnCount}>
                <QueryState
                  kind="empty"
                  inline
                  message={`No ${tab.noun} measured for this range.`}
                />
              </TableCell>
            </TableRow>
          ) : null}
          {rows.map((row) => (
            <TableRow key={row.dimension_key}>
              <TableCell className="bg-panel sticky left-0 z-10">
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
                    <span className="tabular-nums">
                      {measured(formatMetric(metric.key, row.metrics[metric.key])) ?? (
                        <MissingValue />
                      )}
                    </span>
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
                  <TableCell key={`${metric.key}-comparison`} numeric>
                    <span className="text-muted tabular-nums">
                      {measured(formatMetric(metric.key, comparisonValue)) ?? <MissingValue />}
                    </span>
                  </TableCell>,
                  <TableCell key={`${metric.key}-difference`} numeric>
                    <span
                      className={cn(
                        'tabular-nums',
                        TONE_CLASS[differenceTone(metric.key, difference)],
                      )}
                    >
                      {measured(formatDifference(metric.key, difference)) ?? <MissingValue />}
                    </span>
                  </TableCell>,
                ];
              })}
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <Pager
        frame="table"
        range={{ from, to, total, noun: tab.noun }}
        pageSize={{ value: table.pageSize, onChange: table.setPageSize }}
        {...cursorControls(table, nextCursor)}
        busy={query.isFetching}
      />
    </Card>
  );
}
