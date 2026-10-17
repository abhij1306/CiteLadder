/** Polling controls for a page rerun before its first active snapshot appears. */
export const RERUN_POLL_INTERVAL_MS = 3_000;
export const RERUN_MAX_PRE_ACTIVE_POLLS = 10;

/** Coalescing window for non-progress Site Health lifecycle events. */
export const SITE_HEALTH_STREAM_INVALIDATE_DEBOUNCE_MS = 500;

/** Reconnect backoff bounds for the credentialed Site Health event stream. */
export const SITE_HEALTH_STREAM_RECONNECT_BASE_MS = 1_000;
export const SITE_HEALTH_STREAM_RECONNECT_MAX_MS = 15_000;

/**
 * One page of the issues catalog, and one page of an issue's occurrences.
 *
 * Here rather than in the screen because the sidebar's hover prefetch has to
 * build the SAME cache key the screen's first request builds, and a limit
 * spelled out twice would silently warm an entry nothing reads.
 */
export const ISSUE_PAGE_LIMIT = 25;
export const ISSUE_OCCURRENCE_LIMIT = 25;

/** Bounds for heterogeneous persisted Website Changes evidence. */
export const CHANGE_EVIDENCE_LIMIT = 8;
export const CHANGE_EVIDENCE_TEXT_LIMIT = 140;
export const CHANGE_EVIDENCE_DEPTH_LIMIT = 2;
