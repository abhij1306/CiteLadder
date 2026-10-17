import { z } from 'zod';
import value from './crawl-logs.json' with { type: 'json' };
import { ConfigError } from './config-error.ts';

const positive = z.int().positive();
const sampling = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('none') }),
  z.strictObject({ kind: z.literal('sampled'), rate: z.number().gt(0).max(1) }),
  z.strictObject({ kind: z.literal('filtered'), description: z.string().trim().min(1).max(512) }),
]);
const preset = z.strictObject({
  collection_point: z.enum(['cdn_edge', 'origin', 'application', 'uploaded_file']),
  sampling,
  timestamp: z.string().min(1),
  host: z.string().min(1),
  path: z.string().min(1),
  method: z.string().min(1),
  status: z.string().min(1),
  user_agent: z.string().min(1),
  client_ip: z.string().min(1),
  request_id: z.string().min(1),
  timestamp_unit: z.enum(['iso', 'seconds', 'milliseconds', 'nanoseconds']),
  timestamp_fallback: z
    .strictObject({ date: z.string().min(1), time: z.string().min(1) })
    .optional(),
  missing_tokens: z.array(z.string().min(1)).optional(),
  user_agent_decode: z.literal('url').optional(),
});
/** Google Cloud Pub/Sub pull cadence, coverage bounds and request bounds. */
const gcpPull = z.strictObject({
  pull_interval_seconds: positive,
  pull_max_iterations: positive,
  pull_max_messages: positive.max(1000),
  max_pull_gap_minutes: positive,
  pull_settle_minutes: positive,
  verification_interval_hours: positive,
  min_ack_deadline_seconds: positive,
  request_timeout_seconds: positive,
  pull_wait_seconds: positive,
  token_lifetime_seconds: positive.max(3600),
  token_refresh_margin_seconds: positive,
  source_label: z.string().regex(/^[a-z][a-z0-9_-]{0,62}$/u),
});
const schema = z.strictObject({
  ingestion_enabled: z.boolean(),
  default_reporting_timezone: z.literal('UTC'),
  default_range: z.enum(['30d', '90d', '1y']),
  parser_version: z.string().min(1),
  formula_version: z.string().min(1),
  formats: z.array(z.enum(['ndjson', 'json_array', 'combined'])).min(1),
  presets: z.record(z.string(), preset),
  gcp_pull: gcpPull,
  max_batch_bytes: positive,
  max_lines_per_batch: positive,
  upload_sample_lines: positive,
  insert_rows_per_statement: positive.max(1000),
  max_line_bytes: positive,
  max_sources_per_project: positive,
  batches_per_source_per_hour: positive,
  accepted_lines_per_project_per_day: positive,
  received_bytes_per_project_per_day: positive,
  stalled_after_hours: positive,
  max_clock_skew_hours: positive,
  max_backdate_days: positive,
  secret_path_patterns: z.array(z.string().min(1)),
  folder_depth: positive,
  retention_days: positive,
  rollup_freeze_margin_days: positive,
  refresh_delay_seconds: positive,
  max_delivery_gap_minutes: positive,
  buffered_delivery_grace_minutes: positive,
  ip_range_refresh_hours: positive,
  ip_range_max_age_hours: positive,
  ip_range_contemporaneous_hours: positive,
  default_verification_filter: z
    .array(z.enum(['verified', 'unverifiable', 'failed_verification']))
    .min(1),
  upload_abandon_hours: positive,
  sweep_batch_size: positive,
  max_source_batch_ids: positive,
  default_page_size: positive,
  max_page_size: positive,
  ip_range_max_bytes: positive,
  ip_range_timeout_seconds: positive,
  ip_range_max_redirects: positive,
  task_max_attempts: positive,
  max_export_rows: positive,
  worker_timeout_ms: positive,
  worker_flush_seconds: positive,
  worker_batch_lines: positive,
});
export function loadCrawlLogs(value: unknown) {
  const result = schema.safeParse(value);
  if (!result.success)
    throw new ConfigError('Invalid crawl log configuration: ' + result.error.message);
  const config = result.data;
  if (config.max_backdate_days >= config.retention_days - config.rollup_freeze_margin_days)
    throw new ConfigError('Crawl backdating must remain inside the unfrozen retention window');
  if (
    config.default_page_size > config.max_page_size ||
    config.max_line_bytes > config.max_batch_bytes ||
    config.max_batch_bytes > config.received_bytes_per_project_per_day ||
    config.worker_batch_lines > config.max_lines_per_batch ||
    config.worker_batch_lines * config.max_line_bytes > config.max_batch_bytes ||
    config.ip_range_contemporaneous_hours > config.ip_range_max_age_hours ||
    config.gcp_pull.pull_max_messages > config.max_lines_per_batch ||
    config.gcp_pull.token_refresh_margin_seconds >= config.gcp_pull.token_lifetime_seconds ||
    config.gcp_pull.pull_interval_seconds > config.gcp_pull.max_pull_gap_minutes * 60
  )
    throw new ConfigError('Inconsistent crawl log bounds');
  try {
    config.secret_path_patterns.forEach((pattern) => new RegExp(pattern, 'giu'));
  } catch {
    throw new ConfigError('Invalid crawl secret path pattern');
  }
  return config;
}
export const crawlLogs = loadCrawlLogs(value);
