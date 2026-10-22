'use client';

import { useRef, useState, type MutableRefObject } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { Alert } from '@/components/ui/alert';
import { QueryState } from '@/components/ui/query-state';
import { Badge } from '@/components/ui/badge';
import { Pager } from '@/components/ui/pager';
import { Button } from '@/components/ui/button';
import { Drawer } from '@/components/ui/drawer';
import { queryKeys } from '@/lib/api/query-keys';
import { siteHealthMutations, siteHealthQueries } from '@/lib/api/site-health';
import type { IssueHistoryPage, PageDetail } from '@/lib/api/types';
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
import { cursorControls, useCursorTable } from '@/lib/table/use-cursor-table';

import { UrlDetailView } from './url-detail-view';
import { Inline, Stack } from '@/components/ui/layout';
import { ledgerClasses, ledgerItemClasses } from '@/components/ui/workspace';
import { ListScreen } from '@/components/layout/page-shell';
import { useActiveWorkspaceId } from '@/lib/project/project-context';

const HISTORY_LIMIT = 25;
const RERUN_SEARCH_PARAM = 'rerun';

/** Query and rerun controller for a crawl-bounded Site Health URL detail. */
export function UrlDetail({
  crawlId,
  siteUrlId,
}: Readonly<{ crawlId: string; siteUrlId: string }>) {
  const workspaceId = useActiveWorkspaceId();
  const router = useNavigate();
  const queryClient = useQueryClient();
  const searchParams = useSearchParams()[0];
  // A rerun that minted a NEW crawl navigates here with `?rerun=1`; start
  // polling on mount so the fresh run's queued/running progress is observed
  // without a manual reload.
  const [rerunPolling, setRerunPolling] = useState(
    () => searchParams.get(RERUN_SEARCH_PARAM) === '1',
  );
  // The cache can still hold the prior terminal snapshot immediately after a
  // rerun succeeds. Polling must continue until the fresh queued/running state
  // has been observed, rather than treating that stale terminal status as done.
  const hasObservedActiveRerunRef = useRef(false);
  const preActivePollCountRef = useRef(0);
  const [rerunQueued, setRerunQueued] = useState(false);
  const [rerunError, setRerunError] = useState<string | null>(null);
  const detailQuery = useQuery({
    ...siteHealthQueries.page(workspaceId ?? '', crawlId, siteUrlId),
    enabled: Boolean(workspaceId),
    refetchInterval: (query) =>
      rerunPollInterval(
        rerunPolling,
        query.state.data?.analysis_status,
        hasObservedActiveRerunRef,
        preActivePollCountRef,
      ),
  });
  const rerun = useMutation({
    ...siteHealthMutations.rerunPage(workspaceId ?? ''),
    onSuccess: async (result) => {
      if (result.crawl_id === crawlId && result.site_url_id === siteUrlId) {
        // Invalidate before enabling polling: setting polling first can observe
        // the stale terminal cache entry and stop before the invalidation fetch
        // returns the newly enqueued pending/running snapshot.
        await queryClient.invalidateQueries({
          queryKey: queryKeys.siteHealth.page(crawlId, siteUrlId),
        });
        hasObservedActiveRerunRef.current = false;
        preActivePollCountRef.current = 0;
        setRerunQueued(true);
        setRerunPolling(true);
        return;
      }
      queryClient.setQueryData<PageDetail>(
        queryKeys.siteHealth.page(result.crawl_id, result.site_url_id),
        (previous) =>
          previous
            ? { ...previous, crawl_id: result.crawl_id, analysis_status: result.analysis_status }
            : previous,
      );
      router(`/site/crawls/${result.crawl_id}/pages/${result.site_url_id}?${RERUN_SEARCH_PARAM}=1`);
    },
    onError: (error) => setRerunError(rerunErrorMessage(error)),
  });

  if (detailQuery.isLoading)
    return (
      <ListScreen>
        <QueryState kind="loading" label="Loading page detail…" />
      </ListScreen>
    );
  if (detailQuery.isError || !detailQuery.data) {
    return (
      <ListScreen>
        <QueryState
          kind="error"
          error={detailQuery.error}
          fallback="Could not load this page. It may not exist in this crawl."
          onRetry={() => void detailQuery.refetch()}
          pending={detailQuery.isFetching}
        />
      </ListScreen>
    );
  }

  return (
    <UrlDetailView
      detail={detailQuery.data}
      rerunPending={rerun.isPending}
      rerunQueued={rerunQueued}
      onRerun={() => {
        setRerunError(null);
        rerun.mutate({ crawlId, siteUrlId });
      }}
      history={
        <IssueHistoryButton
          // A finished re-audit changes what is resolved: start the history over.
          key={`history:${crawlId}:${siteUrlId}:${detailQuery.data.last_audited ?? ''}`}
          workspaceId={workspaceId!}
          crawlId={crawlId}
          siteUrlId={siteUrlId}
        />
      }
    >
      {rerunError ? <Alert tone="danger">{rerunError}</Alert> : null}
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
  if (error instanceof ApiError && error.status === 409) {
    return 'This page is not in your monitored set — add it before re-auditing.';
  }
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
  const pager = useCursorTable(`${workspaceId}|${crawlId}|${siteUrlId}`);
  const historyQuery = useQuery({
    ...siteHealthQueries.issueHistory(workspaceId, crawlId, siteUrlId, {
      cursor: pager.cursor,
      limit: HISTORY_LIMIT,
    }),
    // Read fresh each time the drawer is first opened for an audit.
    staleTime: 0,
  });
  const rows = historyQuery.isError ? [] : (historyQuery.data?.items ?? []);
  const nextCursor = historyQuery.data?.next_cursor ?? null;

  return (
    <Stack>
      {historyQuery.isError ? (
        <QueryState
          kind="error"
          error={historyQuery.error}
          fallback="Could not load issue history."
          onRetry={() => void historyQuery.refetch()}
          pending={historyQuery.isFetching}
        />
      ) : null}
      {historyQuery.isLoading ? <QueryState kind="loading" label="Loading issue history" /> : null}
      {historyQuery.data && !historyQuery.data.current_analysis_finalized ? (
        <QueryState
          kind="empty"
          inline
          message="Resolved issues are known once this page’s current analysis finishes."
        />
      ) : null}
      {historyQuery.data?.current_analysis_finalized && rows.length === 0 ? (
        <QueryState kind="empty" inline message="No resolved issues for this page." />
      ) : null}
      {rows.length > 0 ? <HistoryRows rows={rows} /> : null}
      {rows.length > 0 ? <Pager {...cursorControls(pager, nextCursor)} /> : null}
    </Stack>
  );
}

function HistoryRows({ rows }: Readonly<{ rows: IssueHistoryPage['items'] }>) {
  const timeZone = useDisplayTimeZone();
  return (
    <ul className={ledgerClasses()}>
      {rows.map((row) => (
        <Inline
          as="li"
          gap="compact"
          key={row.id}
          className={ledgerItemClasses('flex-wrap justify-between')}
        >
          <span className="flex min-w-0 flex-col">
            <span className="type-body text-foreground [overflow-wrap:anywhere]">
              {issueTitle(row)}
            </span>
            <span className="type-caption tabular-nums">
              Last found {formatAudited(row.created_at, timeZone)}
            </span>
          </span>
          <Inline as="span" className="shrink-0">
            <Badge>{dimensionLabel(row.dimension)}</Badge>
            <Badge variant="status" value={severityBadgeValue(row.severity)}>
              {severityLabel(row.severity)}
            </Badge>
          </Inline>
        </Inline>
      ))}
    </ul>
  );
}
