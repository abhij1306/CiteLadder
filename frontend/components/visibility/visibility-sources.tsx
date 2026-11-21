import { useMemo, useState } from 'react';

import { AppGrid } from '@/components/ui/app-grid';
import type { DataTableState } from '@/components/ui/data-table';
import { readErrorProps } from '@/components/ui/notice';
import { Stack } from '@/components/ui/layout';
import { SourceDomainDetail } from '@/components/visibility/source-domain-detail';
import { TopMoversCard, useSourceMovers } from '@/components/visibility/source-movers';
import { NearMissTable, useSourceNearMisses } from '@/components/visibility/source-near-misses';
import { sourceTableToolbar } from '@/components/visibility/source-toolbar';
import { TypesCard, UsageCard } from '@/components/visibility/source-charts';
import { SourceUrlDetail } from '@/components/visibility/source-url-detail';
import { sourcePager } from '@/components/visibility/source-panels';
import {
  DomainTable,
  UrlTable,
  type SourceFilters,
  type SourceTableFrame,
} from '@/components/visibility/source-rows';
import { Globe } from '@/lib/icons';
import { TABLE_DEFAULT_PAGE_SIZE, isTablePageSize, type TablePageSize } from '@/lib/config/tables';
import type { SourceTab } from '@/lib/visibility/dashboard';
import { optionalStringUrlCodec, setUrlParams, useUrlState } from '@/lib/navigation/url-state';
import {
  matchesSearch,
  SOURCE_SORT_CODEC,
  sortItems,
  typeSlices,
  type SortState,
} from '@/lib/visibility/sources';
import {
  useSourceAnalysis,
  useSourceSeries,
  type SourceQueries,
} from '@/lib/visibility/use-source-analysis';

export function VisibilitySources({
  tab,
  filters,
  queries,
}: Readonly<{ tab: SourceTab; filters: SourceFilters; queries: SourceQueries }>) {
  const [openUrl, setOpenUrl] = useUrlState('source_url', optionalStringUrlCodec);
  const [domain, setDomain] = useUrlState('source_domain', optionalStringUrlCodec, {
    clearKeys: ['source_cursor', 'source_offset', 'source_as_of', 'source_url', 'source_view'],
  });

  if (openUrl) {
    return (
      <SourceUrlDetail
        url={openUrl}
        domain={domain}
        filters={filters}
        queries={queries}
        onBack={() => setOpenUrl(null)}
        onOpenInventory={() => {
          setOpenUrl(null);
          setDomain(null);
        }}
      />
    );
  }
  if (domain) {
    return (
      <SourceDomainDetail
        domain={domain}
        filters={filters}
        queries={queries}
        onBack={() => setDomain(null)}
        onOpenUrl={setOpenUrl}
      />
    );
  }
  return (
    // Deliberately NOT keyed on the tab. Remounting threw away the React Query
    // observer along with the panel, so `retainPreviousDataForScope` had no
    // previous data to hold and the table emptied to a skeleton on every
    // switch. The panel resets its own local state instead.
    <SourcesPanel
      dimension={tab === 'domains' ? 'domain' : 'url'}
      readNotCited={tab === 'read-not-cited'}
      filters={filters}
      queries={queries}
      onOpenUrl={setOpenUrl}
      onOpenDomain={setDomain}
    />
  );
}

export function SourcesPanel({
  dimension,
  filters,
  queries,
  domain = null,
  onOpenUrl,
  onOpenDomain,
  readNotCited = false,
}: Readonly<{
  dimension: 'domain' | 'url';
  filters: SourceFilters;
  queries: SourceQueries;
  domain?: string | null;
  onOpenUrl: (url: string) => void;
  onOpenDomain?: (domain: string) => void;
  readNotCited?: boolean;
}>) {
  const [offset] = useUrlState('source_offset', optionalStringUrlCodec);
  const [cursor] = useUrlState('source_cursor', optionalStringUrlCodec);
  const [asOf] = useUrlState('source_as_of', optionalStringUrlCodec);
  const [sourceType] = useUrlState('source_type', optionalStringUrlCodec);
  const gapOnly = useGapOnly(dimension, readNotCited);
  const [pageSize, setPageSize] = useState<TablePageSize>(TABLE_DEFAULT_PAGE_SIZE);
  const [search, setSearch] = useState('');
  const [storedSort, setStoredSort] = useUrlState('source_sort', SOURCE_SORT_CODEC);
  const sort: SortState = storedSort?.dimension === dimension ? storedSort.sort : null;
  const [shownDimension, setShownDimension] = useState(dimension);
  if (shownDimension !== dimension) {
    setShownDimension(dimension);
    setPageSize(TABLE_DEFAULT_PAGE_SIZE);
    setSearch('');
  }

  const [pickedDomain] = useUrlState('source_pick', optionalStringUrlCodec);
  const activeDomain = domain ?? (dimension === 'url' ? pickedDomain : null);
  const scope = { dimension, domain: activeDomain, cursor, asOf, sourceType, gapOnly, pageSize };
  const { sourceQuery } = useSourceAnalysis(filters, queries, scope);
  const seriesQuery = useSourceSeries(filters, queries, {
    dimension,
    domain: activeDomain,
    sourceType,
    enabled: !readNotCited,
  });
  const nearMissQuery = useSourceNearMisses(filters, queries, {
    enabled: readNotCited,
    limit: pageSize,
  });
  const moversQuery = useSourceMovers(filters, queries, { dimension, enabled: !domain });
  const comparable = queries.visibilityQuery.data?.comparison?.status === 'comparable';
  const onPageSizeChange = (value: number) => {
    setPageSize(isTablePageSize(value) ? value : TABLE_DEFAULT_PAGE_SIZE);
    setUrlParams({ source_cursor: null, source_offset: null, source_as_of: null });
  };

  const data = sourceQuery.data;
  const slices = typeSlices(data?.category_totals, dimension);
  const rows = useMemo(
    () =>
      sortItems(
        (data?.items ?? []).filter((item) => matchesSearch(item, search)),
        sort,
      ),
    [data, search, sort],
  );

  const onSort = (column: string) =>
    setStoredSort({
      dimension,
      sort:
        sort?.column === column
          ? { column, direction: sort.direction === 'desc' ? 'asc' : 'desc' }
          : { column, direction: 'desc' },
    });

  const toolbar = sourceTableToolbar({
    dimension,
    search,
    onSearch: setSearch,
    rows,
    domain: activeDomain,
  });
  const tableAnswered = answered(readNotCited ? nearMissQuery : sourceQuery);

  return (
    <Stack gap="workspace">
      {readNotCited ? (
        <NearMissTable
          query={nearMissQuery}
          pageSize={pageSize}
          toolbar={toolbar}
          onOpenUrl={onOpenUrl}
          onPageSizeChange={onPageSizeChange}
        />
      ) : (
        <SourceTable
          dimension={dimension}
          query={sourceQuery}
          rows={rows}
          sort={sort}
          onSort={onSort}
          onOpenUrl={onOpenUrl}
          onOpenDomain={onOpenDomain}
          frame={{
            toolbar,
            pageSize,
            busy: { active: sourceQuery.isFetching, label: 'Updating sources' },
            state: tableState({
              query: sourceQuery,
              rows,
              narrowed: Boolean(search || sourceType),
              searching: Boolean(search),
              gapOnly,
            }),
            pager: sourcePager({
              data,
              domain: activeDomain,
              dimension,
              offset: pageOffset(offset),
              pageSize,
              busy: sourceQuery.isFetching,
              onPageSizeChange,
            }),
          }}
        />
      )}

      {tableAnswered ? (
        <>
          {readNotCited ? null : (
            <AppGrid layout="main-aside">
              <UsageCard dimension={dimension} query={seriesQuery} />
              <TypesCard slices={slices} total={data?.total_citations ?? 0} query={sourceQuery} />
            </AppGrid>
          )}
          {domain ? null : (
            <TopMoversCard dimension={dimension} query={moversQuery} comparable={comparable} />
          )}
        </>
      ) : null}
    </Stack>
  );
}

function answered(query: Readonly<{ data: unknown; isError: boolean }>): boolean {
  return query.data !== undefined || query.isError;
}

function pageOffset(raw: string | null): number {
  return Math.max(0, Number.parseInt(raw ?? '0', 10) || 0);
}

function useGapOnly(dimension: 'domain' | 'url', readNotCited: boolean) {
  const [standing] = useUrlState('source_standing', optionalStringUrlCodec);
  return dimension === 'url' && !readNotCited && standing === 'gap';
}

function tableState({
  query,
  rows,
  narrowed,
  searching,
  gapOnly,
}: Readonly<{
  query: ReturnType<typeof useSourceAnalysis>['sourceQuery'];
  rows: ReturnType<typeof sortItems>;
  narrowed: boolean;
  searching: boolean;
  gapOnly: boolean;
}>): DataTableState | undefined {
  if (query.isError) {
    return {
      kind: 'error',
      ...readErrorProps(query),
      title: "Couldn't load the sources",
      fallback: 'Check your connection and try again.',
    };
  }
  if (!query.data) return { kind: 'loading', label: 'Loading sources…' };
  if (rows.length) return undefined;
  return {
    kind: 'empty',
    headingLevel: 3,
    icon: Globe,
    heading: emptyHeading(searching, gapOnly, narrowed),
  };
}

function emptyHeading(searching: boolean, gapOnly: boolean, narrowed: boolean): string {
  if (searching) return 'No sources on this page match your search';
  if (gapOnly) return 'No read page in this selection lists competitors without you';
  if (narrowed) return 'No sources of this type in this selection';
  return 'No cited sources in this selection';
}

function SourceTable({
  dimension,
  query,
  rows,
  sort,
  onSort,
  onOpenUrl,
  onOpenDomain,
  frame,
}: Readonly<{
  dimension: 'domain' | 'url';
  query: ReturnType<typeof useSourceAnalysis>['sourceQuery'];
  rows: ReturnType<typeof sortItems>;
  sort: SortState;
  onSort: (column: string) => void;
  onOpenUrl: (url: string) => void;
  onOpenDomain?: (domain: string) => void;
  frame: SourceTableFrame;
}>) {
  const retrieval = query.data?.retrieval;
  return dimension === 'url' ? (
    <UrlTable
      rows={rows}
      sort={sort}
      onSort={onSort}
      onOpenUrl={onOpenUrl}
      retrieval={retrieval}
      frame={frame}
    />
  ) : (
    <DomainTable
      rows={rows}
      sort={sort}
      onSort={onSort}
      onOpenDomain={onOpenDomain}
      retrieval={retrieval}
      frame={frame}
    />
  );
}
