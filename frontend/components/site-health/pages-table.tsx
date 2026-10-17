'use client';

import { useNavigate } from 'react-router-dom';

import { Badge } from '@/components/ui/badge';
import {
  ClampText,
  SortableTableHead,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { scoreTextClass } from '@/components/ui/score-band';
import { UnavailableValue } from '@/components/ui/unavailable-value';
import { TextLink } from '@/components/ui/text-link';
import { cn } from '@/lib/utils';
import type { PagesSort } from '@/lib/api/site-health';
import type { PageSummary } from '@/lib/api/types';
import { PageKindBadge } from '@/components/site-health/page-kind-badge';
import {
  PLACEHOLDER,
  formatAudited,
  formatIssueCount,
  formatScore,
  pageDisplayTitle,
  pageStatusBadgeValue,
  isFetchFailure,
  statusLabel,
} from '@/lib/site-health/status';
import { textRole } from '@/components/ui/typography';
import { useProjectHref } from '@/lib/navigation/project-destination';
import { useDisplayTimeZone } from '@/lib/display-timezone';

/**
 * Analyzed-pages table (Slice 7, mockups 712 + 713).
 *
 * Renders one row per analyzed page: URL (+ path), the page-kind badge (v2
 * P1), a per-page analysis status badge (queued/running/completed/error/
 * blocked), issue count, Web Fundamentals / AEO scores, the crawl's internal-link
 * metrics, last audited, and a View action. Missing / not-yet-analysed scores and
 * unmeasured link metrics render the `Not measured` placeholder — never a
 * fabricated zero (an error/blocked row shows `Not measured`, not 0; a page with no
 * metric row is unmeasured, not unlinked). The whole row is clickable and navigates
 * to the Slice 8 per-URL detail route (`/site/crawls/[crawlId]/pages/[siteUrlId]`);
 * the View link remains as the keyboard/screen-reader affordance.
 *
 * Sorting is SERVER-SIDE and keyset-paged: each link column asks the backend to
 * reorder the whole result set, never the current page window. Each sort has one
 * meaningful direction (most-linked first, shallowest first), so a header selects
 * a sort rather than toggling one.
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

const LINK_COLUMNS: ReadonlyArray<{
  sort: Exclude<PagesSort, 'url'>;
  label: string;
  descending: boolean;
  value: (page: PageSummary) => number | null;
}> = [
  {
    sort: 'inbound',
    label: 'Inbound',
    descending: true,
    value: (page) => page.inbound_count,
  },
];

export function PagesTable({
  pages,
  crawlId,
  sort = 'status',
  onSortChange,
}: Readonly<{
  pages: PageSummary[];
  crawlId: string;
  sort?: PagesSort;
  /** Omitted where the table is read-only; the link headers then render plain. */
  onSortChange?: (sort: PagesSort) => void;
}>) {
  const router = useNavigate();
  const timeZone = useDisplayTimeZone();
  const projectHref = useProjectHref();
  const openPage = (siteUrlId: string) => {
    const page = pages.find((row) => row.site_url_id === siteUrlId);
    router(projectHref(`/site/crawls/${page?.crawl_id ?? crawlId}/pages/${siteUrlId}`));
  };
  return (
    <Table minWidth="xl">
      <TableHeader>
        <TableRow>
          <TableHead numeric className="w-10">
            #
          </TableHead>
          {onSortChange ? (
            <SortableTableHead
              label="Page URL"
              active={sort === 'url'}
              descending={false}
              onSort={() => onSortChange(sort === 'url' ? 'status' : 'url')}
            />
          ) : (
            <TableHead>Page URL</TableHead>
          )}
          <TableHead>Type</TableHead>
          {onSortChange ? (
            <SortableTableHead
              label="Status"
              active={sort === 'status'}
              descending={false}
              onSort={() => onSortChange('status')}
            />
          ) : (
            <TableHead>Status</TableHead>
          )}
          <TableHead numeric>Issues</TableHead>
          <TableHead numeric>Web Fundamentals</TableHead>
          <TableHead numeric>AEO Readiness</TableHead>
          <TableHead numeric>AEO Coverage</TableHead>
          {LINK_COLUMNS.map((column) =>
            onSortChange ? (
              <SortableTableHead
                key={column.sort}
                label={column.label}
                active={sort === column.sort}
                descending={column.descending}
                numeric
                onSort={() => onSortChange(sort === column.sort ? 'status' : column.sort)}
              />
            ) : (
              <TableHead key={column.sort} numeric>
                {column.label}
              </TableHead>
            ),
          )}
          <TableHead>Main-content indexable</TableHead>
          <TableHead>Last Audit</TableHead>
          <TableHead className="w-16" />
        </TableRow>
      </TableHeader>
      <TableBody>
        {pages.map((page, index) => (
          <TableRow
            key={page.site_url_id}
            // Preserve native row/cell semantics; View is the announced link.
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
              {index + 1}
            </TableCell>
            {/* A URL is one unbreakable token, so an untruncated cell takes its
                full max-content width and shoves every following column off
                screen — one tracking-parameter URL was enough to make the
                table unreadable. Both lines are clamped to a fixed column and
                carry the full value in a tooltip when cut. */}
            {/* The clamp lives on the inner box, not the `<td>`: under the
                default `table-layout: auto` browsers treat `max-width` on a
                cell as advisory and size the column to content anyway. */}
            <TableCell>
              <span className="flex w-72 min-w-0 flex-col">
                <ClampText lines={1} className={textRole('emphasis', 'text-foreground')}>
                  {pageDisplayTitle(page.title, page.display_url)}
                </ClampText>
                <ClampText lines={1} className="type-caption tabular-nums">
                  {page.display_url}
                </ClampText>
                <LinkedFromLine page={page} />
              </span>
            </TableCell>
            <TableCell className="whitespace-nowrap">
              <PageKindBadge pageKind={page.page_kind} />
            </TableCell>
            <TableCell className="whitespace-nowrap">
              <Badge variant="status" value={pageStatusBadgeValue(page.analysis_status)}>
                {statusLabel(page.analysis_status)}
              </Badge>
            </TableCell>
            <TableCell
              numeric
              className={cn(
                'tabular-nums',
                page.issue_count !== null && page.issue_count > 0 && 'text-danger-text',
              )}
            >
              <Measured value={formatIssueCount(page.issue_count)} />
            </TableCell>
            <TableCell numeric className={scoreTextClass(page.web_fundamentals_score)}>
              <MeasurementValue
                score={page.web_fundamentals_score}
                coverage={page.web_fundamentals_coverage}
                state={page.web_fundamentals_state}
              />
            </TableCell>
            <TableCell numeric className={scoreTextClass(page.aeo_readiness_score)}>
              <MeasurementValue
                score={page.aeo_readiness_score}
                coverage={page.aeo_measurement_coverage}
                state={page.aeo_measurement_state}
              />
            </TableCell>
            <TableCell numeric>
              {page.aeo_measurement_coverage === null
                ? measurementStateValue(page.aeo_measurement_state)
                : `${Math.round(page.aeo_measurement_coverage * 100)}%`}
            </TableCell>
            {LINK_COLUMNS.map((column) => {
              const value = column.value(page);
              return (
                <TableCell
                  key={column.sort}
                  numeric
                  className={cn('tabular-nums', value === null ? 'type-caption' : 'text-secondary')}
                >
                  {value ?? <UnavailableValue state="not_measured" />}
                </TableCell>
              );
            })}
            <TableCell className="type-caption whitespace-nowrap">
              {page.main_content_indexable === null ? (
                <UnavailableValue state="not_measured" />
              ) : (
                formatIndexability(page.main_content_indexable)
              )}
            </TableCell>
            <TableCell className="type-caption whitespace-nowrap">
              <Measured value={formatAudited(page.last_audited, timeZone)} />
            </TableCell>
            <TableCell>
              <TextLink
                text="label"
                href={`/site/crawls/${page.crawl_id}/pages/${page.site_url_id}`}
                onClick={(event) => event.stopPropagation()}
                aria-label={`View ${pageDisplayTitle(page.title, page.display_url)} — ${page.display_url}`}
              >
                View
              </TextLink>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function formatIndexability(value: boolean | null) {
  if (value === null) return PLACEHOLDER;
  return value ? 'Indexable' : 'Blocked';
}

/**
 * A formatted string, or the shared mark when the formatter had nothing to
 * format. The formatters answer in words so the value carries its own meaning;
 * this is where those words become the mark that the rest of the table uses.
 */
function Measured({ value }: Readonly<{ value: string }>) {
  return value === PLACEHOLDER ? <UnavailableValue state="not_measured" /> : <>{value}</>;
}

function MeasurementValue({
  score,
  state,
}: Readonly<{ score: number | null; coverage: number | null; state: string }>) {
  if (score === null) return measurementStateValue(state);
  return formatScore(score);
}

function measurementStateValue(state: string) {
  const label = measurementStateLabel(state);
  return label === PLACEHOLDER ? <UnavailableValue state="not_measured" /> : label;
}

function measurementStateLabel(state: string): string {
  if (state === 'limited_evidence') return 'Limited evidence';
  if (state === 'excluded') return 'Excluded';
  return PLACEHOLDER;
}
