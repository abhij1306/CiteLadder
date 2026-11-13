import { randomBytes } from 'node:crypto';
import { sql, type Selectable } from 'kysely';
import type { Database } from '../db/database.ts';
import type { AuditTasks } from '../generated/db-schema.ts';
import { policy } from '../config.ts';
import { auditPolicy } from '../audits/config.ts';
import { auditEvent, transitionAudit } from '../audits/state.ts';
import { AUDIT_LANE, TaskQueue, type ClaimFilter } from './task-queue.ts';

export type AuditTask = Selectable<AuditTasks>;
/** A row this claim leased: its `lease_owner` is the claim's own owner, for every later write. */
export type ClaimedAuditTask = AuditTask & { lease_owner: string };
const table = 'audit_tasks';
/** `audit_tasks.lease_owner` is `varchar(64)`. */
const LEASE_OWNER_MAX_LENGTH = 64;
const { statuses } = policy.task_queue;

export type AuditClaimScope = { workspaceId: string; auditId: string };

/** Claims only these audits' tasks, each in its own workspace. */
function auditScope(scope: AuditClaimScope | readonly AuditClaimScope[]): ClaimFilter {
  const scopes: readonly AuditClaimScope[] = 'auditId' in scope ? [scope] : scope;
  return (column) =>
    scopes.length
      ? sql<boolean>`(${sql.join(
          scopes.map(
            ({ workspaceId, auditId }) =>
              sql`(${column('workspace_id')} = ${workspaceId} and ${column('audit_id')} = ${auditId})`,
          ),
          sql` or `,
        )})`
      : sql<boolean>`false`;
}

/**
 * Lease the earliest due audit schedules, committed before planning: an
 * expired lease is due again, and a held one is skipped, so two schedulers
 * never plan the same occurrence.
 */
export function claimDueSchedules(
  db: Database,
  options: { owner: string; at: Date; limit: number; leaseSeconds: number },
) {
  return db.transaction().execute(async (trx) => {
    const schedules = await trx
      .selectFrom('audit_schedules')
      .selectAll()
      .where('enabled', '=', true)
      .where('next_run_at', '<=', options.at)
      .where((eb) =>
        eb.or([
          eb('lease_expires_at', 'is', null),
          eb('lease_expires_at', '<=', sql<Date>`clock_timestamp()`),
        ]),
      )
      .orderBy('next_run_at')
      .orderBy('id')
      .limit(options.limit)
      .forUpdate()
      .skipLocked()
      .execute();
    if (schedules.length)
      await trx
        .updateTable('audit_schedules')
        .set({
          lease_owner: options.owner,
          lease_expires_at: sql<Date>`clock_timestamp() + ${options.leaseSeconds} * interval '1 second'`,
          updated_at: options.at,
        })
        .where(
          'id',
          'in',
          schedules.map((schedule) => schedule.id),
        )
        .execute();
    return schedules.map((schedule) => ({
      id: schedule.id,
      workspaceId: schedule.workspace_id,
      projectId: schedule.project_id,
      // The due filter excludes schedules without a next run.
      scheduledFor: schedule.next_run_at ?? options.at,
    }));
  });
}

/** Lock order for every worker write: scoped parent audit, then the owned task. */
export async function ownedAuditTask(db: Database, claimed: AuditTask, owner: string) {
  const audit = await db
    .selectFrom('audits')
    .selectAll()
    .where('id', '=', claimed.audit_id)
    .where('workspace_id', '=', claimed.workspace_id)
    .where('project_id', '=', claimed.project_id)
    .forUpdate()
    .executeTakeFirst();
  if (!audit || auditPolicy.constants.audit_terminal_statuses.includes(audit.status)) return null;
  const task = await db
    .selectFrom(table)
    .selectAll()
    .where('id', '=', claimed.id)
    .where('audit_id', '=', audit.id)
    .where('workspace_id', '=', claimed.workspace_id)
    .where('lease_owner', '=', owner)
    .where('status', 'in', [statuses.leased, statuses.running])
    .where('lease_expires_at', '>', sql<Date>`clock_timestamp()`)
    .forUpdate()
    .executeTakeFirst();
  return task ? { audit, task } : null;
}

/** Polling and capacity parks keep the paid-attempt budget unchanged. Caller owns the transaction. */
export function parkAuditTask(
  db: Database,
  task: AuditTask,
  status: 'capacity_wait' | 'awaiting_provider_result' | 'submission_uncertain' | 'retry_wait',
  availableAt: Date,
  at: Date,
) {
  return db
    .updateTable(table)
    .set({
      status,
      available_at: availableAt,
      lease_owner: null,
      lease_expires_at: null,
      heartbeat_at: null,
      updated_at: at,
    })
    .where('id', '=', task.id)
    .where('audit_id', '=', task.audit_id)
    .where('workspace_id', '=', task.workspace_id)
    .execute();
}

/**
 * The audit lane's domain side on the shared queue owner: claims are scoped
 * to audits, and every write after the claim takes the parent audit lock
 * first (`ownedAuditTask`).
 */
export class AuditQueue {
  readonly db: Database;
  readonly now: () => Date;
  readonly #tasks: TaskQueue<'audit_tasks'>;
  constructor(db: Database, leaseSeconds: number, now?: () => Date) {
    this.db = db;
    this.now = now ?? (() => new Date());
    this.#tasks = new TaskQueue(db, AUDIT_LANE, { leaseTtlSeconds: leaseSeconds, now });
  }
  /**
   * The claim and fairness cursor commit before any provider dispatch. Each
   * claim leases its rows to `<owner>:<nonce>`: the lane charges no attempt
   * at claim or uncertain reclaim, so only this per-claim owner tells a stale
   * slot's lease from the same worker's re-claim of the task.
   */
  async claim(
    owner: string,
    limit = 1,
    scope?: AuditClaimScope | readonly AuditClaimScope[],
  ): Promise<ClaimedAuditTask[]> {
    const leaseOwner = `${owner}:${randomBytes(4).toString('hex')}`;
    if (leaseOwner.length > LEASE_OWNER_MAX_LENGTH)
      throw new TypeError('Audit worker owner is too long');
    const rows = await this.#tasks.claim({
      owner: leaseOwner,
      limit,
      where: scope && auditScope(scope),
    });
    return rows.map((row) => ({ ...row, lease_owner: leaseOwner }));
  }
  /** Earliest claimable time or lease expiry, so an idle runner stays for a retry, provider poll or recovery due soon. */
  nextDue(): Promise<Date | null> {
    return this.#tasks.nextDue();
  }
  markRunning(claimed: AuditTask, owner: string, startTask = true) {
    const at = this.now();
    return this.db.transaction().execute(async (trx) => {
      const locked = await ownedAuditTask(trx, claimed, owner);
      if (!locked) return null;
      if (!['queued', 'running'].includes(locked.audit.status)) return null;
      if (locked.audit.status === 'queued') {
        await transitionAudit(trx, claimed.workspace_id, claimed.audit_id, 'running', at);
        await trx
          .updateTable('audits')
          .set({ started_at: at })
          .where('id', '=', claimed.audit_id)
          .where('workspace_id', '=', claimed.workspace_id)
          .execute();
        await auditEvent(
          trx,
          { workspaceId: claimed.workspace_id, auditId: claimed.audit_id },
          auditPolicy.constants.event_audit_running,
          'audit running',
          {},
          at,
        );
      }
      const task = await trx
        .updateTable(table)
        .set({
          status: startTask ? statuses.running : statuses.leased,
          heartbeat_at: at,
          updated_at: at,
        })
        .where('id', '=', claimed.id)
        .where('workspace_id', '=', claimed.workspace_id)
        .returningAll()
        .executeTakeFirstOrThrow();
      return {
        audit: { ...locked.audit, status: 'running', started_at: locked.audit.started_at ?? at },
        task,
      };
    });
  }
  heartbeat(task: AuditTask, owner: string) {
    return this.#tasks.heartbeat(task.id, owner, task.workspace_id);
  }
  isTerminal(task: AuditTask) {
    return this.#tasks.isTerminal(task.id, task.workspace_id);
  }
}
