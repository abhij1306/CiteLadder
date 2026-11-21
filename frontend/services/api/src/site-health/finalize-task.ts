import { sql } from 'kysely';
import { isActiveCrawl } from '@citeladder/contracts/site-health';

import { policy } from '../config.ts';
import type { Database } from '../db/database.ts';
import { timeOrderedId } from '../db/ids.ts';
import { asyncCommit, type SiteTask } from '../queue/task-queue.ts';
import { insertEvaluations, type EvaluationGroup } from './analysis-rows.ts';
import { duplicateAliases, markDuplicates } from './canonical-alias.ts';
import { assessCrawl } from './crawl-assessment.ts';
import { syncIssueCurrency } from './issue-currency.ts';
import { prepareFinalization, type Finalization } from './lifecycle-finalize.ts';
import {
  Abandoned,
  cancelTask,
  heldBySlot,
  loadScope,
  lockSiteTask,
  settleTask,
  type Crawl,
  type HeldTask,
  type SiteTaskContext,
} from './site-task.ts';
import { appendFinalRevisions, crawlSiteSources, type SiteSources } from './terminal-analysis.ts';
import { publishCancelledCrawl, publishDrainedCrawl } from './terminal-publication.ts';

const FINALIZE = policy.site_health.crawl.finalize;
type Mode = 'drained' | 'cancelled';
class Stopped extends Abandoned {}

function modeOf(crawl: Crawl): Mode | null {
  if (isActiveCrawl(crawl.status)) return 'drained';
  return crawl.status === 'cancelled' ? 'cancelled' : null;
}

async function commit(
  ctx: SiteTaskContext,
  claimed: SiteTask,
  step: {
    mode: Mode;
    body: (trx: Database, held: HeldTask) => Promise<void>;
    durable?: boolean;
  },
) {
  const { mode, body, durable } = step;
  ctx.signal.throwIfAborted();
  const run = async (trx: Database) => {
    const held = await lockSiteTask(trx, ctx, claimed, { task: 'keyShare' });
    if (!held) throw new Abandoned();
    if (modeOf(held.crawl) !== mode) throw new Stopped();
    await body(trx, held);
    return true;
  };
  const committed = await (durable ? ctx.db.transaction().execute(run) : asyncCommit(ctx.db, run))
    .then((value): boolean | null => value)
    .catch((error: unknown) => {
      if (error instanceof Stopped) return null;
      if (error instanceof Abandoned) return false;
      throw error;
    });
  if (committed === null) await cancelTask(ctx.db, claimed, ctx.owner);
  return committed === true;
}

async function anyFinalized(db: Database, crawl: Crawl) {
  const row = await db
    .selectFrom('site_page_analyses')
    .select('id')
    .where('workspace_id', '=', crawl.workspace_id)
    .where('project_id', '=', crawl.project_id)
    .where('crawl_id', '=', crawl.id)
    .where('finalized_at', 'is not', null)
    .limit(1)
    .executeTakeFirst();
  return row !== undefined;
}

async function stillPending(db: Database, crawl: Crawl, ids: string[]) {
  const rows = await db
    .selectFrom('site_page_analyses')
    .select('id')
    .where('workspace_id', '=', crawl.workspace_id)
    .where('project_id', '=', crawl.project_id)
    .where('crawl_id', '=', crawl.id)
    .where('id', '=', sql<string>`any(${ids}::uuid[])`)
    .where('is_current', '=', true)
    .where('finalized_at', 'is', null)
    .execute();
  const pending = new Set(rows.map((row) => row.id));
  return ids.filter((id) => pending.has(id));
}

async function freshEvaluations(
  db: Database,
  crawl: Crawl,
  ids: string[],
  prepared: Finalization,
): Promise<EvaluationGroup[]> {
  const groups = ids.flatMap((analysisId) => {
    const judged = prepared.judge(analysisId);
    return judged ? [{ analysisId, ...judged }] : [];
  });
  if (!groups.length) return [];
  const recorded = await db
    .selectFrom('site_rule_evaluations')
    .select(['analysis_id', 'rule_id'])
    .where('workspace_id', '=', crawl.workspace_id)
    .where('analysis_id', '=', sql<string>`any(${groups.map((group) => group.analysisId)}::uuid[])`)
    .where('source_architecture_id', 'is', null)
    .execute();
  const seen = new Set(recorded.map((row) => `${row.analysis_id}:${row.rule_id}`));
  return groups.map((group) => ({
    ...group,
    evaluations: group.evaluations
      .filter((evaluation) => !seen.has(`${group.analysisId}:${evaluation.rule_id}`))
      .map((evaluation) => ({ ...evaluation, id: timeOrderedId() })),
  }));
}

export async function runFinalize(ctx: SiteTaskContext, claimed: SiteTask) {
  ctx.signal.throwIfAborted();
  const scope = await loadScope(ctx.db, claimed);
  if (!scope || !heldBySlot(scope.task, claimed, ctx.owner)) return;
  const mode = modeOf(scope.crawl);
  if (!mode) return cancelTask(ctx.db, claimed, ctx.owner);
  const { crawl } = scope;
  let aliases =
    mode === 'drained' && !(await anyFinalized(ctx.db, crawl))
      ? await duplicateAliases(ctx.db, crawl)
      : [];
  const prepared = await prepareFinalization(ctx.db, crawl, {
    crossPage: mode === 'drained',
    retiring: new Set(aliases),
  });
  let siteSources: SiteSources | null = null;
  const size = FINALIZE.batch_pages;
  for (let offset = 0; offset < prepared.pendingIds.length; offset += size) {
    const batch = prepared.pendingIds.slice(offset, offset + size);
    let sources: SiteSources | null = siteSources;
    const write = async (trx: Database, held: HeldTask) => {
      await markDuplicates(trx, held.crawl, aliases);
      const pending = await stillPending(trx, held.crawl, batch);
      if (mode === 'drained')
        await insertEvaluations(
          trx,
          held.crawl,
          await freshEvaluations(trx, held.crawl, pending, prepared),
        );
      sources ??= await crawlSiteSources(trx, held.crawl);
      await appendFinalRevisions(trx, held.crawl, pending, sources);
      await syncIssueCurrency(trx, held.crawl, pending);
    };
    const committed = await commit(ctx, claimed, { mode, body: write }); // NOSONAR -- One short transaction per batch, in order.
    if (!committed) return;
    aliases = [];
    siteSources = sources;
  }
  const publish = async (trx: Database, held: HeldTask) => {
    await markDuplicates(trx, held.crawl, aliases);
    if (mode === 'drained') {
      const assessment = await assessCrawl(trx, held.crawl);
      if (!assessment.drained) throw new Error('finalize found open lifecycle tasks');
      await publishDrainedCrawl(trx, held.crawl, assessment);
    } else await publishCancelledCrawl(trx, held.crawl);
    const settling = await lockSiteTask(trx, ctx, claimed);
    if (!settling) throw new Abandoned();
    await settleTask(trx, ctx, settling.task, { kind: 'succeeded', artifactId: null });
  };
  await commit(ctx, claimed, { mode, body: publish, durable: true });
}
