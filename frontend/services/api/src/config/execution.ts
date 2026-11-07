import { resolveSpec, type SettingSource, type SettingSpec } from './settings.ts';

export const heartbeatFailureLimit = 2;
/** Interactive POSTs borrow existing workers without waiting for a new job. */
export const interactiveExecution = {
  admissionSeconds: 30,
  timeoutSeconds: 240,
  concurrency: 2,
};

/**
 * In-request work one API instance runs at a time: interactive audits and
 * Agent turns together. A full instance answers 429 with `Retry-After`; the
 * queued work stays durable. On shutdown, open work is stopped and given
 * `shutdownGraceMs` to settle before the server closes.
 */
export const interactiveCapacity = {
  slots: 6,
  retryAfterSeconds: 15,
  shutdownGraceMs: 8000,
};

/** Runner lanes run concurrently; an idle lane is polled at most this far apart. */
export const runnerLanes = {
  idlePollMs: 5000,
};

const defaults = {
  drainLockWaitMs: 15_000,
  drainLockPollMs: 250,
};

const integer = (name: string, value: number, maximum: number): SettingSpec => ({
  env: [name],
  type: 'int',
  default: value,
  minimum: 1,
  maximum,
});

/** The runner's execution settings, resolved like every other setting. */
export const executionSpecs = {
  budget_seconds: integer('RUNNER_BUDGET_SECONDS', 300, 3600),
  pool_size: integer('RUNNER_DB_POOL_SIZE', 4, 4),
};

export function executionSettings(source: SettingSource) {
  const setting = (name: keyof typeof executionSpecs) =>
    resolveSpec(name, executionSpecs[name], source);
  return {
    // How long a later execution waits for an active drain before leaving it the work.
    drainLockWaitMs: defaults.drainLockWaitMs,
    drainLockPollMs: defaults.drainLockPollMs,
    budgetSeconds: setting('budget_seconds') as number,
    poolSize: setting('pool_size') as number,
  };
}

// hashtextextended(DRAIN_LOCK, 0): one drain per database at a time.
export const DRAIN_LOCK = 'citeladder-runner-drain';
