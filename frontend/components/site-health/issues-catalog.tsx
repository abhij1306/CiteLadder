import { useMemo, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';

import { ReportPage } from '@/components/templates/report-page';
import { Inline } from '@/components/ui/layout';
import {
  IssueDetailDrawer,
  PendingIssueDrawer,
  type IssueHead,
} from '@/components/site-health/issue-detail-dialog';
import { IssueCategoryTag, IssueSeverityMark } from '@/components/site-health/issue-metadata';
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
import { readErrorProps } from '@/components/ui/notice';
import { READ_FAILED } from '@/components/ui/state-block';
import { Pressable } from '@/components/ui/pressable';
import { TextLink } from '@/components/ui/text-link';
import { SubmittedSearch } from '@/components/site-health/submitted-search';
import { ClampText } from '@/components/ui/clamp-text';
import { TableCell, TableRow } from '@/components/ui/table';
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
  ISSUE_PRIORITY_PARAMS,
  ISSUE_SECTIONS,
  ISSUE_SEVERITY_CHOICES,
  issueCatalogParams,
  issueSeverityChange,
  issueSeverityChoice,
  useIssueFilters,
  type IssueFilters,
} from '@/lib/site-health/issue-filters';
import { issueTitle } from '@/lib/site-health/issues';
import { formatCount } from '@/lib/format';

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
    ...siteHealthQueries.issue(workspaceId, crawlId, selectedGroupId ?? '', {
      cursor: occurrenceCursor,
      limit: ISSUE_OCCURRENCE_LIMIT,
      page_kind: filters.page_kind || undefined,
    }),
    enabled: selectedGroupId !== null,
  });
  const rows = issuesQuery.data?.items ?? [];
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
  const fixesQuery = useQuery(siteHealthQueries.issueFixes(workspaceId, crawlId));
  const summary = issuesQuery.data?.summary ?? null;
  const crawlSummary = priorityQuery.data?.summary;
  const pager = useCatalogPager(cursor, issuesQuery.data?.next_cursor ?? null, catalog.goToPage);

  return (
    <ReportPage>
      {notice}
      <IssuesSummary
        query={priorityQuery}
        fixes={fixesQuery.data?.items}
        onOpen={catalog.selectIssue}
      />
      <DataTable
        label="Issues"
        columns={issueColumns(filters.sort, (sort) => updateFilters({ sort }))}
        toolbar={{
          view: (
            <SectionControl
              value={filters.section}
              summary={summary}
              upTo={
                crawlSummary &&
                crawlSummary.defect_issue_type_count + crawlSummary.advisory_issue_type_count
              }
              onChange={(section) => updateFilters({ section })}
            />
          ),
          search: (
            <SubmittedSearch
              key={filters.query}
              query={filters.query}
              onApply={(query) => updateFilters({ query })}
              placeholder="Search issues…"
              label="Search issues"
            />
          ),
          filters: catalogFilters(filters, rows, updateFilters),
        }}
        state={tableState(issuesQuery)}
        rowCount={rows.length}
        pageSize={ISSUE_PAGE_LIMIT}
        pager={pager}
        busy={{ active: issuesQuery.isFetching, label: 'Updating issues' }}
      >
        {rows.map((issue) => (
          <IssueRow key={issue.group_id} issue={issue} onOpen={catalog.selectIssue} />
        ))}
      </DataTable>
      {selectedGroupId !== null && open === null ? (
        <PendingIssueDrawer detailQuery={detailQuery} onClose={() => catalog.selectIssue(null)} />
      ) : null}
      {open ? (
        <IssueDetailDrawer
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
    </ReportPage>
  );
}

function tableState(query: ReturnType<typeof useIssuesCatalogQueries>['issuesQuery']) {
  if (query.isError && !query.data)
    return {
      kind: 'error',
      ...readErrorProps(query),
      fallback: READ_FAILED,
      title: "Couldn't load issues for this crawl",
    } satisfies DataTableState;
  if (!query.data) return { kind: 'loading', label: 'Loading issues…' } satisfies DataTableState;
  if (query.data.items.length === 0)
    return {
      kind: 'empty',
      icon: ICONS.issues,
      heading: 'No issue types match this view',
    } satisfies DataTableState;
  return undefined;
}

function issueColumns(sort: IssueSort, onSort: (sort: IssueSort) => void): DataTableColumn[] {
  return [
    { key: 'issue', label: 'Issue', kind: 'identity' },
    {
      key: 'severity',
      label: 'Severity',
      kind: 'status',
      width: 'status',
      sort: { active: sort === 'severity', descending: true, onSort: () => onSort('severity') },
    },
    {
      key: 'pages',
      label: 'Pages affected',
      kind: 'number',
      width: 'metric',
      sort: { active: sort === 'pages', descending: true, onSort: () => onSort('pages') },
    },
    { key: 'category', label: 'Category', width: 'category', priority: 'low' },
  ];
}

function IssueRow({
  issue,
  onOpen,
}: Readonly<{ issue: SiteIssue; onOpen: (groupId: string) => void }>) {
  const title = issueTitle(issue);
  return (
    <TableRow onClick={() => onOpen(issue.group_id)} className="cursor-pointer">
      <TableCell>
        <Inline gap="tight">
          <TextLink asChild underline="hover">
            <Pressable
              aria-haspopup="dialog"
              onClick={(event) => {
                event.stopPropagation();
                onOpen(issue.group_id);
              }}
              className="min-h-6 w-auto min-w-0"
            >
              <ClampText>{title}</ClampText>
            </Pressable>
          </TextLink>
          {issue.description ? (
            <InfoHint label={`What “${title}” checks`}>{issue.description}</InfoHint>
          ) : null}
        </Inline>
      </TableCell>
      <TableCell>
        <IssueSeverityMark issue={issue} />
      </TableCell>
      <TableCell numeric className="tabular-nums">
        {formatCount(issue.affected_url_count)}
      </TableCell>
      <TableCell>
        <IssueCategoryTag issue={issue} />
      </TableCell>
    </TableRow>
  );
}

function SectionControl({
  value,
  summary,
  upTo,
  onChange,
}: Readonly<{
  value: IssueSection;
  summary: Summary | null;
  upTo: number | undefined;
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
        countUpTo: upTo,
      }))}
    />
  );
}

function catalogFilters(
  filters: IssueFilters,
  rows: readonly SiteIssue[],
  updateFilters: (change: Partial<IssueFilters>) => void,
): FilterDefinition[] {
  return [
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
    pageKindFilter({
      value: filters.page_kind,
      onChange: (page_kind) => updateFilters({ page_kind }),
    }),
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

function ruleFilterTitle(rows: readonly SiteIssue[], ruleId: string): string {
  const row = rows.find((issue) => issue.rule_id === ruleId);
  return row ? issueTitle(row) : 'one issue';
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
