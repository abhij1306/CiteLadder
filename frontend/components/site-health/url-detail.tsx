import { useRef, useState, type MutableRefObject } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';

import { StatusMark } from '@/components/ui/status-mark';
import { Tag } from '@/components/ui/tag';
import { DataTable, type DataTableColumn } from '@/components/ui/data-table';
import { TableCell, TableRow, TableTime } from '@/components/ui/table';
import { Absence } from '@/components/ui/absence';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Drawer } from '@/components/ui/drawer';
import { urlParamHref, useUrlParam } from '@/lib/navigation/url-params';
import { History } from '@/lib/icons';
import { siteHealthMutations, siteHealthQueries } from '@/lib/api/site-health-queries';
import type { PageDetail } from '@citeladder/contracts';
import { ApiError, isNotFound } from '@/lib/api/errors';
import { RERUN_MAX_PRE_ACTIVE_POLLS, RERUN_POLL_INTERVAL_MS } from '@/lib/config/site-health';
import { dimensionLabel, issueTitle, severityLabel } from '@/lib/site-health/issues';
import { useCursorTableQuery } from '@/lib/table/use-cursor-table-query';

import { PAGE_DETAIL_TRAIL, UrlDetailView } from './url-detail-view';
import { NotFoundScreen } from '@/components/templates/not-found-screen';
import { RecordPage } from '@/components/templates/record-page';
import { useProjectScope } from '@/lib/project/active-project-scope';
import { useWorkspaceCapability } from '@/lib/project/project-context';
import { Notice, readErrorProps } from '@/components/ui/notice';
import { StateBlock } from '@/components/ui/state-block';

const HISTORY_LIMIT = 25;

export function PageDetailScreen() {
  const { crawlId, siteUrlId } = useParams<{ crawlId: string; siteUrlId: string }>();
  if (!crawlId || !siteUrlId) return null;
  return <UrlDetail key={`${crawlId}:${siteUrlId}`} crawlId={crawlId} siteUrlId={siteUrlId} />;
}

export function UrlDetail({
  crawlId,
  siteUrlId,
}: Readonly<{ crawlId: string; siteUrlId: string }>) {
  const { workspaceId } = useProjectScope();
  const router = useNavigate();
  const rerunRequested = useUrlParam('rerun');
  const [rerunPolling] = useState(() => rerunRequested);
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
  const rerun = useMutation(siteHealthMutations.rerunPage(workspaceId));
  const canRun = useWorkspaceCapability('run');
  const startRerun = () =>
    rerun.mutate(
      { crawlId, siteUrlId },
      {
        onSuccess: (result) =>
          router(
            `/site/crawls/${result.crawl_id}/pages/${result.site_url_id}${urlParamHref('rerun', true)}`,
          ),
        onError: (error) => setRerunError(rerunErrorMessage(error)),
      },
    );

  if (detailQuery.isLoading)
    return (
      <RecordPage trail={PAGE_DETAIL_TRAIL}>
        <StateBlock
          kind="loading"
          label="Loading page detail…"
          shape={{ kind: 'facts', rows: 3, tagRows: [1] }}
        />
      </RecordPage>
    );
  if (isNotFound(detailQuery.error)) return <NotFoundScreen />;
  if (detailQuery.isError || !detailQuery.data) {
    return (
      <RecordPage trail={PAGE_DETAIL_TRAIL}>
        <StateBlock
          kind="error"
          {...readErrorProps(detailQuery)}
          fallback="Couldn't load this page. It may not exist in this crawl."
          title="Couldn't load this page"
        />
      </RecordPage>
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
          key={`history:${crawlId}:${siteUrlId}:${detailQuery.data.last_audited ?? ''}`}
          workspaceId={workspaceId}
          crawlId={crawlId}
          siteUrlId={siteUrlId}
        />
      }
    >
      {rerunError ? <Notice tone="negative">{rerunError}</Notice> : null}
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

function IssueHistoryButton(target: HistoryTarget) {
  const [open, setOpen] = useState(false);
  const [requested, setRequested] = useState(false);
  return (
    <>
      <Button
        variant="quiet"
        onClick={() => {
          setRequested(true);
          setOpen(true);
        }}
      >
        <Icon icon={History} />
        History
      </Button>
      <Drawer open={open} onOpenChange={setOpen} title="Issue history">
        {requested ? <IssueHistory {...target} /> : null}
      </Drawer>
    </>
  );
}

function IssueHistory({ workspaceId, crawlId, siteUrlId }: HistoryTarget) {
  const { page, table } = useCursorTableQuery({
    workspaceId,
    scopeId: crawlId,
    scope: siteUrlId,
    query: (request) => ({
      ...siteHealthQueries.issueHistory(workspaceId, crawlId, siteUrlId, request),
      staleTime: 0,
    }),
    noun: 'resolved issues',
    loading: 'Loading issue history…',
    subject: 'the issue history',
    empty: (current) => ({
      kind: 'empty',
      icon: History,
      headingLevel: 3,
      heading: current.current_analysis_finalized ? 'No resolved issues' : 'Analysis not finished',
    }),
    fixedPageSize: HISTORY_LIMIT,
  });

  return (
    <DataTable label="Resolved issues" columns={HISTORY_COLUMNS} {...table}>
      {page?.items.map((row) => (
        <TableRow key={row.id}>
          <TableCell>{issueTitle(row)}</TableCell>
          <TableCell>
            <Tag>{dimensionLabel(row.dimension)}</Tag>
          </TableCell>
          <TableCell>
            <StatusMark variant="severity" value={row.severity}>
              {severityLabel(row.severity)}
            </StatusMark>
          </TableCell>
          <TableCell>
            <TableTime value={row.created_at} fallback={<Absence state="not_measured" />} />
          </TableCell>
        </TableRow>
      ))}
    </DataTable>
  );
}

const HISTORY_COLUMNS: readonly DataTableColumn[] = [
  { key: 'issue', label: 'Issue', kind: 'identity' },
  { key: 'dimension', label: 'Dimension', kind: 'text', width: 'name' },
  { key: 'severity', label: 'Severity', kind: 'status' },
  { key: 'found', label: 'Last found', kind: 'date' },
];
