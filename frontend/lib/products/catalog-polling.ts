import type { CommerceCatalog } from '@citeladder/contracts/commerce-suite';

import { ACTIVE_RUN_POLL_MS } from '@/lib/config/operational';

/**
 * How often to re-read the catalog, or `false` to stop: poll while projection
 * tasks are in flight, then stop, rather than re-reading a finished crawl
 * every few seconds for as long as the screen is open.
 */
export function catalogPollingInterval(
  projection: CommerceCatalog['projection'] | undefined,
): number | false {
  return projection?.in_flight ? ACTIVE_RUN_POLL_MS : false;
}
