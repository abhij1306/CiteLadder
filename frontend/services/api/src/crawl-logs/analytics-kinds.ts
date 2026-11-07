/** The crawl-log and AI Traffic analytics kinds. */
import { crawlLogs } from '../config/crawl-logs.ts';
import type { AnalyticsKinds } from '../queue/executor.ts';
import { refreshTrafficInsights } from './insights.ts';
import {
  botIpRangeRefresh,
  botRequestRetentionSweep,
  crawlLogUploadAbandonSweep,
} from './maintenance.ts';
import { crawlLogPull } from './pull.ts';
import { crawlLogRollupRefresh } from './rollup.ts';

export const crawlLogKinds = {
  ai_traffic_insights_refresh: { run: refreshTrafficInsights },
  crawl_log_rollup_refresh: { run: crawlLogRollupRefresh },
  crawl_log_pull: { run: crawlLogPull(), leaseTtlSeconds: crawlLogs.pull_lease_ttl_seconds },
  bot_ip_range_refresh: { run: botIpRangeRefresh() },
  bot_request_retention_sweep: { run: botRequestRetentionSweep },
  crawl_log_upload_abandon_sweep: { run: crawlLogUploadAbandonSweep },
} as const satisfies AnalyticsKinds;
