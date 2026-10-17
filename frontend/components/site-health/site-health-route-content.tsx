'use client';

import { IssuesScreen } from './issues-screen';
import { SiteHealthScreen } from './site-health-screen';
import { UrlDetail } from './url-detail';

/** Shared Website content for the active project's current crawl. */
export function WebsiteRouteContent() {
  return <SiteHealthScreen />;
}

/** Shared Issues catalog route content for the active project. */
export function IssuesRouteContent() {
  return <IssuesScreen />;
}

/** Shared crawl-scoped page-detail route content. */
export function WebsitePageDetailRouteContent({
  crawlId,
  siteUrlId,
}: Readonly<{ crawlId: string; siteUrlId: string }>) {
  return <UrlDetail crawlId={crawlId} siteUrlId={siteUrlId} />;
}
