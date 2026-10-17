/**
 * Shared mutation-notice policy (A4).
 *
 * ONE owner for how a failed mutation reads in the UI:
 *   - **4xx (precondition/validation, not 408/429)** → the backend `message`
 *     verbatim. It names a real precondition ("no completed sync window is
 *     available"), so NO "try again" copy is appended — retrying unchanged
 *     would fail the same way.
 *   - **5xx / network / timeout** → retryable (`retryable: true`, so the notice
 *     can offer a retry). The copy prefers the backend envelope's own message
 *     when there is one — it is more specific than the generic sentence, which
 *     is reserved for failures carrying no server message (network-class, the
 *     A3 timeout, or a bare 5xx that is only an HTTP status text).
 *   - The backend's explicit `retryable` classification (A1 envelope) and the
 *     A3 `request_timeout` surface always win over the status heuristic.
 *   - `code` and `requestId` ride along for support correlation (A6).
 *
 * Display lives in `components/ui/mutation-notice.tsx`; this module is the
 * pure, testable policy.
 */
import { ApiError, humanizeApiError, httpErrorStatus } from './errors';

export type MutationNotice = {
  /** User-facing copy (verbatim backend message on 4xx, transient copy otherwise). */
  message: string;
  /** True when retrying the same action can succeed — the retry affordance. */
  retryable: boolean;
  /** Stable machine code for support correlation, when the backend sent one. */
  code?: string;
  /** `X-Request-ID` correlation token, when captured. */
  requestId?: string;
};

/** True when the failure class is transient (retrying can succeed). */
export function isTransientMutationError(error: unknown): boolean {
  if (typeof error === 'object' && error !== null && 'retryable' in error) {
    const retryable = (error as { retryable: unknown }).retryable;
    if (typeof retryable === 'boolean') return retryable;
  }
  const status = httpErrorStatus(error);
  // No status = network-class failure (offline, DNS, the A3 timeout ApiError).
  if (status === undefined) return true;
  return status === 408 || status === 429 || status >= 500;
}

/**
 * Build the notice for a failed mutation. `action` is the verb phrase that
 * completes "Could not ___" (e.g. `'start the attribution recompute'`) and is
 * used only for transient failures — 4xx copy is the backend's own message.
 */
export function mutationNoticeForError(
  error: unknown,
  options: { action: string },
): MutationNotice {
  const humanized = humanizeApiError(error);
  const retryable = isTransientMutationError(error);
  return {
    message: retryable
      ? transientMessage(error, humanized.message, options.action)
      : humanized.message,
    retryable,
    code: humanized.code,
    requestId: humanized.requestId,
  };
}

/**
 * Codes whose message carries no actionable information. `internal_error` is
 * the sanitized 500 placeholder ("An unexpected error occurred") the backend
 * substitutes precisely so nothing internal leaks, and `request_timeout` is
 * the client's own A3 surface — for both, the generic retry sentence is
 * strictly more useful than echoing the placeholder.
 */
const _GENERIC_TRANSIENT_CODES = new Set(['internal_error', 'request_timeout', 'http_error']);

/**
 * Copy for a TRANSIENT failure. When the backend envelope carried a SPECIFIC
 * message ("no completed sync window is available yet; retry after the next
 * sync"), show it — it is more actionable than the generic sentence and stays
 * retryable. The generic sentence covers everything that carries no real
 * server message: network-class errors, the A3 timeout, and a bare 5xx whose
 * message is a sanitized placeholder or just the HTTP status text.
 */
function transientMessage(error: unknown, message: string, action: string): string {
  const generic = `Could not ${action} — the request failed or timed out. This is usually temporary; try again.`;
  if (!(error instanceof ApiError)) return generic;
  // No status = network-class/timeout; no code = no canonical envelope block,
  // so `message` is only the status-text fallback.
  if (error.status <= 0 || !error.code) return generic;
  if (_GENERIC_TRANSIENT_CODES.has(error.code)) return generic;
  return message.trim() || generic;
}
