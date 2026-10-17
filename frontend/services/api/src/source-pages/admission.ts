import { randomUUID, createHash } from 'node:crypto';
import { sql } from 'kysely';

import { policy } from '../config.ts';
import type { Database } from '../db/database.ts';
import { acquireProjectLock } from '../prompts/locks.ts';
import type { QueueTask } from '../queue/task-queue.ts';
import { fenceInspectionTask } from './task-fence.ts';

export type SourceScope = { workspaceId: string; projectId: string };
const p = policy.source_pages;
async function remaining(db: Database, scope: SourceScope, now: Date) {
  const row = await db
    .selectFrom('source_page_inspection_spend')
    .select(sql<string>`coalesce(sum(units), 0)`.as('spent'))
    .where('workspace_id', '=', scope.workspaceId)
    .where('project_id', '=', scope.projectId)
    .where('created_at', '>=', new Date(now.getTime() - p.budget_window_hours * 3_600_000))
    .executeTakeFirstOrThrow();
  return Math.max(0, p.budget_per_window - Number(row.spent));
}
function spend(
  db: Database,
  scope: SourceScope,
  kind: string,
  key: string,
  pageId: string | null,
  now: Date,
) {
  return db
    .insertInto('source_page_inspection_spend')
    .values({
      id: randomUUID(),
      workspace_id: scope.workspaceId,
      project_id: scope.projectId,
      source_page_id: pageId,
      spend_kind: kind,
      units: 1,
      idempotency_key: key,
      created_at: now,
    })
    .onConflict((oc) => oc.column('idempotency_key').doNothing())
    .returning('id')
    .executeTakeFirst();
}
/**
 * Charge one redirect token: `charged` to follow it, `duplicate` if already
 * paid in this budget window. A token that failed is retried in a later window.
 */
export function spendRedirect(
  db: Database,
  scope: SourceScope,
  url: string,
  now = new Date(),
  task?: QueueTask,
): Promise<'charged' | 'duplicate' | 'exhausted'> {
  return db.transaction().execute(async (trx) => {
    await fenceInspectionTask(trx, task);
    await requireScope(trx, scope);
    await acquireProjectLock(trx, scope.projectId);
    if (!(await remaining(trx, scope, now))) return 'exhausted';
    const digest = createHash('sha256').update(url).digest('hex');
    const window = Math.floor(now.getTime() / (p.budget_window_hours * 3_600_000));
    const key = `redirect:${scope.projectId}:${digest}:${window}`;
    return (await spend(trx, scope, 'redirect', key, null, now)) ? 'charged' : 'duplicate';
  });
}
const NOT_EARNABLE = policy.opportunity.earned_actions.EARNED_EXCLUDED_SOURCE_CLASSES;
const v = policy.opportunity.source_pages;
const hoursAgo = (now: Date, hours: number) => new Date(now.getTime() - hours * 3_600_000);

/**
 * Claim the next pages to read within the remaining budget. A page is read
 * once and again only after it goes stale. Pages cited in answers come before
 * organic search results nobody cited; within each, never read before stale,
 * then retries. A failed read waits a budget window and a blocked one the
 * stale period, so neither is re-fetched every run.
 */
export function claimPages(db: Database, scope: SourceScope, now = new Date(), task?: QueueTask) {
  return db.transaction().execute(async (trx) => {
    await fenceInspectionTask(trx, task);
    await requireScope(trx, scope);
    await acquireProjectLock(trx, scope.projectId);
    const budget = Math.min(p.batch_max, await remaining(trx, scope, now));
    if (!budget) return [];
    const retryAfter = (state: string, hours: number) =>
      sql<boolean>`(inspection_state = ${state} and not exists (
        select 1 from source_page_snapshots attempt
        where attempt.id = source_pages.latest_snapshot_id
          and attempt.fetched_at > ${hoursAgo(now, hours)}))`;
    const query = trx
      .selectFrom('source_pages')
      .selectAll()
      .where('workspace_id', '=', scope.workspaceId)
      .where('project_id', '=', scope.projectId)
      .where((eb) =>
        eb.or([eb('source_class', 'is', null), eb('source_class', 'not in', NOT_EARNABLE)]),
      )
      .where((eb) =>
        eb.or([
          eb('inspection_state', 'in', [v.INSPECTION_NOT_INSPECTED, v.INSPECTION_STALE]),
          eb.and([
            eb('inspection_state', '=', v.INSPECTION_QUEUED),
            eb('claim_expires_at', '<', now),
          ]),
          retryAfter(v.INSPECTION_FAILED, p.budget_window_hours),
          retryAfter(v.INSPECTION_BLOCKED, p.stale_after_hours),
        ]),
      )
      .orderBy(sql`last_cited_at is null`)
      .orderBy(
        sql`case inspection_state when ${v.INSPECTION_NOT_INSPECTED} then 0 when ${v.INSPECTION_STALE} then 1 else 2 end`,
      )
      .orderBy('recurrence_count', 'desc')
      .orderBy(sql`last_cited_at desc nulls last`)
      .orderBy('id')
      .limit(budget);
    const lease = new Date(now.getTime() + p.claim_lease_minutes * 60_000);
    const claims = [];
    for (const page of await query.execute()) {
      const kind = [v.INSPECTION_INSPECTED, v.INSPECTION_STALE].includes(page.inspection_state)
        ? 'recheck'
        : 'page';
      if (
        !(await spend(
          trx,
          scope,
          kind,
          `${kind}:${page.id}:${Math.floor(lease.getTime() / 1000)}`,
          page.id,
          now,
        ))
      )
        continue;
      await trx
        .updateTable('source_pages')
        .set({ inspection_state: v.INSPECTION_QUEUED, claim_expires_at: lease, updated_at: now })
        .where('workspace_id', '=', scope.workspaceId)
        .where('project_id', '=', scope.projectId)
        .where('id', '=', page.id)
        .execute();
      claims.push({ id: page.id, url: page.canonical_url, lease });
    }
    return claims;
  });
}

async function requireScope(db: Database, scope: SourceScope) {
  const project = await db
    .selectFrom('projects')
    .select('id')
    .where('workspace_id', '=', scope.workspaceId)
    .where('id', '=', scope.projectId)
    .executeTakeFirst();
  if (!project) throw new Error('Source-page project is outside its workspace');
}
