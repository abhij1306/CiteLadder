import type { UseQueryResult } from '@tanstack/react-query';
import { ProjectLink } from '@/components/ui/project-link';

import { Button } from '@/components/ui/button';
import { ReportPage } from '@/components/templates/report-page';
import { IssuesCatalog } from '@/components/site-health/issues-catalog';
import { ICONS } from '@/lib/icons';
import { useLiveCrawlDashboard } from '@/lib/site-health/use-live-crawl-dashboard';
import type { SiteCrawl, SiteHealthDashboard } from '@citeladder/contracts';
import { Inline } from '@/components/ui/layout';
import { CrawlStatusBadge } from '@/components/site-health/crawl-status-badge';
import { dashboardRunNotice } from '@/lib/site-health/run-notice';
import { CRAWL_STATES, crawlDisplayStatus } from '@/lib/site-health/status';
import { httpErrorStatus } from '@/lib/api/errors';
import { useProjectScope } from '@/lib/project/active-project-scope';
import { Notice, readErrorProps } from '@/components/ui/notice';
import { READ_FAILED, StateBlock } from '@/components/ui/state-block';
import { IssuesPageLoading } from '@/components/site-health/issues-summary-loading';

export function IssuesScreen() {
  const { workspaceId, projectId } = useProjectScope();
  const dashboardQuery = useLiveCrawlDashboard({ workspaceId, projectId });
  return (
    <IssuesDataRegion workspaceId={workspaceId} projectId={projectId} dashboard={dashboardQuery} />
  );
}

function IssuesDataRegion({
  workspaceId,
  projectId,
  dashboard,
}: Readonly<{
  workspaceId: string;
  projectId: string;
  dashboard: UseQueryResult<SiteHealthDashboard, Error>;
}>) {
  if (dashboard.isLoading)
    return (
      <ReportPage>
        <IssuesPageLoading />
      </ReportPage>
    );

  const status = httpErrorStatus(dashboard.error);
  const accessDenied = status === 401 || status === 403;
  if (dashboard.isError && (accessDenied || !dashboard.data)) {
    return (
      <ReportPage>
        <StateBlock
          kind="error"
          error={dashboard.error}
          fallback={accessDenied ? '' : READ_FAILED}
          title={
            accessDenied
              ? 'Site health is unavailable for this project'
              : "Couldn't load the latest Site health crawl"
          }
          onRetry={() => void dashboard.refetch()}
          pending={dashboard.isFetching}
        />
      </ReportPage>
    );
  }

  return (
    <IssuesLoadedRegion workspaceId={workspaceId} projectId={projectId} dashboard={dashboard} />
  );
}

function IssuesLoadedRegion({
  workspaceId,
  projectId,
  dashboard,
}: Readonly<{
  workspaceId: string;
  projectId: string;
  dashboard: UseQueryResult<SiteHealthDashboard, Error>;
}>) {
  const crawl = dashboard.data?.crawl ?? null;
  if (dashboard.isError) {
    return crawl ? (
      <IssuesCatalog
        workspaceId={workspaceId}
        projectId={projectId}
        crawlId={crawl.id}
        notice={
          <Notice
            kind="read"
            {...readErrorProps(dashboard)}
            fallback={READ_FAILED}
            title="Could not refresh the latest Site health crawl"
          />
        }
      />
    ) : (
      <ReportPage>
        <StateBlock
          kind="error"
          {...readErrorProps(dashboard)}
          fallback={READ_FAILED}
          title="Could not refresh the latest Site health crawl"
        />
      </ReportPage>
    );
  }
  if (!crawl) {
    return (
      <ReportPage>
        <StateBlock
          kind="empty"
          icon={ICONS.issues}
          heading="No Site health crawl yet"
          action={
            <Button asChild>
              <ProjectLink href="/site">Go to Site health</ProjectLink>
            </Button>
          }
        />
      </ReportPage>
    );
  }
  return (
    <IssuesCatalog
      workspaceId={workspaceId}
      projectId={projectId}
      crawlId={crawl.id}
      notice={<IssuesRunNotice crawl={crawl} />}
    />
  );
}

function IssuesRunNotice({ crawl }: Readonly<{ crawl: SiteCrawl }>) {
  const message = CRAWL_STATES[crawlDisplayStatus(crawl)].active
    ? 'Crawl in progress. Issues update in batches as pages are analyzed.'
    : dashboardRunNotice(crawl)?.message;
  if (!message) return null;
  return (
    <Notice tone="info">
      <Inline className="flex-wrap">
        <CrawlStatusBadge crawl={crawl} />
        <span>{message}</span>
      </Inline>
    </Notice>
  );
}
