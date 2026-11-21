import { useQuery } from '@tanstack/react-query';
import type { z } from 'zod';

import { DataTable, type DataTableColumn, type DataTableState } from '@/components/ui/data-table';
import { readErrorProps } from '@/components/ui/notice';
import type { FilterBarProps } from '@/components/ui/filter-bar';
import { TableCell, TableRow } from '@/components/ui/table';
import { NumericCell, SourceName } from '@/components/visibility/source-cells';
import { OpenSource, type SourceFilters } from '@/components/visibility/source-rows';
import { Link2Off } from '@/lib/icons';
import { retainPreviousDataForScope } from '@/lib/api/query-client';
import { visibilityQueries } from '@/lib/api/visibility-queries';
import { useEngineCatalog } from '@/lib/providers/engines';
import { count, hostOf, pathOf, sinceLabel } from '@/lib/visibility/sources';
import { topicSelectionParams, type SourceQueries } from '@/lib/visibility/use-source-analysis';
import type { visibilitySourceNearMissesSchema } from '@citeladder/contracts/visibility-evidence';

type NearMisses = z.infer<typeof visibilitySourceNearMissesSchema>;

export function useSourceNearMisses(
  filters: SourceFilters,
  queries: SourceQueries,
  input: { enabled: boolean; limit: number },
) {
  const params = { ...topicSelectionParams(filters, queries), limit: input.limit };
  const enabled = input.enabled && Boolean(queries.activeRunId);
  return useQuery({
    ...visibilityQueries.sourceNearMisses(
      { workspaceId: queries.workspaceId, projectId: queries.projectId },
      params,
    ),
    enabled,
    placeholderData: enabled
      ? (data, previous) => retainPreviousDataForScope(queries.projectId, data, previous)
      : undefined,
  });
}

type EngineLabel = (key: string) => string;

function readHint(data: NearMisses | undefined, engineLabel: EngineLabel) {
  const base =
    'Answers that read this page, counted over answers whose engine exposes what it read.';
  const unavailable = data?.unavailable_engines ?? [];
  return unavailable.length
    ? `${base} Not available for ${unavailable.map(engineLabel).join(', ')}.`
    : base;
}

function nearMissColumns(
  data: NearMisses | undefined,
  engineLabel: EngineLabel,
): DataTableColumn[] {
  return [
    { key: 'page', label: 'Your page' },
    {
      key: 'read',
      label: 'Read in',
      width: 'figure',
      kind: 'number',
      hint: readHint(data, engineLabel),
    },
    { key: 'cited', label: 'Cited in', width: 'figure', kind: 'number' },
    { key: 'missed', label: 'Not cited in', width: 'figure', kind: 'number' },
    { key: 'last', label: 'Last read', width: 'figure', kind: 'date', desktopOnly: true },
  ];
}

function nearMissState(
  query: ReturnType<typeof useSourceNearMisses>,
  engineLabel: EngineLabel,
): DataTableState | undefined {
  if (query.isError) {
    return {
      kind: 'error',
      ...readErrorProps(query),
      title: "Couldn't load your pages read but not cited",
      fallback: 'The request failed or timed out.',
    };
  }
  const data = query.data;
  if (!data) return { kind: 'loading', label: 'Loading your pages read but not cited…' };
  if (data.items.length) return undefined;
  if (data.responses === 0)
    return {
      kind: 'empty',
      headingLevel: 3,
      icon: Link2Off,
      heading: 'No engine in this selection exposes the pages it read',
    };
  const unavailable = data.unavailable_engines;
  return {
    kind: 'empty',
    headingLevel: 3,
    icon: Link2Off,
    heading: 'Every page of yours that an engine read, it also cited',
    description: unavailable.length
      ? `Unknown for ${unavailable.map(engineLabel).join(', ')}`
      : undefined,
  };
}

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
  const engines = useEngineCatalog();
  const items = query.data?.items ?? [];
  const shown = items.length;
  return (
    <DataTable
      label="Your pages read but not cited"
      toolbar={toolbar}
      columns={nearMissColumns(query.data, engines.label)}
      state={nearMissState(query, engines.label)}
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
            <OpenSource onOpen={() => onOpenUrl(row.url)}>
              <SourceName
                name={row.title.trim() || pathOf(row.url)}
                host={hostOf(row.url)}
                secondary={row.title.trim() ? pathOf(row.url) : null}
              />
            </OpenSource>
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
