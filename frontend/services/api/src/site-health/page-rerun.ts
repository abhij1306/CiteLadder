import { sql } from 'kysely';
import { record } from '../db/json.ts';
import type { Crawl } from './site-task.ts';

export function isPageRerun(crawl: Pick<Crawl, 'configuration'>) {
  return record(crawl.configuration).page_rerun === true;
}
export const pageRerunSql = sql<boolean>`coalesce(configuration->>'page_rerun' = 'true', false)`;
