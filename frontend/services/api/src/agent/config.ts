import { resolveSkillsDirectory } from '../config/skill-inputs.ts';
import { policy, resolveSettingSpec } from '../config.ts';

export function agentSettings(env: Record<string, string | undefined> = process.env) {
  const specs = policy.models.gateway;
  const setting = (name: keyof typeof specs) => resolveSettingSpec(specs[name], env);
  return {
    skillsDirectory: resolveSkillsDirectory(String(setting('skills_directory'))),
    executionTimeoutSeconds: Number(setting('execution_timeout_seconds')),
    leaseMarginSeconds: Number(setting('lease_margin_seconds')),
    activeLimit: Number(resolveSettingSpec(policy.abuse.active_agent_runs_per_workspace, env)),
    dailyLimit: Number(resolveSettingSpec(policy.abuse.agent_runs_per_workspace_daily, env)),
    dailyWindowSeconds: Number(resolveSettingSpec(policy.abuse.agent_call_window_seconds, env)),
    retryAfterSeconds: Number(resolveSettingSpec(policy.abuse.active_job_retry_after_seconds, env)),
  };
}
