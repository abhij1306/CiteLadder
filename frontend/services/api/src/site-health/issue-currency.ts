/**
 * Issue currency: whether a persisted issue is part of its crawl's present
 * state, kept on `site_issues.is_current`.
 *
 * A crawl's current issues are those whose evaluation a current, finalized page
 * analysis names in `source_evaluation_ids`, plus the crawl's site-level
 * architecture findings. Each writer that changes that set refreshes the flag
 * in its own transaction: the terminal publication, an analysis appended over
 * a finalized one, a duplicate alias retiring analyses. Architecture findings
 * are written current. The Issues reads then filter one indexed flag instead of
 * unnesting every current analysis's evaluation list on every query, and the
 * same refresh rewrites the crawl's persisted Issues catalog
 * (`issue-catalog.ts`).
 *
 * The flag is a derived projection: issues and evaluations stay as written, and
 * the analyses keep the exact evaluation ids the flag is computed from.
 */
import { sql } from 'kysely';

import type { Database } from '../db/database.ts';
import { persistIssueCatalog } from './issue-catalog.ts';
import type { Crawl } from './site-task.ts';

/** Recompute the flag for every issue of the crawl, writing only the rows that change. */
export async function refreshIssueCurrency(db: Database, crawl: Crawl): Promise<void> {
  await sql`
    with current_evaluation as (
      select unnest(a.source_evaluation_ids) as id from site_page_analyses a
      where a.workspace_id = ${crawl.workspace_id} and a.crawl_id = ${crawl.id}
        and a.is_current and a.finalized_at is not null
      union
      select e.id from site_rule_evaluations e
      join site_observed_architectures o
        on o.id = e.source_architecture_id and o.workspace_id = e.workspace_id
      where o.workspace_id = ${crawl.workspace_id} and o.crawl_id = ${crawl.id}
    ),
    currency as (
      select i.id, i.evaluation_id in (select id from current_evaluation) as current
      from site_issues i
      where i.workspace_id = ${crawl.workspace_id} and i.crawl_id = ${crawl.id}
    )
    update site_issues i set is_current = c.current
    from currency c
    where i.id = c.id and i.workspace_id = ${crawl.workspace_id}
      and i.is_current is distinct from c.current`.execute(db);
  await persistIssueCatalog(db, crawl);
}
