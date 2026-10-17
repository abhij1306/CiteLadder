/**
 * Abuse budgets, PostgreSQL-enforced except `sse_streams_per_user`, which each
 * API instance counts in memory; all environment overrides must be positive integers.
 */
const defaults = {
  agent_call_limit: 30,
  agent_call_window_seconds: 86400,
  bulk_import_limit: 10,
  bulk_import_window_seconds: 3600,
  provider_test_limit: 20,
  provider_test_window_seconds: 3600,
  property_discovery_limit: 60,
  property_discovery_window_seconds: 3600,
  crawl_create_limit: 10,
  crawl_create_window_seconds: 86400,
  brand_logo_refresh_limit: 10,
  brand_logo_refresh_window_seconds: 3600,
  active_audits_per_workspace: 3,
  audit_tasks_per_workspace_daily: 1500,
  active_agent_runs_per_workspace: 5,
  agent_runs_per_workspace_daily: 200,
  active_brand_discoveries_per_workspace: 3,
  brand_discoveries_per_workspace_daily: 20,
  commerce_discoveries_per_workspace_daily: 50,
  internal_link_analyses_per_workspace_daily: 10,
  prompt_judge_calls_per_workspace_daily: 500,
  active_job_retry_after_seconds: 60,
  sse_streams_per_user: 3,
  usage_window_cleanup_batch: 500,
};

export const abuse = Object.fromEntries(
  Object.entries(defaults).map(([name, value]) => [
    name,
    { env: [`ABUSE_${name.toUpperCase()}`], type: 'int', default: value, minimum: 1 },
  ]),
) as Record<
  keyof typeof defaults,
  { env: string[]; type: string; default: number; minimum: number }
>;
