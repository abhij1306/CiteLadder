import { StatusMark } from '@/components/ui/status-mark';
import { CRAWL_STATES, crawlDisplayStatus } from '@/lib/site-health/status';
import type { SiteCrawl } from '@citeladder/contracts';

export function CrawlStatusBadge({
  crawl,
}: Readonly<{ crawl: Pick<SiteCrawl, 'status' | 'partial_reason'> }>) {
  const state = CRAWL_STATES[crawlDisplayStatus(crawl)];
  return (
    <StatusMark variant="run-status" value={state.badge}>
      {state.label}
    </StatusMark>
  );
}
