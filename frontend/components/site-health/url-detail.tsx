import { useRef, useState, type MutableRefObject } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { History } from 'lucide-react';

import { Callout } from '@/components/ui/callout';
import { QueryState } from '@/components/ui/query-state';
import { Badge } from '@/components/ui/badge';
import { DataTable, type DataTableColumn } from '@/components/ui/data-table';
import { TableCell, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Drawer } from '@/components/ui/drawer';
import { siteHealthMutations, siteHealthQueries } from '@/lib/api/site-health-queries';
import type { PageDetail } from '@citeladder/contracts';
import { ApiError } from '@/lib/api/errors';
import { RERUN_MAX_PRE_ACTIVE_POLLS, RERUN_POLL_INTERVAL_MS } from '@/lib/config/site-health';
import {
  dimensionLabel,
  issueTitle,
  severityBadgeValue,
  severityLabel,
} from '@/lib/site-health/issues';
import { formatAudited } from '@/lib/site-health/status';
import { useDisplayTimeZone } from '@/lib/display-timezone';
import { useCursorTableQuery } from '@/lib/table/use-cursor-table-query';

import { PAGE_DETAIL_BACK, UrlDetailView } from './url-detail-view';
import { DetailScreen } from '@/components/layout/page-shell';
import { useProjectScope } from '@/lib/project/active-project-scope';
import { useWorkspaceCapability } from '@/lib/project/project-context';

const HISTORY_LIMIT = 25;
const RERUN_SEARCH_PARAM = 'rerun';

/** Query and rerun controller for a crawl-bounded Site Health URL detail. */
/** `/site/crawls/:crawlId/pages/:siteUrlId`: one crawl-bounded page detail. */
export function PageDetailScreen() {
  const { crawlId, siteUrlId } = useParams<{ crawlId: string; siteUrlId: string }>();
  if (!crawlId || !siteUrlId) return null;
  // Keyed, so a re-audit's navigation to its own crawl starts fresh and polls.
  return <UrlDetail key={`${crawlId}:${siteUrlId}`} crawlId={crawlId} siteUrlId={siteUrlId} />;
}

export function UrlDetail({
  crawlId,
  siteUrlId,
}: Readonly<{ crawlId: string; siteUrlId: string }>) {
  const { workspaceId } = useProjectScope();
  const router = useNavigate();
  const searchParams = useSearchParams()[0];
  // A re-audit navigates to its own crawl's page with `?rerun=1`; poll from
  // mount so its queued/running progress shows without a manual reload.
  const [rerunPolling] = useState(() => searchParams.get(RERUN_SEARCH_PARAM) === '1');
  // The cache can still hold the prior terminal snapshot immediately after a
  // rerun succeeds. Polling must continue until the fresh queued/running state
  // has been observed, rather than treating that stale terminal status as done.
  const hasObservedActiveRerunRef = useRef(false);
  const preActivePollCountRef = useRef(0);
  const [rerunError, setRerunError] = useState<string | null>(null);
  const detailQuery = useQuery({
    ...siteHealthQueries.page(workspaceId, crawlId, siteUrlId),
    refetchInterval: (query) =>
      rerunPollInterval(
        rerunPolling,
        query.state.data?.analysis_status,
        hasObservedActiveRerunRef,
        preActivePollCountRef,
      ),
  });
  // A re-audit is always its own one-page crawl: follow it to that crawl's page.
  const rerun = useMutation(siteHealthMutations.rerunPage(workspaceId));
  // A re-audit is a crawl, offered only to a role that may run one.
  const canRun = useWorkspaceCapability('run');
  const startRerun = () =>
    rerun.mutate(
      { crawlId, siteUrlId },
      {
        onSuccess: (result) =>
          router(
            `/site/crawls/${result.crawl_id}/pages/${result.site_url_id}?${RERUN_SEARCH_PARAM}=1`,
          ),
        onError: (error) => setRerunError(rerunErrorMessage(error)),
      },
    );

  if (detailQuery.isLoading)
    return (
      <DetailScreen back={PAGE_DETAIL_BACK}>
        <QueryState kind="loading" label="Loading page detail…" />
      </DetailScreen>
    );
  if (detailQuery.isError || !detailQuery.data) {
    return (
      <DetailScreen back={PAGE_DETAIL_BACK}>
        <QueryState
          kind="error"
          error={detailQuery.error}
          fallback="Could not load this page. It may not exist in this crawl."
          onRetry={() => void detailQuery.refetch()}
          pending={detailQuery.isFetching}
        />
      </DetailScreen>
    );
  }

  return (
    <UrlDetailView
      detail={detailQuery.data}
      rerun={
        canRun
          ? {
              busy: rerun.isPending,
              onRerun: () => {
                setRerunError(null);
                startRerun();
              },
            }
          : undefined
      }
      history={
        <IssueHistoryButton
          // A finished re-audit changes what is resolved: start the history over.
          key={`history:${crawlId}:${siteUrlId}:${detailQuery.data.last_audited ?? ''}`}
          workspaceId={workspaceId}
          crawlId={crawlId}
          siteUrlId={siteUrlId}
        />
      }
    >
      {rerunError ? <Callout tone="negative">{rerunError}</Callout> : null}
    </UrlDetailView>
  );
}

function rerunPollInterval(
  polling: boolean,
  status: PageDetail['analysis_status'] | undefined,
  observedActive: MutableRefObject<boolean>,
  preActivePollCount: MutableRefObject<number>,
): number | false {
  if (!polling) return false;
  if (status === 'pending' || status === 'running') {
    observedActive.current = true;
    preActivePollCount.current = 0;
    return RERUN_POLL_INTERVAL_MS;
  }
  if (status === undefined || !observedActive.current) {
    if (preActivePollCount.current >= RERUN_MAX_PRE_ACTIVE_POLLS) return false;
    preActivePollCount.current += 1;
    return RERUN_POLL_INTERVAL_MS;
  }
  return false;
}

function rerunErrorMessage(error: unknown): string {
  if (error instanceof ApiError && error.code === 'crawl_already_active')
    return 'A crawl is running. Re-audit this page when it finishes.';
  if (error instanceof ApiError && error.status === 409)
    return 'This page is not in your monitored set, so it can’t be re-audited.';
  if (error instanceof ApiError && error.status === 403)
    return 'You do not have permission to re-audit pages in this workspace.';
  return 'Could not re-audit this page. Please try again.';
}

type HistoryTarget = Readonly<{ workspaceId: string; crawlId: string; siteUrlId: string }>;

/** Opens the page's resolved issues in a drawer; nothing is read until it opens. */
function IssueHistoryButton(target: HistoryTarget) {
  const [open, setOpen] = useState(false);
  // Read on first open, then kept so the drawer does not blank as it closes.
  const [requested, setRequested] = useState(false);
  return (
    <>
      <Button
        variant="ghost"
        onClick={() => {
          setRequested(true);
          setOpen(true);
        }}
      >
        History
      </Button>
      <Drawer
        open={open}
        onOpenChange={setOpen}
        title="Issue history"
        description="Issues found on this page before that this crawl no longer reports."
      >
        {requested ? <IssueHistory {...target} /> : null}
      </Drawer>
    </>
  );
}

function IssueHistory({ workspaceId, crawlId, siteUrlId }: HistoryTarget) {
  const timeZone = useDisplayTimeZone();
  // A page turn keeps the rows and the pager in place until the next page
  // lands; the first load, a failed read and an empty history draw inside the
  // table at the height of a full page.
  const { page, table } = useCursorTableQuery({
    workspaceId,
    scopeId: crawlId,
    scope: siteUrlId,
    query: (request) => ({
      ...siteHealthQueries.issueHistory(workspaceId, crawlId, siteUrlId, request),
      // Read fresh each time the drawer is first opened for an audit.
      staleTime: 0,
    }),
    noun: 'resolved issues',
    loading: 'Loading issue history…',
    error: 'Could not load issue history.',
    empty: (current) => ({
      kind: 'empty',
      icon: History,
      headingLevel: 3,
      heading: current.current_analysis_finalized
        ? 'No resolved issues for this page'
        : 'Resolved issues are known once this page’s current analysis finishes',
    }),
    fixedPageSize: HISTORY_LIMIT,
  });

  return (
    <DataTable label="Resolved issues" columns={HISTORY_COLUMNS} nested {...table}>
      {page?.items.map((row) => (
        <TableRow key={row.id}>
          <TableCell>{issueTitle(row)}</TableCell>
          <TableCell>
            <Badge>{dimensionLabel(row.dimension)}</Badge>
          </TableCell>
          <TableCell>
            <Badge variant="status" value={severityBadgeValue(row.severity)}>
              {severityLabel(row.severity)}
            </Badge>
          </TableCell>
          <TableCell numeric>{formatAudited(row.created_at, timeZone)}</TableCell>
        </TableRow>
      ))}
    </DataTable>
  );
}

const HISTORY_COLUMNS: readonly DataTableColumn[] = [
  { key: 'issue', label: 'Issue' },
  { key: 'dimension', label: 'Dimension', width: 'name' },
  { key: 'severity', label: 'Severity', width: 'status' },
  { key: 'found', label: 'Last found', width: 'date', numeric: true },
];
