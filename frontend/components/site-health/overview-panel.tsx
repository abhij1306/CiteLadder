'use client';

import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';

import { CoverageByKind } from './coverage-by-kind';
import { OverviewDetails } from './overview-details';
import { OverviewMetricCards } from './overview-metrics';
import { PageLoading } from '@/components/layout/page-loading';
import { Alert } from '@/components/ui/alert';
import { ReadError } from '@/components/ui/read-error';
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
      <ReadError
        error={overview.error}
        fallback="Could not load the persisted Site Health Overview."
        onRetry={() => void overview.refetch()}
        pending={overview.isFetching}
      />
    );
  } else if (data) {
    overviewBody = <OverviewDetails data={data} />;
  } else if (terminal && overview.isLoading) {
    overviewBody = <PageLoading label="Loading Overview details" />;
  }

  return (
    <div className="grid min-w-0 gap-4" data-testid="site-health-overview">
      {data ? (
        <Alert tone={searchEligibilityTone(data.search_eligibility)}>
          Audit finished: {data.audited_page_count} of {data.selected_page_count} selected pages
          analyzed. {searchEligibilitySentence(data.search_eligibility)}
        </Alert>
      ) : null}
      <OverviewMetricCards overview={data} dashboard={dashboard} crawl={crawl} />
      {data ? <CoverageByKind coverage={data.crawl_coverage} /> : null}
      {overviewBody}
    </div>
  );
}

function searchEligibilityTone(state: 'eligible' | 'blocked' | 'unknown' | 'excluded') {
  if (state === 'eligible') return 'success' as const;
  if (state === 'blocked') return 'danger' as const;
  return 'warning' as const;
}

/** The sentence beside the tone, so the two cannot describe different states. */
function searchEligibilitySentence(state: 'eligible' | 'blocked' | 'unknown' | 'excluded') {
  if (state === 'blocked') {
    return 'At least one selected page has a critical search eligibility blocker.';
  }
  if (state === 'eligible') return 'No observed blocker.';
  return `Search access evidence: ${state}.`;
}
