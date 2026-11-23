import { useState } from 'react';

import { ProjectLink } from '@/components/ui/project-link';
import { ActionButton } from '@/components/ui/actions';
import { Button } from '@/components/ui/button';
import { ClampText } from '@/components/ui/clamp-text';
import { DataTable } from '@/components/ui/data-table';
import { Drawer } from '@/components/ui/drawer';
import { Inline, Stack } from '@/components/ui/layout';
import { ledgerClasses, ledgerItemClasses } from '@/components/ui/workspace';
import { SearchField } from '@/components/ui/search-field';
import { TextLink } from '@/components/ui/text-link';
import { textRole } from '@/components/ui/typography';
import { SearchX } from '@/lib/icons';
import { agentHandoffHref, type HandoffInput } from '@/lib/agent/handoff';
import { useAgentPanelSeed } from '@/lib/agent/panel-context';
import {
  searchIntelligenceQueries,
  type SearchIntelligenceDataset,
  type SearchIntelligenceRow,
} from '@/lib/api/search-intelligence';
import { useProjectScope } from '@/lib/project/active-project-scope';
import { useCursorTableQuery } from '@/lib/table/use-cursor-table-query';
import { Absence } from '@/components/ui/absence';
import { useDisplayTimeZone } from '@/lib/display-timezone';
import { TABLE_SEARCH_DEBOUNCE_MS } from '@/lib/config/operational';
import { useDebounced } from '@/lib/use-debounced';
import { evidenceFields, searchNumber } from './search-intelligence-format';
import { SEARCH_COLUMNS_BY_KIND } from '@/lib/config/search-intelligence';
import { visibilityRunSourcesHref } from '@/lib/visibility/use-visibility-dashboard';
import { SearchIntelligenceExport } from './search-intelligence-export';
import type { KeywordFilterValues } from './search-intelligence-collection-state';
import {
  SearchIntelligenceRows,
  searchIntelligenceColumns,
} from './search-intelligence-rows-table';
import { StateBlock } from '@/components/ui/state-block';

export function SearchIntelligenceDatasetView({
  dataset,
  title = 'Ranking keywords',
  description,
  keywordFilters,
}: Readonly<{
  dataset: SearchIntelligenceDataset;
  title?: string;
  description?: string;
  keywordFilters?: KeywordFilterValues;
}>) {
  const { workspaceId, projectId } = useProjectScope();
  const [selected, setSelected] = useState<SearchIntelligenceRow | null>(null);
  const [filter, setFilter] = useState('');
  const search = useDebounced(filter, TABLE_SEARCH_DEBOUNCE_MS);
  const [order, setOrder] = useState<{ sort: string; direction: 'asc' | 'desc' }>({
    sort: 'id',
    direction: 'asc',
  });
  const minVolume = keywordFilters?.minVolume ?? '';
  const filters = {
    ...order,
    search,
    intent: keywordFilters?.intent ?? '',
    min_volume: minVolume === '' ? undefined : Number(minVolume),
  };
  const hasRows = dataset.unique_rows_saved > 0;
  const { query, page, table } = useCursorTableQuery({
    workspaceId,
    scopeId: dataset.id,
    scope: filters,
    query: (request) =>
      searchIntelligenceQueries.datasetRows({ workspaceId, projectId }, dataset.id, {
        ...filters,
        ...request,
      }),
    noun: 'evidence rows',
    loading: 'Loading saved rows…',
    subject: 'the saved rows',
    empty: () => ({
      kind: 'empty',
      icon: SearchX,
      heading: 'No saved rows match this view',
      headingLevel: 3,
    }),
    enabled: hasRows,
    total: (current) => (current ? filteredSavedCount(current.dataset) : undefined),
  });
  const rows = page?.items ?? [];
  useRowsPanelSeed(dataset.id, selected, page?.items, title);
  if (!hasRows) return <EmptyDataset dataset={dataset} />;
  return (
    <>
      <DataTable
        title={title}
        description={description}
        toolbar={{
          search: (
            <SearchField
              value={filter}
              onValueChange={setFilter}
              aria-label="Filter saved results"
              placeholder="Filter saved results"
            />
          ),
          status: query.isFetching ? 'Updating saved rows…' : null,
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
        {...table}
        footer={datasetSummary(dataset)}
      >
        <SearchIntelligenceRows kind={dataset.dataset_kind} rows={rows} onSelect={setSelected} />
      </DataTable>
      <EvidenceDrawer selected={selected} onClose={() => setSelected(null)} />
    </>
  );
}

function useRowsPanelSeed(
  datasetId: string,
  selected: SearchIntelligenceRow | null,
  pageRows: readonly SearchIntelligenceRow[] | undefined,
  title?: string,
): void {
  const rows = selected ? [selected] : (pageRows ?? []);
  useAgentPanelSeed(rows.length > 0 ? rowsHandoff(datasetId, rows, title) : null);
}

function rowsHandoff(
  datasetId: string,
  rows: readonly SearchIntelligenceRow[],
  title?: string,
): HandoffInput {
  const [first] = rows;
  const subject =
    rows.length === 1 && first
      ? `the Keyword research row for "${first.keyword || first.url || first.domain}"`
      : `these ${rows.length} ${title ?? 'Keyword research'} rows`;
  return {
    searchIntelligence: { datasetId, rowIds: rows.map((row) => row.id) },
    prompt: `Help me act on ${subject}.`,
  };
}

export function EvidenceDrawer({
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
    >
      {selected ? (
        <Inline className="flex-wrap">
          {selected.action_id ? (
            <ActionButton action="openAction" href={`/actions/${selected.action_id}`} />
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
        <TextLink href={visibilityRunSourcesHref(selected.auxiliary.audit_id)} className="w-fit">
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
    <dl className={ledgerClasses('type-body text-ink-2')}>
      {evidenceFields(row, labels, timeZone).map((field) => (
        <Stack key={field.key} gap="tight" className={ledgerItemClasses('min-w-0')}>
          <dt className="text-ink-2">{field.label}</dt>
          <dd className="min-w-0">
            {field.value === null ? <Absence /> : <ClampText>{field.value}</ClampText>}
          </dd>
        </Stack>
      ))}
    </dl>
  );
}

function EmptyDataset({ dataset }: Readonly<{ dataset: SearchIntelligenceDataset }>) {
  return (
    <StateBlock
      kind="empty"
      icon={SearchX}
      heading={emptyDatasetHeading(dataset)}
      description="Charged even with no results."
    />
  );
}

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

function filteredSavedCount(dataset: SearchIntelligenceDataset) {
  return typeof dataset.filtered_saved_count === 'number'
    ? dataset.filtered_saved_count
    : dataset.unique_rows_saved;
}

function datasetSummary(dataset: SearchIntelligenceDataset) {
  const coverage = [
    dataset.provider_total === null
      ? null
      : `${searchNumber(dataset.provider_total)} available from the provider`,
    dataset.truncated ? 'Truncated' : null,
  ].filter((part) => part !== null);
  if (!coverage.length) return null;
  return <p className={textRole('caption')}>{coverage.join(' · ')}</p>;
}
