import { budget } from '../abuse/usage.ts';
import { ConfigError, policy } from '../config.ts';
import { resolveSettingSpec, settingValues, type SettingSource } from '../config/settings.ts';
import { providerSettings } from '../providers/config.ts';
import { searchSettings } from '../search-surfaces/dataforseo.ts';
export const auditPolicy = policy.audits;
export function auditSettings(env: SettingSource = process.env) {
  const settings = settingValues(auditPolicy.settings, env);
  if (settings.heartbeat_interval_seconds >= settings.lease_ttl_seconds)
    throw new ConfigError('Audit heartbeat interval must be shorter than its lease');
  if (settings.retry_base_delay_seconds > settings.retry_max_delay_seconds)
    throw new ConfigError('Audit retry base delay must not exceed its maximum');
  return settings;
}
export function auditRuntime(env: SettingSource = process.env) {
  return {
    audits: auditSettings(env),
    providers: providerSettings(env),
    search: searchSettings(env),
    activeLimit: Number(resolveSettingSpec(policy.abuse.active_audits_per_workspace, env)),
    dailyTasks: budget('audit_provider_tasks', env),
    retrySeconds: Number(resolveSettingSpec(policy.abuse.active_job_retry_after_seconds, env)),
  };
}
export type AuditRuntime = ReturnType<typeof auditRuntime>;
