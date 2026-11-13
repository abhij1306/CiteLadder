import type { ComponentProps } from 'react';
import { useNavigate } from 'react-router-dom';

import { Badge } from '@/components/ui/badge';
import { DataTable, type DataTableColumn, type DataTableState } from '@/components/ui/data-table';
import type { FilterBarProps } from '@/components/ui/filter-bar';
import { Inline, Stack } from '@/components/ui/layout';
import { ClampText, mutedWhenMissing, TableCell, TableRow } from '@/components/ui/table';
import { UnavailableValue } from '@/components/ui/unavailable-value';
import { TextLink } from '@/components/ui/text-link';
import type { PagesSort } from '@/lib/api/site-health';
import type { PageSummary } from '@citeladder/contracts';
import { PageKindBadge } from '@/components/site-health/page-kind-badge';
import { RobotsExcludedBadge } from '@/components/site-health/robots-choice';
import {
  DEFAULT_PAGES_SORT,
  PLACEHOLDER,
  formatIssueCount,
  formatScore,
  pageDisplayTitle,
  pageStatusBadgeValue,
  isFetchFailure,
  statusLabel,
} from '@/lib/site-health/status';
import { useProjectHref } from '@/lib/navigation/project-destination';
import { TableTime } from '@/components/ui/display-time';

/**
 * Analyzed-pages table (Slice 7, mockups 712 + 713).
 *
 * Seven columns: the row's ordinal, the page (its title, which links to the
 * per-URL detail, over its URL), the page-kind badge (v2 P1), the issue count,
 * the Web Fundamentals and AEO Readiness scores and the last audit. A page whose
 * analysis has not completed (queued, running, error, blocked…) carries its
 * status badge beside the title, so a failure stays visible on every view.
 * Missing / not-yet-analysed scores render the `Not measured` placeholder —
 * never a fabricated zero (an error/blocked row shows `Not measured`, not 0).
 * The whole row is clickable and navigates to the Slice 8 per-URL detail route
 * (`/site/crawls/[crawlId]/pages/[siteUrlId]`); the title link is the
 * keyboard/screen-reader affordance.
 *
 * Sorting is SERVER-SIDE and keyset-paged: the Page header asks the backend to
 * reorder the whole result set by URL, never the current page window; clicking
 * it again returns to the default (status) order.
 */

/** Where a failing URL is linked from: the first page, and how many more the crawl found. */
function LinkedFromLine({ page }: Readonly<{ page: PageSummary }>) {
  const [first, ...rest] = page.linked_from;
  if (!first || !isFetchFailure(page.analysis_status)) return null;
  return (
    <ClampText lines={1} className="type-caption">
      {rest.length
        ? `Linked from ${first.url} and ${rest.length} more`
        : `Linked from ${first.url}`}
    </ClampText>
  );
}

function pagesColumns(
  sort: PagesSort,
  onSortChange: ((sort: PagesSort) => void) | undefined,
): DataTableColumn[] {
  const byUrl = sort === 'url';
  return [
    { key: 'index', label: '#', width: 'index', numeric: true },
    {
      key: 'page',
      label: 'Page',
      sort: onSortChange
        ? {
            active: byUrl,
            descending: false,
            onSort: () => onSortChange(byUrl ? DEFAULT_PAGES_SORT : 'url'),
          }
        : undefined,
    },
    { key: 'type', label: 'Type', width: 'status' },
    { key: 'issues', label: 'Issues', width: 'figure', numeric: true },
    { key: 'web', label: 'Web Fundamentals', width: 'figure', numeric: true },
    { key: 'aeo', label: 'AEO Readiness', width: 'figure', numeric: true },
    { key: 'audited', label: 'Last Audit', width: 'date' },
  ];
}

export function PagesTable({
  pages,
  crawlId,
  sort = DEFAULT_PAGES_SORT,
  onSortChange,
  state,
  toolbar,
  pager,
  pageSize,
  busy,
  rowOffset = 0,
}: Readonly<{
  pages: PageSummary[];
  crawlId: string;
  /** Rows on the pages before this one, so "#" runs on across keyset pages. */
  rowOffset?: number;
  sort?: PagesSort;
  /** Omitted where the table is read-only; the Page header then renders plain. */
  onSortChange?: (sort: PagesSort) => void;
  /** What the table shows instead of rows (loading, error, empty). */
  state?: DataTableState;
  toolbar?: FilterBarProps;
  pager?: ComponentProps<typeof DataTable>['pager'];
  pageSize?: number;
  busy?: ComponentProps<typeof DataTable>['busy'];
}>) {
  const router = useNavigate();
  const projectHref = useProjectHref();
  const openPage = (siteUrlId: string) => {
    const page = pages.find((row) => row.site_url_id === siteUrlId);
    router(projectHref(`/site/crawls/${page?.crawl_id ?? crawlId}/pages/${siteUrlId}`));
  };
  return (
    <DataTable
      label="Pages"
      columns={pagesColumns(sort, onSortChange)}
      minWidth="md"
      toolbar={toolbar}
      state={state}
      pager={pager}
      pageSize={pageSize}
      rowCount={pages.length}
      busy={busy}
      // Every Pages view shares one footprint, so switching views never moves
      // the sections below the table.
      reserveRows
    >
      {pages.map((page, index) => {
        const title = pageDisplayTitle(page.title, page.display_url);
        return (
          <TableRow
            key={page.site_url_id}
            // Preserve native row/cell semantics; the title is the announced link.
            tabIndex={0}
            onClick={() => openPage(page.site_url_id)}
            onKeyDown={(event) => {
              if (event.key !== 'Enter' && event.key !== ' ') return;
              if (event.target !== event.currentTarget) return;
              event.preventDefault();
              openPage(page.site_url_id);
            }}
            className="focus-ring cursor-pointer"
          >
            <TableCell numeric className="type-caption tabular-nums">
              {rowOffset + index + 1}
            </TableCell>
            {/* A URL is one unbreakable token: every line is clamped to the
                column and carries the full value in a tooltip when cut. */}
            <TableCell>
              <Stack as="span" gap="tight" className="min-w-0">
                <Inline as="span">
                  <ClampText lines={1}>
                    <TextLink
                      text="emphasis"
                      href={`/site/crawls/${page.crawl_id}/pages/${page.site_url_id}`}
                      onClick={(event) => event.stopPropagation()}
                      aria-label={`View ${title} — ${page.display_url}`}
                    >
                      {title}
                    </TextLink>
                  </ClampText>
                  {page.analysis_status === 'completed' ? null : (
                    <Badge variant="status" value={pageStatusBadgeValue(page.analysis_status)}>
                      {statusLabel(page.analysis_status)}
                    </Badge>
                  )}
                  {page.robots_excluded ? <RobotsExcludedBadge /> : null}
                </Inline>
                <ClampText lines={1} className="type-caption tabular-nums">
                  {page.display_url}
                </ClampText>
                <LinkedFromLine page={page} />
              </Stack>
            </TableCell>
            <TableCell className="whitespace-nowrap">
              <PageKindBadge pageKind={page.page_kind} />
            </TableCell>
            <TableCell numeric className="tabular-nums">
              <Measured value={formatIssueCount(page.issue_count)} />
            </TableCell>
            <TableCell numeric className={mutedWhenMissing(page.web_fundamentals_score)}>
              <MeasurementValue
                score={page.web_fundamentals_score}
                state={page.web_fundamentals_state}
              />
            </TableCell>
            <TableCell numeric className={mutedWhenMissing(page.aeo_readiness_score)}>
              <MeasurementValue
                score={page.aeo_readiness_score}
                state={page.aeo_measurement_state}
              />
            </TableCell>
            <TableCell>
              <TableTime
                value={page.last_audited}
                fallback={<UnavailableValue state="not_measured" />}
              />
            </TableCell>
          </TableRow>
        );
      })}
    </DataTable>
  );
}

/**
 * A formatted string, or the shared mark when the formatter had nothing to
 * format. The formatters answer in words so the value carries its own meaning;
 * this is where those words become the mark that the rest of the table uses.
 */
function Measured({ value }: Readonly<{ value: string }>) {
  return value === PLACEHOLDER ? <UnavailableValue state="not_measured" /> : <>{value}</>;
}

/**
 * A measured score is the number alone (owner, 2026-11-10: no evidence
 * caption under it); only a score with no value names its state.
 */
function MeasurementValue({ score, state }: Readonly<{ score: number | null; state: string }>) {
  if (score === null) return measurementStateValue(state);
  return formatScore(score);
}

function measurementStateValue(state: string) {
  if (state === 'limited_evidence') return 'Limited evidence';
  if (state === 'excluded') return 'Excluded';
  return <UnavailableValue state="not_measured" />;
}
