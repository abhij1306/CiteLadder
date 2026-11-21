import type { Selectable } from 'kysely';
import type { Database } from '../src/db/database.ts';
import type { SiteCrawls } from '../src/generated/db-schema.ts';
import { refreshIssueCurrency } from '../src/site-health/issue-currency.ts';
import { landIssueStates } from '../src/site-health/issue-states.ts';
import { reconcileCrawl } from '../src/site-health/lifecycle.ts';
import { prepareFinalization } from '../src/site-health/lifecycle-finalize.ts';
import { appendFinalRevisions, crawlSiteSources } from '../src/site-health/terminal-analysis.ts';
import { SiteFixtures, type SiteSeed } from './site-health-fixtures.ts';

export type { SiteSeed };

export class FinalizeFixtures extends SiteFixtures {
  async terminalize(seed: SiteSeed, worker = this.worker(seed)) {
    await reconcileCrawl(this.siteDb, seed.workspaceId, seed.crawlId);
    const open = await this.siteDb
      .selectFrom('site_crawl_tasks')
      .select('id')
      .where('workspace_id', '=', seed.workspaceId)
      .where('crawl_id', '=', seed.crawlId)
      .where('task_kind', '=', 'finalize')
      .where('status', 'in', ['queued', 'retry_wait'])
      .executeTakeFirst();
    if (!open) return false;
    const [task] = await worker.queue.claim({
      owner: worker.owner,
      kinds: ['finalize'],
      scope: { workspaceId: seed.workspaceId, taskIds: [open.id] },
    });
    if (!task) return false;
    await worker.execute(task);
    return true;
  }
}

export async function landFinalRevisions(trx: Database, crawl: Selectable<SiteCrawls>) {
  const { pendingIds } = await prepareFinalization(trx, crawl, {
    crossPage: false,
    retiring: new Set(),
  });
  if (!pendingIds.length) return landIssueStates(trx, crawl);
  await appendFinalRevisions(trx, crawl, pendingIds, await crawlSiteSources(trx, crawl));
  await refreshIssueCurrency(trx, crawl);
}
