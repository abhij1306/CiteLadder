/** The analytics lane's worker settings (`ANALYTICS_*`). */
import { ConfigError } from './config-error.ts';
import { analytics } from './connected-data.ts';
import { resolveSpec, type SettingSource } from './settings.ts';

export type WorkerSettings = {
  leaseReclaimBatchSize: number;
  drainBudgetSeconds: number;
  leaseTtlSeconds: number;
  heartbeatIntervalSeconds: number;
  taskMaxAttempts: number;
  pollIntervalSeconds: number;
  /** The first retry's base wait; each later attempt doubles it up to `retryMaxDelaySeconds`. */
  retryDelaySeconds: number;
  retryMaxDelaySeconds: number;
};

/** The analytics worker knobs, refusing a heartbeat slower than the lease. */
export function loadWorkerSettings(source: SettingSource = process.env): WorkerSettings {
  const specs = analytics.worker_settings;
  const setting = (name: keyof typeof specs) => resolveSpec(name, specs[name], source) as number;
  const settings: WorkerSettings = {
    leaseReclaimBatchSize: setting('lease_reclaim_batch_size'),
    drainBudgetSeconds: setting('drain_budget_seconds'),
    leaseTtlSeconds: setting('lease_ttl_seconds'),
    heartbeatIntervalSeconds: setting('heartbeat_interval_seconds'),
    taskMaxAttempts: setting('task_max_attempts'),
    pollIntervalSeconds: setting('poll_interval_seconds'),
    retryDelaySeconds: setting('retry_delay_seconds'),
    retryMaxDelaySeconds: setting('retry_max_delay_seconds'),
  };
  // A heartbeat slower than the lease guarantees expiry during healthy work;
  // the analytics worker checks the per-kind leases its registry declares.
  if (settings.heartbeatIntervalSeconds >= settings.leaseTtlSeconds) {
    throw new ConfigError('heartbeat_interval_seconds must be shorter than every lease TTL');
  }
  // A cap below the base would cut every backoff short of the configured first wait.
  if (settings.retryMaxDelaySeconds < settings.retryDelaySeconds) {
    throw new ConfigError('retry_max_delay_seconds must not be below retry_delay_seconds');
  }
  return settings;
}
