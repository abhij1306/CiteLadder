import { Badge } from '@/components/ui/badge';
import { CRAWL_STATES, crawlDisplayStatus } from '@/lib/site-health/status';
import type { SiteCrawl } from '@citeladder/contracts';

/** A crawl's status as a reader sees it: one badge, one display rule. */
export function CrawlStatusBadge({
  crawl,
}: Readonly<{ crawl: Pick<SiteCrawl, 'status' | 'partial_reason'> }>) {
  const state = CRAWL_STATES[crawlDisplayStatus(crawl)];
  return (
    <Badge variant="run-status" value={state.badge}>
      {state.label}
    </Badge>
  );
}
