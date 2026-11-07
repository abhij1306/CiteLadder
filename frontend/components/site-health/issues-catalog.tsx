'use client';

import { useMemo, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { X } from 'lucide-react';

import { ListScreen } from '@/components/layout/page-shell';
import { Inline, Stack } from '@/components/ui/layout';
import { IssueDetailRail } from '@/components/site-health/issue-detail-rail';
import { IssueMetadata } from '@/components/site-health/issue-metadata';
import { PageKindSelect } from '@/components/site-health/page-kind-select';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { ListDetailCard, ListDetailRow } from '@/components/ui/list-detail';
import { Pager } from '@/components/ui/pager';
import { QueryState } from '@/components/ui/query-state';
import { SearchField } from '@/components/ui/search-field';
import { SegmentedControl } from '@/components/ui/tabs';
import { siteHealthQueries } from '@/lib/api/site-health-queries';
import { ICONS } from '@/lib/icons';
import { ISSUE_OCCURRENCE_LIMIT } from '@/lib/config/site-health';
import type { IssuesSummary, SiteIssue } from '@citeladder/contracts';
import {
  findingClassChange,
  issueFilterClass,
  issueFilterClassChange,
  issueFilterClasses,
  issueCatalogParams,
  useIssueFilters,
  type FindingClass,
  type IssueFilterClass,
  type IssueFilters,
} from '@/lib/site-health/issue-filters';
import { issueTitle } from '@/lib/site-health/issues';
import { InlineFigure, textRole } from '@/components/ui/typography';
import { FilterChoice } from '@/components/ui/filter-bar';
import { formatCount } from '@/lib/format';

/** The toggle's count, only once a summary has landed. */
function findingViewCount(view: FindingClass, summary: IssuesSummary | null): number | undefined {
  if (!summary) return undefined;
  return view === 'defect' ? summary.defect_issue_type_count : summary.advisory_issue_type_count;
}

function filterCount(filter: IssueFilterClass, summary: IssuesSummary, view: FindingClass): number {
  if (filter === 'high')
    return (summary.severity_counts.high ?? 0) + (summary.severity_counts.critical ?? 0);
  if (filter === 'medium' || filter === 'low') return summary.severity_counts[filter] ?? 0;
  if (filter === 'technical' || filter === 'aeo') return summary.dimension_counts[filter] ?? 0;
  return view === 'defect' ? summary.defect_issue_type_count : summary.advisory_issue_type_count;
}

/**
 * The issue page and the occurrences of whichever issue the rail shows, with
 * no request waiting on another: a selection named in the address starts its
 * detail alongside the list, and the default selection (the first row) rides
 * the list response itself.
 */
function useIssuesCatalogQueries(
  workspaceId: string,
  crawlId: string,
  filters: IssueFilters,
  cursor: string | null,
  selectedGroupId: string | null,
  occurrenceCursor: string | undefined,
) {
  const params = useMemo(() => issueCatalogParams(filters, cursor), [filters, cursor]);
  const issuesQuery = useQuery(siteHealthQueries.issues(workspaceId, crawlId, params));
  const summary = issuesQuery.data?.summary ?? null;
  const rows = issuesQuery.data?.items ?? [];
  const selected = rows.find((issue) => issue.group_id === selectedGroupId) ?? rows[0] ?? null;
  // Until the list lands, the address names the issue to read. Once it has,
  // the row actually selected does: an address issue missing from this page
  // falls back to the first row, as the highlight does.
  const detailGroupId = issuesQuery.data ? (selected?.group_id ?? null) : selectedGroupId;
  const embedded = issuesQuery.data?.first_issue;
  const detailQuery = useQuery({
    // The rail lists the pages its row counted, so it takes the row's page-kind filter.
    ...siteHealthQueries.issue(workspaceId, crawlId, detailGroupId ?? '', {
      cursor: occurrenceCursor,
      limit: ISSUE_OCCURRENCE_LIMIT,
      page_kind: filters.page_kind || undefined,
    }),
    enabled: detailGroupId !== null,
    // The list carried this exact first page of the first row's detail.
    initialData: () =>
      embedded && embedded.group_id === detailGroupId && !occurrenceCursor ? embedded : undefined,
    initialDataUpdatedAt: issuesQuery.dataUpdatedAt,
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
        {/* Severity and category share one menu: as three segmented groups
            the band wrapped to two rows at the owner's 982px. */}
        <FilterChoice
          label="Severity or category"
          value={issueFilterClass(filters)}
          defaultValue="all"
          onChange={(value) => updateFilters(issueFilterClassChange(value))}
          options={issueFilterClasses(findingView).map((item) => ({
            value: item.key,
            label: summary
              ? `${item.label} (${filterCount(item.key, summary, findingView)})`
              : item.label,
          }))}
        />
        {/* Last in the strip, so clearing it moves no other control. */}
        {filters.rule_id ? (
          <RuleFilterChip
            title={ruleFilterTitle(rows, filters.rule_id)}
            onClear={() => updateFilters({ rule_id: '' })}
          />
        ) : null}
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
      <ListScreen controls={controls}>
        <Stack gap="section" className="min-w-0" aria-busy="true">
          {notice}
          <QueryState kind="loading" label="Loading issues…" />
        </Stack>
      </ListScreen>
    );

  let issuesBody: ReactNode = (
    <ListDetailCard
      busy={issuesQuery.isFetching}
      list={
        <IssueGroupList
          rows={rows}
          selectedGroupId={selected?.group_id}
          onSelect={catalog.selectIssue}
        />
      }
      detail={
        shown ? (
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
        ) : null
      }
    />
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
      <QueryState kind="empty" icon={ICONS.issues} heading="No issues match this view" />
    );
  }

  return (
    <ListScreen controls={controls}>
      <Stack gap="section" className="min-w-0">
        {notice}
        {/* The summary line belongs to the list it counts: it sits the
            Overview crawl line's compact gap above it, not a section apart. */}
        <Stack className="min-w-0">
          {summary ? <IssueSummary summary={summary} findingView={findingView} /> : null}
          {issuesBody}
        </Stack>

        {rows.length > 0 ? (
          <CatalogPager cursor={cursor} page={issuesQuery.data} onGo={catalog.goToPage} />
        ) : null}
      </Stack>
    </ListScreen>
  );
}

/** The deep-linked issue's title, from the rows it filtered to; never its rule id. */
function ruleFilterTitle(rows: SiteIssue[], ruleId: string): string {
  const row = rows.find((issue) => issue.rule_id === ruleId);
  return row ? issueTitle(row) : 'one issue';
}

/** A deep link's one-issue filter, visible and removable rather than silent. */
function RuleFilterChip({ title, onClear }: Readonly<{ title: string; onClear: () => void }>) {
  return (
    <Button variant="secondary" onClick={onClear}>
      Showing: {title}
      <Icon icon={X} />
      <span className="sr-only">(show all issues)</span>
    </Button>
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
  const defects = findingView === 'defect';
  const typeCount = defects ? summary.defect_issue_type_count : summary.advisory_issue_type_count;
  return (
    <p className="type-body">
      <SummaryCount
        value={typeCount}
        singular={defects ? 'issue' : 'advisory'}
        plural={defects ? 'issues' : 'advisories'}
      />
      <span aria-hidden> · </span>
      <SummaryCount value={summary.occurrence_count} singular="occurrence" plural="occurrences" />
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
        label: view === 'defect' ? 'Issues' : 'Advisories',
        count: findingViewCount(view, summary),
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
  return rows.map((issue) => (
    <ListDetailRow
      key={issue.group_id}
      selected={issue.group_id === selectedGroupId}
      onSelect={() => onSelect(issue.group_id)}
    >
      <span className={textRole('itemTitle')}>{issueTitle(issue)}</span>
      <Inline as="span" className="flex-wrap justify-between">
        <IssueMetadata issue={issue} />
        <span className="type-caption whitespace-nowrap">
          <InlineFigure>{formatCount(issue.affected_url_count)}</InlineFigure>{' '}
          {issue.affected_url_count === 1 ? 'page' : 'pages'}
        </span>
      </Inline>
    </ListDetailRow>
  ));
}
