'use client';

import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';

import { OverviewDetails } from './overview-details';
import { OverviewMetricCards } from './overview-metrics';
import { Stack } from '@/components/ui/layout';
import { QueryState } from '@/components/ui/query-state';
import { httpErrorStatus } from '@/lib/api/client';
import { siteHealthQueries } from '@/lib/api/site-health';
import type { SiteCrawl, SiteHealthDashboard } from '@/lib/api/types';
import { shouldPollCrawl } from '@/lib/site-health/status';

/**
 * Overview shares the screen's single polling dashboard while a crawl runs.
 * Its immutable snapshot query is enabled only after the crawl terminalizes.
 */
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
  const terminal = crawl ? !shouldPollCrawl(crawl) : false;
  const overview = useQuery({
    ...siteHealthQueries.overview(workspaceId, projectId, crawlId),
    enabled: terminal,
  });
  const data = overview.data;
  let overviewBody: ReactNode = null;
  // The snapshot is WRITTEN at terminalization, so before then the endpoint
  // answers 404 by design — an absence, not a failure. Two things used to turn
  // that into a red alert over a perfectly healthy running crawl: hovering the
  // Overview tab warmed this exact query key regardless of the crawl's state,
  // and `isError` is sticky, so the 404 it cached stayed on screen long after
  // `enabled` went false. Report only a failure this query is actually making
  // now, and never the expected absence.
  if (terminal && overview.isError && httpErrorStatus(overview.error) !== 404) {
    overviewBody = (
      <QueryState
        kind="error"
        error={overview.error}
        fallback="Could not load the persisted Site Health Overview."
        onRetry={() => void overview.refetch()}
        pending={overview.isFetching}
      />
    );
  } else if (data) {
    overviewBody = <OverviewDetails data={data} />;
  } else if (terminal && overview.isLoading) {
    overviewBody = <QueryState kind="loading" label="Loading Overview details" />;
  }

  return (
    <Stack gap="workspace" className="min-w-0" data-testid="site-health-overview">
      <OverviewMetricCards overview={data} dashboard={dashboard} crawl={crawl} />
      {overviewBody}
    </Stack>
  );
}
