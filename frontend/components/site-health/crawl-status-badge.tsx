import { Badge } from '@/components/ui/badge';
import { crawlBadgeValue, crawlDisplayStatus, statusLabel } from '@/lib/site-health/status';
import type { SiteCrawl } from '@/lib/api/types';

/** A crawl's status as a reader sees it: one badge, one display rule. */
export function CrawlStatusBadge({
  crawl,
}: Readonly<{ crawl: Pick<SiteCrawl, 'status' | 'partial_reason'> }>) {
  const status = crawlDisplayStatus(crawl);
  return (
    <Badge variant="run-status" value={crawlBadgeValue(status)}>
      {statusLabel(status)}
    </Badge>
  );
}
