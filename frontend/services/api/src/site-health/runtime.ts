import { policy, resolveSettingSpec } from '../config.ts';

export function siteWorkerSettings(env: Record<string, string | undefined> = process.env) {
  const spec = policy.site_health.settings;
  const number = (name: keyof typeof spec) => Number(resolveSettingSpec(spec[name], env));
  const lease = number('lease_ttl_seconds');
  const heartbeat = number('heartbeat_interval_seconds');
  if (heartbeat <= 0 || lease <= heartbeat)
    throw new Error('Site Health heartbeat must be shorter than its lease');
  // Environment specs enforce individual bounds; guard the whole lease contract here.
  for (const name of ['lease_reclaim_batch_size', 'stalled_crawl_reconcile_batch'] as const)
    if (!Number.isSafeInteger(number(name)) || number(name) <= 0)
      throw new Error(`Site Health ${name} must be a positive integer`);
  return {
    lease,
    heartbeat,
    poll: number('poll_interval_seconds'),
    /** How long one claim pass keeps refilling freed slots before yielding. */
    claimWindow: number('claim_window_seconds'),
    /** Unscoped stalled/overdue/cancelled crawl backstops; well inside the stalled threshold. */
    backstopInterval: number('backstop_interval_seconds'),
    concurrency: Math.max(1, Math.min(number('worker_concurrency'), number('global_concurrency'))),
    maxAttempts: number('max_attempts'),
    retryBase: number('retry_base_delay_seconds'),
    retryMax: number('retry_max_delay_seconds'),
    retryJitter: number('retry_jitter_seconds'),
    conflictMax: number('db_conflict_max_requeues'),
    conflictBase: number('db_conflict_base_delay_seconds'),
    conflictJitter: number('db_conflict_jitter_seconds'),
    reclaimBatch: number('lease_reclaim_batch_size'),
    drainBudget: number('drain_budget_seconds'),
    lifecycle: {
      stalledSeconds: number('stalled_crawl_reconcile_seconds'),
      overdueSeconds: number('overdue_crawl_seconds'),
      batch: number('stalled_crawl_reconcile_batch'),
    },
    scoreRefresh: {
      pageInterval: number('live_score_refresh_page_interval'),
      pageFraction: number('live_score_refresh_page_fraction'),
      minIntervalSeconds: number('live_score_refresh_min_interval_seconds'),
      maxTrackedCrawls: number('live_score_refresh_max_tracked_crawls'),
    },
  };
}
export type SiteWorkerSettings = ReturnType<typeof siteWorkerSettings>;

/** What the read API needs: export and event-stream bounds, and the advanced-controls flag. */
export function siteReadSettings(env: Record<string, string | undefined> = process.env) {
  const spec = policy.site_health.settings;
  const value = (name: keyof typeof spec) => resolveSettingSpec(spec[name], env);
  return {
    advancedControls: value('advanced_controls_enabled') === true,
    maxExportItems: Number(value('max_export_items')),
    maxEventPage: Number(value('max_event_page')),
    ssePollSeconds: Number(value('sse_poll_interval_seconds')),
    sseMaxSeconds: Number(value('sse_max_duration_seconds')),
  };
}
