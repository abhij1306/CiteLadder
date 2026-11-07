import { randomBytes } from 'node:crypto';
import type { Database } from '../db/database.ts';
import { getLogger } from '../logging.ts';
import { AuditQueue, ownedAuditTask, parkAuditTask, type AuditTask } from '../queue/audit-queue.ts';
import { leaseSignal, maintainLease } from '../queue/heartbeat.ts';
import { logLaneFailure } from '../queue/lane-log.ts';
import { AUDIT_LANE } from '../queue/task-queue.ts';
import { ProviderError } from '../providers/errors.ts';
import { executeAnswer } from '../answer-engines/execute.ts';
import { acquireCapacity, releaseCapacity, type CapacityDecision } from '../providers/capacity.ts';
import { loadExecutionContext, type ExecutionContext } from './execution-context.ts';
import { auditPolicy, type AuditRuntime } from './config.ts';
import { auditEvent } from './state.ts';
import { repairOwnedCompletion } from './maintenance.ts';
import type {
  DispatchState,
  PhaseDeps,
  ProjectionOwners,
  SurfaceAdapter,
} from './surfaces/adapter.ts';
import { surfaceAdapter } from './surfaces/index.ts';

export type { ProjectionOwners } from './surfaces/adapter.ts';

const logger = getLogger('workers.audit');

/**
 * One lease advances one stored phase. The worker owns the lease, heartbeat, deadlines
 * and provider capacity; the task's surface adapter owns dispatch and persistence.
 * Provider retries live exclusively in PostgreSQL.
 */
export class AuditWorker {
  readonly owner: string;
  readonly #db: Database;
  readonly #queue: AuditQueue;
  readonly #runtime: AuditRuntime;
  readonly #key: string;
  readonly #projections: ProjectionOwners;
  readonly #deps: PhaseDeps;
  readonly #taskScope: { workspaceId: string; auditId: string } | undefined;
  readonly #now: () => Date;
  constructor(
    db: Database,
    runtime: AuditRuntime,
    encryptionKey: string,
    projections: ProjectionOwners,
    options: {
      owner?: string;
      send?: typeof fetch;
      execute?: typeof executeAnswer;
      taskScope?: { workspaceId: string; auditId: string };
      now?: () => Date;
    } = {},
  ) {
    this.#db = db;
    this.#runtime = runtime;
    this.#key = encryptionKey;
    this.#projections = projections;
    this.#taskScope = options.taskScope;
    this.#now = options.now ?? (() => new Date());
    this.owner = options.owner ?? `audit-worker-ts-${randomBytes(6).toString('hex')}`;
    this.#queue = new AuditQueue(db, runtime.audits.lease_ttl_seconds, this.#now);
    // Revocation still lands within the TTL; the per-task ownership lock is never cached.
    this.#deps = {
      db,
      owner: this.owner,
      runtime,
      now: this.#now,
      send: options.send ?? globalThis.fetch,
      executeAnswer: options.execute ?? executeAnswer,
      derivation: async (context, result) =>
        projections.prepare ? projections.prepare(context, result) : projections.execution,
    };
  }
  /** Earliest due retry, capacity wait or provider poll, so an idle runner stays for it. */
  nextDue() {
    return this.#queue.nextDue();
  }
  /** The runner lane reclaims expired leases first; stuck-audit repair stays in periodic maintenance. */
  async runOnce(signal?: AbortSignal) {
    if (signal?.aborted) return 0;
    const tasks = await this.#queue.claim(
      this.owner,
      this.#runtime.audits.worker_concurrency,
      this.#taskScope,
    );
    await Promise.all(tasks.map((task) => this.#execute(task, signal)));
    return tasks.length;
  }
  /**
   * Keep up to `worker_concurrency` tasks in flight while the caller admits:
   * each settlement frees a slot the next claim refills, so one slow answer
   * never idles the others. Refills stop once a claim finds nothing, admission
   * ends or the claim window closes; claimed work always settles.
   */
  async drain(canAdmit: () => boolean) {
    const limit = this.#runtime.audits.worker_concurrency;
    const windowEnd = performance.now() + this.#runtime.audits.claim_window_seconds * 1000;
    const inFlight = new Set<Promise<void>>();
    const failures: unknown[] = [];
    let claimed = 0;
    let queued = true;
    const refill = async () => {
      let tasks: AuditTask[];
      try {
        tasks = await this.#queue.claim(this.owner, limit - inFlight.size, this.#taskScope);
      } catch (error) {
        // In-flight work still settles before the failure surfaces.
        failures.push(error);
        return;
      }
      queued = tasks.length > 0;
      claimed += tasks.length;
      for (const task of tasks) {
        const running: Promise<void> = this.#execute(task)
          .catch((error: unknown) => {
            failures.push(error);
          })
          .finally(() => inFlight.delete(running));
        inFlight.add(running);
      }
    };
    const admit = () => queued && !failures.length && canAdmit() && performance.now() < windowEnd;
    if (admit()) await refill();
    while (inFlight.size) {
      await Promise.race(inFlight); // NOSONAR -- Wait for the next free slot.
      if (admit()) await refill(); // NOSONAR -- One refill per settlement.
    }
    if (failures.length) throw failures[0];
    return claimed;
  }
  async #execute(claimed: AuditTask, signal?: AbortSignal) {
    const startedAt = performance.now();
    const heartbeat = maintainLease(
      () => this.#queue.heartbeat(claimed, this.owner),
      Math.max(1, this.#runtime.audits.heartbeat_interval_seconds) * 1000,
      () => logger.info('audit_heartbeat_failed', { task_id: claimed.id }),
    );
    const dispatchSignal = leaseSignal(heartbeat.signal, signal);
    const adapter = surfaceAdapter(claimed.logical_engine);
    let context: ExecutionContext | null = null;
    const dispatch: DispatchState = { started: false };
    try {
      if (await repairOwnedCompletion(this.#db, claimed, this.owner, this.#now())) return;
      // Start the parent now; publish task running only after acquiring provider capacity.
      const running = await this.#queue.markRunning(claimed, this.owner, false);
      if (!running) return;
      claimed = running.task;
      if ((await this.#checkDeadline(adapter, claimed)).expired) return;
      context = await this.#loadContext(adapter, claimed);
      if (!context) return;
      const { expired, recovery } = await this.#checkDeadline(adapter, claimed, context);
      if (expired) return;
      const capacity = adapter.capacity(claimed, context);
      const decision = await acquireCapacity(this.#db, capacity, this.#runtime, this.#now());
      if (!decision.acquired) {
        await this.#parkCapacity(claimed, decision, recovery);
        return;
      }
      await this.#dispatchLeased(adapter, claimed, context, capacity, dispatch, dispatchSignal);
    } catch (error) {
      // The surface adapter decides retry or failure; the log records where it broke.
      logLaneFailure(AUDIT_LANE.table, claimed, {
        phase: dispatch.started ? 'dispatch' : 'prepare',
        startedAt,
        error,
        facts: { engine: claimed.logical_engine },
      });
      await adapter.fail(this.#deps, claimed, context, {
        kind: 'internal',
        error,
        dispatched: dispatch.started,
      });
    } finally {
      await heartbeat.stop();
      await this.#projections.finalize(claimed.workspace_id, claimed.audit_id);
    }
  }
  /** The leased dispatch: ownership is rechecked right before any network boundary. */
  async #dispatchLeased(
    adapter: SurfaceAdapter,
    claimed: AuditTask,
    context: ExecutionContext,
    capacity: ExecutionContext['capacity'],
    dispatch: DispatchState,
    signal: AbortSignal,
  ) {
    try {
      // Recheck ownership after acquiring capacity, immediately before any network boundary.
      const live = await this.#db
        .transaction()
        .execute((trx) => ownedAuditTask(trx, claimed, this.owner));
      if (!live || signal.aborted) return;
      if (!(await this.#queue.markRunning(claimed, this.owner))) return;
      await adapter.dispatch(this.#deps, context, dispatch, signal);
    } catch (error) {
      if (error instanceof ProviderError) dispatch.rateError = error;
      throw error;
    } finally {
      await releaseCapacity(
        this.#db,
        capacity,
        this.#runtime,
        {
          rateLimited: dispatch.rateError?.code === 'rate_limit',
          retryAfterSeconds: dispatch.rateError?.retryAfterSeconds,
        },
        this.#now(),
      );
    }
  }
  async #loadContext(adapter: SurfaceAdapter, claimed: AuditTask) {
    try {
      return await loadExecutionContext(
        this.#db,
        claimed,
        this.owner,
        this.#runtime,
        this.#key,
        this.#now(),
      );
    } catch (error) {
      const safe =
        error instanceof ProviderError
          ? error
          : new ProviderError(auditPolicy.constants.error_no_connection);
      await adapter.fail(this.#deps, claimed, null, {
        kind: 'context_unavailable',
        error: safe,
      });
      return null;
    }
  }
  async #checkDeadline(adapter: SurfaceAdapter, claimed: AuditTask, context?: ExecutionContext) {
    const task = context?.task ?? claimed;
    const recovery = adapter.recoveryDeadline(task);
    if (recovery && this.#now() >= recovery) {
      await adapter.fail(this.#deps, claimed, context ?? null, {
        kind: 'recovery_deadline',
      });
      return { expired: true, recovery };
    }
    const startedAt = context?.audit.started_at;
    // Once a paid submission may exist, retrieval is free and bounded by the poll ceiling
    // (Google AI Overview) or the recovery deadline (scrapers), never by the run cap.
    const runExpired =
      !recovery &&
      !task.provider_submission_ref &&
      startedAt &&
      this.#now().getTime() - startedAt.getTime() >= context.maxRunSeconds * 1000;
    if (!runExpired) return { expired: false, recovery };
    await adapter.fail(this.#deps, claimed, context ?? null, {
      kind: 'run_deadline',
    });
    return { expired: true, recovery };
  }
  #parkCapacity(
    task: AuditTask,
    decision: Extract<CapacityDecision, { acquired: false }>,
    deadline: Date | null,
  ) {
    const at = this.#now(),
      available = deadline && decision.availableAt > deadline ? deadline : decision.availableAt;
    return this.#db.transaction().execute(async (trx) => {
      const locked = await ownedAuditTask(trx, task, this.owner);
      if (!locked) return;
      await parkAuditTask(trx, locked.task, 'capacity_wait', available, at);
      await auditEvent(
        trx,
        task.audit_id,
        auditPolicy.constants.event_task_capacity_wait,
        'task capacity wait',
        {
          task_id: task.id,
          attempt: locked.task.attempt_count + 1,
          code: decision.code,
          pool_kind: decision.poolKind,
          available_at: available.toISOString(),
          retry_after_seconds: Math.max(0, (available.getTime() - at.getTime()) / 1000),
        },
        at,
      );
    });
  }
}
