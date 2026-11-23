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
  retryDelaySeconds: number;
  retryMaxDelaySeconds: number;
};

export function loadWorkerSettings(source: SettingSource = process.env): WorkerSettings {
  const specs = analytics.worker_settings;
  const setting = <K extends keyof typeof specs>(name: K) => resolveSpec(name, specs[name], source);
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
  if (settings.heartbeatIntervalSeconds >= settings.leaseTtlSeconds) {
    throw new ConfigError('heartbeat_interval_seconds must be shorter than every lease TTL');
  }
  if (settings.retryMaxDelaySeconds < settings.retryDelaySeconds) {
    throw new ConfigError('retry_max_delay_seconds must not be below retry_delay_seconds');
  }
  return settings;
}
