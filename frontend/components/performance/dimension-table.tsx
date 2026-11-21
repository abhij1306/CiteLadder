import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { DataTable, type DataTableColumn } from '@/components/ui/data-table';
import { Delta } from '@/components/ui/delta';
import { ClampText } from '@/components/ui/clamp-text';
import { TableCell, TableRow, UrlText } from '@/components/ui/table';
import { SearchX } from '@/lib/icons';
import { sharedOrigin } from '@/lib/format';
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
  dimensionTab,
  formatDimensionValue,
  formatMetric,
  metricDelta,
  metricDifference,
  sortDirection,
  sortKey,
  toggleSort,
  type PerformanceMetricKey,
} from '@/lib/performance/performance';
import { cn } from '@/lib/utils';

function orderableSort(
  sort: string,
  dimension: PerformanceDimension,
  displayed: readonly { key: PerformanceMetricKey }[],
): string {
  const key = sortKey(sort);
  if (key === DIMENSION_SORT_KEY) return sort;
  return displayed.some((card) => card.key === key) ? sort : defaultSort(dimension);
}

function dimensionColumns({
  dimension,
  header,
  metrics,
  activeSort,
  onSort,
  comparing,
  selectedLabel,
  compareLabel,
}: Readonly<{
  dimension: PerformanceDimension;
  header: string;
  metrics: readonly { key: PerformanceMetricKey; label: string }[];
  activeSort: string;
  onSort: (key: PerformanceMetricKey) => void;
  comparing: boolean;
  selectedLabel: string;
  compareLabel: string;
}>): DataTableColumn[] {
  return [
    { key: 'dimension', label: header, kind: dimension === 'page' ? 'url' : 'identity' },
    ...metrics.flatMap((metric): DataTableColumn[] => {
      const label = metric.label.replace(/^(Total|Average) /, '');
      const selected: DataTableColumn = {
        key: metric.key,
        label,
        kind: 'number',
        sort: {
          active: sortKey(activeSort) === metric.key,
          descending: sortDirection(activeSort) === 'descending',
          onSort: () => onSort(metric.key),
        },
        sublabel: comparing ? selectedLabel : undefined,
      };
      if (!comparing) return [selected];
      return [
        selected,
        {
          key: `${metric.key}-comparison`,
          label,
          kind: 'number',
          sublabel: compareLabel,
        },
        {
          key: `${metric.key}-difference`,
          label,
          kind: 'number',
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
        { workspaceId, projectId },
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
  measuredRows: number;
  selectedLabel: string;
  compareLabel: string;
  activeMetrics?: ReadonlySet<PerformanceMetricKey>;
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
        { workspaceId, projectId },
        tableParams(
          { snapshotId, compareSnapshotId },
          { dimension, sort: activeSort, cursor: request.cursor, size: request.limit },
        ),
      ),
    noun: tab.noun,
    loading: `Loading ${tab.noun}…`,
    subject: `the ${tab.noun}`,
    empty: () => ({
      kind: 'empty',
      icon: SearchX,
      heading: `No ${tab.noun} measured for this range`,
    }),
    enabled: !unavailable,
    total: (current) => current?.total_count ?? measuredRows,
  });

  const columns = dimensionColumns({
    dimension,
    header: tab.header,
    metrics: displayedMetrics,
    activeSort,
    onSort: (key) => setSort(toggleSort(activeSort, key)),
    comparing,
    selectedLabel,
    compareLabel,
  });
  if (unavailable) {
    return (
      <DataTable
        label={tab.header}
        columns={columns}
        reserveRows
        {...table}
        state={{
          kind: 'empty',
          icon: SearchX,
          heading: `No ${tab.noun} imported`,
          description: 'Not provided for a date range.',
        }}
      />
    );
  }

  const origin =
    dimension === 'page' ? sharedOrigin(page?.items.map((row) => row.display_value) ?? []) : null;
  return (
    <DataTable label={tab.header} columns={columns} reserveRows {...table}>
      {page?.items.map((row) => (
        <TableRow key={row.dimension_key}>
          <TableCell>
            {dimension === 'page' ? (
              <UrlText url={row.display_value} origin={origin} />
            ) : (
              <ClampText className={cn(dimension === 'day' && 'tabular-nums')}>
                {formatDimensionValue(dimension, row.display_value)}
              </ClampText>
            )}
          </TableCell>
          {displayedMetrics.flatMap((metric) => {
            const selectedCell = (
              <TableCell key={metric.key} numeric>
                {formatMetric(metric.key, row.metrics[metric.key])}
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
              <TableCell key={`${metric.key}-comparison`} numeric className="text-ink-2">
                {formatMetric(metric.key, comparisonValue)}
              </TableCell>,
              <TableCell key={`${metric.key}-difference`} numeric>
                <Delta {...metricDelta(metric.key, difference)} />
              </TableCell>,
            ];
          })}
        </TableRow>
      ))}
    </DataTable>
  );
}
