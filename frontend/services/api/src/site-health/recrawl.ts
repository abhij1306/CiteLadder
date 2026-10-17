/**
 * A recrawl reruns an earlier crawl's frozen scope and settings, so Changes
 * always has a comparable baseline. It goes through ordinary crawl admission:
 * plan grants, fetch budgets and the one-active-crawl rule are unchanged.
 */
import type { Database } from '../db/database.ts';
import { jsonObject, strings } from '../db/json.ts';
import { WorkspaceScope } from '../db/workspace-scope.ts';
import { isPageRerun, pageRerunSql } from './page-rerun.ts';
import { crawlError, createCrawlRequest, type CreateCrawlRequest } from './planner-policy.ts';
import { loadCrawl } from './reads/crawl.ts';

/**
 * The site crawl to rerun. A one-page rerun is no site crawl, so recrawling it
 * reruns the newest site crawl before it; copying its one-page settings would
 * start a one-page crawl that Changes then compares with the full one.
 */
async function siteCrawl(db: Database, workspaceId: string, crawlId: string) {
  const crawl = await loadCrawl(db, workspaceId, crawlId);
  if (!isPageRerun(crawl)) return crawl;
  const earlier = await new WorkspaceScope(workspaceId)
    .selectFrom(db, 'site_crawls')
    .selectAll()
    .where('project_id', '=', crawl.project_id)
    .where('created_at', '<', crawl.created_at)
    .where(pageRerunSql, '=', false)
    .orderBy('created_at', 'desc')
    .orderBy('id', 'desc')
    .executeTakeFirst();
  return earlier ?? crawlError('No site crawl to rerun yet', 'invalid_crawl_request');
}

export async function recrawlRequest(
  db: Database,
  workspaceId: string,
  crawlId: string,
): Promise<CreateCrawlRequest> {
  const crawl = await siteCrawl(db, workspaceId, crawlId);
  const frozen = jsonObject(crawl.configuration, 'site_crawls.configuration');
  // The same random seed draws the same sample, so a sampled crawl compares too.
  return createCrawlRequest.parse({
    project_id: crawl.project_id,
    include_globs: strings(frozen.include_globs),
    exclude_globs: strings(frozen.exclude_globs),
    input_mode: frozen.input_mode,
    requested_page_limit: frozen.requested_page_limit,
    seed_urls: strings(frozen.seed_urls),
    page_kinds: strings(frozen.page_kinds),
    seed: crawl.random_seed,
  });
}
