import { randomInt, randomUUID } from 'node:crypto';
import { crawlLogTick } from '../crawl-logs/maintenance.ts';
import { setTimeout as sleep } from 'node:timers/promises';
import pg from 'pg';
import { policy, type ServiceConfig } from '../config.ts';
import { resolveSettingSpec } from '../config/settings.ts';
import { loadWorkerSettings } from '../config/analytics.ts';
import { observeDatabaseSize, poolOptions, type Database } from '../db/database.ts';
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
import { AuditWorker } from '../audits/worker.ts';
import { AuditScheduler, schedulerSettings } from './audit-scheduler.ts';
import { CrawlScheduler, crawlSchedulerSettings } from './crawl-scheduler.ts';
import { SiteHealthWorker, type PeersDue } from './site-health-worker.ts';
import { integrationSettings } from '../integrations/config.ts';
import { siteWorkerSettings } from '../site-health/runtime.ts';
import { getLogger } from '../logging.ts';
import { cleanupMcpProtocol } from '../mcp/maintenance.ts';
import { pruneSecurityEvents, pruneUsageWindows } from '../abuse/usage.ts';
import { purgeApiIdempotency } from '../public-api/idempotency.ts';
import { DRAIN_LOCK, runnerLanes } from '../config/execution.ts';
import { maintainLease } from '../queue/heartbeat.ts';

export type RunnerLane = {
  name: string;
  run: (canAdmit: () => boolean, peersDue: PeersDue) => Promise<number | boolean | void>;
  nextDue?: () => Promise<Date | null>;
  group?: string;
};
const YIELD: PeersDue = () => Promise.resolve(true);
type DrainOptions = {
  signal: AbortSignal;
  deadline: number;
  now?: () => number;
  firstLane?: number;
  idlePollMs?: number;
  pause?: (ms: number, signal: AbortSignal) => Promise<unknown>;
};

export async function nextDueDelay(
  lanes: readonly RunnerLane[],
  wallClock: () => number = Date.now,
): Promise<number | null> {
  let earliest: number | null = null;
  for (const lane of lanes) {
    if (!lane.nextDue) continue;
    try {
      const due = await lane.nextDue(); // NOSONAR
      if (due && (earliest === null || due.getTime() < earliest)) earliest = due.getTime();
    } catch (error) {
      getLogger('workers.runner').exception('runner_next_due_failed', error, { lane: lane.name });
    }
  }
  return earliest === null ? null : Math.max(0, earliest - wallClock());
}

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
  started: number;
  seen: number;
};
type Settlement = { state: LaneState; progress: number } | { state: LaneState; error: unknown };

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
      this.running.set(state, settle(state, this.#canAdmit, this.#peersDue(state)));
    }
  }
  #peersDue(state: LaneState): PeersDue {
    const group = state.lane.group;
    if (!group) return YIELD;
    const peers = () =>
      this.#states.filter((s) => s !== state && s.phase !== 'failed' && s.lane.group === group);
    return async () => {
      for (const { lane } of peers()) {
        const due = await lane.nextDue?.(); // NOSONAR
        if (due && due.getTime() <= Date.now()) return true;
      }
      return false;
    };
  }
  wakeIdle() {
    for (const state of this.#states) if (state.phase === 'idle') state.phase = 'ready';
  }
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
    if (turns.running.size) await turns.next(canAdmit(), pollMs, pause, options.signal); // NOSONAR
    else if (!canAdmit() || !(await waitForDue(turns, remaining, pollMs, pause, options.signal)))
      break; // NOSONAR
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

async function settle(
  state: LaneState,
  canAdmit: () => boolean,
  peersDue: PeersDue,
): Promise<Settlement> {
  try {
    return { state, progress: Number((await state.lane.run(canAdmit, peersDue)) ?? 0) };
  } catch (error) {
    return { state, error };
  }
}

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

export function idlePause(wait: number | null, remaining: number, pollMs: number) {
  if (wait === null || wait >= remaining) return null;
  const ms = Math.min(wait > 0 ? wait : 250, pollMs);
  return ms < remaining ? ms : null;
}

export type Exclusive = (drain: () => Promise<number>) => Promise<number>;

export function exclusiveDrain(
  config: ServiceConfig,
  options: Pick<DrainOptions, 'signal' | 'deadline' | 'now'>,
  waitMs = config.execution.drainLockWaitMs,
): Exclusive {
  const now = options.now ?? (() => performance.now());
  return async (drain) => {
    const lock = new pg.Client(poolOptions(config));
    const logger = getLogger('workers.runner');
    const lost = (event: string) => (error: unknown) => logger.exception(event, error);
    lock.on('error', lost('runner_drain_lock_lost'));
    try {
      await lock.connect();
      const until = Math.min(now() + waitMs, options.deadline);
      for (;;) {
        const { rows } = await lock.query<{ locked: boolean }>( // NOSONAR
          'select pg_try_advisory_lock(hashtextextended($1, 0)) as locked',
          [DRAIN_LOCK],
        );
        if (rows[0]?.locked) break;
        if (options.signal.aborted || now() >= until) {
          logger.info('runner_drain_active_elsewhere');
          return 0;
        }
        const pause = sleep(config.execution.drainLockPollMs, undefined, options);
        await pause.catch(() => undefined); // NOSONAR
      }
      try {
        return await drain();
      } finally {
        await lock
          .query('select pg_advisory_unlock(hashtextextended($1, 0))', [DRAIN_LOCK])
          .catch(lost('runner_drain_unlock_failed'));
      }
    } finally {
      await lock.end().catch(() => undefined);
    }
  };
}

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
  const env = config.settings;
  const runtime = auditRuntime(env);
  const slots = Math.max(1, config.execution.poolSize - 1);
  runtime.audits.worker_concurrency = Math.min(runtime.audits.worker_concurrency, slots);
  const projections = auditProjections(db);
  const analytics = new AnalyticsWorker(db, loadWorkerSettings(env));
  const discovery = new DiscoveryWorker(db, { env });
  const integration = new IntegrationWorker(db, undefined, integrationSettings(env));
  const agent = new AgentWorker(db, await createAgentBindings(db, env, config));
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
  const crawlScheduler = new CrawlScheduler(db, crawlSchedulerSettings(env));
  const dispatcher = new IntegrationDispatcher(db);
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
        nextDue: () => discovery.nextDue(),
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
          return reclaimed + (canAdmit() ? await audit.drain(canAdmit) : 0);
        },
        nextDue: () => audit.nextDue(),
      },
      {
        name: 'site-health',
        group: crawler,
        run: (canAdmit, peersDue) =>
          site.drain(Math.min(site.settings.concurrency, slots), canAdmit, peersDue),
        nextDue: () => site.nextDue(),
      },
    ] satisfies RunnerLane[],
    periodic: [
      { name: 'database-size', run: () => observeDatabaseSize(db) },
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
            Number(resolveSettingSpec(policy.abuse.usage_window_cleanup_batch, config.settings)),
            canAdmit,
          ),
      },
      {
        name: 'security-event-retention',
        run: (canAdmit) =>
          pruneSecurityEvents(
            db,
            new Date(),
            {
              retentionDays: Number(
                resolveSettingSpec(policy.abuse.security_event_retention_days, config.settings),
              ),
              batch: Number(
                resolveSettingSpec(policy.abuse.security_event_prune_batch, config.settings),
              ),
            },
            canAdmit,
          ),
      },
      { name: 'audit-maintenance', run: (canAdmit) => maintenance.runOnce(new Date(), canAdmit) },
      {
        name: 'research-recovery',
        run: (canAdmit) => reconcileResearch(db, new Date(), canAdmit),
      },
      { name: 'audit-scheduler', run: (canAdmit) => scheduler.runOnce(scheduler.now(), canAdmit) },
      {
        name: 'crawl-scheduler',
        run: (canAdmit) => crawlScheduler.runOnce(crawlScheduler.now(), canAdmit),
      },
      { name: 'integration-dispatcher', run: (canAdmit) => dispatcher.runOnce(canAdmit) },
      { name: 'crawl-log-maintenance', run: (canAdmit) => crawlLogTick(db, new Date(), canAdmit) },
    ] satisfies RunnerLane[],
  };
}

export async function runPeriodic(
  periodic: readonly RunnerLane[],
  options: Pick<DrainOptions, 'signal' | 'deadline' | 'now'>,
): Promise<unknown[]> {
  const failures: unknown[] = [];
  const logger = getLogger('workers.runner');
  const now = options.now ?? (() => performance.now());
  const canAdmit = () => !options.signal.aborted && now() < options.deadline;
  for (const phase of periodic) {
    if (options.signal.aborted || now() >= options.deadline) break;
    const started = performance.now();
    try {
      await phase.run(canAdmit, YIELD); // NOSONAR
      logger.info('tick_phase_completed', {
        phase: phase.name,
        duration_ms: Math.round(performance.now() - started),
      });
    } catch (error) {
      failures.push(error);
      logger.exception('tick_phase_failed', error, { phase: phase.name });
    }
  }
  return failures;
}

export async function tickAndDrain(
  owners: { lanes: RunnerLane[]; periodic: RunnerLane[] },
  options: DrainOptions,
  exclusive: Exclusive = (drain) => drain(),
) {
  const failures = await runPeriodic(owners.periodic, options);
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
