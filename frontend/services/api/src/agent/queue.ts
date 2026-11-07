import { sql } from 'kysely';
import type { Database } from '../db/database.ts';
import { policy } from '../config.ts';
import { AGENT_LANE, fenceLease, TaskQueue } from '../queue/task-queue.ts';
import { AgentError, type Lease, type Run } from './contracts.ts';
import { appendRecoveryReply } from './messages.ts';

const { statuses, claimable, active, terminal } = policy.task_queue;
/** The fenced run lock every turn write takes: still running, held and not cancelled. */
export async function lockRun(db: Database, lease: Lease): Promise<Run> {
  const run = await fenceLease(
    db,
    AGENT_LANE,
    { id: lease.runId, workspace_id: lease.workspaceId, attempt_count: lease.attempt },
    lease.owner,
    [statuses.running],
  );
  if (!run || run.cancelled_at !== null) throw new AgentError('lease');
  return run;
}
export async function terminalize(
  db: Database,
  lease: Lease,
  status: 'succeeded' | 'failed',
  code = '',
) {
  await lockRun(db, lease);
  await db
    .updateTable('agent_runs')
    .set({
      status,
      error_code: code,
      error_detail: '',
      completed_at: sql<Date>`clock_timestamp()`,
      updated_at: sql<Date>`clock_timestamp()`,
      lease_owner: null,
      lease_expires_at: null,
    })
    .where('id', '=', lease.runId)
    .where('workspace_id', '=', lease.workspaceId)
    .execute();
}

/** Workspace sets come from the process owner, with bounded lease recovery. */
export class AgentQueue {
  readonly db: Database;
  readonly #runs: TaskQueue<'agent_runs'>;
  constructor(db: Database, leaseSeconds: number) {
    this.db = db;
    this.#runs = new TaskQueue(db, AGENT_LANE, { leaseTtlSeconds: leaseSeconds });
  }
  /** Claim the next turn of `workspaceIds` (or `runId`), committed before the stream runs it. */
  async claim(owner: string, workspaceIds: readonly string[], runId?: string): Promise<Run | null> {
    if (!workspaceIds.length) return null;
    const [run] = await this.#runs.claim({
      owner,
      where: (column) =>
        runId === undefined
          ? sql<boolean>`${column('workspace_id')} in (${sql.join(workspaceIds)})`
          : sql<boolean>`${column('workspace_id')} in (${sql.join(workspaceIds)}) and ${column('id')} = ${runId}`,
    });
    return run ?? null;
  }
  async start(run: Run, owner: string): Promise<Lease> {
    const row = await this.db
      .updateTable('agent_runs')
      .set({
        status: statuses.running,
        attempt_count: sql`attempt_count + 1`,
        updated_at: sql<Date>`clock_timestamp()`,
      })
      .where('id', '=', run.id)
      .where('workspace_id', '=', run.workspace_id)
      .where('lease_owner', '=', owner)
      .where('status', '=', statuses.leased)
      .whereRef('attempt_count', '<', 'max_attempts')
      .where('lease_expires_at', '>', sql<Date>`clock_timestamp()`)
      .returning('attempt_count')
      .executeTakeFirst();
    if (!row) throw new AgentError('lease');
    return { runId: run.id, workspaceId: run.workspace_id, owner, attempt: row.attempt_count };
  }
  heartbeat(lease: Lease) {
    return this.#runs.heartbeat(lease.runId, lease.owner, lease.workspaceId, lease.attempt);
  }
  /**
   * Turns run only inside the browser's stream, so nothing here replays one.
   * A turn whose process stopped heartbeating, or that no stream ever claimed,
   * ends as interrupted with its reply.
   */
  recover(
    workspaceIds: readonly string[],
    limit: number,
    unclaimedGraceSeconds: number,
    reconcile: (db: Database, run: Run) => Promise<void>,
  ) {
    if (!workspaceIds.length) return Promise.resolve(0);
    return this.db.transaction().execute(async (trx) => {
      const rows = await trx
        .selectFrom('agent_runs')
        .selectAll()
        .where('workspace_id', 'in', workspaceIds)
        .where((eb) =>
          eb.or([
            eb.and([
              eb('status', 'in', [statuses.leased, statuses.running]),
              eb('lease_expires_at', '<=', sql<Date>`clock_timestamp()`),
            ]),
            eb.and([
              eb('status', 'in', claimable),
              eb(
                'available_at',
                '<=',
                sql<Date>`clock_timestamp() - ${unclaimedGraceSeconds} * interval '1 second'`,
              ),
            ]),
          ]),
        )
        .orderBy('updated_at')
        .orderBy('id')
        .limit(limit)
        .forUpdate()
        .skipLocked()
        .execute();
      for (const run of rows) {
        // Ledger settlement and terminal writes share one ordered transaction.
        await reconcile(trx, run); // NOSONAR
        await trx // NOSONAR
          .updateTable('agent_runs')
          .set({
            status: statuses.failed,
            error_code: 'interrupted',
            updated_at: sql<Date>`clock_timestamp()`,
            lease_owner: null,
            lease_expires_at: null,
            completed_at: sql<Date>`clock_timestamp()`,
          })
          .where('id', '=', run.id)
          .where('workspace_id', '=', run.workspace_id)
          .execute();
        await appendRecoveryReply(trx, run, 'interrupted'); // NOSONAR
      }
      return rows.length;
    });
  }
}
export { active, terminal };
