import type { ComponentProps } from 'react';
import { useNavigate } from 'react-router-dom';

import { StatusMark } from '@/components/ui/status-mark';
import { DataTable, type DataTableColumn, type DataTableState } from '@/components/ui/data-table';
import type { FilterBarProps } from '@/components/ui/filter-bar';
import { Inline, Stack } from '@/components/ui/layout';
import { ClampText } from '@/components/ui/clamp-text';
import { mutedWhenMissing, TableCell, TableRow, TableTime, UrlText } from '@/components/ui/table';
import { sharedOrigin } from '@/lib/format';
import { Absence, printed } from '@/components/ui/absence';
import { TextLink } from '@/components/ui/text-link';
import type { PagesSort } from '@/lib/api/site-health';
import type { PageSummary } from '@citeladder/contracts';
import { PageKindBadge } from '@/components/site-health/page-kind-badge';
import { RobotsExcludedBadge } from '@/components/site-health/robots-choice';
import {
  checksRunLabel,
  DEFAULT_PAGES_SORT,
  formatIssueCount,
  formatScore,
  pageDisplayTitle,
  pageStatusBadgeValue,
  isFetchFailure,
  statusLabel,
  type ChecksRun,
} from '@/lib/site-health/status';
import { useProjectHref } from '@/lib/navigation/project-destination';
import { scoreBand, type ScoreBand } from '@/lib/score-band';

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
  const sortBy = (key: PagesSort, descending: boolean) =>
    onSortChange
      ? {
          active: sort === key,
          descending,
          onSort: () => onSortChange(sort === key ? DEFAULT_PAGES_SORT : key),
        }
      : undefined;
  return [
    { key: 'page', label: 'Page', kind: 'identity', sort: sortBy('url', false) },
    { key: 'status', label: 'Status', kind: 'status', sort: sortBy('status', false) },
    { key: 'type', label: 'Type', kind: 'status', width: 'category', priority: 'low' },
    { key: 'issues', label: 'Issues', kind: 'number', width: 'figure' },
    { key: 'web', label: 'Web fundamentals', kind: 'number', width: 'figure' },
    { key: 'aeo', label: 'AEO readiness', kind: 'number', width: 'figure' },
    { key: 'depth', label: 'Depth', kind: 'number', priority: 'low', sort: sortBy('depth', false) },
    {
      key: 'inlinks',
      label: 'Inlinks',
      kind: 'number',
      priority: 'low',
      sort: sortBy('inbound', true),
    },
    { key: 'audited', label: 'Last audit', kind: 'date', width: 'metric', priority: 'low' },
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
}: Readonly<{
  pages: PageSummary[];
  crawlId: string;
  sort?: PagesSort;
  onSortChange?: (sort: PagesSort) => void;
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
  const origin = sharedOrigin(pages.map((page) => page.display_url));
  return (
    <DataTable
      label="Pages"
      columns={pagesColumns(sort, onSortChange)}
      toolbar={toolbar}
      state={state}
      pager={pager}
      pageSize={pageSize}
      rowCount={pages.length}
      busy={busy}
      reserveRows
    >
      {pages.map((page) => {
        const title = pageDisplayTitle(page.title, page.display_url);
        return (
          <TableRow
            key={page.site_url_id}
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
            <TableCell>
              <Stack as="span" gap="tight" className="min-w-0">
                <Inline as="span" className="phone:flex-wrap">
                  <ClampText className="max-w-full shrink-0">
                    <TextLink
                      text="emphasis"
                      underline="hover"
                      href={`/site/crawls/${page.crawl_id}/pages/${page.site_url_id}`}
                      onClick={(event) => event.stopPropagation()}
                      aria-label={`View ${title}, ${page.display_url}`}
                    >
                      {title}
                    </TextLink>
                  </ClampText>
                  {page.robots_excluded ? <RobotsExcludedBadge /> : null}
                  <span className="text-ink-2 min-w-0 overflow-hidden">
                    <UrlText url={page.display_url} origin={origin} />
                  </span>
                </Inline>
                <LinkedFromLine page={page} />
              </Stack>
            </TableCell>
            <TableCell className="whitespace-nowrap">
              <StatusMark variant="status" value={pageStatusBadgeValue(page.analysis_status)}>
                {statusLabel(page.analysis_status)}
              </StatusMark>
            </TableCell>
            <TableCell className="whitespace-nowrap">
              <PageKindBadge pageKind={page.page_kind} />
            </TableCell>
            <TableCell numeric className={page.issue_count === 0 ? 'text-ink-2' : undefined}>
              {formatIssueCount(page.issue_count)}
            </TableCell>
            <TableCell numeric className={mutedWhenMissing(page.web_fundamentals_score)}>
              <MeasurementValue
                score={page.web_fundamentals_score}
                checks={page.web_fundamentals_checks}
                state={page.web_fundamentals_state}
              />
            </TableCell>
            <TableCell numeric className={mutedWhenMissing(page.aeo_readiness_score)}>
              <MeasurementValue
                score={page.aeo_readiness_score}
                checks={page.aeo_readiness_checks}
                state={page.aeo_measurement_state}
              />
            </TableCell>
            <TableCell numeric className={mutedWhenMissing(page.depth_from_home)}>
              <DepthValue page={page} />
            </TableCell>
            <TableCell numeric className={mutedWhenMissing(page.inbound_count)}>
              {page.inbound_count ?? <Absence state="not_measured" />}
            </TableCell>
            <TableCell>
              <TableTime value={page.last_audited} fallback={<Absence state="not_measured" />} />
            </TableCell>
          </TableRow>
        );
      })}
    </DataTable>
  );
}

function DepthValue({ page }: Readonly<{ page: PageSummary }>) {
  if (page.depth_from_home !== null) return page.depth_from_home;
  if (page.inbound_count === null) return <Absence state="not_measured" />;
  return 'Not reached';
}

function MeasurementValue({
  score,
  checks,
  state,
}: Readonly<{ score: number | null; checks: ChecksRun | null; state: string }>) {
  if (score === null) return measurementStateValue(state, checks);
  return (
    <span className={SCORE_TONE[scoreBand(Math.round(score))]}>{printed(formatScore(score))}</span>
  );
}

const SCORE_TONE = {
  low: 'text-negative font-medium',
  mid: 'text-warning font-medium',
  high: undefined,
} satisfies Record<ScoreBand, string | undefined>;

function measurementStateValue(state: string, checks: ChecksRun | null) {
  const run = checksRunLabel(checks);
  if (run) return run;
  if (state === 'excluded') return 'Excluded';
  return <Absence state="not_measured" />;
}
