/**
 * The PostgreSQL queue-lane owner (invariant 15).
 *
 * A lane registers a descriptor (its table, claimable statuses, the status a
 * claim moves to, extra readiness and where its attempt is charged, as
 * `docs/backend-architecture.md` documents per lane). The owner holds what
 * every lane promises: a claim locks eligible rows `FOR UPDATE SKIP LOCKED`
 * and commits, with the workspace turn cursor, before the caller does any
 * work; each workspace gets one task before any workspace gets a second; only
 * the lease owner may run, extend or settle a claimed row. Domain lifecycle
 * (Site Health's crawl-first lock, the audit parent-first lock, integration
 * events) runs as hooks inside the lane transaction or stays with the lane's
 * worker. Every lane runs on it: analytics, Site Health, discovery, Agent,
 * integrations and audits.
 */
import { randomUUID } from 'node:crypto';

import { sql, type RawBuilder, type Selectable, type Kysely } from 'kysely';

import { policy } from '../config.ts';
import type { Database } from '../db/database.ts';
import type {
  AnalyticsTasks,
  DB,
  SiteCrawlTasks,
  QueueWorkspaceTurns,
} from '../generated/db-schema.ts';
import { compareText } from '../text-order.ts';
import { nextDueAt } from './next-due.ts';

export type QueueTask = Selectable<AnalyticsTasks>;
export type SiteTask = Selectable<SiteCrawlTasks>;
type LaneTable =
  | 'agent_runs'
  | 'analytics_tasks'
  | 'audit_tasks'
  | 'brand_discovery_tasks'
  | 'integration_sync_runs'
  | 'site_crawl_tasks';
export type TaskFor<T extends LaneTable> = Selectable<DB[T]>;
// Queries in this owner touch only the lease projection every lane table
// shares; `task_kind` exists only on kinded lanes and is read only when a
// claim names kinds.
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
  | 'max_attempts'
>;
type QueueDatabase = Kysely<
  Record<LaneTable, LeaseColumns> & { queue_workspace_turns: QueueWorkspaceTurns }
>;
function queueDatabase(db: Database) {
  return db as unknown as QueueDatabase;
}

const { statuses, claimable, terminal } = policy.task_queue;

/** What a lane registers with the queue owner. */
export type LaneDescriptor<T extends LaneTable = LaneTable> = {
  /** The lane's table; also its `queue_workspace_turns.queue_name`. */
  table: T;
  claimable: readonly string[];
  /** The status a claim moves a row to: `leased` when the worker marks it running itself. */
  claimStatus: 'leased' | 'running';
  /** Attempts the claim itself charges. */
  claimCharge: 0 | 1;
  /** Claimability beyond status and `available_at`, such as remaining attempts. */
  ready?: RawBuilder<boolean>;
  /** Attempts one expired-lease reclaim charges: 1 when the claim does not charge. */
  recoveryCharge: 0 | 1;
};

const attemptsLeft = sql<boolean>`attempt_count < max_attempts`;

/** Analytics counts the attempt at its one finalize, or when recovery reclaims the lease. */
export const ANALYTICS_LANE = {
  table: 'analytics_tasks',
  claimable,
  claimStatus: 'leased',
  claimCharge: 0,
  recoveryCharge: 1,
} as const satisfies LaneDescriptor<'analytics_tasks'>;

/** Site Health counts the attempt at settlement, or when recovery reclaims the lease. */
export const SITE_HEALTH_LANE = {
  table: 'site_crawl_tasks',
  claimable,
  claimStatus: 'leased',
  claimCharge: 0,
  recoveryCharge: 1,
} as const satisfies LaneDescriptor<'site_crawl_tasks'>;

/** Discovery runs on claim and counts the attempt on completion or recovery. */
export const DISCOVERY_LANE = {
  table: 'brand_discovery_tasks',
  claimable,
  claimStatus: 'running',
  claimCharge: 0,
  ready: attemptsLeft,
  recoveryCharge: 1,
} as const satisfies LaneDescriptor<'brand_discovery_tasks'>;

/** An Agent turn is charged when its stream starts it (`AgentQueue.start`). */
export const AGENT_LANE = {
  table: 'agent_runs',
  claimable,
  claimStatus: 'leased',
  claimCharge: 0,
  ready: attemptsLeft,
  recoveryCharge: 0,
} as const satisfies LaneDescriptor<'agent_runs'>;

/** Integrations charge at claim; recovery does not charge a second time. */
export const INTEGRATION_LANE = {
  table: 'integration_sync_runs',
  claimable: [statuses.queued, statuses.retry_wait],
  claimStatus: 'running',
  claimCharge: 1,
  ready: attemptsLeft,
  recoveryCharge: 0,
} as const satisfies LaneDescriptor<'integration_sync_runs'>;

/**
 * Audits charge the attempt when a paid result or failure settles, never on
 * claim; parks keep the budget, and recovery (`AuditMaintenance`, parent
 * first) charges unless the submission is uncertain or the audit ended.
 */
export const AUDIT_LANE = {
  table: 'audit_tasks',
  claimable,
  claimStatus: 'leased',
  claimCharge: 0,
  recoveryCharge: 1,
} as const satisfies LaneDescriptor<'audit_tasks'>;

type LeaseOptions = {
  leaseTtlSeconds: number;
  /** Per-kind leases, for work that holds an external resource (a pulled batch) longer. */
  leaseTtlSecondsByKind?: Readonly<Record<string, number>>;
  /** The clock; tests pin it. */
  now?: () => Date;
};
export type ClaimScope = { workspaceId: string; taskIds: readonly string[] };
/**
 * A lane-specific claim scope, such as one discovery, one audit or a set of
 * workspaces. `column` qualifies a lane-table column for the query it runs in.
 */
export type ClaimFilter = (column: (name: string) => RawBuilder<unknown>) => RawBuilder<boolean>;
type ClaimOptions = {
  /** Only these kinds; kinded lanes (analytics, Site Health, discovery) only. */
  kinds?: readonly string[];
  scope?: ClaimScope;
  where?: ClaimFilter;
};

function scopeFilter(scope: ClaimScope): ClaimFilter {
  return (column) =>
    sql<boolean>`${column('workspace_id')} = ${scope.workspaceId} and ${column('id')} in (${sql.join(scope.taskIds)})`;
}

/**
 * The locking SELECT one claim runs.
 *
 * Only the `claim_candidate_limit` oldest due rows are ranked, so a claim's
 * cost is bounded by that cap rather than by the whole backlog; within them,
 * each workspace's rows are numbered and the least recently served workspace
 * goes first. Eligibility (`status`/`available_at`/readiness/scope) is applied
 * twice on purpose: in the candidate set, and on the locked relation itself.
 * Under READ COMMITTED a statement that meets a row another transaction
 * updated and committed re-evaluates only the quals on the locked relation;
 * with the predicate only in the subquery, two claims whose statements overlap
 * return the same row once the first commits. `task_kind` is immutable after
 * insert, so it needs no outer copy.
 */
export function claimStatement(
  db: Database,
  lane: LaneDescriptor,
  options: ClaimOptions & { now: Date | RawBuilder<Date>; limit: number },
) {
  const { now, limit, kinds } = options;
  const { table, ready } = lane;
  const filters = [
    ...(options.scope ? [scopeFilter(options.scope)] : []),
    ...(options.where ? [options.where] : []),
  ];
  const inner = (name: string) => sql.ref(`${table}.${name}`);
  const outer = (name: string) => sql.ref(`queued.${name}`);
  const queueDb = queueDatabase(db);
  const due = queueDb
    .selectFrom(table)
    .select(['id', 'workspace_id', 'priority', 'available_at', 'randomized_position'])
    .where('status', 'in', lane.claimable)
    .where('available_at', '<=', now)
    .$if(kinds !== undefined, (q) => q.where('task_kind', 'in', kinds!))
    .$if(ready !== undefined, (q) => q.where(ready!))
    .$call((q) => filters.reduce((query, filter) => query.where(filter(inner)), q))
    .orderBy('available_at', 'asc')
    .orderBy('id', 'asc')
    .limit(policy.task_queue.claim_candidate_limit)
    .as('due');
  const ranked = queueDb
    .selectFrom(due)
    .select([
      'due.id as task_id',
      sql<number>`row_number() over (partition by due.workspace_id order by due.priority desc, due.available_at asc, due.randomized_position asc, due.id asc)`.as(
        'workspace_position',
      ),
    ])
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
      .where('queued.status', 'in', lane.claimable)
      .where('queued.available_at', '<=', now)
      .$if(ready !== undefined, (q) => q.where(ready!))
      .$call((q) => filters.reduce((query, filter) => query.where(filter(outer)), q))
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

/** Advance the lane's turn cursor for the workspaces one claim served, in the claim's transaction. */
async function advanceTurns(
  trx: Database,
  queueName: LaneTable,
  workspaceIds: readonly string[],
  at: Date,
) {
  const workspaces = [...new Set(workspaceIds)].sort(compareText);
  if (!workspaces.length) return;
  await queueDatabase(trx)
    .insertInto('queue_workspace_turns')
    .values(
      workspaces.map((workspaceId) => ({
        id: randomUUID(),
        queue_name: queueName,
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
}

/** FOR UPDATE to settle; FOR KEY SHARE to hold a row the heartbeat still extends. */
export type FenceStrength = 'update' | 'keyShare';
type FencedClaim = { id: string; workspace_id: string; attempt_count: number };

/**
 * The fenced lock a terminal write takes inside its transaction: the claimed
 * row, still leased to `owner` at the claimed attempt and not terminal (and
 * in one of `inStatus` when given), or undefined when the lease was lost.
 * `keyShare` holds the row through a long transaction while the heartbeat's
 * non-key UPDATE still extends the lease; a settling write takes FOR UPDATE.
 */
export async function fenceLease<T extends LaneTable>(
  trx: Database,
  lane: Pick<LaneDescriptor<T>, 'table'>,
  claimed: FencedClaim,
  owner: string,
  inStatus?: readonly string[],
  strength: FenceStrength = 'update',
): Promise<TaskFor<T> | undefined> {
  const table: LaneTable = lane.table;
  const row = await queueDatabase(trx)
    .selectFrom(table)
    .selectAll()
    .where('id', '=', claimed.id)
    .where('workspace_id', '=', claimed.workspace_id)
    .where('attempt_count', '=', claimed.attempt_count)
    .where('lease_owner', '=', owner)
    .where('lease_expires_at', '>', sql<Date>`clock_timestamp()`)
    .$if(inStatus !== undefined, (query) => query.where('status', 'in', inStatus!))
    .$call((query) => (strength === 'keyShare' ? query.forKeyShare() : query.forUpdate()))
    .executeTakeFirst();
  return row === undefined || terminal.includes(row.status)
    ? undefined
    : (row as unknown as TaskFor<T>);
}

export class TaskQueue<T extends LaneTable = 'analytics_tasks'> {
  readonly #db: Database;
  readonly #lane: LaneDescriptor<T>;
  /** The lane's table, widened: every lane table shares the lease columns queried here. */
  readonly #table: LaneTable;
  /** The row's lease length: its kind's override, else the lane default. */
  readonly #leaseTtlSeconds: RawBuilder<number>;
  readonly #now: () => Date;
  /**
   * What a claim compares `available_at` with: the pinned clock, else the
   * later of the application and database clocks, since producers stamp rows
   * with one and recovery with the other; skew never strands a due row.
   */
  readonly #claimClock: () => Date | RawBuilder<Date>;

  constructor(db: Database, lane: LaneDescriptor<T>, options: LeaseOptions) {
    if (!Number.isFinite(options.leaseTtlSeconds) || options.leaseTtlSeconds <= 0)
      throw new TypeError('Invalid lease TTL');
    this.#db = db;
    this.#lane = lane;
    this.#table = lane.table;
    const overrides = Object.entries(options.leaseTtlSecondsByKind ?? {});
    this.#leaseTtlSeconds = overrides.length
      ? sql<number>`(case task_kind ${sql.join(
          overrides.map(([kind, seconds]) => sql`when ${kind} then ${seconds}::float8`),
          sql` `,
        )} else ${options.leaseTtlSeconds}::float8 end)`
      : sql<number>`${options.leaseTtlSeconds}`;
    this.#now = options.now ?? (() => new Date());
    this.#claimClock =
      options.now ?? (() => sql<Date>`greatest(${new Date()}::timestamptz, clock_timestamp())`);
  }

  /**
   * When the earliest row (of `kinds`, on a kinded lane) becomes claimable or
   * its lease expires; null when none is pending.
   */
  nextDue(kinds?: readonly string[], scope: RawBuilder<boolean> = sql`true`): Promise<Date | null> {
    if (kinds?.length === 0) return Promise.resolve(null);
    return nextDueAt(this.#db, {
      table: this.#lane.table,
      claimable: this.#lane.claimable,
      ready: this.#lane.ready,
      scope: kinds ? sql<boolean>`task_kind in (${sql.join(kinds)}) and ${scope}` : scope,
    });
  }

  /**
   * Claim up to `limit` eligible rows for `owner`, committed. `onClaimed` runs
   * the lane's domain lifecycle inside the claim's transaction.
   */
  claim(
    options: ClaimOptions & {
      owner: string;
      limit?: number;
      onClaimed?: (trx: Database, claimed: TaskFor<T>[]) => Promise<void>;
    },
  ): Promise<TaskFor<T>[]> {
    const { owner, kinds, limit = 1 } = options;
    if (!Number.isSafeInteger(limit) || limit < 1) throw new TypeError('Invalid claim limit');
    if (kinds?.length === 0 || options.scope?.taskIds.length === 0) return Promise.resolve([]);
    const now = this.#now();
    const table = this.#table;
    return this.#db.transaction().execute(async (trx) => {
      const locked = await claimStatement(trx, this.#lane, {
        ...options,
        now: this.#claimClock(),
        limit,
      }).execute();
      if (locked.length === 0) return [];
      const claimed = await queueDatabase(trx)
        .updateTable(table)
        .set({
          status: statuses[this.#lane.claimStatus],
          attempt_count: sql<number>`attempt_count + ${this.#lane.claimCharge}`,
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
      await advanceTurns(
        trx,
        table,
        claimed.map((task) => task.workspace_id),
        now,
      );
      // Keep the claim's own order; RETURNING does not promise one.
      const byId = new Map(claimed.map((task) => [task.id, task]));
      // SELECT/RETURNING * retains the concrete table's additional columns.
      const rows = locked.map((task) => byId.get(task.id)!) as unknown as TaskFor<T>[];
      await options.onClaimed?.(trx, rows);
      return rows;
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

  /** The fenced lock a terminal write takes inside its transaction (`fenceLease`). */
  fence(
    trx: Database,
    claimed: FencedClaim,
    owner: string,
    inStatus?: readonly string[],
    strength: FenceStrength = 'update',
  ): Promise<TaskFor<T> | undefined> {
    return fenceLease(trx, this.#lane, claimed, owner, inStatus, strength);
  }

  /** Whether the row reached a terminal status or is gone (cooperative cancel). */
  async isTerminal(taskId: string, workspaceId: string): Promise<boolean> {
    const row = await queueDatabase(this.#db)
      .selectFrom(this.#table)
      .select('status')
      .where('id', '=', taskId)
      .where('workspace_id', '=', workspaceId)
      .executeTakeFirst();
    return row === undefined || terminal.includes(row.status);
  }
}
