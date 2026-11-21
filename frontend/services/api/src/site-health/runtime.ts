import { policy } from '../config.ts';
import { resolveSettingSpec, type SettingSource } from '../config/settings.ts';

export function siteWorkerSettings(env: SettingSource = process.env) {
  const spec = policy.site_health.settings;
  const number = (name: keyof typeof spec) => Number(resolveSettingSpec(spec[name], env));
  const lease = number('lease_ttl_seconds');
  const heartbeat = number('heartbeat_interval_seconds');
  if (heartbeat <= 0 || lease <= heartbeat)
    throw new Error('Site Health heartbeat must be shorter than its lease');
  for (const name of ['lease_reclaim_batch_size', 'stalled_crawl_reconcile_batch'] as const)
    if (!Number.isSafeInteger(number(name)) || number(name) <= 0)
      throw new Error(`Site Health ${name} must be a positive integer`);
  return {
    lease,
    heartbeat,
    poll: number('poll_interval_seconds'),
    claimWindow: number('claim_window_seconds'),
    backstopInterval: number('backstop_interval_seconds'),
    concurrency: Math.max(1, Math.min(number('worker_concurrency'), number('global_concurrency'))),
    maxAttempts: number('max_attempts'),
    retryBase: number('retry_base_delay_seconds'),
    retryMax: number('retry_max_delay_seconds'),
    retryJitter: number('retry_jitter_seconds'),
    conflictMax: number('db_conflict_max_requeues'),
    conflictBase: number('db_conflict_base_delay_seconds'),
    conflictJitter: number('db_conflict_jitter_seconds'),
    dependencyRetry: number('analysis_dependency_retry_seconds'),
    dependencyRetryMax: number('analysis_dependency_retry_max_seconds'),
    dependencyMaxWait: number('analysis_dependency_max_wait_seconds'),
    reclaimBatch: number('lease_reclaim_batch_size'),
    drainBudget: number('drain_budget_seconds'),
    lifecycle: {
      stalledSeconds: number('stalled_crawl_reconcile_seconds'),
      overdueSeconds: number('overdue_crawl_seconds'),
      noProgressSeconds: number('crawl_no_progress_seconds'),
      batch: number('stalled_crawl_reconcile_batch'),
    },
    scoreRefresh: {
      pageInterval: number('live_score_refresh_page_interval'),
      pageFraction: number('live_score_refresh_page_fraction'),
      minIntervalSeconds: number('live_score_refresh_min_interval_seconds'),
      largePages: number('live_score_refresh_large_crawl_pages'),
      largeIntervalSeconds: number('live_score_refresh_large_crawl_interval_seconds'),
      maxTrackedCrawls: number('live_score_refresh_max_tracked_crawls'),
      issuePages: number('issue_publication_page_interval'),
      countersSeconds: number('live_counters_refresh_seconds'),
    },
  };
}
export type SiteWorkerSettings = ReturnType<typeof siteWorkerSettings>;

export function siteReadSettings(env: SettingSource = process.env) {
  const spec = policy.site_health.settings;
  const value = (name: keyof typeof spec) => resolveSettingSpec(spec[name], env);
  return {
    maxExportItems: Number(value('max_export_items')),
    maxEventPage: Number(value('max_event_page')),
    ssePollSeconds: Number(value('sse_poll_interval_seconds')),
    sseMaxSeconds: Number(value('sse_max_duration_seconds')),
  };
}
