import { useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { CRAWL_VIEW_REFRESH_MS } from '@/lib/config/operational';
import {
  refreshCrawlViews,
  refreshMonitoredUrls,
  siteHealthQueries,
} from '@/lib/api/site-health-queries';
import { useCrawlEvents } from '@/lib/site-health/use-crawl-events';
import {
  crawlPollInterval,
  crawlProgressVersion,
  crawlViewsDue,
  CRAWL_STATES,
  type SeenProgress,
} from '@/lib/site-health/status';

export function useLiveCrawlDashboard(
  scope: Parameters<typeof siteHealthQueries.dashboard>[0],
  pinnedCrawlId?: string,
) {
  const queryClient = useQueryClient();
  const { projectId } = scope;
  const dashboardQuery = useQuery({
    ...siteHealthQueries.dashboard(scope, pinnedCrawlId),
    refetchInterval: (query) => {
      const polled = query.state.data?.crawl;
      return polled ? crawlPollInterval(polled) : false;
    },
  });

  const crawl = dashboardQuery.data?.crawl ?? null;
  const active = crawl ? CRAWL_STATES[crawl.status].active : false;

  useCrawlEvents(crawl?.id, projectId, active);

  const crawlId = crawl?.id ?? null;
  const crawlStatus = crawl?.status ?? null;
  const crawlVersion = crawl ? crawlProgressVersion(crawl) : null;
  const lastSeenRef = useRef<(SeenProgress & { crawlId: string }) | null>(null);
  useEffect(() => {
    if (!crawlId || !crawlStatus || crawlVersion === null) return;
    const previous = lastSeenRef.current;
    const next = { version: crawlVersion, status: crawlStatus };
    const now = Date.now();
    if (previous?.crawlId !== crawlId) {
      lastSeenRef.current = { crawlId, ...next, refreshedAt: now };
      return;
    }
    if (previous.version === crawlVersion) return;
    const refresh = () => {
      lastSeenRef.current = { crawlId, ...next, refreshedAt: Date.now() };
      void refreshCrawlViews(queryClient, crawlId);
      void refreshMonitoredUrls(queryClient, projectId);
    };
    if (crawlViewsDue(previous, next, now)) {
      refresh();
      return;
    }
    const trailing = setTimeout(refresh, previous.refreshedAt + CRAWL_VIEW_REFRESH_MS - now);
    return () => clearTimeout(trailing);
  }, [crawlId, crawlStatus, crawlVersion, projectId, queryClient]);

  return dashboardQuery;
}
