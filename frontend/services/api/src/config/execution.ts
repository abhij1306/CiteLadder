import { ConfigError } from './config-error.ts';

export const heartbeatFailureLimit = 2;
/** Interactive POSTs borrow existing workers without waiting for a new job. */
export const interactiveExecution = {
  admissionSeconds: 30,
  timeoutSeconds: 240,
  concurrency: 2,
};

const defaults = {
  budgetSeconds: 300,
  poolSize: 4,
  drainLockWaitMs: 15_000,
  drainLockPollMs: 250,
};

function integer(
  env: Record<string, string | undefined>,
  name: string,
  fallback: number,
  max: number,
) {
  const raw = env[name];
  const value = raw === undefined ? fallback : Number(raw);
  if (
    (raw !== undefined && !/^\d+$/u.test(raw)) ||
    !Number.isSafeInteger(value) ||
    value < 1 ||
    value > max
  )
    throw new ConfigError(`${name} must be an integer between 1 and ${max}`);
  return value;
}

export function executionSettings(env: Record<string, string | undefined>) {
  return {
    // How long a later execution waits for an active drain before leaving it the work.
    drainLockWaitMs: defaults.drainLockWaitMs,
    drainLockPollMs: defaults.drainLockPollMs,
    budgetSeconds: integer(env, 'RUNNER_BUDGET_SECONDS', defaults.budgetSeconds, 3600),
    poolSize: integer(env, 'RUNNER_DB_POOL_SIZE', defaults.poolSize, 4),
  };
}

// hashtextextended(DRAIN_LOCK, 0): one drain per database at a time.
export const DRAIN_LOCK = 'citeladder-runner-drain';
