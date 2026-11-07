'use client';

import { useState } from 'react';
import { SearchX } from 'lucide-react';

import { ProjectLink } from '@/components/layout/scoped-link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DataTable } from '@/components/ui/data-table';
import { Drawer } from '@/components/ui/drawer';
import { Inline, Stack } from '@/components/ui/layout';
import { ledgerClasses, ledgerItemClasses } from '@/components/ui/workspace';
import { SearchField } from '@/components/ui/search-field';
import { TextLink } from '@/components/ui/text-link';
import { textRole } from '@/components/ui/typography';
import { agentHandoffHref, type HandoffInput } from '@/lib/agent/handoff';
import { useAgentPanelSeed } from '@/lib/agent/panel-context';
import {
  searchIntelligenceQueries,
  type SearchIntelligenceDataset,
  type SearchIntelligenceRow,
} from '@/lib/api/search-intelligence';
import { useProjectContext } from '@/lib/project/project-context';
import { useCursorTableQuery } from '@/lib/table/use-cursor-table-query';
import { MissingValue } from '@/components/ui/unavailable-value';
import { useDisplayTimeZone } from '@/lib/display-timezone';
import { evidenceFields, searchNumber } from './search-intelligence-format';
import { searchDatasetTraits } from '@citeladder/contracts/search-intelligence';
import { SEARCH_COLUMNS_BY_KIND, searchScopeLabel } from '@/lib/config/search-intelligence';
import { FilterField } from '@/components/ui/filter-bar';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { SearchIntelligenceExport } from './search-intelligence-export';
import {
  SearchIntelligenceRows,
  searchIntelligenceColumns,
} from './search-intelligence-rows-table';

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
  const filters = {
    ...order,
    search: filter,
    intent,
    min_volume: minVolume === '' ? undefined : Number(minVolume),
  };
  const projectId = activeProject?.id ?? null;
  const hasRows = dataset.unique_rows_saved > 0;
  // A sort or filter edit restarts from the first page: the server binds the
  // cursor to them. A page turn or a filter edit keeps the rows and the pager
  // on screen until the next rows land; the first load, a failed read and an
  // empty view draw inside the table at its full height.
  const { query, page, table } = useCursorTableQuery({
    workspaceId: activeProject?.workspace_id ?? null,
    scopeId: dataset.id,
    scope: filters,
    query: (request) =>
      searchIntelligenceQueries.datasetRows(
        activeProject?.workspace_id ?? '',
        projectId ?? '',
        dataset.id,
        { ...filters, ...request },
      ),
    noun: 'evidence rows',
    loading: 'Loading saved rows…',
    error: 'Saved rows could not be loaded.',
    empty: () => ({
      kind: 'empty',
      icon: SearchX,
      heading: 'No saved rows match this view',
      headingLevel: 3,
    }),
    // A dataset that saved nothing has no rows to read.
    enabled: hasRows,
    total: (current) => (current ? filteredSavedCount(current.dataset) : undefined),
  });
  const rows = page?.items ?? [];
  useRowsPanelSeed(dataset.id, selected, page?.items, title);
  const keywordDataset = Boolean(searchDatasetTraits(dataset.dataset_kind)?.keyword);
  if (!hasRows) return <EmptyDataset dataset={dataset} title={title} />;
  return (
    <>
      <DataTable
        title={title}
        toolbar={{
          search: (
            <SearchField
              value={filter}
              onValueChange={setFilter}
              aria-label="Filter saved results"
              placeholder="Filter saved results"
            />
          ),
          filters: (
            <KeywordFilters
              enabled={keywordDataset}
              minVolume={minVolume}
              setMinVolume={setMinVolume}
              intent={intent}
              setIntent={setIntent}
            />
          ),
          status: query.isFetching ? 'Updating saved rows…' : `${rows.length} rows shown`,
          actions: (
            <>
              <SearchIntelligenceExport dataset={dataset} params={filters} />
              {rows.length > 0 ? (
                <Button variant="secondary" asChild>
                  <ProjectLink href={agentHandoffHref(rowsHandoff(dataset.id, rows, title))}>
                    Ask agent
                  </ProjectLink>
                </Button>
              ) : null}
              <DepthReviewAction onExpand={onExpand} />
            </>
          ),
        }}
        columns={searchIntelligenceColumns({
          kind: dataset.dataset_kind,
          order,
          onSort: (sort) =>
            setOrder({
              sort,
              direction: order.sort === sort && order.direction === 'asc' ? 'desc' : 'asc',
            }),
        })}
        minWidth={dataset.dataset_kind === 'ranking_keywords' ? 'xl' : 'lg'}
        {...table}
        footer={<DatasetSummary dataset={dataset} />}
      >
        <SearchIntelligenceRows kind={dataset.dataset_kind} rows={rows} onSelect={setSelected} />
      </DataTable>
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
      ? `the Keyword Research row for "${first.keyword || first.url || first.domain}"`
      : `these ${rows.length} ${title ?? 'Keyword Research'} rows`;
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
        <Inline className="flex-wrap">
          {selected.action_id ? (
            <Button variant="primary" asChild className="w-fit">
              <ProjectLink href={`/agent/actions/${selected.action_id}`}>Open Action</ProjectLink>
            </Button>
          ) : null}
          <Button variant="secondary" asChild className="w-fit">
            <ProjectLink href={agentHandoffHref(rowsHandoff(selected.dataset_id, [selected]))}>
              Ask agent about this row
            </ProjectLink>
          </Button>
        </Inline>
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
    <dl className={ledgerClasses('open', 'type-body')}>
      {evidenceFields(row, labels, timeZone).map((field) => (
        <Stack key={field.key} gap="tight" className={ledgerItemClasses()}>
          <dt className="text-ink-muted">{field.label}</dt>
          <dd className="break-all">{field.value ?? <MissingValue />}</dd>
        </Stack>
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
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <Stack gap="compact">
          <p className={textRole('itemTitle')}>{emptyDatasetHeading(dataset)}</p>
          <p className={textRole('body')}>
            Requests can incur charges even when no results are returned. Check the website and
            market before reviewing another analysis.
          </p>
          <p className={textRole('caption')}>
            {dataset.target_hostname}
            {dataset.comparison_origin
              ? ` · compared with ${new URL(dataset.comparison_origin).hostname}`
              : ''}{' '}
            · 0 saved rows
          </p>
        </Stack>
      </CardContent>
    </Card>
  );
}

/**
 * What a dataset that saved no rows means, by the coverage acquisition
 * recorded: `empty` (the provider answered with no rows) is a measured
 * "no data"; `complete` is "no data" only when no raw rows arrived either,
 * otherwise rows arrived and none were saved; `unknown` is unavailable
 * evidence; `partial` is incomplete evidence, never "no data".
 */
function emptyDatasetHeading({
  coverage,
  raw_rows_received,
}: Pick<SearchIntelligenceDataset, 'coverage' | 'raw_rows_received'>) {
  const noData = 'The provider returned no data for this saved scope.';
  if (coverage === 'empty') return noData;
  if (coverage === 'complete')
    return raw_rows_received > 0
      ? 'The provider returned results, but none were saved for this scope.'
      : noData;
  if (coverage === 'unknown') return 'Provider evidence is unavailable for this saved scope.';
  return 'Provider evidence for this saved scope is incomplete, and no rows were saved.';
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
      <FilterField>
        <Input
          aria-label="Minimum search volume"
          placeholder="Min. search volume"
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
      </FilterField>
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
    <Button variant="ghost" onClick={onExpand}>
      Review depth
    </Button>
  ) : null;
}

/** What the saved dataset covers, under its table. */
function DatasetSummary({ dataset }: Readonly<{ dataset: SearchIntelligenceDataset }>) {
  return (
    <>
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
    </>
  );
}
