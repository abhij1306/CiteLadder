import { resolveSpec, type SettingSource, type SettingSpec } from './settings.ts';

export const heartbeatFailureLimit = 2;
export const interactiveExecution = {
  admissionSeconds: 30,
  timeoutSeconds: 240,
  concurrency: 2,
};

export const interactiveCapacity = {
  slots: 6,
  retryAfterSeconds: 15,
  shutdownGraceMs: 8000,
};

export const runnerLanes = {
  idlePollMs: 5000,
};

export const handoverLeadMs = 180_000;

const defaults = {
  drainLockWaitMs: 15_000,
  drainLockPollMs: 250,
};

const integer = (
  name: string,
  value: number,
  maximum: number,
): SettingSpec & { default: number } => ({
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
  const setting = <K extends keyof typeof executionSpecs>(name: K) =>
    resolveSpec(name, executionSpecs[name], source);
  return {
    // How long a later execution waits for an active drain before leaving it the work.
    drainLockWaitMs: defaults.drainLockWaitMs,
    drainLockPollMs: defaults.drainLockPollMs,
    budgetSeconds: setting('budget_seconds'),
    poolSize: setting('pool_size'),
  };
}

export const DRAIN_LOCK = 'citeladder-runner-drain';
