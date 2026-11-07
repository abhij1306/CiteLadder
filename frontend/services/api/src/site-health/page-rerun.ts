/** Which crawls are one-page reruns rather than site crawls. */
import { sql } from 'kysely';
import { record } from '../db/json.ts';
import type { Crawl } from './site-task.ts';

/** A one-page rerun re-reads a page; it is no site comparison. Reruns carry `page_rerun`. */
export function isPageRerun(crawl: Pick<Crawl, 'configuration'>) {
  return record(crawl.configuration).page_rerun === true;
}
/** `isPageRerun` over a `site_crawls` row in SQL; never null, so `not` keeps other crawls. */
export const pageRerunSql = sql<boolean>`coalesce(configuration->>'page_rerun' = 'true', false)`;
