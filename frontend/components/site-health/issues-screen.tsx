'use client';

import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { ProjectLink } from '@/components/layout/scoped-link';

import { Button } from '@/components/ui/button';
import { ProjectRequiredState } from '@/components/layout/project-required-state';
import { ListScreen } from '@/components/layout/page-shell';
import { QueryState } from '@/components/ui/query-state';
import { ReadError } from '@/components/ui/read-error';
import { IssuesCatalog } from '@/components/site-health/issues-catalog';
import { ICONS } from '@/lib/icons';
import { siteHealthQueries } from '@/lib/api/site-health';
import type { SiteHealthDashboard } from '@/lib/api/types';
import { httpErrorStatus } from '@/lib/api/errors';
import { useProjectContext } from '@/lib/project/project-context';
import { resolveProjectRequestScope } from '@/lib/project/request-scope';

/**
 * Issues screen container (Slice 8, mockup 710).
 *
 * Resolves the active project's current (latest/selected) crawl via the
 * dashboard projection, then renders the grouped Issues catalog for that
 * crawl. If no crawl has produced issues yet, it directs the user to run Site
 * Health first (the catalog is per-crawl and there is nothing to group).
 */
export function IssuesScreen() {
  const { activeProject, activeWorkspaceId, isLoading: projectLoading } = useProjectContext();
  const projectId = activeProject?.id ?? null;
  const requestScope = resolveProjectRequestScope(activeWorkspaceId, projectId);

  const dashboardQuery = useQuery({
    ...siteHealthQueries.dashboard(requestScope.workspaceId, requestScope.projectId),
    enabled: requestScope.enabled,
  });

  return (
    <IssuesDataRegion
      projectId={projectId}
      workspaceId={activeWorkspaceId}
      projectLoading={projectLoading}
      dashboard={dashboardQuery}
    />
  );
}

function IssuesDataRegion({
  projectId,
  workspaceId,
  projectLoading,
  dashboard,
}: Readonly<{
  projectId: string | null;
  workspaceId: string | null;
  projectLoading: boolean;
  dashboard: UseQueryResult<SiteHealthDashboard, Error>;
}>) {
  if (!projectId && !projectLoading)
    return (
      <ListScreen>
        <ProjectRequiredState />
      </ListScreen>
    );
  if (projectLoading || dashboard.isLoading)
    return (
      <ListScreen>
        <QueryState kind="loading" label="Loading issues…" />
      </ListScreen>
    );

  const status = httpErrorStatus(dashboard.error);
  const accessDenied = status === 401 || status === 403;
  if (dashboard.isError && (accessDenied || !dashboard.data)) {
    return (
      <ListScreen>
        <QueryState
          kind="error"
          error={dashboard.error}
          fallback={
            accessDenied
              ? 'Site Health is unavailable for this project.'
              : 'Could not load Site Health.'
          }
          onRetry={() => void dashboard.refetch()}
          pending={dashboard.isFetching}
        />
      </ListScreen>
    );
  }

  return <IssuesLoadedRegion workspaceId={workspaceId} dashboard={dashboard} />;
}

function IssuesLoadedRegion({
  workspaceId,
  dashboard,
}: Readonly<{
  workspaceId: string | null;
  dashboard: UseQueryResult<SiteHealthDashboard, Error>;
}>) {
  const crawl = dashboard.data?.crawl ?? null;
  if (dashboard.isError) {
    return crawl && workspaceId ? (
      <IssuesCatalog
        workspaceId={workspaceId}
        crawlId={crawl.id}
        notice={
          <ReadError
            error={dashboard.error}
            fallback="Could not refresh Site Health."
            onRetry={() => void dashboard.refetch()}
            pending={dashboard.isFetching}
          />
        }
      />
    ) : (
      <ListScreen>
        <QueryState
          kind="error"
          error={dashboard.error}
          fallback="Could not refresh Site Health."
          onRetry={() => void dashboard.refetch()}
          pending={dashboard.isFetching}
        />
      </ListScreen>
    );
  }
  if (!crawl) {
    return (
      <ListScreen>
        <QueryState
          kind="empty"
          icon={ICONS.issues}
          heading="No Site Health crawl yet"
          description="Run Site Health to discover and analyze this project's pages — grouped issues will appear here once a crawl finishes."
          action={
            <Button variant="secondary" asChild>
              <ProjectLink href="/site">Go to Website</ProjectLink>
            </Button>
          }
        />
      </ListScreen>
    );
  }
  return workspaceId ? <IssuesCatalog workspaceId={workspaceId} crawlId={crawl.id} /> : null;
}
