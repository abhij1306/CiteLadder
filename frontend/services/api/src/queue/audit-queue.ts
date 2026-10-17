import { randomUUID } from 'node:crypto';
import { sql, type Selectable } from 'kysely';
import type { Database } from '../db/database.ts';
import type { AuditTasks } from '../generated/db-schema.ts';
import { policy } from '../config.ts';
import { auditPolicy } from '../audits/config.ts';
import { auditEvent, transitionAudit } from '../audits/state.ts';
import { compareText } from '../text-order.ts';
import { nextDueAt } from './next-due.ts';

export type AuditTask = Selectable<AuditTasks>;
const table = 'audit_tasks';
const { claimable, statuses, terminal } = policy.task_queue;

export type AuditClaimScope = { workspaceId: string; auditId: string };
function auditClaimStatement(
  db: Database,
  at: Date,
  limit: number,
  scope?: AuditClaimScope | AuditClaimScope[],
) {
  let scopes: AuditClaimScope[] = [];
  if (Array.isArray(scope)) scopes = scope;
  else if (scope) scopes = [scope];
  const candidates = db
    .selectFrom(table)
    .select([
      'id as task_id',
      sql<number>`row_number() over (partition by workspace_id order by priority desc, available_at asc, randomized_position asc)`.as(
        'workspace_position',
      ),
    ])
    .where('status', 'in', claimable)
    .where('available_at', '<=', at)
    .$if(Boolean(scope), (query) =>
      query.where((eb) =>
        eb.or(
          scopes.map(({ workspaceId, auditId }) =>
            eb.and([eb('workspace_id', '=', workspaceId), eb('audit_id', '=', auditId)]),
          ),
        ),
      ),
    )
    .as('candidates');
  return (
    db
      .selectFrom(table)
      .innerJoin(candidates, 'candidates.task_id', 'audit_tasks.id')
      .leftJoin('queue_workspace_turns as turns', (join) =>
        join
          .on('turns.queue_name', '=', table)
          .onRef('turns.workspace_id', '=', 'audit_tasks.workspace_id'),
      )
      .selectAll(table)
      // READ COMMITTED rechecks these predicates on the locked relation after a concurrent update.
      .where('audit_tasks.status', 'in', claimable)
      .where('audit_tasks.available_at', '<=', at)
      .orderBy('candidates.workspace_position')
      .orderBy(sql`turns.last_claimed_at asc nulls first`)
      .orderBy('audit_tasks.priority', 'desc')
      .orderBy('audit_tasks.available_at')
      .orderBy('audit_tasks.randomized_position')
      .orderBy('audit_tasks.id')
      .limit(limit)
      .forUpdate(table)
      .skipLocked()
  );
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

export class AuditQueue {
  readonly db: Database;
  readonly leaseSeconds: number;
  readonly now: () => Date;
  constructor(db: Database, leaseSeconds: number, now = () => new Date()) {
    this.db = db;
    this.leaseSeconds = leaseSeconds;
    this.now = now;
  }
  /** The claim and fairness cursor commit before any provider dispatch. */
  claim(
    owner: string,
    limit = 1,
    scope?: AuditClaimScope | AuditClaimScope[],
  ): Promise<AuditTask[]> {
    if (!Number.isSafeInteger(limit) || limit < 1) throw new Error('Invalid audit claim limit');
    const at = this.now();
    return this.db.transaction().execute(async (trx) => {
      const locked = await auditClaimStatement(trx, at, limit, scope).execute();
      if (!locked.length) return [];
      const rows = await trx
        .updateTable(table)
        .set({
          status: statuses.leased,
          lease_owner: owner,
          lease_expires_at: sql<Date>`clock_timestamp() + ${this.leaseSeconds} * interval '1 second'`,
          heartbeat_at: at,
          updated_at: at,
        })
        .where(
          'id',
          'in',
          locked.map((task) => task.id),
        )
        .returningAll()
        .execute();
      const workspaces = [...new Set(rows.map((task) => task.workspace_id))].sort(compareText);
      await trx
        .insertInto('queue_workspace_turns')
        .values(
          workspaces.map((workspaceId) => ({
            id: randomUUID(),
            queue_name: table,
            workspace_id: workspaceId,
            last_claimed_at: at,
            created_at: at,
          })),
        )
        .onConflict((conflict) =>
          conflict.constraint('uq_queue_workspace_turn').doUpdateSet({
            last_claimed_at: sql`greatest(queue_workspace_turns.last_claimed_at, ${at})`,
          }),
        )
        .execute();
      const byId = new Map(rows.map((task) => [task.id, task]));
      return locked.map((task) => byId.get(task.id)!);
    });
  }
  /** Earliest claimable time or lease expiry, so an idle runner stays for a retry, provider poll or recovery due soon. */
  nextDue(): Promise<Date | null> {
    return nextDueAt(this.db, { table, claimable });
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
          claimed.audit_id,
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
  async heartbeat(task: AuditTask, owner: string) {
    const at = this.now();
    const result = await this.db
      .updateTable(table)
      .set({
        heartbeat_at: at,
        updated_at: at,
        lease_expires_at: sql<Date>`clock_timestamp() + ${this.leaseSeconds} * interval '1 second'`,
      })
      .where('id', '=', task.id)
      .where('workspace_id', '=', task.workspace_id)
      .where('audit_id', '=', task.audit_id)
      .where('lease_owner', '=', owner)
      .where('status', 'in', [statuses.leased, statuses.running])
      .where('lease_expires_at', '>', sql<Date>`clock_timestamp()`)
      .executeTakeFirst();
    return result.numUpdatedRows > 0n;
  }
  async isTerminal(task: AuditTask) {
    const row = await this.db
      .selectFrom(table)
      .select('status')
      .where('id', '=', task.id)
      .where('audit_id', '=', task.audit_id)
      .where('workspace_id', '=', task.workspace_id)
      .executeTakeFirst();
    return !row || terminal.includes(row.status);
  }
}
