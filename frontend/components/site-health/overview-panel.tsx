import { useQuery } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';

import { OverviewDetails } from './overview-details';
import { OverviewMetricCards } from './overview-metrics';
import { Stack } from '@/components/ui/layout';
import { httpErrorStatus } from '@/lib/api/client';
import { siteHealthQueries } from '@/lib/api/site-health-queries';
import type { SiteCrawl, SiteHealthDashboard } from '@citeladder/contracts';
import { CRAWL_STATES } from '@/lib/site-health/status';
import { readErrorProps } from '@/components/ui/notice';
import type { LoadingShape } from '@/components/ui/skeleton-block';
import { READ_FAILED, StateBlock } from '@/components/ui/state-block';

const PILLAR_TABLE = { kind: 'table', columns: 3 } satisfies LoadingShape;

export function OverviewPanel({
  workspaceId,
  projectId,
  crawlId,
  crawl,
  dashboard,
}: Readonly<{
  workspaceId: string;
  projectId: string;
  crawlId: string;
  crawl: SiteCrawl | null;
  dashboard: SiteHealthDashboard | undefined;
}>) {
  const terminal = crawl ? !CRAWL_STATES[crawl.status].active : false;
  const overview = useQuery({
    ...siteHealthQueries.overview({ workspaceId, projectId }, crawlId),
    enabled: terminal,
  });
  const data = overview.data;
  if (useAwaitingFirstSnapshot(terminal && overview.isPending))
    return (
      <Stack gap="workspace" className="min-w-0" data-testid="site-health-overview">
        <StateBlock kind="loading" label="Loading Overview" shape={{ kind: 'figures' }} />
        <StateBlock kind="loading" label="Loading Overview details" shape={PILLAR_TABLE} />
      </Stack>
    );
  let overviewBody: ReactNode = null;
  if (terminal && overview.isError && httpErrorStatus(overview.error) !== 404) {
    overviewBody = (
      <StateBlock
        kind="error"
        {...readErrorProps(overview)}
        fallback={READ_FAILED}
        title="Couldn't load the Site health overview"
      />
    );
  } else if (data) {
    overviewBody = <OverviewDetails data={data} />;
  } else if (terminal && overview.isLoading) {
    overviewBody = (
      <StateBlock kind="loading" label="Loading Overview details" shape={PILLAR_TABLE} />
    );
  }

  return (
    <Stack gap="workspace" className="min-w-0" data-testid="site-health-overview">
      <OverviewMetricCards overview={data} dashboard={dashboard} crawl={crawl} />
      {overviewBody}
    </Stack>
  );
}

function useAwaitingFirstSnapshot(snapshotPending: boolean): boolean {
  const [scoresShown, setScoresShown] = useState(false);
  if (!snapshotPending && !scoresShown) setScoresShown(true);
  return snapshotPending && !scoresShown;
}
