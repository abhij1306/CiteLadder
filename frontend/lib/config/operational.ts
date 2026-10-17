/**
 * Frontend operational configuration.
 *
 * This is the single owner for tunable client limits, request bounds, polling
 * cadences, and the same-origin API base. Feature modules may re-export values
 * for backwards compatibility, but must not redefine them.
 */

// Same-origin API transport.
export const API_BASE_URL = '/api/v1';

/**
 * Bounded default fetch timeout (A3). Every API request attempt is wrapped in
 * `AbortSignal.timeout(...)`; an expiry surfaces as a retryable network-class
 * `ApiError` (`code: 'request_timeout'`). Env-overridable via
 * `NEXT_PUBLIC_API_REQUEST_TIMEOUT_MS`; read lazily so tests and
 * Next.js environments can change it without re-importing this module.
 */
export const DEFAULT_API_REQUEST_TIMEOUT_MS = 30_000;
const MAX_API_REQUEST_TIMEOUT_MS = 2_147_483_647;

export function getApiRequestTimeoutMs(): number {
  const raw = process.env.NEXT_PUBLIC_API_REQUEST_TIMEOUT_MS;
  if (!raw || !/^[1-9]\d*$/u.test(raw)) return DEFAULT_API_REQUEST_TIMEOUT_MS;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed)
    ? Math.min(parsed, MAX_API_REQUEST_TIMEOUT_MS)
    : DEFAULT_API_REQUEST_TIMEOUT_MS;
}

/**
 * Bounded timeout for the shell's opening reads: session, memberships, the
 * workspace's project list (and an explicitly requested project detail).
 * These are tiny payloads a
 * healthy-but-distant network still serves in well under a second; letting one
 * ride the full 30-second request timeout meant a stalled connection painted
 * nothing but a loader for minutes while the gate's retry notice waited on an
 * answer that never came. An expiry still surfaces through the ordinary
 * retryable `request_timeout` path, so recovery stays with the existing
 * notices and retries. Env-overridable via `NEXT_PUBLIC_BOOTSTRAP_READ_TIMEOUT_MS`.
 */
export const DEFAULT_BOOTSTRAP_READ_TIMEOUT_MS = 8_000;

export function getBootstrapReadTimeoutMs(): number {
  const raw = process.env.NEXT_PUBLIC_BOOTSTRAP_READ_TIMEOUT_MS;
  if (!raw || !/^[1-9]\d*$/u.test(raw)) return DEFAULT_BOOTSTRAP_READ_TIMEOUT_MS;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) ? parsed : DEFAULT_BOOTSTRAP_READ_TIMEOUT_MS;
}

/**
 * Commerce buyer-prompt generation performs one structured model call. Keep
 * its browser request alive for the backend model gateway's 180-second bound
 * plus response/persistence overhead instead of applying the ordinary
 * 30-second API limit.
 */
export const COMMERCE_BUYER_PROMPT_REQUEST_TIMEOUT_MS = 195_000;

/**
 * Prompt generation makes sequential structured model calls (offering maps,
 * then generation batches, each bounded by the 180-second model gateway)
 * before a JEV judging pass that is bounded at 30 seconds. A measured local
 * run spent about a minute in the model calls and two seconds in JEV, which
 * the ordinary 30-second limit abandoned while the server went on to stage
 * its candidates.
 */
export const PROMPT_GENERATION_REQUEST_TIMEOUT_MS = 240_000;

/**
 * "Create project" confirms every selected competitor website before it
 * commits. The checks run concurrently, each bounded at 12 seconds on the
 * backend (two fetch attempts inside that), and the commit follows. The
 * ordinary 30-second limit sat too close to that bound: the browser gave up
 * while the server went on to create the project.
 */
export const ONBOARDING_COMPLETION_REQUEST_TIMEOUT_MS = 60_000;
// Interactive research owns a 180-second server budget, plus response overhead.
export const ONBOARDING_RESEARCH_REQUEST_TIMEOUT_MS = 195_000;
// Interactive crawl/link work has a 180-second server bound plus settlement overhead.
export const SITE_HEALTH_EXECUTION_REQUEST_TIMEOUT_MS = 195_000;
export const INTERACTIVE_EXECUTION_REQUEST_TIMEOUT_MS = 255_000;

/**
 * Bounded backoff between the API client's network-failure retries (A3). The
 * delay is multiplied by the attempt number, so attempt 2 waits one unit.
 */
export const API_RETRY_BACKOFF_MS = 150;

// A blocking workspace precondition should not look frozen indefinitely.
// This timer changes only the UI from passive loading to an explicit retry;
// the API client's request timeout remains the network authority.
export const WORKSPACE_LOADING_STALL_MS = 8_000;

/**
 * How long a first-load placeholder hides its spinner so a wait short enough
 * to go unnoticed passes without one. The visual reveal is the mirrored
 * `citeladder-loading-appear` animation delay in globals.css; this constant
 * holds the accessible `status` announcement to the same beat.
 */
export const LOADING_INDICATOR_DELAY_MS = 300;

// Evidence request/display bounds.
export const EVIDENCE_LIMIT = 100;
export const FANOUT_SEARCH_DEBOUNCE_MS = 300;

// Audit launch bounds.
export const MIN_REPETITIONS = 1;
export const MAX_REPETITIONS = 10;
export const DEFAULT_REPETITIONS = 1;

// Polling cadences and retry ceilings.
export const ACTIVE_RUN_POLL_MS = 3_000;
export const SYNC_RUN_POLL_MS = 3_000;
/** How often the Perception tab rechecks while answers are still being classified. */
export const PERCEPTION_PENDING_POLL_MS = 15_000;
