import { randomInt, randomUUID } from 'node:crypto';
import { crawlLogTick } from '../crawl-logs/maintenance.ts';
import { setTimeout as sleep } from 'node:timers/promises';
import pg from 'pg';
import {
  configEnvironment,
  loadWorkerSettings,
  policy,
  resolveSettingSpec,
  type ServiceConfig,
} from '../config.ts';
import { poolOptions, type Database } from '../db/database.ts';
import { createAgentBindings } from '../agent/bindings.ts';
import { auditRuntime } from '../audits/config.ts';
import { auditProjections } from '../audits/projections.ts';
import { AuditMaintenance } from '../audits/maintenance.ts';
import { reconcileResearch } from '../search-intelligence/maintenance.ts';
import { AnalyticsWorker } from './analytics-worker.ts';
import { DiscoveryWorker } from './discovery-worker.ts';
import { IntegrationWorker } from './integration-worker.ts';
import { IntegrationDispatcher } from './integration-dispatcher.ts';
import { AgentWorker } from './agent-worker.ts';
import { AuditWorker } from './audit-worker.ts';
import { AuditScheduler, schedulerSettings } from './audit-scheduler.ts';
import { SiteHealthWorker } from './site-health-worker.ts';
import { integrationSettings } from '../integrations/config.ts';
import { siteWorkerSettings } from '../site-health/runtime.ts';
import { getLogger } from '../logging.ts';
import { cleanupMcpProtocol } from '../mcp/maintenance.ts';
import { pruneUsageWindows } from '../abuse/usage.ts';
import { purgeApiIdempotency } from '../public-api/idempotency.ts';
import { DRAIN_LOCK, runnerLanes } from '../config/execution.ts';
import { maintainLease } from '../queue/heartbeat.ts';

export type RunnerLane = {
  name: string;
  run: (canAdmit: () => boolean) => Promise<number | boolean | void>;
  /** When this owner's earliest pending task becomes claimable; null when none is pending. */
  nextDue?: () => Promise<Date | null>;
  /** Lanes sharing a group take turns instead of overlapping (one crawler identity). */
  group?: string;
};
type DrainOptions = {
  signal: AbortSignal;
  deadline: number;
  now?: () => number;
  firstLane?: number;
  /** Upper bound on one idle pause, so work committed meanwhile is still seen promptly. */
  idlePollMs?: number;
  pause?: (ms: number, signal: AbortSignal) => Promise<unknown>;
};

/** Milliseconds until the earliest pending task across lanes; null when none is pending. */
export async function nextDueDelay(
  lanes: readonly RunnerLane[],
  wallClock: () => number = Date.now,
): Promise<number | null> {
  let earliest: number | null = null;
  for (const lane of lanes) {
    if (!lane.nextDue) continue;
    try {
      const due = await lane.nextDue(); // NOSONAR -- One probe at a time keeps the shared pool free.
      if (due && (earliest === null || due.getTime() < earliest)) earliest = due.getTime();
    } catch (error) {
      // The probe only extends a drain; tick still recovers anything it misses.
      getLogger('workers.runner').exception('runner_next_due_failed', error, { lane: lane.name });
    }
  }
  return earliest === null ? null : Math.max(0, earliest - wallClock());
}

/**
 * Lanes that failed during a drain. The execution still fails, but its caller
 * can start a successor for the owners that did not, instead of leaving every
 * lane's deferred work for the next tick.
 */
export class LaneFailures extends AggregateError {
  readonly lanes: ReadonlySet<string>;
  readonly tasks: number;
  constructor(options: {
    lanes: ReadonlySet<string>;
    errors: unknown[];
    tasks: number;
    message: string;
  }) {
    super(options.errors, options.message);
    this.lanes = options.lanes;
    this.tasks = options.tasks;
  }
}

type Pause = (ms: number, signal: AbortSignal) => Promise<unknown>;
type LaneState = {
  lane: RunnerLane;
  phase: 'ready' | 'running' | 'idle' | 'failed';
  /** Start order; the least recently started ready lane goes first. */
  started: number;
  /** Progress count when this run started: progress elsewhere since means successors may wait. */
  seen: number;
};
type Settlement = { state: LaneState; progress: number } | { state: LaneState; error: unknown };

/** Which lanes run, wait their group's turn, idle or failed during one drain. */
class LaneTurns {
  readonly running = new Map<LaneState, Promise<Settlement>>();
  readonly failures: unknown[] = [];
  tasks = 0;
  readonly #states: LaneState[];
  readonly #canAdmit: () => boolean;
  #starts: number;
  #progress = 0;
  constructor(lanes: readonly RunnerLane[], first: number, canAdmit: () => boolean) {
    this.#canAdmit = canAdmit;
    this.#starts = lanes.length;
    this.#states = lanes.map((lane, index) => ({
      lane,
      phase: 'ready',
      started: (index - first + lanes.length) % lanes.length,
      seen: 0,
    }));
  }
  /** Start ready lanes, least recently started first, one per group at a time. */
  startReady() {
    const busy = new Set(
      this.#states.filter((s) => s.phase === 'running' && s.lane.group).map((s) => s.lane.group),
    );
    const ready = this.#states
      .filter((s) => s.phase === 'ready')
      .sort((a, b) => a.started - b.started);
    for (const state of ready) {
      if (!this.#canAdmit()) return;
      const group = state.lane.group;
      if (group && busy.has(group)) continue;
      if (group) busy.add(group);
      state.phase = 'running';
      state.started = this.#starts++;
      state.seen = this.#progress;
      this.running.set(state, settle(state, this.#canAdmit));
    }
  }
  wakeIdle() {
    for (const state of this.#states) if (state.phase === 'idle') state.phase = 'ready';
  }
  /** Record the next lane to settle; while admitting, idle lanes wake each poll interval. */
  async next(admitting: boolean, pollMs: number, pause: Pause, signal: AbortSignal) {
    const polling = admitting && this.#states.some((state) => state.phase === 'idle');
    const settled = await nextSettlement(this.running, polling ? pollMs : null, pause, signal);
    if (settled) this.record(settled);
    else this.wakeIdle();
  }
  lanes(phase?: LaneState['phase']) {
    return this.#states
      .filter((state) => (phase ? state.phase === phase : state.phase !== 'failed'))
      .map((state) => state.lane);
  }
  record(settled: Settlement) {
    const { state } = settled;
    this.running.delete(state);
    if ('error' in settled) {
      // Attempt other owners, but leave an infrastructure failure visible to the job.
      state.phase = 'failed';
      this.failures.push(settled.error);
      getLogger('workers.runner').exception('runner_lane_failed', settled.error, {
        lane: state.lane.name,
      });
    } else if (settled.progress) {
      this.tasks += settled.progress;
      this.#progress++;
      state.phase = 'ready';
      this.wakeIdle();
    } else state.phase = this.#progress > state.seen ? 'ready' : 'idle';
  }
}

/**
 * Lanes run concurrently, each bounded by its own batch, so one owner's claim
 * window or slow batch never holds another's queued work. A lane that made
 * progress runs again at once; an idle lane runs again after progress elsewhere
 * (successors) or each poll interval while others are busy. Grouped lanes take
 * turns. With every lane idle, the drain keeps the execution while deferred
 * work becomes due within the budget; exiting would leave it for the next tick.
 * Stop admitting at the deadline; finish claimed work and retain all lease owners.
 */
export async function drainLanes(lanes: readonly RunnerLane[], options: DrainOptions) {
  const now = options.now ?? (() => performance.now());
  const canAdmit = () => !options.signal.aborted && now() < options.deadline;
  const pause: Pause =
    options.pause ?? ((ms, signal) => sleep(ms, undefined, { signal }).catch(() => undefined));
  const pollMs = options.idlePollMs ?? runnerLanes.idlePollMs;
  const turns = new LaneTurns(
    lanes,
    options.firstLane ?? randomInt(Math.max(1, lanes.length)),
    canAdmit,
  );
  const remaining = () => options.deadline - now();
  for (;;) {
    turns.startReady();
    if (turns.running.size) await turns.next(canAdmit(), pollMs, pause, options.signal); // NOSONAR -- Wait for the next lane or poll.
    else if (!canAdmit() || !(await waitForDue(turns, remaining, pollMs, pause, options.signal)))
      break; // NOSONAR -- Idle until deferred work is due.
  }
  if (turns.failures.length)
    throw new LaneFailures({
      lanes: new Set(turns.lanes('failed').map((lane) => lane.name)),
      errors: turns.failures,
      tasks: turns.tasks,
      message: 'Runner lanes failed',
    });
  return turns.tasks;
}

/** Every lane is idle: pause until deferred work is due within the budget; false to exit. */
async function waitForDue(
  turns: LaneTurns,
  remaining: () => number,
  pollMs: number,
  pause: Pause,
  signal: AbortSignal,
) {
  const wait = await nextDueDelay(turns.lanes());
  const ms = idlePause(wait, remaining(), pollMs);
  if (ms === null) return false;
  await pause(ms, signal);
  turns.wakeIdle();
  return true;
}

async function settle(state: LaneState, canAdmit: () => boolean): Promise<Settlement> {
  try {
    return { state, progress: Number((await state.lane.run(canAdmit)) ?? 0) };
  } catch (error) {
    return { state, error };
  }
}

/** The next lane to settle, or null when the idle-lane poll interval elapses first. */
async function nextSettlement(
  running: ReadonlyMap<LaneState, Promise<Settlement>>,
  pollMs: number | null,
  pause: Pause,
  signal: AbortSignal,
) {
  if (pollMs === null) return Promise.race(running.values());
  const poll = new AbortController();
  try {
    return await Promise.race([
      ...running.values(),
      pause(pollMs, AbortSignal.any([signal, poll.signal])).then(() => null),
    ]);
  } finally {
    poll.abort();
  }
}

/**
 * How long an idle drain pauses before its lanes run again, or null to exit. Work
 * already due but unclaimed (a row locked by another claimer) backs off briefly
 * instead of spinning; a pause must fit inside the remaining budget.
 */
export function idlePause(wait: number | null, remaining: number, pollMs: number) {
  if (wait === null || wait >= remaining) return null;
  const ms = Math.min(wait > 0 ? wait : 250, pollMs);
  return ms < remaining ? ms : null;
}

export type Exclusive = (drain: () => Promise<number>) => Promise<number>;

/**
 * Each committed write may start an execution; without this a burst would open
 * one pool per execution against the small database. A second execution waits
 * briefly, then leaves the work to the active drain, which revisits every lane
 * until idle. Tick recovers the rare start that lands after that final pass.
 * The lock lives on its own session so the drain keeps every pooled connection.
 */
export function exclusiveDrain(
  config: ServiceConfig,
  options: Pick<DrainOptions, 'signal' | 'deadline' | 'now'>,
  waitMs = config.execution.drainLockWaitMs,
): Exclusive {
  const now = options.now ?? (() => performance.now());
  return async (drain) => {
    const lock = new pg.Client(poolOptions(config));
    // A lost session releases the lock; leases still arbitrate claims, so log
    // instead of letting an unhandled 'error' event crash claimed work.
    lock.on('error', (error) =>
      getLogger('workers.runner').exception('runner_drain_lock_lost', error),
    );
    await lock.connect();
    try {
      const until = Math.min(now() + waitMs, options.deadline);
      for (;;) {
        const { rows } = await lock.query<{ locked: boolean }>( // NOSONAR -- Each attempt waits for the previous one.
          'select pg_try_advisory_lock(hashtextextended($1, 0)) as locked',
          [DRAIN_LOCK],
        );
        if (rows[0]?.locked) break;
        if (options.signal.aborted || now() >= until) {
          getLogger('workers.runner').info('runner_drain_active_elsewhere');
          return 0;
        }
        const pause = sleep(config.execution.drainLockPollMs, undefined, {
          signal: options.signal,
        });
        await pause.catch(() => undefined); // NOSONAR -- Polling interval between attempts.
      }
      try {
        return await drain();
      } finally {
        await lock.query('select pg_advisory_unlock(hashtextextended($1, 0))', [DRAIN_LOCK]);
      }
    } finally {
      await lock.end();
    }
  };
}

/**
 * Run `work` with a signal that aborts once the drain stops admitting, so a long
 * sync yields at the deadline instead of holding every later lane until the
 * job timeout. Committed pages resume on the next claim.
 */
async function untilAdmissionEnds<T>(
  canAdmit: () => boolean,
  work: (signal: AbortSignal) => Promise<T>,
  pollMs = 1_000,
): Promise<T> {
  const admission = maintainLease(() => Promise.resolve(canAdmit()), pollMs);
  try {
    return await work(admission.signal);
  } finally {
    await admission.stop();
  }
}

export async function runnerOwners(db: Database, config: ServiceConfig) {
  const env = configEnvironment(config);
  const runtime = auditRuntime(env);
  // Provider calls hold no connection, so audits keep a pool-bounded set in
  // flight like Site Health below; per-transport capacity still caps each provider.
  runtime.audits.worker_concurrency = Math.min(
    runtime.audits.worker_concurrency,
    config.execution.poolSize,
  );
  const projections = auditProjections(db);
  const analytics = new AnalyticsWorker(db, loadWorkerSettings(env));
  const discovery = new DiscoveryWorker(db, { env });
  const integration = new IntegrationWorker(db, undefined, integrationSettings(env));
  const agent = new AgentWorker(db, await createAgentBindings(db, env));
  const audit = new AuditWorker(
    db,
    runtime,
    String(resolveSettingSpec(policy.settings.encryption_key, env)),
    projections,
  );
  const site = new SiteHealthWorker(db, { settings: siteWorkerSettings(env) });
  const owner = `runner-discovery:${randomUUID()}`;
  const maintenance = new AuditMaintenance(db, projections.finalize);
  const scheduler = new AuditScheduler(db, runtime, schedulerSettings(env));
  const dispatcher = new IntegrationDispatcher(db);
  // Owners that fetch public websites take turns, as interactive crawls and
  // competitor discovery do under the drain lock, to keep publisher pacing.
  const crawler = 'web-fetch';
  return {
    lanes: [
      {
        name: 'analytics',
        group: crawler,
        run: () => analytics.runOnce(),
        nextDue: () => analytics.nextDue(),
      },
      {
        name: 'discovery',
        group: crawler,
        run: () => discovery.runOnce(owner),
        nextDue: () => discovery.queue.nextDue(),
      },
      {
        name: 'integrations',
        run: (canAdmit) => untilAdmissionEnds(canAdmit, (signal) => integration.runOnce(signal)),
        nextDue: () => integration.nextDue(),
      },
      { name: 'agent', run: () => agent.runOnce(), nextDue: () => agent.nextDue() },
      {
        name: 'audits',
        run: async (canAdmit) => {
          const reclaimed = await maintenance.recoverLeases(new Date(), canAdmit);
          // Recovery may spend the rest of the budget; claim nothing after admission closes.
          return reclaimed + (canAdmit() ? await audit.drain(canAdmit) : 0);
        },
        nextDue: () => audit.nextDue(),
      },
      {
        name: 'site-health',
        group: crawler,
        run: (canAdmit) =>
          site.drain(Math.min(site.settings.concurrency, config.execution.poolSize), canAdmit),
        nextDue: () => site.nextDue(),
      },
    ] satisfies RunnerLane[],
    periodic: [
      {
        name: 'mcp-protocol-cleanup',
        run: (canAdmit) => cleanupMcpProtocol(db, new Date(), canAdmit),
      },
      {
        name: 'api-idempotency-cleanup',
        run: (canAdmit) => purgeApiIdempotency(db, new Date(), canAdmit),
      },
      {
        name: 'usage-window-cleanup',
        run: (canAdmit) =>
          pruneUsageWindows(
            db,
            new Date(),
            Number(resolveSettingSpec(policy.abuse.usage_window_cleanup_batch)),
            canAdmit,
          ),
      },
      { name: 'audit-maintenance', run: (canAdmit) => maintenance.runOnce(new Date(), canAdmit) },
      {
        name: 'research-recovery',
        run: (canAdmit) => reconcileResearch(db, new Date(), canAdmit),
      },
      { name: 'audit-scheduler', run: (canAdmit) => scheduler.runOnce(scheduler.now(), canAdmit) },
      { name: 'integration-dispatcher', run: (canAdmit) => dispatcher.runOnce(canAdmit) },
      { name: 'crawl-log-maintenance', run: (canAdmit) => crawlLogTick(db, new Date(), canAdmit) },
    ] satisfies RunnerLane[],
  };
}

/** Periodic work runs once, followed by the same drain with the remaining budget. */
export async function tickAndDrain(
  owners: { lanes: RunnerLane[]; periodic: RunnerLane[] },
  options: DrainOptions,
  exclusive: Exclusive = (drain) => drain(),
) {
  const failures: unknown[] = [];
  const logger = getLogger('workers.runner');
  const now = options.now ?? (() => performance.now());
  const canAdmit = () => !options.signal.aborted && now() < options.deadline;
  for (const phase of owners.periodic) {
    if (options.signal.aborted || now() >= options.deadline) break;
    const started = performance.now();
    try {
      await phase.run(canAdmit); // NOSONAR -- Periodic phases share one admission budget and pool.
      logger.info('tick_phase_completed', {
        phase: phase.name,
        duration_ms: Math.round(performance.now() - started),
      });
    } catch (error) {
      failures.push(error);
      logger.exception('tick_phase_failed', error, { phase: phase.name });
    }
  }
  let tasks = 0;
  let failedLanes: ReadonlySet<string> = new Set();
  try {
    tasks = await exclusive(() => drainLanes(owners.lanes, options));
  } catch (error) {
    if (error instanceof LaneFailures) {
      failedLanes = error.lanes;
      tasks = error.tasks;
    }
    failures.push(error);
  }
  if (failures.length)
    throw new LaneFailures({ lanes: failedLanes, errors: failures, tasks, message: 'Tick failed' });
  return tasks;
}
