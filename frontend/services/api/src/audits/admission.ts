import { sql } from 'kysely';
import type { Database } from '../db/database.ts';
import { subjectXactLock } from '../db/advisory-lock.ts';
import { spendBudget } from '../abuse/usage.ts';
import { ApiError } from '../errors.ts';
import type { prepareAudit } from './freeze.ts';
import { auditPolicy, type AuditRuntime } from './config.ts';

export type FrozenAudit = Awaited<ReturnType<typeof prepareAudit>>;

/** The workspace enqueue lock every audit launch and repair takes before admission. */
export function lockAuditEnqueue(db: Database, workspaceId: string) {
  return subjectXactLock(db, `audit-enqueue:${workspaceId}`);
}

/** Called under the workspace enqueue lock: the active-run and daily provider-task limits. */
export async function reserveAuditCapacity(
  db: Database,
  workspaceId: string,
  slots: number,
  launchId: string | null,
  runtime: AuditRuntime,
  at: Date,
) {
  // A launch's per-market audits count as one active run, and never against themselves.
  let launches = db
    .selectFrom('audits')
    .select(sql<string>`count(distinct coalesce(launch_id, id))`.as('count'))
    .where('workspace_id', '=', workspaceId)
    .where('status', 'in', auditPolicy.constants.audit_active_statuses);
  if (launchId) launches = launches.where('launch_id', 'is distinct from', launchId);
  const active = await launches.executeTakeFirstOrThrow();
  if (Number(active.count) >= runtime.activeLimit)
    throw new ApiError(429, 'Workspace active audit limit exceeded', {
      headers: { 'retry-after': String(runtime.retrySeconds) },
    });
  await spendBudget(db, runtime.dailyTasks, workspaceId, { amount: slots, at });
}
