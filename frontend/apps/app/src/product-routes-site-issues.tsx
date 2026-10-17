import { useParams } from 'react-router-dom';

import {
  IssuesRouteContent,
  WebsitePageDetailRouteContent,
  WebsiteRouteContent,
} from '@/components/site-health/site-health-route-content';

/** `/site` — the active project's current Site Health dashboard. */
export function WebsiteRoute() {
  return <WebsiteRouteContent />;
}

/** `/site/crawls/:crawlId/pages/:siteUrlId` — one crawl-bounded page detail. */
export function WebsitePageDetailRoute() {
  const { crawlId, siteUrlId } = useParams<{ crawlId: string; siteUrlId: string }>();
  if (!crawlId || !siteUrlId) return null;
  return <WebsitePageDetailRouteContent crawlId={crawlId} siteUrlId={siteUrlId} />;
}

/** `/issues` — the active project's current-crawl issue catalog. */
export function IssuesRoute() {
  return <IssuesRouteContent />;
}
