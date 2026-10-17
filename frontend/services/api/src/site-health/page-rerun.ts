/** Which crawls are one-page reruns rather than site crawls. */
import { sql } from 'kysely';
import { record } from '../db/json.ts';
import type { Crawl } from './task-fence.ts';

/**
 * A one-page rerun re-reads a page; it is no site comparison. Reruns carry
 * `page_rerun`; older ones are the only crawls that requested one page and
 * discovered nothing.
 */
export function isPageRerun(crawl: Pick<Crawl, 'configuration' | 'discovery_requested_count'>) {
  const configuration = record(crawl.configuration);
  return (
    configuration.page_rerun === true ||
    (crawl.discovery_requested_count === 0 && Number(configuration.requested_page_limit) === 1)
  );
}
/** `isPageRerun` over a `site_crawls` row in SQL; never null, so `not` keeps other crawls. */
export const pageRerunSql = sql<boolean>`coalesce(configuration->>'page_rerun' = 'true'
  or (discovery_requested_count = 0 and configuration->>'requested_page_limit' = '1'), false)`;
