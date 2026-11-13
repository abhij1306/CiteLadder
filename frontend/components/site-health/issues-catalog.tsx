import { useMemo, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';

import { ListScreen } from '@/components/layout/page-shell';
import { Inline, Stack } from '@/components/ui/layout';
import {
  IssueDetailDialog,
  PendingIssueDialog,
  type IssueHead,
} from '@/components/site-health/issue-detail-dialog';
import { IssueMetadata } from '@/components/site-health/issue-metadata';
import { IssuesSummary } from '@/components/site-health/issues-summary';
import { pageKindFilter } from '@/components/site-health/page-kind-select';
import { choiceFilter, type FilterDefinition } from '@/components/ui/all-filters';
import {
  DataTable,
  type DataTableColumn,
  type DataTablePager,
  type DataTableState,
} from '@/components/ui/data-table';
import { InfoHint } from '@/components/ui/info-hint';
import { Pressable } from '@/components/ui/pressable';
import { SearchField } from '@/components/ui/search-field';
import { ClampText, TableCell, TableRow } from '@/components/ui/table';
import { SegmentedControl } from '@/components/ui/tabs';
import { siteHealthQueries } from '@/lib/api/site-health-queries';
import { ICONS } from '@/lib/icons';
import { ISSUE_OCCURRENCE_LIMIT, ISSUE_PAGE_LIMIT } from '@/lib/config/site-health';
import type {
  IssueSection,
  IssueSort,
  IssuesSummary as Summary,
  SiteIssue,
} from '@citeladder/contracts';
import {
  findingClassChange,
  ISSUE_PRIORITY_PARAMS,
  ISSUE_SECTIONS,
  ISSUE_SEVERITY_CHOICES,
  issueCatalogParams,
  issueSeverityChange,
  issueSeverityChoice,
  useIssueFilters,
  type FindingClass,
  type IssueFilters,
} from '@/lib/site-health/issue-filters';
import { issueTitle, severityCount } from '@/lib/site-health/issues';
import { InlineFigure, textRole } from '@/components/ui/typography';
import { formatCount } from '@/lib/format';

/**
 * The Issues screen's reads, none waiting on another: the listed page, the
 * crawl's unfiltered summary with its worst issues, and — while one is open —
 * the open issue's occurrences.
 */
function useIssuesCatalogQueries({
  workspaceId,
  crawlId,
  filters,
  cursor,
  selectedGroupId,
  occurrenceCursor,
}: Readonly<{
  workspaceId: string;
  crawlId: string;
  filters: IssueFilters;
  cursor: string | null;
  selectedGroupId: string | null;
  occurrenceCursor: string | undefined;
}>) {
  const params = useMemo(() => issueCatalogParams(filters, cursor), [filters, cursor]);
  const issuesQuery = useQuery(siteHealthQueries.issues(workspaceId, crawlId, params));
  const priorityQuery = useQuery(
    siteHealthQueries.issues(workspaceId, crawlId, ISSUE_PRIORITY_PARAMS),
  );
  const detailQuery = useQuery({
    // The dialog lists the pages its row counted, so it takes the row's page-kind filter.
    ...siteHealthQueries.issue(workspaceId, crawlId, selectedGroupId ?? '', {
      cursor: occurrenceCursor,
      limit: ISSUE_OCCURRENCE_LIMIT,
      page_kind: filters.page_kind || undefined,
    }),
    enabled: selectedGroupId !== null,
  });
  const rows = issuesQuery.data?.items ?? [];
  // The open issue as its list row says it, or — named by the address but on
  // another page or tab — as its own detail says it. Never another issue's
  // detail retained while this one loads.
  const detail = detailQuery.data?.group_id === selectedGroupId ? detailQuery.data : undefined;
  const open: IssueHead | null =
    rows.find((issue) => issue.group_id === selectedGroupId) ??
    priorityQuery.data?.items.find((issue) => issue.group_id === selectedGroupId) ??
    detail ??
    null;
  return { issuesQuery, priorityQuery, detailQuery, rows, open };
}

export function IssuesCatalog({
  workspaceId,
  projectId,
  crawlId,
  notice,
}: Readonly<{
  workspaceId: string;
  projectId: string;
  crawlId: string;
  /** A refresh failure to report above the catalog it could not refresh. */
  notice?: ReactNode;
}>) {
  const catalog = useIssueFilters();
  const { filters, cursor, selectedGroupId, updateFilters } = catalog;
  const { issuesQuery, priorityQuery, detailQuery, rows, open } = useIssuesCatalogQueries({
    workspaceId,
    crawlId,
    filters,
    cursor,
    selectedGroupId,
    occurrenceCursor: catalog.occurrenceCursor,
  });
  // Fix progress is a side read: while it loads or fails, the summary shows no fix lines.
  const fixesQuery = useQuery(siteHealthQueries.issueFixes(workspaceId, crawlId));
  const summary = issuesQuery.data?.summary ?? null;
  const pager = useCatalogPager(cursor, issuesQuery.data?.next_cursor ?? null, catalog.goToPage);

  return (
    <ListScreen narrow>
      <Stack gap="workspace" className="min-w-0">
        {notice}
        <IssuesSummary
          query={priorityQuery}
          fixes={fixesQuery.data?.items}
          onOpen={catalog.selectIssue}
        />
        <DataTable
          label="Issues"
          // Keeps the Issue column readable beside the fixed severity and pages
          // columns; narrower screens scroll the table instead.
          minWidth="sm"
          columns={issueColumns(filters.sort, (sort) => updateFilters({ sort }))}
          toolbar={{
            view: (
              <SectionControl
                value={filters.section}
                summary={summary}
                onChange={(section) => updateFilters({ section })}
              />
            ),
            search: (
              <IssueSearch
                key={filters.query}
                query={filters.query}
                onApply={(query) => updateFilters({ query })}
              />
            ),
            filters: catalogFilters(filters, rows, updateFilters),
            status: summary ? (
              <IssueCount summary={summary} findingView={filters.finding_class} />
            ) : null,
          }}
          state={tableState(issuesQuery)}
          rowCount={rows.length}
          pageSize={ISSUE_PAGE_LIMIT}
          pager={pager}
          busy={{ active: issuesQuery.isFetching, label: 'Updating issues' }}
        >
          {rows.map((issue, index) => (
            <IssueRow
              key={issue.group_id}
              issue={issue}
              index={index}
              onOpen={catalog.selectIssue}
            />
          ))}
        </DataTable>
      </Stack>
      {selectedGroupId !== null && open === null ? (
        <PendingIssueDialog detailQuery={detailQuery} onClose={() => catalog.selectIssue(null)} />
      ) : null}
      {open ? (
        <IssueDetailDialog
          issue={open}
          scope={{ workspaceId, projectId }}
          crawlId={crawlId}
          detailQuery={detailQuery}
          canPrevious={catalog.canPageOccurrencesBack}
          onPrevious={catalog.previousOccurrences}
          onNext={() => {
            const next = detailQuery.data?.next_cursor;
            if (next) catalog.nextOccurrences(next);
          }}
          onClose={() => catalog.selectIssue(null)}
        />
      ) : null}
    </ListScreen>
  );
}

/** The list's read as the table states it: loading and failure before rows, then "none match". */
function tableState(query: ReturnType<typeof useIssuesCatalogQueries>['issuesQuery']) {
  if (query.isError && !query.data)
    return {
      kind: 'error',
      error: query.error,
      fallback: 'Could not load issues for this crawl.',
      onRetry: () => void query.refetch(),
      pending: query.isFetching,
    } satisfies DataTableState;
  if (!query.data) return { kind: 'loading', label: 'Loading issues…' } satisfies DataTableState;
  if (query.data.items.length === 0)
    return {
      kind: 'empty',
      icon: ICONS.issues,
      heading: 'No issues match this view',
    } satisfies DataTableState;
  return undefined;
}

/** Ordinal, the issue, its severity, its pages; severity and pages order the list. */
function issueColumns(sort: IssueSort, onSort: (sort: IssueSort) => void): DataTableColumn[] {
  return [
    { key: 'index', label: '#', width: 'index', numeric: true },
    { key: 'issue', label: 'Issue' },
    {
      key: 'severity',
      label: 'Severity',
      width: 'statusLabel',
      sort: { active: sort === 'severity', descending: true, onSort: () => onSort('severity') },
    },
    {
      key: 'pages',
      label: 'Pages',
      width: 'figure',
      numeric: true,
      sort: { active: sort === 'pages', descending: true, onSort: () => onSort('pages') },
    },
  ];
}

/** One issue: the whole row opens its detail, the title is the keyboard's way in. */
function IssueRow({
  issue,
  index,
  onOpen,
}: Readonly<{ issue: SiteIssue; index: number; onOpen: (groupId: string) => void }>) {
  const title = issueTitle(issue);
  return (
    <TableRow onClick={() => onOpen(issue.group_id)} className="cursor-pointer">
      <TableCell numeric className="type-caption tabular-nums">
        {index + 1}
      </TableCell>
      <TableCell>
        <Inline gap="tight">
          <Pressable
            aria-haspopup="dialog"
            onClick={(event) => {
              event.stopPropagation();
              onOpen(issue.group_id);
            }}
            className="min-w-0"
          >
            <ClampText lines={1} className={textRole('emphasis')}>
              {title}
            </ClampText>
          </Pressable>
          {issue.description ? (
            // The rule's description states the passing check, so it is
            // offered as what the check looks for, never under the title.
            <InfoHint label={`What “${title}” checks`}>{issue.description}</InfoHint>
          ) : null}
        </Inline>
      </TableCell>
      <TableCell className="whitespace-nowrap">
        <IssueMetadata issue={issue} />
      </TableCell>
      <TableCell numeric className="tabular-nums">
        {formatCount(issue.affected_url_count)}
      </TableCell>
    </TableRow>
  );
}

/** Technical | Content | AEO, each with its issue count under the other filters. */
function SectionControl({
  value,
  summary,
  onChange,
}: Readonly<{
  value: IssueSection;
  summary: Summary | null;
  onChange: (value: IssueSection) => void;
}>) {
  return (
    <SegmentedControl
      value={value}
      onChange={onChange}
      ariaLabel="Issue type"
      options={ISSUE_SECTIONS.map((section) => ({
        value: section.value,
        label: section.label,
        count: summary?.section_counts[section.value],
      }))}
    />
  );
}

/**
 * The list's narrowing: severity (issues only — advisories carry none), the
 * page type, whether it lists issues or advisories, and a deep link's
 * one-issue filter while it holds.
 */
function catalogFilters(
  filters: IssueFilters,
  rows: readonly SiteIssue[],
  updateFilters: (change: Partial<IssueFilters>) => void,
): FilterDefinition[] {
  const defects = filters.finding_class === 'defect';
  return [
    ...(defects
      ? [
          choiceFilter({
            id: 'severity',
            label: 'Severity',
            value: issueSeverityChoice(filters),
            defaultValue: 'all',
            onChange: (value) => updateFilters(issueSeverityChange(value)),
            groups: [
              { options: ISSUE_SEVERITY_CHOICES.map(({ key, label }) => ({ value: key, label })) },
            ],
          }),
        ]
      : []),
    pageKindFilter({
      value: filters.page_kind,
      onChange: (page_kind) => updateFilters({ page_kind }),
    }),
    choiceFilter<FindingClass>({
      id: 'finding_class',
      label: 'Show',
      value: filters.finding_class,
      defaultValue: 'defect',
      onChange: (value) => updateFilters(findingClassChange(value)),
      groups: [
        {
          options: [
            { value: 'defect', label: 'Issues' },
            { value: 'advisory', label: 'Advisories' },
          ],
        },
      ],
    }),
    // A deep link's one-issue filter, counted on the button and cleared in its menu.
    ...(filters.rule_id
      ? [
          choiceFilter({
            id: 'rule',
            label: 'Issue',
            value: filters.rule_id,
            defaultValue: '',
            onChange: (rule_id) => updateFilters({ rule_id }),
            groups: [
              {
                options: [
                  { value: '', label: 'All issues' },
                  { value: filters.rule_id, label: ruleFilterTitle(rows, filters.rule_id) },
                ],
              },
            ],
          }),
        ]
      : []),
  ];
}

/** The deep-linked issue's title, from the rows it filtered to; never its rule id. */
function ruleFilterTitle(rows: readonly SiteIssue[], ruleId: string): string {
  const row = rows.find((issue) => issue.rule_id === ruleId);
  return row ? issueTitle(row) : 'one issue';
}

function IssueSearch({
  query,
  onApply,
}: Readonly<{ query: string; onApply: (query: string) => void }>) {
  const [draft, setDraft] = useState(query);
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onApply(draft);
      }}
    >
      <SearchField
        value={draft}
        onValueChange={(value) => {
          setDraft(value);
          // An emptied box lists everything again: there is nothing to submit.
          if (value === '' && query !== '') onApply('');
        }}
        placeholder="Search issues…"
        aria-label="Search issues"
      />
    </form>
  );
}

/**
 * The catalog's page controls. The cursor lives in the URL and the API pages
 * forward only, so the way back is the trail of cursors this view followed; a
 * deep-linked page has none and steps back to the first page.
 */
function useCatalogPager(
  cursor: string | null,
  nextCursor: string | null,
  onGo: (cursor: string | null) => void,
): DataTablePager {
  const [trail, setTrail] = useState<(string | null)[]>([]);
  // A filter change drops the cursor, which starts a new trail.
  const followed = cursor ? trail : [];
  return {
    canPrev: Boolean(cursor),
    canNext: Boolean(nextCursor),
    onFirst: () => {
      setTrail([]);
      onGo(null);
    },
    onPrev: () => {
      setTrail(followed.slice(0, -1));
      onGo(followed.at(-1) ?? null);
    },
    onNext: () => {
      if (!nextCursor) return;
      setTrail([...followed, cursor]);
      onGo(nextCursor);
    },
  };
}

/** The listed view's size: issue types, their occurrences and the pages they reach. */
function IssueCount({
  summary,
  findingView,
}: Readonly<{ summary: Summary; findingView: FindingClass }>) {
  const defects = findingView === 'defect';
  const typeCount = defects ? summary.defect_issue_type_count : summary.advisory_issue_type_count;
  const high = severityCount(summary.severity_counts, 'high');
  return (
    <p className="type-caption whitespace-nowrap">
      <SummaryCount
        value={typeCount}
        singular={defects ? 'issue' : 'advisory'}
        plural={defects ? 'issues' : 'advisories'}
      />
      {defects && high > 0 ? (
        <>
          <span aria-hidden> · </span>
          <span>
            <InlineFigure className={textRole('emphasis')}>{formatCount(high)}</InlineFigure> high
          </span>
        </>
      ) : null}
      <span aria-hidden> · </span>
      <SummaryCount value={summary.affected_url_count} singular="page" plural="pages" />
    </p>
  );
}

function SummaryCount({
  value,
  singular,
  plural,
}: Readonly<{ value: number; singular: string; plural: string }>) {
  return (
    <span>
      <InlineFigure className={textRole('emphasis')}>{formatCount(value)}</InlineFigure>{' '}
      {value === 1 ? singular : plural}
    </span>
  );
}
