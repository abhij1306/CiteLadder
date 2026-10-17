import { ConfigError, policy, resolveSettingSpec } from '../config.ts';
import { providerSettings } from '../providers/config.ts';
import { searchSettings } from '../search-surfaces/dataforseo.ts';
export const auditPolicy = policy.audits;
/** Admission resolves policy once. Workers read the persisted copy for measurement behavior. */
export function auditSettings(env: Record<string, string | undefined> = process.env) {
  const settings = Object.fromEntries(
    Object.entries(auditPolicy.settings).map(([name, spec]) => [
      name,
      Number(resolveSettingSpec(spec, env)),
    ]),
  ) as Record<keyof typeof auditPolicy.settings, number>;
  if (settings.heartbeat_interval_seconds >= settings.lease_ttl_seconds)
    throw new ConfigError('Audit heartbeat interval must be shorter than its lease');
  if (settings.retry_base_delay_seconds > settings.retry_max_delay_seconds)
    throw new ConfigError('Audit retry base delay must not exceed its maximum');
  return settings;
}
export function auditRuntime(env: Record<string, string | undefined> = process.env) {
  return {
    audits: auditSettings(env),
    providers: providerSettings(env),
    search: searchSettings(env),
    activeLimit: Number(resolveSettingSpec(policy.abuse.active_audits_per_workspace, env)),
    dailyTasks: Number(resolveSettingSpec(policy.abuse.audit_tasks_per_workspace_daily, env)),
    retrySeconds: Number(resolveSettingSpec(policy.abuse.active_job_retry_after_seconds, env)),
  };
}
export type AuditRuntime = ReturnType<typeof auditRuntime>;
