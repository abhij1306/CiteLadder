'use client';

import { useMemo, useState } from 'react';

import { BusyBar } from '@/components/ui/busy-bar';
import { Card, CardContent } from '@/components/ui/card';
import { ReadError } from '@/components/ui/read-error';
import { Stack } from '@/components/ui/layout';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { splitPaneClasses } from '@/components/ui/workspace';
import { SourceDomainDetail } from '@/components/visibility/source-domain-detail';
import {
  DomainFilter,
  StandingFilter,
  TypeFilter,
  type PageStandingFilter,
} from '@/components/visibility/source-filters';
import { TopMoversCard, useSourceMovers } from '@/components/visibility/source-movers';
import { NearMissBody, useSourceNearMisses } from '@/components/visibility/source-near-misses';
import { SourceTableToolbar } from '@/components/visibility/source-toolbar';
import { TypesCard, UsageCard } from '@/components/visibility/source-charts';
import { SourceUrlDetail } from '@/components/visibility/source-url-detail';
import { SourcePaging } from '@/components/visibility/source-panels';
import {
  DomainTable,
  UrlTable,
  type SourceFilters,
  type SourceTableState,
} from '@/components/visibility/source-rows';
import { TABLE_DEFAULT_PAGE_SIZE, isTablePageSize, type TablePageSize } from '@/lib/config/tables';
import { optionalStringUrlCodec, setUrlParams, useUrlState } from '@/lib/navigation/url-state';
import {
  availableTypes,
  matchesSearch,
  sortItems,
  typeSlices,
  type SortState,
} from '@/lib/visibility/sources';
import {
  useSourceAnalysis,
  useSourceDomains,
  useSourceSeries,
  type SourceQueries,
} from '@/lib/visibility/use-source-analysis';

/** Which half of Sources is showing. Persisted so a link reopens the same one. */
const DIMENSIONS = [
  { value: 'domain', label: 'Domains' },
  { value: 'url', label: 'URLs' },
] as const;

/**
 * Sources: the domains and URLs the engines retrieved, and how much.
 *
 * Three levels, all driven by URL state so every one of them is linkable and
 * survives a reload: the inventory, one domain's pages, and one URL's own
 * page. They are not routes because the run / engine / period controls above
 * them narrow all three identically — a route would have had to re-establish
 * that selection, and the first drill-down to forget a filter would be
 * answering a different question from the table it was opened from.
 */
export function VisibilitySources({
  filters,
  queries,
}: Readonly<{ filters: SourceFilters; queries: SourceQueries }>) {
  const [openUrl, setOpenUrl] = useUrlState('source_url', optionalStringUrlCodec);
  // `source_view` goes with the domain: opening a second domain while its
  // Prompts tab was selected would otherwise land on that domain's Prompts,
  // which is not where a reader who clicked a row expects to be.
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
    <SourcesInventory
      filters={filters}
      queries={queries}
      onOpenUrl={setOpenUrl}
      onOpenDomain={setDomain}
    />
  );
}

/** The Domains / URLs inventory: the table, then the usage chart and type ring. */
function SourcesInventory({
  filters,
  queries,
  onOpenUrl,
  onOpenDomain,
}: Readonly<{
  filters: SourceFilters;
  queries: SourceQueries;
  onOpenUrl: (url: string) => void;
  onOpenDomain: (domain: string) => void;
}>) {
  // A different dimension is a different result set, so the offset cursor and
  // the type filter cannot carry over: page three of domains is not page three
  // of URLs, and `editorial` is not a page format.
  const [rawDimension, setDimension] = useUrlState('source_dim', optionalStringUrlCodec, {
    clearKeys: ['source_cursor', 'source_offset', 'source_as_of', 'source_type', 'source_standing'],
  });
  const dimension = rawDimension === 'url' ? 'url' : 'domain';
  return (
    // Deliberately NOT keyed on `dimension`. Remounting threw away the React
    // Query observer along with the panel, so `retainPreviousDataForScope` had
    // no previous data to hold and the table emptied to a skeleton on every
    // switch. The panel resets its own local state instead -- see `SourcesPanel`.
    <SourcesPanel
      dimension={dimension}
      onChangeDimension={(value) => setDimension(value === 'domain' ? null : value)}
      filters={filters}
      queries={queries}
      onOpenUrl={onOpenUrl}
      onOpenDomain={onOpenDomain}
    />
  );
}

/**
 * Every type in the selection, including while one of them is filtering.
 *
 * `category_totals` follows the type filter on purpose: the ring beside the
 * table prints the same `total_citations` its segments are shares of. The
 * filter's OPTIONS cannot follow it -- picking "Editorial" left exactly one
 * option, the control fell below its own minimum and unmounted, and there was
 * no way back to "All URL types". So the last unfiltered list is remembered,
 * exactly as `useSourceDomains` reads its own list unfiltered.
 */
function useTypeOptions({
  measured,
  filtered,
  loaded,
}: Readonly<{
  measured: ReturnType<typeof availableTypes>;
  filtered: boolean;
  loaded: boolean;
}>) {
  const [known, setKnown] = useState(measured);
  // Compared by token, not by identity: `availableTypes` builds a fresh array
  // every render, so an identity check would set state on every pass.
  const tokens = (list: ReturnType<typeof availableTypes>) =>
    list.map((type) => type.token).join('|');
  if (!filtered && loaded && tokens(known) !== tokens(measured)) setKnown(measured);
  // Nothing remembered means nothing was ever seen unfiltered -- which is what
  // a shared link that already carries `source_type` looks like on its first
  // render. Returning the empty list there left the control offering only
  // "All URL types" and no way to reach any other one.
  if (!filtered) return measured;
  return known.length ? known : measured;
}

export function SourcesPanel({
  dimension,
  onChangeDimension,
  filters,
  queries,
  domain = null,
  onOpenUrl,
  onOpenDomain,
}: Readonly<{
  dimension: 'domain' | 'url';
  onChangeDimension?: (value: string) => void;
  filters: SourceFilters;
  queries: SourceQueries;
  /** Set on a domain's own page, where the table lists only its pages. */
  domain?: string | null;
  onOpenUrl: (url: string) => void;
  /** Required whenever the domain dimension can be shown. */
  onOpenDomain?: (domain: string) => void;
}>) {
  const [offset] = useUrlState('source_offset', optionalStringUrlCodec);
  const [cursor] = useUrlState('source_cursor', optionalStringUrlCodec);
  const [asOf] = useUrlState('source_as_of', optionalStringUrlCodec);
  const [sourceType, setSourceType] = useUrlState('source_type', optionalStringUrlCodec, {
    clearKeys: ['source_cursor', 'source_offset', 'source_as_of'],
  });
  const { standingFilter, setStanding } = useStanding(dimension);
  const gapOnly = standingFilter === 'gap';
  const nearMiss = standingFilter === 'near_miss';
  const [pageSize, setPageSize] = useState<TablePageSize>(TABLE_DEFAULT_PAGE_SIZE);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<SortState>(null);
  // What the panel was showing last render, so a dimension change can clear the
  // controls that do not carry over -- page three of domains is not page three
  // of URLs, and `editorial` is not a page format. Done during render rather
  // than in an effect so the table never paints one frame of the old sort
  // applied to the new dimension.
  const [shownDimension, setShownDimension] = useState(dimension);
  if (shownDimension !== dimension) {
    setShownDimension(dimension);
    setPageSize(TABLE_DEFAULT_PAGE_SIZE);
    setSearch('');
    setSort(null);
  }

  // On a domain's own page the publisher is fixed by the route above, so the
  // control is not offered there — it would let a reader contradict the
  // breadcrumb they arrived through.
  const [pickedDomain, setPickedDomain] = useUrlState('source_pick', optionalStringUrlCodec, {
    clearKeys: ['source_cursor', 'source_offset', 'source_as_of'],
  });
  const domainOptions = useSourceDomains(filters, queries);
  const activeDomain = domain ?? pickedDomain;
  const scope = { dimension, domain: activeDomain, cursor, asOf, sourceType, gapOnly, pageSize };
  const { sourceQuery } = useSourceAnalysis(filters, queries, scope);
  const seriesQuery = useSourceSeries(filters, queries, {
    dimension,
    domain: activeDomain,
    sourceType,
  });
  const nearMissQuery = useSourceNearMisses(filters, queries, {
    enabled: nearMiss,
    limit: pageSize,
  });
  // Movement is an inventory question; a domain's own page has no peers to rank.
  const moversQuery = useSourceMovers(filters, queries, { dimension, enabled: !domain });
  const comparable = queries.visibilityQuery.data?.comparison?.status === 'comparable';
  const onPageSizeChange = (value: number) => {
    setPageSize(isTablePageSize(value) ? value : TABLE_DEFAULT_PAGE_SIZE);
    setUrlParams({ source_cursor: null, source_offset: null, source_as_of: null });
  };

  const data = sourceQuery.data;
  const types = useTypeOptions({
    measured: availableTypes(data?.category_totals, dimension),
    filtered: Boolean(sourceType),
    loaded: Boolean(data),
  });
  const slices = typeSlices(data?.category_totals, dimension);
  // Search and sort narrow what is LOADED. The footer reports the loaded count
  // against the server's total, so a reader can see the difference.
  const rows = useMemo(
    () =>
      sortItems(
        (data?.items ?? []).filter((item) => matchesSearch(item, search)),
        sort,
      ),
    [data, search, sort],
  );

  const onSort = (column: string) =>
    setSort((current) =>
      current?.column === column
        ? { column, direction: current.direction === 'desc' ? 'asc' : 'desc' }
        : { column, direction: 'desc' },
    );

  return (
    <Stack gap="workspace">
      {onChangeDimension ? (
        <SegmentedControl
          value={dimension}
          onChange={onChangeDimension}
          options={DIMENSIONS.map((entry) => ({ value: entry.value, label: entry.label }))}
          ariaLabel="Source dimension"
        />
      ) : null}

      <Card className="relative">
        <BusyBar active={sourceQuery.isFetching} label="Updating sources" />
        <SourceTableToolbar
          dimension={dimension}
          search={search}
          onSearch={setSearch}
          rows={rows}
          domain={activeDomain}
          domainControl={
            domain ? null : (
              <DomainFilter
                value={pickedDomain}
                options={domainOptions}
                onChange={setPickedDomain}
              />
            )
          }
          typeControl={
            <>
              <TypeFilter
                dimension={dimension}
                value={sourceType}
                options={types}
                onChange={setSourceType}
              />
              {dimension === 'url' ? (
                <StandingFilter value={standingFilter} onChange={setStanding} />
              ) : null}
            </>
          }
        />
        {/* A floor, with the footer pinned to the bottom of it. The card used
            to be exactly as tall as whatever it was showing, so a filter that
            returned three rows instead of ten pulled everything below it up
            by seven rows -- and then pushed it back down when the filter was
            cleared. The height is the toolbar plus a full page of rows. */}
        <CardContent className="flex min-h-[560px] flex-col justify-between p-0">
          {nearMiss ? (
            <NearMissBody
              query={nearMissQuery}
              pageSize={pageSize}
              onOpenUrl={onOpenUrl}
              onPageSizeChange={onPageSizeChange}
            />
          ) : (
            <>
              <SourceTable
                dimension={dimension}
                query={sourceQuery}
                rows={rows}
                sort={sort}
                onSort={onSort}
                onOpenUrl={onOpenUrl}
                onOpenDomain={onOpenDomain}
                pageSize={pageSize}
                narrowed={Boolean(search || sourceType)}
                searching={Boolean(search)}
                gapOnly={gapOnly}
              />
              <SourcePaging
                data={data}
                domain={activeDomain}
                dimension={dimension}
                offset={Math.max(0, Number.parseInt(offset ?? '0', 10) || 0)}
                pageSize={pageSize}
                busy={sourceQuery.isFetching}
                onPageSizeChange={onPageSizeChange}
              />
            </>
          )}
        </CardContent>
      </Card>

      {/* The table leads; the usage over time and the type mix explain it below. */}
      <div className={splitPaneClasses('main-aside')}>
        <UsageCard dimension={dimension} query={seriesQuery} />
        <TypesCard slices={slices} total={data?.total_citations ?? 0} query={sourceQuery} />
      </div>
      {domain ? null : (
        <TopMoversCard dimension={dimension} query={moversQuery} comparable={comparable} />
      )}
    </Stack>
  );
}

/** Only pages have a standing, so the standing filter applies to the URL table. */
function useStanding(dimension: 'domain' | 'url') {
  const [standing, setStanding] = useUrlState('source_standing', optionalStringUrlCodec, {
    clearKeys: ['source_cursor', 'source_offset', 'source_as_of'],
  });
  let standingFilter: PageStandingFilter = null;
  if (dimension === 'url' && (standing === 'gap' || standing === 'near_miss'))
    standingFilter = standing;
  return { standingFilter, setStanding };
}

/**
 * Which of the four things the table is doing right now.
 *
 * Four states, kept apart on purpose: nothing has been measured yet, the
 * filters exclude everything, the rows are on their way, and the read failed.
 * They are not interchangeable -- "no cited sources in this selection" is a
 * finding, "could not load sources" is a fault -- and a reader who cannot tell
 * them apart cannot tell whether to change the filter or retry.
 */
function tableState({
  query,
  rows,
  pageSize,
  narrowed,
  searching,
  gapOnly,
}: Readonly<{
  query: ReturnType<typeof useSourceAnalysis>['sourceQuery'];
  rows: ReturnType<typeof sortItems>;
  pageSize: number;
  narrowed: boolean;
  searching: boolean;
  gapOnly: boolean;
}>): SourceTableState {
  if (query.isLoading) return { kind: 'loading', rows: pageSize };
  if (rows.length) return { kind: 'rows' };
  if (searching) return { kind: 'empty', message: 'No sources on this page match your search.' };
  if (gapOnly)
    return {
      kind: 'empty',
      message: 'No read page in this selection lists competitors without you.',
    };
  if (narrowed) return { kind: 'empty', message: 'No sources of this type in this selection.' };
  return { kind: 'empty', message: 'No cited sources in this selection.' };
}

/** Whichever table the dimension calls for, carrying its own state inside it. */
function SourceTable({
  dimension,
  query,
  rows,
  sort,
  onSort,
  onOpenUrl,
  onOpenDomain,
  pageSize,
  narrowed,
  searching,
  gapOnly,
}: Readonly<{
  dimension: 'domain' | 'url';
  query: ReturnType<typeof useSourceAnalysis>['sourceQuery'];
  rows: ReturnType<typeof sortItems>;
  sort: SortState;
  onSort: (column: string) => void;
  onOpenUrl: (url: string) => void;
  onOpenDomain?: (domain: string) => void;
  pageSize: number;
  narrowed: boolean;
  searching: boolean;
  gapOnly: boolean;
}>) {
  // A failed read is the one state that has no table to fill: there are no
  // columns to be honest about, and leaving an empty grid under an error
  // presents a fault as a finding.
  if (query.isError) {
    return (
      <ReadError
        error={query.error}
        fallback="Could not load sources. Check your connection and try again."
        onRetry={() => void query.refetch()}
        pending={query.isFetching}
        className="m-[var(--card-padding)]"
      />
    );
  }
  const state = tableState({ query, rows, pageSize, narrowed, searching, gapOnly });
  const retrieval = query.data?.retrieval;
  return dimension === 'url' ? (
    <UrlTable
      rows={rows}
      sort={sort}
      onSort={onSort}
      onOpenUrl={onOpenUrl}
      retrieval={retrieval}
      state={state}
    />
  ) : (
    <DomainTable
      rows={rows}
      sort={sort}
      onSort={onSort}
      onOpenDomain={onOpenDomain}
      retrieval={retrieval}
      state={state}
    />
  );
}
