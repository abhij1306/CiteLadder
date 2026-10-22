'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { BusyBar } from '@/components/ui/busy-bar';
import { FilterBar, FilterChoice } from '@/components/ui/filter-bar';
import { Pager, pageNumberControls, useTablePage } from '@/components/ui/pager';
import { SearchField } from '@/components/ui/search-field';
import {
  ClampText,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  EvidenceEmpty,
  EvidenceError,
  EvidenceFilteredEmpty,
  EvidenceSkeleton,
  TruncationNotice,
  type EvidenceTabProps,
} from '@/components/visibility/evidence-states';
import { queryKeys } from '@/lib/api/query-keys';
import { retainPreviousDataForScope } from '@/lib/api/query-client';
import { visibilityApi } from '@/lib/api/visibility';
import { useActiveWorkspaceId } from '@/lib/project/project-context';
import { engineLabel } from '@/lib/visibility/dashboard';
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
import { FANOUT_SEARCH_DEBOUNCE_MS } from '@/lib/config/operational';
import {
  isSelectionWide,
  selectionMatchedQueries,
  NoSearchMatch,
  SearchScopeNote,
  FanoutCounts,
} from '@/components/visibility/fanout-totals';

const TITLE = 'Query fanouts';

/** The run/engine/cohort scope the evidence table was read under. */
export type FanoutScope = Readonly<{
  audit_id?: string;
  audit_ids?: string[];
  engine?: string;
  cohort?: string;
}>;

/** Rows (or groups) per page, matching the shared table footer. */
const PAGE_SIZE = 10;

/** What a page of this grouping is counting, for the shared table footer. */
const GROUP_NOUNS: Record<(typeof GROUP_OPTIONS)[number]['value'], string> = {
  none: 'searches',
  prompt: 'prompts',
  topic: 'topics',
};

const GROUP_OPTIONS = [
  { value: 'none', label: 'Group by: None' },
  { value: 'prompt', label: 'Group by: Prompt' },
  { value: 'topic', label: 'Group by: Topic' },
] as const;

const groupCodec = stringUrlCodec(
  GROUP_OPTIONS.map((option) => option.value),
  'none',
);

/**
 * The searches an engine ran before answering, as ONE table.
 *
 * This tab used to be two stacked cards that answered the same question twice:
 * a summary card listing query strings with event counts, and a second card
 * repeating every query nested inside per-execution panels. Both are folded
 * into one table whose grouping the reader chooses — no grouping, by prompt, or
 * by topic — which is the only axis that actually changed between them.
 *
 * The three per-execution states stay distinct, because they are different
 * facts: a query whose text the model exposed becomes a row; a search whose
 * wording was withheld, and an answer that searched nothing at all, are counted
 * under the group rather than invented as rows.
 */
/** No searches at all, or none under the current filters. */
function FanoutEmpty({
  isFiltered,
  onClearFilters,
}: Readonly<Pick<EvidenceTabProps, 'isFiltered' | 'onClearFilters'>>) {
  return isFiltered ? (
    <EvidenceFilteredEmpty
      title={TITLE}
      body="No answers match the selected run, model, prompt and period. Widen the period or clear a filter."
      onClear={onClearFilters}
    />
  ) : (
    <EvidenceEmpty
      title={TITLE}
      heading="No searches recorded yet"
      body="Once a run answers your prompts, the searches each engine ran first appear here."
    />
  );
}

export function FanoutEvidence({
  query,
  isFiltered,
  onClearFilters,
  limit,
  projectId,
  runId,
  scope,
  scopeReady,
  scopeNarrowed,
}: EvidenceTabProps &
  Readonly<{
    projectId: string | null;
    runId: string | null;
    scope: FanoutScope;
    scopeReady: boolean;
    scopeNarrowed: boolean;
  }>) {
  const {
    grouping,
    setGrouping,
    search,
    setSearch,
    needle,
    items,
    visible,
    paged,
    totals,
    unit,
    page,
    setPage,
    pageCount,
    from,
    to,
  } = useSearchTable(query, projectId, runId);
  const serverNeedle = useDebouncedNeedle(needle);
  const summary = useFanoutSummary(projectId, scope, scopeReady, serverNeedle);
  const summaryMatchesInput = serverNeedle === needle && !summary.isFetching;
  // False whenever the server is counting a different population than the
  // table shows; the headline then falls back to what the reader can see.
  const selectionWide = isSelectionWide(summary, scopeNarrowed);
  const matched = summaryMatchesInput ? selectionMatchedQueries(summary, scopeNarrowed) : null;

  if (query.isLoading) return <EvidenceSkeleton title={TITLE} />;
  if (query.isError) return <EvidenceError title={TITLE} onRetry={() => query.refetch()} />;
  if (items.length === 0) {
    return <FanoutEmpty isFiltered={isFiltered} onClearFilters={onClearFilters} />;
  }

  return (
    <Card className="relative" aria-busy={query.isFetching}>
      <BusyBar active={query.isFetching} label="Updating evidence" />
      <CardHeader bordered>
        <CardTitle>{TITLE}</CardTitle>
        <FilterBar
          search={
            <SearchField
              value={search ?? ''}
              onValueChange={(value) => setSearch(value || null)}
              placeholder="Search queries…"
              aria-label="Filter searches by text"
              maxLength={SEARCH_MAX_LENGTH}
            />
          }
          status={
            needle && matched != null ? <SearchScopeNote search={needle} matched={matched} /> : null
          }
          actions={
            <>
              <span aria-busy={!summaryMatchesInput}>
                <FanoutCounts summary={summary} fallback={totals} selectionWide={selectionWide} />
              </span>
              <FilterChoice
                label="Group searches by"
                value={grouping}
                options={GROUP_OPTIONS}
                onChange={setGrouping}
              />
            </>
          }
        />
      </CardHeader>
      <CardContent flush className="grid gap-0">
        {visible.length === 0 ? (
          <NoSearchMatch search={needle} matched={matched} />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Search</TableHead>
                <TableHead>Model</TableHead>
                <TableHead numeric className="w-32">
                  Occurrences
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {paged.map((group) => (
                <SearchGroupRows key={group.key} group={group} />
              ))}
            </TableBody>
          </Table>
        )}
        {unit > PAGE_SIZE ? (
          <Pager
            frame="table"
            range={{ from, to, total: unit, noun: GROUP_NOUNS[grouping] }}
            {...pageNumberControls(page, pageCount, setPage)}
          />
        ) : null}
        {query.data?.truncated ? <TruncationNotice limit={limit} /> : null}
      </CardContent>
    </Card>
  );
}

/**
 * Everything the table derives from one loaded evidence window.
 *
 * Kept out of the component because it is all one derivation — choose a
 * grouping, filter by text, page the result, and total what survives — and
 * reading it inline buried the four states the component actually renders.
 */
function useSearchTable(
  query: EvidenceTabProps['query'],
  projectId: string | null,
  runId: string | null,
) {
  const [grouping, setGrouping] = useUrlState('group', groupCodec);
  const [search, setSearch] = useUrlState('q', optionalStringUrlCodec, { history: 'replace' });
  // Trimmed and capped ONCE: the table filter, the server scope, the match
  // count and the empty state all read this, so none of them can be asking
  // about a different string than the others.
  const needle = useMemo(() => normalizeSearch(search), [search]);
  const topicOf = usePromptTopics(projectId, runId, grouping === 'topic');
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
  // Totalled over what the reader can SEE. Counting `groups` reported every
  // search in the window while the table showed only the ones matching a
  // filter, so the two disagreed the moment anything was typed.
  const totals = useMemo(
    () => ({
      distinct: new Set(visible.flatMap((group) => group.rows.map((row) => row.query))).size,
      occurrences: visible.reduce(
        (sum, group) => sum + group.rows.reduce((rows, row) => rows + row.occurrences, 0),
        0,
      ),
    }),
    [visible],
  );
  // Grouped views page by group so a prompt's searches are never split across
  // two pages; the ungrouped view pages by row.
  const grouped = grouping !== 'none';
  const unit = grouped ? visible.length : (visible[0]?.rows.length ?? 0);
  const { page, setPage, pageCount, from, to } = useTablePage(unit, PAGE_SIZE);
  // Regrouping or searching produces a different set; page 3 of the old set is
  // not page 3 of the new one.
  useEffect(() => setPage(1), [grouping, needle, setPage]);
  const paged = grouped
    ? visible.slice(from - 1, to)
    : visible.map((group) => ({
        ...group,
        rows: group.rows.slice(from - 1, to),
      }));
  return {
    grouping,
    setGrouping,
    search,
    setSearch,
    needle,
    items,
    visible,
    paged,
    totals,
    unit,
    page,
    setPage,
    pageCount,
    from,
    to,
  };
}

function useDebouncedNeedle(needle: string): string {
  const [debounced, setDebounced] = useState(needle);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(needle), FANOUT_SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [needle]);
  return debounced;
}

/**
 * One group's heading row and its searches, inside the shared table.
 *
 * A group renders as rows of the SAME table rather than a table of its own, so
 * every search in the tab sits on one set of columns. Repeating a header per
 * group restarted the column widths at each prompt and left nothing aligned.
 */
function SearchGroupRows({ group }: Readonly<{ group: SearchGroup }>) {
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
          <TableCell colSpan={3} className="bg-surface-2">
            <ClampText className={textRole('itemTitle')}>{group.label}</ClampText>
          </TableCell>
        </TableRow>
      ) : null}
      {group.rows.map((row) => (
        <TableRow key={`${group.key}-${row.query}`}>
          <TableCell>
            <span
              className={group.label ? 'flex items-start gap-2 ps-4' : 'flex items-start gap-2'}
            >
              <Search className="text-muted mt-0.5 size-3 shrink-0" aria-hidden />
              <ClampText>{row.query}</ClampText>
            </span>
          </TableCell>
          <TableCell>{row.engines.map(engineLabel).join(', ')}</TableCell>
          <TableCell numeric>{row.occurrences}</TableCell>
        </TableRow>
      ))}
      {note ? (
        <TableRow>
          <TableCell colSpan={3} className={textRole('caption', 'text-secondary')}>
            {note}
          </TableCell>
        </TableRow>
      ) : null}
    </>
  );
}

/**
 * Selection-wide fanout totals, straight from the server.
 *
 * The table below is one loaded evidence window, and deriving "Distinct
 * searches" and "Total occurrences" from it meant both figures changed as the
 * reader paged — they were page totals wearing selection labels. This asks the
 * projection that already aggregates the COMPLETE selection
 * (`services/api/src/analysis/fanout.ts`), which it does with `limit=None`.
 *
 * The normalized search is sent too, so the count of matching queries covers
 * the whole run set rather than whatever happens to be loaded: a query stored
 * past the first page was previously unfindable. It is the SAME value the
 * table filters by, so the two can never disagree about what matched.
 */
function useFanoutSummary(
  projectId: string | null,
  scope: FanoutScope,
  scopeReady: boolean,
  needle: string,
) {
  const workspaceId = useActiveWorkspaceId();
  const params = useMemo(
    // Already normalized by `normalizeSearch`, which caps it at the bound the
    // endpoint declares — a longer value is rejected as a 422 before it can
    // match anything, turning a long paste into an error rather than a search.
    () => ({ ...scope, search: needle || undefined }),
    [scope, needle],
  );
  const result = useQuery({
    queryKey: queryKeys.visibility.fanout(projectId ?? '', params),
    queryFn: ({ signal }) =>
      visibilityApi.getFanoutSummary(projectId ?? '', params, { signal, workspaceId }),
    enabled: Boolean(projectId && workspaceId) && scopeReady,
    // Totals for a selection do not change while the reader pages through it;
    // keeping the previous values avoids the headline flickering to blank.
    placeholderData: (data, query) => retainPreviousDataForScope(projectId ?? '', data, query),
  });
  return {
    distinctQueries: result.data?.distinct_queries ?? null,
    eventCount: result.data?.event_count ?? null,
    matchedQueries: result.data?.matched_queries ?? null,
    isFetching: result.isFetching,
  };
}

/**
 * Prompt-to-topic map for the topic grouping.
 *
 * Evidence rows carry no topic; the prompt metrics projection already publishes
 * one per prompt, so the join happens here rather than being pushed into the
 * evidence endpoint. Only fetched when the reader actually groups by topic.
 */
function usePromptTopics(projectId: string | null, runId: string | null, enabled: boolean) {
  const workspaceId = useActiveWorkspaceId();
  const result = useQuery({
    queryKey: [...queryKeys.visibility.prompts(projectId ?? '', runId ?? undefined), 'topics'],
    queryFn: ({ signal }) =>
      visibilityApi.getPromptMetrics(projectId ?? '', runId ?? undefined, {
        signal,
        workspaceId,
      }),
    enabled: enabled && Boolean(projectId && runId && workspaceId),
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
