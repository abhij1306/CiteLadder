/**
 * ONE definition of "what a crawl change refreshes".
 *
 * The Site Health screen used to run five independent 4s polls over the same
 * crawl (dashboard, pages, and three list views), each owning its own timer,
 * while the SSE hook invalidated a hand-listed set of keys on every frame.
 * Overlapping refetches then resolved out of order and panels rendered state
 * from different moments — counts ticking backwards, a score appearing then
 * vanishing. Now there is a single subscription (the dashboard query's timer)
 * plus the stream, and BOTH refresh the derived views through this module, so
 * the two paths can never drift apart.
 */
import type { QueryClient } from '@tanstack/react-query';

import { queryKeys } from '@/lib/api/query-keys';

/**
 * True for a keyset list query sitting on its FIRST page.
 *
 * Deeper cursor pages are deliberately left alone: the user is reading a fixed
 * window of rows, and refetching it as new URLs stream in shifts the rows under
 * their cursor. The filter object is always the last key segment
 * (`['site-health', <view>, <crawlId>, filters]`) and carries an explicit
 * `cursor: null` for a first page.
 */
function isFirstPage(queryKey: readonly unknown[]): boolean {
  const filters = queryKey.at(-1);
  if (typeof filters !== 'object' || filters === null) return true;
  return (filters as { cursor?: unknown }).cursor == null;
}

/**
 * Refresh every list view derived from a crawl: the crawl summary and the first
 * page of the pages / inventory / issues lists, across all filter combinations.
 * Pass `projectId` to also refresh that project's dashboard (the stream does;
 * the dashboard's own poll must not, since it is the trigger).
 */
export function invalidateCrawlViews(
  queryClient: QueryClient,
  crawlId: string,
  projectId?: string | null,
): void {
  queryClient.invalidateQueries({ queryKey: queryKeys.siteHealth.crawl(crawlId) });
  for (const key of [
    queryKeys.siteHealth.pages(crawlId),
    queryKeys.siteHealth.inventory(crawlId),
    queryKeys.siteHealth.issues(crawlId),
  ]) {
    queryClient.invalidateQueries({
      queryKey: key,
      predicate: (query) => isFirstPage(query.queryKey),
    });
  }
  if (projectId) {
    queryClient.invalidateQueries({ queryKey: queryKeys.siteHealth.dashboard(projectId) });
  }
}

/**
 * Refresh the project-level monitored projection while automatic admission is
 * still growing it. It is not crawl-owned data, so it deliberately stays out
 * of `invalidateCrawlViews`: callers decide when a crawl progress change can
 * also have changed the persistent monitored set.
 */
export function invalidateMonitoredProjection(queryClient: QueryClient, projectId: string): void {
  queryClient.invalidateQueries({ queryKey: queryKeys.siteHealth.monitored(projectId) });
}
