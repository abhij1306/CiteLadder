/**
 * Run-detail streaming and polling cadences.
 *
 * The SSE stream is an *invalidation accelerator*, not a source of rows:
 * polling stays the reliable fallback, so every value here tunes how fast the
 * UI notices a change — never whether it eventually does.
 */

/** Poll cadence while a run is active. Unchanged from the pre-stream default. */
export const RUN_ACTIVE_POLL_MS = 3_000;

/**
 * Events arrive in bursts (one per task). Coalesce them into a single
 * invalidation so a 60-task run does not trigger 60 refetches.
 */
export const RUN_STREAM_INVALIDATE_DEBOUNCE_MS = 250;

/** Reconnect backoff bounds after a dropped stream. */
export const RUN_STREAM_RECONNECT_BASE_MS = 1_000;
export const RUN_STREAM_RECONNECT_MAX_MS = 15_000;
