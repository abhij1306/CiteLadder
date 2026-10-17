'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import { ProjectLink } from '@/components/layout/scoped-link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Drawer } from '@/components/ui/drawer';
import { FilterRow } from '@/components/ui/filter-row';
import { Pager } from '@/components/ui/pager';
import { ReadError, readErrorProps } from '@/components/ui/read-error';
import { SearchField } from '@/components/ui/search-field';
import { Skeleton } from '@/components/ui/skeleton';
import { TextLink } from '@/components/ui/text-link';
import { textRole } from '@/components/ui/typography';
import { agentHandoffHref, type HandoffInput } from '@/lib/agent/handoff';
import { useAgentPanelSeed } from '@/lib/agent/panel-context';
import { httpErrorStatus } from '@/lib/api/errors';
import {
  searchIntelligenceApi,
  type SearchIntelligenceDataset,
  type SearchIntelligenceRow,
} from '@/lib/api/search-intelligence';
import { searchIntelligenceKeys } from '@/lib/api/query-keys/search-intelligence';
import { useProjectContext } from '@/lib/project/project-context';
import { cursorControls, pageRange, useCursorTable } from '@/lib/table/use-cursor-table';
import { MissingValue } from '@/components/ui/unavailable-value';
import { useDisplayTimeZone } from '@/lib/display-timezone';
import { evidenceFields, searchNumber } from './search-intelligence-format';
import {
  KEYWORD_DATASET_KINDS,
  SEARCH_COLUMNS_BY_KIND,
  searchScopeLabel,
} from '@/lib/config/search-intelligence';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { SearchIntelligenceExport } from './search-intelligence-export';
import { SearchIntelligenceRowsTable } from './search-intelligence-rows-table';

function useDatasetRows(
  datasetId: string,
  projectId: string | undefined,
  workspaceId: string | undefined,
  params: {
    cursor?: string;
    limit: number;
    sort: string;
    direction: 'asc' | 'desc';
    search: string;
    min_volume?: number;
  },
) {
  const scope = searchIntelligenceKeys.dataset(workspaceId, projectId, datasetId);
  const query = useQuery({
    queryKey: [...scope, params],
    queryFn: ({ signal }) =>
      searchIntelligenceApi.rows(projectId!, datasetId, { signal, workspaceId }, params),
    enabled: Boolean(projectId && workspaceId),
    // A failed interactive sort/filter must settle promptly so the empty
    // placeholder is replaced by the read error, not held through retries.
    retry: false,
    placeholderData: (previousPage, previousQuery) => {
      if (!previousPage || !previousQuery) return undefined;
      const previousScope = previousQuery.queryKey.slice(0, scope.length);
      if (JSON.stringify(previousScope) !== JSON.stringify(scope)) return undefined;
      return { dataset: previousPage.dataset, rows: [], next_cursor: null };
    },
  });
  const accessFailure =
    query.isError && [401, 403, 404].includes(httpErrorStatus(query.error) ?? 0);
  const page = accessFailure ? undefined : query.data;
  return { query, page };
}

export function SearchIntelligenceDatasetView({
  dataset,
  title = 'Ranking keywords',
  onExpand,
}: Readonly<{ dataset: SearchIntelligenceDataset; title?: string; onExpand?: () => void }>) {
  const { activeProject } = useProjectContext();
  const [selected, setSelected] = useState<SearchIntelligenceRow | null>(null);
  const [filter, setFilter] = useState('');
  const [minVolume, setMinVolume] = useState('');
  const [intent, setIntent] = useState('');
  const [order, setOrder] = useState<{ sort: string; direction: 'asc' | 'desc' }>({
    sort: 'id',
    direction: 'asc',
  });
  const table = useCursorTable(
    `${activeProject?.workspace_id}:${activeProject?.id}:${dataset.id}:${order.sort}:${order.direction}:${filter}:${minVolume}:${intent}`,
  );
  const params = {
    cursor: table.cursor,
    limit: table.pageSize,
    ...order,
    search: filter,
    intent,
    min_volume: minVolume === '' ? undefined : Number(minVolume),
  };
  const { query, page } = useDatasetRows(
    dataset.id,
    activeProject?.id,
    activeProject?.workspace_id,
    params,
  );
  useRowsPanelSeed(dataset.id, selected, page?.rows, title);
  const keywordDataset = KEYWORD_DATASET_KINDS.includes(dataset.dataset_kind);
  if (query.isPending && !page) return <Skeleton className="h-80 w-full" />;
  if (!page)
    return <ReadError {...readErrorProps(query)} fallback="Dataset rows could not be loaded." />;
  if (!dataset.unique_rows_saved && !page.rows.length)
    return <EmptyDataset dataset={dataset} title={title} />;
  const rows = page.rows;
  const range = pageRange(table.page, table.pageSize, rows.length);
  return (
    <>
      <Card className="min-w-0">
        <DatasetHeader dataset={dataset} title={title} />
        <CardContent flush>
          <FilterRow
            className="border-border-subtle min-h-14 border-b px-[var(--table-cell-padding-x)] py-2"
            search={
              <SearchField
                value={filter}
                onValueChange={setFilter}
                aria-label="Filter saved results"
                placeholder="Filter saved results"
              />
            }
            actions={
              <>
                <SearchIntelligenceExport dataset={dataset} params={params} />
                {rows.length > 0 ? (
                  <Button size="sm" variant="secondary" asChild>
                    <ProjectLink href={agentHandoffHref(rowsHandoff(dataset.id, rows, title))}>
                      Ask agent
                    </ProjectLink>
                  </Button>
                ) : null}
                <DepthReviewAction onExpand={onExpand} />
              </>
            }
          >
            <KeywordFilters
              enabled={keywordDataset}
              minVolume={minVolume}
              setMinVolume={setMinVolume}
              intent={intent}
              setIntent={setIntent}
            />
          </FilterRow>
          {query.isError ? (
            <ReadError
              {...readErrorProps(query)}
              fallback="Saved rows could not be updated."
              className="px-[var(--table-cell-padding-x)] py-2"
            />
          ) : null}
          <div
            aria-busy={query.isFetching}
            style={{
              minHeight: `calc(var(--table-header-height) + ${table.pageSize} * var(--table-row-height))`,
            }}
          >
            <SearchIntelligenceRowsTable
              kind={dataset.dataset_kind}
              rows={rows}
              order={order}
              onSelect={setSelected}
              onSort={(sort) => {
                setOrder({
                  sort,
                  direction: order.sort === sort && order.direction === 'asc' ? 'desc' : 'asc',
                });
                table.reset();
              }}
            />
          </div>
          <output
            className={textRole(
              'caption',
              'flex h-6 items-center px-[var(--table-cell-padding-x)]',
            )}
            aria-live="polite"
          >
            {query.isFetching ? 'Updating saved rows…' : `${rows.length} rows shown`}
          </output>
          <Pager
            frame="table"
            range={{ ...range, total: filteredSavedCount(page.dataset), noun: 'evidence rows' }}
            pageSize={{ value: table.pageSize, onChange: table.setPageSize }}
            {...cursorControls(table, page.next_cursor)}
            busy={query.isFetching}
          />
        </CardContent>
      </Card>
      <EvidenceDrawer selected={selected} onClose={() => setSelected(null)} />
    </>
  );
}

/** The agent panel starts from the open row, or else the rows on this page. */
function useRowsPanelSeed(
  datasetId: string,
  selected: SearchIntelligenceRow | null,
  pageRows: readonly SearchIntelligenceRow[] | undefined,
  title?: string,
): void {
  const rows = selected ? [selected] : (pageRows ?? []);
  useAgentPanelSeed(rows.length > 0 ? rowsHandoff(datasetId, rows, title) : null);
}

/**
 * Ask agent about saved rows. Only their ids travel; the server re-reads and
 * authorizes them. A table page never exceeds the 100-row reference cap.
 */
function rowsHandoff(
  datasetId: string,
  rows: readonly SearchIntelligenceRow[],
  title?: string,
): HandoffInput {
  const [first] = rows;
  const subject =
    rows.length === 1 && first
      ? `the Search Intelligence row for "${first.keyword || first.url || first.domain}"`
      : `these ${rows.length} ${title ?? 'Search Intelligence'} rows`;
  return {
    searchIntelligence: { datasetId, rowIds: rows.map((row) => row.id) },
    prompt: `Help me act on ${subject}.`,
  };
}

function EvidenceDrawer({
  selected,
  onClose,
}: Readonly<{ selected: SearchIntelligenceRow | null; onClose: () => void }>) {
  return (
    <Drawer
      open={selected !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title="Row details"
      description="What the provider reported for this result when it was saved."
    >
      {selected ? (
        <div className="flex flex-wrap gap-2">
          {selected.action_id ? (
            <Button size="sm" asChild className="w-fit">
              <ProjectLink href={`/agent/actions/${selected.action_id}`}>Open Action</ProjectLink>
            </Button>
          ) : null}
          <Button size="sm" variant="secondary" asChild className="w-fit">
            <ProjectLink href={agentHandoffHref(rowsHandoff(selected.dataset_id, [selected]))}>
              Ask agent about this row
            </ProjectLink>
          </Button>
        </div>
      ) : null}
      {selected?.row_kind === 'citation_match' &&
      typeof selected.auxiliary.audit_id === 'string' ? (
        <TextLink
          href={`/visibility?tab=sources&audit=${selected.auxiliary.audit_id}`}
          className="w-fit"
        >
          View in Sources
        </TextLink>
      ) : null}
      {selected ? <RowFields row={selected} /> : null}
    </Drawer>
  );
}

function RowFields({ row }: Readonly<{ row: SearchIntelligenceRow }>) {
  const timeZone = useDisplayTimeZone();
  const labels = Object.fromEntries(
    (SEARCH_COLUMNS_BY_KIND[row.row_kind] ?? []).map((column) => [column.field, column.label]),
  );
  return (
    <dl className="type-body grid gap-3">
      {evidenceFields(row, labels, timeZone).map((field) => (
        <div key={field.key} className="border-border-subtle grid gap-1 border-b pb-2">
          <dt className="text-muted">{field.label}</dt>
          <dd className="break-all">{field.value ?? <MissingValue />}</dd>
        </div>
      ))}
    </dl>
  );
}

function EmptyDataset({
  dataset,
  title,
}: Readonly<{ dataset: SearchIntelligenceDataset; title: string }>) {
  return (
    <Card>
      <CardHeader bordered>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-2 py-[var(--workspace-gap)]">
        <p className={textRole('itemTitle')}>
          {dataset.coverage === 'unknown'
            ? 'Provider evidence is unavailable for this saved scope.'
            : 'The provider returned no data for this saved scope.'}
        </p>
        <p className={textRole('body')}>
          Requests can incur charges even when no results are returned. Check the website and market
          before reviewing another analysis.
        </p>
        <p className={textRole('caption')}>
          {dataset.target_hostname}
          {dataset.comparison_origin
            ? ` · compared with ${new URL(dataset.comparison_origin).hostname}`
            : ''}{' '}
          · 0 saved rows
        </p>
      </CardContent>
    </Card>
  );
}

function KeywordFilters({
  enabled,
  minVolume,
  setMinVolume,
  intent,
  setIntent,
}: Readonly<{
  enabled: boolean;
  minVolume: string;
  setMinVolume: (value: string) => void;
  intent: string;
  setIntent: (value: string) => void;
}>) {
  if (!enabled) return null;
  return (
    <>
      <Input
        aria-label="Minimum search volume"
        placeholder="Min. search volume"
        className="w-40"
        type="number"
        min={0}
        value={minVolume}
        step={1}
        onChange={(event) => {
          const value = event.target.value;
          if (value === '' || (Number.isInteger(Number(value)) && Number(value) >= 0))
            setMinVolume(value);
        }}
      />
      <Select
        ariaLabel="Saved keyword intent"
        value={intent || 'any'}
        onValueChange={(value) => setIntent(value === 'any' ? '' : value)}
        options={['any', 'informational', 'commercial', 'navigational', 'transactional'].map(
          (value) => ({ value, label: value === 'any' ? 'Any intent' : value }),
        )}
      />
    </>
  );
}

function filteredSavedCount(dataset: SearchIntelligenceDataset) {
  return typeof dataset.filtered_saved_count === 'number'
    ? dataset.filtered_saved_count
    : dataset.unique_rows_saved;
}

function DepthReviewAction({ onExpand }: Readonly<{ onExpand?: () => void }>) {
  return onExpand ? (
    <Button variant="ghost" size="sm" onClick={onExpand}>
      Review depth
    </Button>
  ) : null;
}

function DatasetHeader({
  dataset,
  title,
}: Readonly<{ dataset: SearchIntelligenceDataset; title: string }>) {
  return (
    <CardHeader bordered>
      <CardTitle>{title}</CardTitle>
      <p className={textRole('caption')}>
        {searchNumber(dataset.unique_rows_saved)} saved rows
        {dataset.provider_total !== null
          ? ` of ${searchNumber(dataset.provider_total)} available`
          : ''}
        {' · '}
        {dataset.target_hostname}
        {' · '}
        {searchScopeLabel(dataset.research_scope)}
        {dataset.truncated ? ' · truncated' : ''}
      </p>
      {dataset.dataset_kind === 'missing_keywords' ? (
        <p className={textRole('caption')}>
          Gaps with real search volume where a competitor ranks in the top 10 become{' '}
          <TextLink href="/agent/actions">Actions</TextLink>. Open a row to see its Action.
        </p>
      ) : null}
    </CardHeader>
  );
}
