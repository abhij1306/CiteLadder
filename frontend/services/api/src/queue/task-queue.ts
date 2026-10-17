/**
 * The PostgreSQL task queue for `analytics_tasks`.
 *
 * TypeScript owns every analytics kind and recovery,
 * so this module must make exactly the
 * same promises: a claim locks eligible rows `FOR UPDATE SKIP LOCKED`, commits
 * before the caller does any work, and gives each workspace one task before
 * any workspace gets a second. Site Health owns its lease recovery; analytics
 * leases expire through bounded TypeScript analytics recovery.
 */
import { randomUUID } from 'node:crypto';

import { sql, type RawBuilder, type Selectable, type Kysely } from 'kysely';

import { policy } from '../config.ts';
import type { Database } from '../db/database.ts';
import type {
  AnalyticsTasks,
  SiteCrawlTasks,
  QueueWorkspaceTurns,
} from '../generated/db-schema.ts';
import { compareText } from '../text-order.ts';
import { nextDueAt } from './next-due.ts';

export type QueueTask = Selectable<AnalyticsTasks>;
export type SiteTask = Selectable<SiteCrawlTasks>;
type QueueTable = 'analytics_tasks' | 'site_crawl_tasks';
type TaskFor<T extends QueueTable> = T extends 'site_crawl_tasks' ? SiteTask : QueueTask;
// Queries in this owner touch only the lease projection shared by both tables.
type LeaseColumns = Pick<
  AnalyticsTasks,
  | 'id'
  | 'workspace_id'
  | 'task_kind'
  | 'status'
  | 'priority'
  | 'available_at'
  | 'randomized_position'
  | 'lease_owner'
  | 'lease_expires_at'
  | 'heartbeat_at'
  | 'updated_at'
  | 'attempt_count'
>;
type QueueDatabase = Kysely<{
  analytics_tasks: LeaseColumns;
  site_crawl_tasks: LeaseColumns;
  queue_workspace_turns: QueueWorkspaceTurns;
}>;
function queueDatabase(db: Database) {
  return db as unknown as QueueDatabase;
}

const QUEUE_TABLE = 'analytics_tasks';
const { statuses, claimable } = policy.task_queue;

export type TaskQueueOptions = {
  leaseTtlSeconds: number;
  /** Per-kind leases, for work that holds an external resource (a pulled batch) longer. */
  leaseTtlSecondsByKind?: Readonly<Record<string, number>>;
  /** The clock; tests pin it. */
  now?: () => Date;
};
export type ClaimScope = { workspaceId: string; taskIds: readonly string[] };

/**
 * The locking SELECT one claim runs.
 *
 * Eligibility (`status`/`available_at`) is applied twice on purpose: inside
 * the ranked subquery, to number each workspace's backlog, and on the
 * locked relation itself. Under READ COMMITTED a statement that meets a row
 * another transaction updated and committed re-evaluates only the quals on
 * the locked relation; with the predicate only in the subquery, two claims
 * whose statements overlap return the same row once the first commits.
 * `task_kind` is immutable after insert, so it needs no outer copy.
 */
export function claimStatement(
  db: Database,
  options: { now: Date; limit: number; kinds: readonly string[]; scope?: ClaimScope },
  table: QueueTable = QUEUE_TABLE,
) {
  const { now, limit, kinds } = options;
  const queueDb = queueDatabase(db);
  const ranked = queueDb
    .selectFrom(table)
    .select([
      'id as task_id',
      sql<number>`row_number() over (partition by workspace_id order by priority desc, available_at asc, randomized_position asc, id asc)`.as(
        'workspace_position',
      ),
    ])
    .where('status', 'in', claimable)
    .where('available_at', '<=', now)
    .where('task_kind', 'in', kinds)
    .$if(options.scope !== undefined, (q) =>
      q
        .where('workspace_id', '=', options.scope!.workspaceId)
        .where('id', 'in', options.scope!.taskIds),
    )
    .as('fair_queue_candidates');
  return (
    queueDb
      .selectFrom(`${table} as queued`)
      .innerJoin(ranked, 'fair_queue_candidates.task_id', 'queued.id')
      .leftJoin('queue_workspace_turns', (join) =>
        join
          .on('queue_workspace_turns.queue_name', '=', table)
          .onRef('queue_workspace_turns.workspace_id', '=', 'queued.workspace_id'),
      )
      .selectAll('queued')
      .where('queued.status', 'in', claimable)
      .where('queued.available_at', '<=', now)
      .$if(options.scope !== undefined, (q) =>
        q
          .where('queued.workspace_id', '=', options.scope!.workspaceId)
          .where('queued.id', 'in', options.scope!.taskIds),
      )
      // One task per workspace before any workspace receives its second.
      .orderBy('fair_queue_candidates.workspace_position', 'asc')
      .orderBy(sql`queue_workspace_turns.last_claimed_at asc nulls first`)
      .orderBy('queued.priority', 'desc')
      .orderBy('queued.available_at', 'asc')
      .orderBy('queued.randomized_position', 'asc')
      .orderBy('queued.id', 'asc')
      .limit(limit)
      .forUpdate('queued')
      .skipLocked()
  );
}

export class TaskQueue<T extends QueueTable = 'analytics_tasks'> {
  readonly #db: Database;
  /** The row's lease length: its kind's override, else the queue default. */
  readonly #leaseTtlSeconds: RawBuilder<number>;
  readonly #now: () => Date;
  readonly #table: QueueTable;

  constructor(db: Database, options: TaskQueueOptions, table: T = QUEUE_TABLE as T) {
    this.#db = db;
    const overrides = Object.entries(options.leaseTtlSecondsByKind ?? {});
    this.#leaseTtlSeconds = overrides.length
      ? sql<number>`(case task_kind ${sql.join(
          overrides.map(([kind, seconds]) => sql`when ${kind} then ${seconds}::float8`),
          sql` `,
        )} else ${options.leaseTtlSeconds}::float8 end)`
      : sql<number>`${options.leaseTtlSeconds}`;
    this.#now = options.now ?? (() => new Date());
    this.#table = table;
  }

  /** When the earliest row of `kinds` becomes claimable or its lease expires; null when none is pending. */
  nextDue(kinds: readonly string[], scope: RawBuilder<boolean> = sql`true`): Promise<Date | null> {
    if (kinds.length === 0) return Promise.resolve(null);
    return nextDueAt(this.#db, {
      table: this.#table,
      claimable,
      scope: sql<boolean>`task_kind in (${sql.join(kinds)}) and ${scope}`,
    });
  }

  /** Claim up to `limit` eligible rows of `kinds` for `owner`, committed. */
  claim(options: {
    owner: string;
    kinds: readonly string[];
    limit?: number;
    scope?: ClaimScope;
  }): Promise<TaskFor<T>[]> {
    const { owner, kinds, limit = 1 } = options;
    if (kinds.length === 0 || options.scope?.taskIds.length === 0) return Promise.resolve([]);
    const now = this.#now();
    return this.#db.transaction().execute(async (trx) => {
      const locked = await claimStatement(
        trx,
        { now, limit, kinds, scope: options.scope },
        this.#table,
      ).execute();
      if (locked.length === 0) return [];
      const claimed = await queueDatabase(trx)
        .updateTable(this.#table)
        .set({
          status: statuses.leased,
          lease_owner: owner,
          lease_expires_at: sql<Date>`clock_timestamp() + ${this.#leaseTtlSeconds} * interval '1 second'`,
          heartbeat_at: now,
          updated_at: now,
        })
        .where(
          'id',
          'in',
          locked.map((task) => task.id),
        )
        .returningAll()
        .execute();
      const workspaces = [...new Set(claimed.map((task) => task.workspace_id))].sort(compareText);
      await trx
        .insertInto('queue_workspace_turns')
        .values(
          workspaces.map((workspaceId) => ({
            id: randomUUID(),
            queue_name: this.#table,
            workspace_id: workspaceId,
            last_claimed_at: now,
            created_at: now,
          })),
        )
        .onConflict((conflict) =>
          conflict.constraint('uq_queue_workspace_turn').doUpdateSet({
            last_claimed_at: sql`greatest(queue_workspace_turns.last_claimed_at, ${now})`,
          }),
        )
        .execute();
      // Keep the claim's own order; RETURNING does not promise one.
      const byId = new Map(claimed.map((task) => [task.id, task]));
      // SELECT/RETURNING * retains the concrete table's additional columns.
      return locked.map((task) => byId.get(task.id)!) as unknown as TaskFor<T>[];
    });
  }

  /** Move a leased row this owner still holds to `running`. */
  async markRunning(taskId: string, owner: string, attemptCount?: number): Promise<boolean> {
    const now = this.#now();
    const updated = await queueDatabase(this.#db)
      .updateTable(this.#table)
      .set({ status: statuses.running, heartbeat_at: now, updated_at: now })
      .where('id', '=', taskId)
      .where('lease_owner', '=', owner)
      .where('status', '=', statuses.leased)
      .$if(attemptCount !== undefined, (query) => query.where('attempt_count', '=', attemptCount!))
      .where('lease_expires_at', '>', sql<Date>`clock_timestamp()`)
      .executeTakeFirst();
    return updated.numUpdatedRows > 0n;
  }

  /** Extend the lease of a leased or running row this owner still holds. */
  async heartbeat(
    taskId: string,
    owner: string,
    workspaceId: string,
    attemptCount?: number,
  ): Promise<boolean> {
    const now = this.#now();
    const updated = await queueDatabase(this.#db)
      .updateTable(this.#table)
      .set({
        heartbeat_at: now,
        lease_expires_at: sql<Date>`clock_timestamp() + ${this.#leaseTtlSeconds} * interval '1 second'`,
        updated_at: now,
      })
      .where('id', '=', taskId)
      .where('workspace_id', '=', workspaceId)
      .where('lease_owner', '=', owner)
      .where('status', 'in', [statuses.leased, statuses.running])
      .where('lease_expires_at', '>', sql<Date>`clock_timestamp()`)
      .$if(attemptCount !== undefined, (query) => query.where('attempt_count', '=', attemptCount!))
      .executeTakeFirst();
    return updated.numUpdatedRows > 0n;
  }

  /** Whether the row reached a terminal status (cooperative cancel). */
  async isTerminal(taskId: string): Promise<boolean> {
    const row = await queueDatabase(this.#db)
      .selectFrom(this.#table)
      .select('status')
      .where('id', '=', taskId)
      .executeTakeFirst();
    return row !== undefined && policy.task_queue.terminal.includes(row.status);
  }
}
