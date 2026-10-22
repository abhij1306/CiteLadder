'use client';

import { useMemo, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';

import { PageShell } from '@/components/layout/page-shell';
import { Stack } from '@/components/ui/layout';
import { IssueDetailRail } from '@/components/site-health/issue-detail-rail';
import { IssueMetadata } from '@/components/site-health/issue-metadata';
import { PageKindSelect } from '@/components/site-health/page-kind-select';
import { Card } from '@/components/ui/card';
import { listRowClasses } from '@/components/ui/list-row';
import { Pager } from '@/components/ui/pager';
import { Pressable } from '@/components/ui/pressable';
import { QueryState } from '@/components/ui/query-state';
import { SearchField } from '@/components/ui/search-field';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { splitPaneClasses } from '@/components/ui/workspace';
import { siteHealthQueries } from '@/lib/api/site-health';
import { ICONS } from '@/lib/icons';
import { ISSUE_OCCURRENCE_LIMIT, ISSUE_PAGE_LIMIT } from '@/lib/config/site-health';
import type { IssuesSummary, SiteIssue } from '@/lib/api/types';
import {
  findingClassChange,
  issueFilterClass,
  issueFilterClassChange,
  issueFilterClasses,
  toIssueParams,
  useIssueFilters,
  type FindingClass,
  type IssueFilterClass,
  type IssueFilters,
} from '@/lib/site-health/issue-filters';
import { issueTitle } from '@/lib/site-health/issues';
import { cn } from '@/lib/utils';
import { textRole } from '@/components/ui/typography';

const FILTER_GROUP_KEYS: Record<'All issues' | 'Severity' | 'Category', readonly string[]> = {
  'All issues': ['all'],
  Severity: ['high', 'medium', 'low'],
  Category: ['technical', 'aeo'],
};

/** The toggle's label, with the count only once a summary has landed. */
function findingViewLabel(view: FindingClass, summary: IssuesSummary | null): string {
  const defects = view === 'defect';
  const label = defects ? 'Defects' : 'Advisories';
  if (!summary) return label;
  const count = defects ? summary.defect_issue_type_count : summary.advisory_issue_type_count;
  return `${label} (${count})`;
}

function filterCount(filter: IssueFilterClass, summary: IssuesSummary, view: FindingClass): number {
  if (filter === 'high')
    return (summary.severity_counts.high ?? 0) + (summary.severity_counts.critical ?? 0);
  if (filter === 'medium' || filter === 'low') return summary.severity_counts[filter] ?? 0;
  if (filter === 'technical' || filter === 'aeo') return summary.dimension_counts[filter] ?? 0;
  return view === 'defect' ? summary.defect_issue_type_count : summary.advisory_issue_type_count;
}

/** The issue page, then the occurrences of whichever issue the rail shows. */
function useIssuesCatalogQueries(
  workspaceId: string,
  crawlId: string,
  filters: IssueFilters,
  cursor: string | null,
  selectedGroupId: string | null,
  occurrenceCursor: string | undefined,
) {
  const params = useMemo(() => toIssueParams(filters, cursor, ISSUE_PAGE_LIMIT), [filters, cursor]);
  const issuesQuery = useQuery(siteHealthQueries.issues(workspaceId, crawlId, params));
  const summary = issuesQuery.data?.summary ?? null;
  const rows = issuesQuery.data?.items ?? [];
  const selected = rows.find((issue) => issue.group_id === selectedGroupId) ?? rows[0] ?? null;
  const detailQuery = useQuery({
    ...siteHealthQueries.issue(workspaceId, crawlId, selected?.group_id ?? '', {
      cursor: occurrenceCursor,
      limit: ISSUE_OCCURRENCE_LIMIT,
    }),
    enabled: selected !== null,
  });
  // The rail describes ONE issue, so its header and its occurrences must come
  // from the same one. The detail lags the selection by a request and the
  // previous page is retained meanwhile, so the rail keeps the pair it already
  // has — and marks itself busy — rather than captioning one issue's title
  // over another issue's pages. The list highlight moves on the click.
  const shown = rows.find((issue) => issue.group_id === detailQuery.data?.group_id) ?? selected;
  return { issuesQuery, detailQuery, summary, rows, selected, shown };
}

export function IssuesCatalog({
  workspaceId,
  crawlId,
  notice,
}: Readonly<{
  workspaceId: string;
  crawlId: string;
  /** A refresh failure to report above the catalog it could not refresh. */
  notice?: ReactNode;
}>) {
  const catalog = useIssueFilters();
  const { filters, cursor, selectedGroupId, updateFilters } = catalog;
  const findingView = filters.finding_class;
  const { issuesQuery, detailQuery, summary, rows, selected, shown } = useIssuesCatalogQueries(
    workspaceId,
    crawlId,
    filters,
    cursor,
    selectedGroupId,
    catalog.occurrenceCursor,
  );

  const controls = {
    search: (
      <IssueSearch
        key={filters.query}
        query={filters.query}
        onApply={(query) => updateFilters({ query })}
      />
    ),
    filters: (
      <>
        <PageKindSelect
          value={filters.page_kind}
          onChange={(page_kind) => updateFilters({ page_kind })}
        />
        <FindingClassFilter
          value={findingView}
          summary={summary}
          onChange={(value) => updateFilters(findingClassChange(value))}
        />
        {(['All issues', 'Severity', 'Category'] as const).map((group) => {
          const keys = FILTER_GROUP_KEYS[group];
          const options = issueFilterClasses(findingView).filter((item) => keys.includes(item.key));
          return options.length > 0 ? (
            <SegmentedControl
              key={group}
              value={issueFilterClass(filters)}
              onChange={(value) => updateFilters(issueFilterClassChange(value))}
              ariaLabel={group}
              options={options.map((item) => ({
                value: item.key,
                label: summary
                  ? `${item.label} (${filterCount(item.key, summary, findingView)})`
                  : item.label,
              }))}
            />
          ) : null;
        })}
      </>
    ),
  };

  // Wait for the issues page, and only for that.
  //
  // This used to wait for the first issue's OCCURRENCES as well — a third
  // request that cannot even begin until the second one names an issue. So the
  // whole screen was withheld for three sequential round trips to show a list
  // that the second one had already fully answered.
  //
  // The reason given for waiting was layout: painting the list alone shoved
  // everything down when the summary arrived and left the rail short until the
  // occurrences did. That is an argument for reserving the space, not for
  // showing nothing — and the filters stay in place while it loads.
  if (issuesQuery.isPending && !issuesQuery.data)
    return (
      <PageShell controls={controls}>
        <Stack gap="section" className="min-w-0" aria-busy="true">
          {notice}
          <QueryState kind="loading" label="Loading issues…" />
        </Stack>
      </PageShell>
    );

  let issuesBody: ReactNode = (
    <Card
      // `overflow-clip` (not `hidden`) rounds the corners without becoming a
      // scroll container, so the detail rail stays sticky against the page.
      className={splitPaneClasses('list-detail', 'gap-0 overflow-clip')}
      aria-busy={issuesQuery.isFetching}
    >
      <IssueGroupList
        rows={rows}
        selectedGroupId={selected?.group_id}
        onSelect={catalog.selectIssue}
      />
      {shown ? (
        <IssueDetailRail
          issue={shown}
          crawlId={crawlId}
          detailQuery={detailQuery}
          canPrevious={catalog.canPageOccurrencesBack}
          onPrevious={catalog.previousOccurrences}
          onNext={() => {
            const next = detailQuery.data?.next_cursor;
            if (next) catalog.nextOccurrences(next);
          }}
        />
      ) : null}
    </Card>
  );
  if (issuesQuery.isError) {
    issuesBody = (
      <QueryState
        kind="error"
        error={issuesQuery.error}
        fallback="Could not load issues for this crawl."
        onRetry={() => void issuesQuery.refetch()}
        pending={issuesQuery.isFetching}
      />
    );
  } else if (rows.length === 0) {
    issuesBody = (
      <QueryState kind="empty" icon={ICONS.issues} heading="No issues match this view." />
    );
  }

  return (
    <PageShell controls={controls}>
      <Stack gap="section" className="min-w-0">
        {notice}
        {summary ? <IssueSummary summary={summary} findingView={findingView} /> : null}

        {issuesBody}

        {rows.length > 0 ? (
          <CatalogPager cursor={cursor} page={issuesQuery.data} onGo={catalog.goToPage} />
        ) : null}
      </Stack>
    </PageShell>
  );
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
        onValueChange={setDraft}
        placeholder="Search issues…"
        aria-label="Search issues"
      />
    </form>
  );
}

/**
 * The catalog's page controls.
 *
 * Renders nothing at all when there is no page to go to. It used to render
 * whenever there were rows and then disable both buttons, so a crawl whose
 * issues all fit on one page showed two permanently dead controls — the same
 * noise the one-point trend chart rule exists to prevent.
 *
 * The cursor lives in the URL and the API pages forward only, so the way back
 * is the trail of cursors this view followed; a deep-linked page has none and
 * steps back to the first page.
 */
function CatalogPager({
  cursor,
  page,
  onGo,
}: Readonly<{
  cursor: string | null;
  page: { next_cursor?: string | null } | undefined;
  onGo: (cursor: string | null) => void;
}>) {
  const [trail, setTrail] = useState<(string | null)[]>([]);
  const nextCursor = page?.next_cursor ?? null;
  // A filter change drops the cursor, which starts a new trail.
  const followed = cursor ? trail : [];
  return (
    <Pager
      hideWhenSinglePage
      canPrev={Boolean(cursor)}
      canNext={Boolean(nextCursor)}
      onFirst={() => {
        setTrail([]);
        onGo(null);
      }}
      onPrev={() => {
        setTrail(followed.slice(0, -1));
        onGo(followed.at(-1) ?? null);
      }}
      onNext={() => {
        if (!nextCursor) return;
        setTrail([...followed, cursor]);
        onGo(nextCursor);
      }}
    />
  );
}

function IssueSummary({
  summary,
  findingView,
}: Readonly<{ summary: IssuesSummary; findingView: FindingClass }>) {
  const typeCount =
    findingView === 'defect' ? summary.defect_issue_type_count : summary.advisory_issue_type_count;
  return (
    <div className="border-border-subtle desktop:border-b-0 desktop:pb-0 flex flex-wrap gap-x-8 gap-y-3 border-b pb-3">
      <SummaryMeasure value={typeCount} label={`${findingView} issue types`} />
      <SummaryMeasure value={summary.occurrence_count} label={`${findingView} occurrences`} />
      <SummaryMeasure value={summary.affected_url_count} label="affected URLs" />
    </div>
  );
}

function SummaryMeasure({ value, label }: Readonly<{ value: number; label: string }>) {
  return (
    <span className="flex items-baseline gap-2">
      <span className={textRole('sectionTitle', 'tabular-nums')}>{value}</span>{' '}
      <span className="type-caption">{label}</span>
    </span>
  );
}

function FindingClassFilter({
  value,
  summary,
  onChange,
}: Readonly<{
  value: FindingClass;
  summary: IssuesSummary | null;
  onChange: (value: FindingClass) => void;
}>) {
  return (
    <SegmentedControl
      value={value}
      onChange={onChange}
      ariaLabel="Finding class"
      options={(['defect', 'advisory'] as const).map((view) => ({
        value: view,
        label: findingViewLabel(view, summary),
      }))}
    />
  );
}

function IssueGroupList({
  rows,
  selectedGroupId,
  onSelect,
}: Readonly<{
  rows: SiteIssue[];
  selectedGroupId: string | undefined;
  onSelect: (groupId: string) => void;
}>) {
  return (
    // One vertical list at every width: above the detail when the panes
    // stack, beside it on desktop. A sideways strip of fixed-width cards left
    // a lone issue stranded at a third of the width.
    <div className="border-border-subtle divide-border-subtle desktop:border-r desktop:border-b-0 grid min-w-0 divide-y border-b">
      {rows.map((issue) => {
        const selected = issue.group_id === selectedGroupId;
        return (
          <Pressable
            key={issue.group_id}
            type="button"
            onClick={() => onSelect(issue.group_id)}
            aria-pressed={selected}
            className={cn(
              'focus-ring grid w-full gap-2 px-4 py-3 text-left',
              listRowClasses({ selected }),
            )}
          >
            <span className={textRole('itemTitle')}>{issueTitle(issue)}</span>
            <span className="flex flex-wrap items-center justify-between gap-2">
              <IssueMetadata issue={issue} />
              <span className="type-caption whitespace-nowrap">
                {issue.affected_url_count} {issue.affected_url_count === 1 ? 'page' : 'pages'}
              </span>
            </span>
            <span className="type-caption line-clamp-2">{issue.description}</span>
          </Pressable>
        );
      })}
    </div>
  );
}
