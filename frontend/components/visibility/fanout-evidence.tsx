import { type ReactNode, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import { DataTable, type DataTableColumn } from '@/components/ui/data-table';
import { choiceFilter, type FilterDefinition } from '@/components/ui/all-filters';
import { Icon } from '@/components/ui/icon';
import { Inline } from '@/components/ui/layout';
import { pageNumberControls, useTablePage } from '@/components/ui/pager';
import { SearchField } from '@/components/ui/search-field';
import { ClampText } from '@/components/ui/clamp-text';
import { TableCell, TableRow } from '@/components/ui/table';
import type { UseQueryResult } from '@tanstack/react-query';
import type { FanoutQueryRow, VisibilityEvidenceResponse } from '@citeladder/contracts';
import { Button } from '@/components/ui/button';
import { ProjectLink } from '@/components/ui/project-link';
import { StateBlock } from '@/components/ui/state-block';
import { readErrorProps } from '@/components/ui/notice';
import { ArrowRight, Inbox, Search } from '@/lib/icons';
import { retainPreviousDataForScope } from '@/lib/api/query-client';
import { visibilityQueries } from '@/lib/api/visibility-queries';
import { useProjectScope } from '@/lib/project/active-project-scope';
import { useEngineCatalog } from '@/lib/providers/engines';
import {
  normalizeSearch,
  SEARCH_MAX_LENGTH,
  searchRows,
  searchRowsByPrompt,
  searchRowsByTopic,
  type SearchGroup,
} from '@/lib/visibility/fanout-grouping';
import { optionalStringUrlCodec, stringUrlCodec, useUrlState } from '@/lib/navigation/url-state';
import { textRole } from '@/components/ui/typography';
import { TABLE_SEARCH_DEBOUNCE_MS } from '@/lib/config/operational';
import { useDebounced } from '@/lib/use-debounced';
import {
  selectionMatchedQueries,
  noSearchMatchState,
  SearchScopeNote,
} from '@/components/visibility/fanout-totals';
import {
  FANOUT_VIEWS,
  type FanoutScope,
  type FanoutView,
  type LookupState,
  METRIC_COLUMNS,
  movedState,
  QueryMetricCells,
  useFanoutQueries,
} from '@/components/visibility/fanout-query-metrics';
import { SegmentedControl } from '@/components/ui/tabs';

const TITLE = 'Query fanouts';

const PAGE_SIZE = 10;

const COLUMNS: readonly DataTableColumn[] = [
  { key: 'search', label: 'Search' },
  { key: 'surface', label: 'Surface', width: 'name' },
  { key: 'occurrences', label: 'Occurrences', width: 'figure', kind: 'number' },
  ...METRIC_COLUMNS,
];

const GROUP_NOUNS: Record<(typeof GROUP_OPTIONS)[number]['value'], string> = {
  none: 'searches',
  prompt: 'prompts',
  topic: 'topics',
};

const GROUP_OPTIONS = [
  { value: 'none', label: 'None' },
  { value: 'prompt', label: 'Prompt' },
  { value: 'topic', label: 'Topic' },
] as const;

const groupCodec = stringUrlCodec(
  GROUP_OPTIONS.map((option) => option.value),
  'none',
);

export function useFanoutGroupFilter(): FilterDefinition {
  const [grouping, setGrouping] = useUrlState('group', groupCodec);
  return choiceFilter({
    id: 'fanout-group',
    label: 'Group by',
    value: grouping,
    defaultValue: 'none',
    groups: [{ options: GROUP_OPTIONS }],
    onChange: setGrouping,
  });
}

type EvidenceTabProps = Readonly<{
  query: UseQueryResult<VisibilityEvidenceResponse, unknown>;
  isFiltered: boolean;
  onClearFilters?: () => void;
  limit: number;
}>;

function FanoutEmpty({
  isFiltered,
  onClearFilters,
}: Readonly<Pick<EvidenceTabProps, 'isFiltered' | 'onClearFilters'>>) {
  if (isFiltered && onClearFilters)
    return (
      <StateBlock
        kind="filtered"
        heading="No answers match the selected run, model, prompt and period"
        onClear={onClearFilters}
      />
    );
  return (
    <StateBlock
      kind="empty"
      icon={Inbox}
      heading={isFiltered ? 'No answers match these filters' : 'No searches recorded yet'}
      action={
        isFiltered ? undefined : (
          <Button asChild>
            <ProjectLink href="/runs">
              <Icon icon={ArrowRight} />
              View Runs
            </ProjectLink>
          </Button>
        )
      }
    />
  );
}

export function FanoutEvidence({
  query,
  isFiltered,
  onClearFilters,
  limit,
  runId,
  scope,
  scopeReady,
}: EvidenceTabProps &
  Readonly<{
    runId: string | null;
    scope: FanoutScope;
    scopeReady: boolean;
  }>) {
  const [view, setView] = useState<FanoutView>('top');
  const queries = useFanoutQueries(scope, scopeReady, view);
  const {
    grouping,
    search,
    setSearch,
    needle,
    items,
    visible,
    paged,
    unit,
    page,
    setPage,
    pageCount,
    from,
    to,
  } = useSearchTable(query, runId);
  const serverNeedle = useDebounced(needle, TABLE_SEARCH_DEBOUNCE_MS);
  const summary = useFanoutSummary(scope, scopeReady, serverNeedle);
  const summaryMatchesInput = serverNeedle === needle && !summary.isFetching;
  const matched = summaryMatchesInput ? selectionMatchedQueries(summary) : null;

  if (query.isPending)
    return (
      <StateBlock
        kind="loading"
        label="Loading evidence…"
        shape={{ kind: 'table', columns: COLUMNS.length }}
      />
    );
  if (query.isError)
    return (
      <StateBlock
        kind="error"
        title="Couldn't load this evidence"
        fallback="The request failed or timed out. Your filters are unchanged."
        {...readErrorProps(query)}
      />
    );
  if (items.length === 0) {
    return <FanoutEmpty isFiltered={isFiltered} onClearFilters={onClearFilters} />;
  }

  return (
    <DataTable
      label={TITLE}
      busy={{ active: query.isFetching || queries.read.isFetching, label: 'Updating evidence' }}
      toolbar={{
        view: (
          <SegmentedControl
            ariaLabel="Query fanouts view"
            value={view}
            onChange={setView}
            options={FANOUT_VIEWS}
          />
        ),
        search: (
          <SearchField
            value={search ?? ''}
            onValueChange={(value) => setSearch(value || null)}
            placeholder="Search queries…"
            aria-label="Filter searches by text"
            maxLength={SEARCH_MAX_LENGTH}
          />
        ),
        status: <SearchScopeNote search={needle} matched={matched} />,
      }}
      columns={COLUMNS}
      state={tableState({ view, rows: visible.length, needle, matched, queries })}
      pager={tablePager({ view, unit, from, to, grouping, page, pageCount, setPage })}
      footer={query.data?.truncated ? `Newest ${limit} shown` : null}
    >
      <FanoutRows view={view} groups={paged} queries={queries} />
    </DataTable>
  );
}

function FanoutRows({
  view,
  groups,
  queries,
}: Readonly<{
  view: FanoutView;
  groups: readonly SearchGroup[];
  queries: ReturnType<typeof useFanoutQueries>;
}>) {
  if (view === 'top')
    return groups.map((group) => (
      <SearchGroupRows
        key={group.key}
        group={group}
        metrics={queries.byQuery}
        lookup={queries.lookup}
      />
    ));
  return queries.rows.map((row) => (
    <QueryRow
      key={row.query}
      query={row.query}
      engines={row.engines}
      occurrences={row.event_count}
      nested={false}
    >
      <QueryMetricCells row={row} lookup="loaded" />
    </QueryRow>
  ));
}

function tablePager(
  input: Pick<
    ReturnType<typeof useSearchTable>,
    'unit' | 'from' | 'to' | 'grouping' | 'page' | 'pageCount' | 'setPage'
  > & { view: FanoutView },
) {
  if (input.view !== 'top' || input.unit <= PAGE_SIZE) return undefined;
  return {
    range: { from: input.from, to: input.to, total: input.unit, noun: GROUP_NOUNS[input.grouping] },
    ...pageNumberControls(input.page, input.pageCount, input.setPage),
  };
}

function tableState(input: {
  view: FanoutView;
  rows: number;
  needle: string;
  matched: number | null;
  queries: ReturnType<typeof useFanoutQueries>;
}) {
  if (input.view !== 'top') return movedState(input.view, input.queries);
  return input.rows === 0 ? noSearchMatchState(input.needle, input.matched) : undefined;
}

function useSearchTable(query: EvidenceTabProps['query'], runId: string | null) {
  const [grouping] = useUrlState('group', groupCodec);
  const [search, setSearch] = useUrlState('q', optionalStringUrlCodec, { history: 'replace' });
  const needle = useMemo(() => normalizeSearch(search), [search]);
  const topicOf = usePromptTopics(runId, grouping === 'topic');
  const items = useMemo(() => query.data?.items ?? [], [query.data]);
  const groups = useMemo(() => {
    if (grouping === 'prompt') return searchRowsByPrompt(items);
    if (grouping === 'topic') return searchRowsByTopic(items, topicOf);
    return searchRows(items);
  }, [items, grouping, topicOf]);
  const visible = useMemo(() => {
    const wanted = needle.toLowerCase();
    if (!wanted) return groups;
    return groups
      .map((group) => ({
        ...group,
        rows: group.rows.filter((row) => row.query.toLowerCase().includes(wanted)),
      }))
      .filter((group) => group.rows.length);
  }, [groups, needle]);
  const grouped = grouping !== 'none';
  const unit = grouped ? visible.length : (visible[0]?.rows.length ?? 0);
  const { page, setPage, pageCount, from, to } = useTablePage(unit, {
    pageSize: PAGE_SIZE,
    resetKey: `${grouping}\u0000${needle}`,
    urlKey: 'fanout_page',
  });
  const paged = grouped
    ? visible.slice(from - 1, to)
    : visible.map((group) => ({
        ...group,
        rows: group.rows.slice(from - 1, to),
      }));
  return {
    grouping,
    search,
    setSearch,
    needle,
    items,
    visible,
    paged,
    unit,
    page,
    setPage,
    pageCount,
    from,
    to,
  };
}

function SearchGroupRows({
  group,
  metrics,
  lookup,
}: Readonly<{
  group: SearchGroup;
  metrics: ReadonlyMap<string, FanoutQueryRow>;
  lookup: LookupState;
}>) {
  const undisclosedNoun = group.undisclosed === 1 ? 'answer' : 'answers';
  const unavailableNoun = group.unavailable === 1 ? 'answer has' : 'answers have';
  const noExposedNoun = group.noExposedQueries === 1 ? 'answer' : 'answers';
  const note = [
    group.undisclosed
      ? `${group.undisclosed} ${undisclosedNoun} searched without returning the wording`
      : null,
    group.silent ? `${group.silent} answered without searching` : null,
    group.unavailable ? `${group.unavailable} ${unavailableNoun} unavailable query evidence` : null,
    group.noExposedQueries
      ? `${group.noExposedQueries} ${noExposedNoun} exposed no queries; search activity is unknown`
      : null,
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <>
      {group.label ? (
        <TableRow>
          <TableCell colSpan={COLUMNS.length}>
            <ClampText className={textRole('captionStrong')}>{group.label}</ClampText>
          </TableCell>
        </TableRow>
      ) : null}
      {group.rows.map((row) => (
        <QueryRow
          key={`${group.key}-${row.query}`}
          query={row.query}
          engines={row.engines}
          occurrences={row.occurrences}
          nested={Boolean(group.label)}
        >
          <QueryMetricCells row={metrics.get(row.query)} lookup={lookup} />
        </QueryRow>
      ))}
      {note ? (
        <TableRow>
          <TableCell colSpan={COLUMNS.length} className={textRole('caption', 'text-ink-2')}>
            {note}
          </TableCell>
        </TableRow>
      ) : null}
    </>
  );
}

function QueryRow({
  query,
  engines,
  occurrences,
  nested,
  children,
}: Readonly<{
  query: string;
  engines: readonly string[];
  occurrences: number;
  nested: boolean;
  children: ReactNode;
}>) {
  const { label: engineLabel } = useEngineCatalog();
  return (
    <TableRow>
      <TableCell nested={nested}>
        <Inline as="span" className="items-start">
          <Icon icon={Search} className="text-ink-2" />
          <ClampText>{query}</ClampText>
        </Inline>
      </TableCell>
      <TableCell>{engines.map(engineLabel).join(', ')}</TableCell>
      <TableCell numeric>{occurrences}</TableCell>
      {children}
    </TableRow>
  );
}

function useFanoutSummary(scope: FanoutScope, scopeReady: boolean, needle: string) {
  const { workspaceId, projectId } = useProjectScope();
  const params = useMemo(() => ({ ...scope, search: needle || undefined }), [scope, needle]);
  const result = useQuery({
    ...visibilityQueries.fanout({ workspaceId, projectId }, params),
    enabled: scopeReady,
    placeholderData: (data, query) => retainPreviousDataForScope(projectId, data, query),
  });
  return {
    distinctQueries: result.data?.distinct_queries ?? null,
    eventCount: result.data?.event_count ?? null,
    matchedQueries: result.data?.matched_queries ?? null,
    isFetching: result.isFetching,
  };
}

function usePromptTopics(runId: string | null, enabled: boolean) {
  const { workspaceId, projectId } = useProjectScope();
  const result = useQuery({
    ...visibilityQueries.prompts({ workspaceId, projectId }, runId),
    enabled: enabled && Boolean(runId),
  });
  return useMemo(() => {
    const map = new Map<string, string>();
    for (const row of result.data ?? []) {
      const topic = row.theme || 'Unclassified';
      if (row.prompt_id) map.set(row.prompt_id, topic);
      if (row.prompt_snapshot_id) map.set(row.prompt_snapshot_id, topic);
    }
    return map;
  }, [result.data]);
}
