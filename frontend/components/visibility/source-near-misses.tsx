'use client';

import { useQuery } from '@tanstack/react-query';
import { Link2Off } from 'lucide-react';
import type { z } from 'zod';

import { DataTable, type DataTableColumn, type DataTableState } from '@/components/ui/data-table';
import type { FilterBarProps } from '@/components/ui/filter-bar';
import { Pressable } from '@/components/ui/pressable';
import { TableCell, TableRow } from '@/components/ui/table';
import { NumericCell, SourceName } from '@/components/visibility/source-cells';
import type { SourceFilters } from '@/components/visibility/source-rows';
import { queryKeys } from '@/lib/api/query-keys';
import { visibilityApi } from '@/lib/api/visibility';
import { engineLabel } from '@/lib/providers/catalog';
import { count, hostOf, pathOf, sinceLabel } from '@/lib/visibility/sources';
import { selectionParams, type SourceQueries } from '@/lib/visibility/use-source-analysis';
import type { visibilitySourceNearMissesSchema } from '@citeladder/contracts/visibility-evidence';

type NearMisses = z.infer<typeof visibilitySourceNearMissesSchema>;

/** Your pages an engine read and did not cite, over the same selection as the table. */
export function useSourceNearMisses(
  filters: SourceFilters,
  queries: SourceQueries,
  input: { enabled: boolean; limit: number },
) {
  const params = { ...selectionParams(filters, queries), limit: input.limit };
  return useQuery({
    queryKey: queryKeys.visibility.sourceNearMisses(queries.projectId ?? '', params),
    queryFn: ({ signal }) =>
      visibilityApi.getSourceNearMisses(queries.projectId!, params, {
        signal,
        workspaceId: queries.workspaceId,
      }),
    enabled: input.enabled && Boolean(queries.projectId && queries.activeRunId),
  });
}

function readHint(data: NearMisses | undefined) {
  const base =
    'Answers that read this page, counted over answers whose engine exposes what it read.';
  const unavailable = data?.unavailable_engines ?? [];
  return unavailable.length
    ? `${base} Not available for ${unavailable.map(engineLabel).join(', ')}.`
    : base;
}

function nearMissColumns(data: NearMisses | undefined): DataTableColumn[] {
  return [
    { key: 'page', label: 'Your page' },
    { key: 'read', label: 'Read in', width: 'figure', numeric: true, hint: readHint(data) },
    { key: 'cited', label: 'Cited in', width: 'figure', numeric: true },
    { key: 'missed', label: 'Not cited in', width: 'figure', numeric: true },
    { key: 'last', label: 'Last read', width: 'figure', numeric: true, desktopOnly: true },
  ];
}

function nearMissState(query: ReturnType<typeof useSourceNearMisses>): DataTableState | undefined {
  if (query.isError) {
    return {
      kind: 'error',
      error: query.error,
      fallback: 'Could not load your pages read but not cited. Try again.',
      onRetry: () => void query.refetch(),
      pending: query.isFetching,
    };
  }
  if (query.isLoading) return { kind: 'loading', label: 'Loading your pages read but not cited…' };
  const data = query.data;
  if (data?.items.length) return undefined;
  if (data && data.responses === 0)
    return {
      kind: 'empty',
      headingLevel: 3,
      icon: Link2Off,
      heading: 'No engine in this selection exposes the pages it read.',
    };
  return {
    kind: 'empty',
    headingLevel: 3,
    icon: Link2Off,
    heading: 'Every page of yours that an engine read, it also cited.',
  };
}

/**
 * The near-miss table, in the source table's place under the same toolbar:
 * a page that reached the engine and still lost the citation. Read and Cited
 * count answers whose engine exposes what it read. The list is the
 * most-missed pages up to the page size; it does not page further, but keeps
 * the same pager footer so switching to this view moves nothing.
 */
export function NearMissTable({
  query,
  pageSize,
  toolbar,
  onOpenUrl,
  onPageSizeChange,
}: Readonly<{
  query: ReturnType<typeof useSourceNearMisses>;
  pageSize: number;
  toolbar: FilterBarProps;
  onOpenUrl: (url: string) => void;
  onPageSizeChange: (value: number) => void;
}>) {
  const items = query.data?.items ?? [];
  const shown = items.length;
  return (
    <DataTable
      label="Your pages read but not cited"
      toolbar={toolbar}
      columns={nearMissColumns(query.data)}
      state={nearMissState(query)}
      pageSize={pageSize}
      rowCount={shown}
      busy={{ active: query.isFetching, label: 'Updating your pages read but not cited' }}
      pager={{
        range: {
          from: shown ? 1 : 0,
          to: shown,
          total: query.data ? shown : undefined,
          noun: 'pages',
        },
        pageSize: { value: pageSize, onChange: onPageSizeChange },
        canPrev: false,
        canNext: false,
        onPrev: () => undefined,
        onNext: () => undefined,
      }}
    >
      {items.map((row) => (
        <TableRow key={row.url_hash ?? row.url}>
          <TableCell>
            <Pressable
              onClick={() => onOpenUrl(row.url)}
              className="hover:text-accent-text flex max-w-full min-w-0 items-center transition-colors"
            >
              <SourceName
                name={row.title.trim() || pathOf(row.url)}
                host={hostOf(row.url)}
                secondary={row.title.trim() ? pathOf(row.url) : null}
              />
            </Pressable>
          </TableCell>
          <NumericCell value={count(row.retrieved)} />
          <NumericCell value={count(row.cited)} />
          <NumericCell value={count(row.retrieved - row.cited)} />
          <NumericCell value={sinceLabel(row.last_retrieved_at)} desktopOnly />
        </TableRow>
      ))}
    </DataTable>
  );
}
