import { budget } from '../abuse/usage.ts';
import { resolveSkillsDirectory } from '../config/skill-inputs.ts';
import { policy } from '../config.ts';
import { resolveSettingSpec, type SettingSource } from '../config/settings.ts';

export function agentSettings(env: SettingSource = process.env) {
  const specs = policy.models.gateway;
  const setting = (name: keyof typeof specs) => resolveSettingSpec(specs[name], env);
  return {
    skillsDirectory: resolveSkillsDirectory(String(setting('skills_directory'))),
    executionTimeoutSeconds: Number(setting('execution_timeout_seconds')),
    /** A running turn's lease: a small multiple of the 20-second heartbeat, so a dead turn ends within about a minute. */
    leaseSeconds: Number(setting('lease_seconds')),
    leaseMarginSeconds: Number(setting('lease_margin_seconds')),
    activeLimit: Number(resolveSettingSpec(policy.abuse.active_agent_runs_per_workspace, env)),
    dailyRuns: budget('agent_runs', env),
    retryAfterSeconds: Number(resolveSettingSpec(policy.abuse.active_job_retry_after_seconds, env)),
  };
}
