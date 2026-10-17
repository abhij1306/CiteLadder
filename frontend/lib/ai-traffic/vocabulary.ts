/**
 * Reader-facing words for AI Traffic contract tokens.
 *
 * The screen speaks the reader's vocabulary, not the schema's: an enum such
 * as `not_connected` or `cdn_edge` reaches a reader only through here, and an
 * unmapped token falls back to spaced words rather than raw snake case.
 */
const CONNECTION = {
  not_connected: 'Not connected',
  awaiting_data: 'Awaiting data',
  connected: 'Connected',
} as const;

const COVERAGE = {
  complete: 'Complete coverage',
  declared_complete: 'Complete (client-reported)',
  partial: 'Partial coverage',
  unknown: 'Coverage unknown',
} as const;

/** The collection points a reader can pick, in menu order. */
export const COLLECTION_POINTS = ['cdn_edge', 'origin', 'application', 'uploaded_file'] as const;

const COLLECTION_POINT: Record<(typeof COLLECTION_POINTS)[number], string> = {
  cdn_edge: 'CDN edge',
  origin: 'Origin server',
  application: 'Application',
  uploaded_file: 'Uploaded file',
};

export function words(token: string): string {
  const spaced = token.replaceAll('_', ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export function label<T extends Record<string, string>>(table: T, token: string): string {
  return token in table ? table[token as keyof T]! : words(token);
}

export const connectionLabel = (token: string) => label(CONNECTION, token);
export const coverageLabel = (token: string) => label(COVERAGE, token);
export const collectionPointLabel = (token: string) => label(COLLECTION_POINT, token);

/** Why a live source is stalled, phrased as what the reader can do about it. */
const STALL_REASON = {
  no_receipts: 'No accepted batches for a day. Check that the sender is still running.',
  oversize: 'A batch over 5 MiB was dropped. Lower the stream buffer size.',
  verification_failed: 'The subscription failed its check. Fix it, then verify again.',
} as const;
export const stallReasonLabel = (token: string) => label(STALL_REASON, token);

/** Which subscription check failed, phrased as the fix. */
const VERIFICATION_FAILURE = {
  label_mismatch: 'The subscription does not carry this source’s citeladder-source label.',
  push_subscription: 'The subscription pushes or exports messages; use a pull subscription.',
  ack_deadline: 'The acknowledgement deadline is under 60 seconds; set it to 120.',
  permission_denied: 'CiteLadder’s reader lacks subscriber and viewer roles on the subscription.',
  not_found: 'The subscription does not exist or the reader cannot see it.',
  unavailable: 'Google Cloud could not be reached. Try again in a few minutes.',
} as const;
export const verificationFailureLabel = (token: string) => label(VERIFICATION_FAILURE, token);

const LEG_STATE = {
  value: 'Measured',
  zero: 'Measured zero',
  flagged: 'Flagged by a data-quality check',
  non_comparable: 'Not comparable',
  unavailable: 'Unavailable',
  unknown: 'Coverage unknown',
  not_connected: 'Not connected',
} as const;

/** Reasons from page legs, verification, coverage and GA4 quality checks. */
const REASON = {
  incomplete_coverage: 'Coverage is incomplete for this window',
  timezone_mismatch: 'Sources report in different timezones',
  currency_mismatch: 'GA4 reported more than one currency',
  projection_pending: 'A newer GA4 import is still being processed',
  partition_fallback: 'An older GA4 import is shown while a newer one is incomplete',
  extract_contract_mismatch: 'The newest GA4 import used a different report shape',
  unavailable: 'GA4 has not reported every day yet',
  missing_ip: 'No client IP in the log line',
  invalid_ip: 'The client IP could not be read',
  no_published_ranges: 'The operator publishes no IP ranges',
  no_snapshot: 'IP ranges have not been fetched yet',
  stale_snapshot: 'No IP ranges from that time',
  ip_outside_ranges: 'IP outside the published ranges',
  later_snapshot_mismatch: 'IP outside ranges published later; ranges may have changed',
  best_effort_worker: 'Best-effort Worker delivery',
  unsampled_gap_free_declared_scope: 'Unsampled delivery without gaps',
  client_reported: 'Declared complete by an uploaded file',
  delivery_gaps_or_partial_scan: 'Delivery gaps or a partial file',
  drained_unsampled_current_filter: 'Unsampled and fully drained with the current sink filter',
  pull_not_live_all_day: 'The source was not connected for the whole day',
  pull_sampled: 'Load balancer logging is sampled',
  sink_filter_outdated: 'The sink filter did not match the crawler catalog all day',
  pull_drain_gap: 'The subscription was not drained for over 30 minutes',
  pull_awaiting_settle: 'Waiting for the drain after the day closed',
  no_data: 'No data',
} as const;

export const legStateLabel = (token: string) => label(LEG_STATE, token);
/** A reason may join several quality flags with commas. */
export const reasonLabel = (token: string) =>
  token
    .split(', ')
    .map((part) => label(REASON, part))
    .join('; ');

export const LOG_FORMATS = ['ndjson', 'json_array', 'combined'] as const;
const LOG_FORMAT: Record<(typeof LOG_FORMATS)[number], string> = {
  ndjson: 'NDJSON',
  json_array: 'JSON array',
  combined: 'Apache/Nginx Combined',
};
export const logFormatLabel = (token: string) => label(LOG_FORMAT, token);

const PATTERN = {
  crawled_without_referrals: 'crawled without AI referrals',
  referrals_without_recent_crawl: 'AI referrals without recent crawls',
  crawler_errors_on_valuable_pages: 'crawler errors on valuable pages',
  key_event_concentration: 'key events concentrated here',
} as const;
export const patternLabel = (token: string) => label(PATTERN, token);
