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
  message: string;
  retryable: boolean;
  code?: string;
  requestId?: string;
};

export function isTransientMutationError(error: unknown): boolean {
  if (typeof error === 'object' && error !== null && 'retryable' in error) {
    if (typeof error.retryable === 'boolean') return error.retryable;
  }
  const status = httpErrorStatus(error);
  if (status === undefined) return true;
  return status === 408 || status === 429 || status >= 500;
}

export function mutationNoticeForError(
  error: unknown,
  options: { action: string },
): MutationNotice {
  const humanized = humanizeApiError(error);
  const retryable = isTransientMutationError(error);
  return {
    message: retryable ? transientMessage(error, options.action) : humanized.message,
    retryable,
    code: humanized.code,
    requestId: humanized.requestId,
  };
}

const _GENERIC_TRANSIENT_CODES = new Set(['internal_error', 'request_timeout', 'http_error']);

function transientMessage(error: unknown, action: string): string {
  const generic = `Could not ${action}. The request failed or timed out. This is usually temporary; try again.`;
  return serverMessage(error) ?? generic;
}

export function serverMessage(error: unknown): string | undefined {
  if (!(error instanceof ApiError)) return undefined;
  if (error.status <= 0 || !error.code || _GENERIC_TRANSIENT_CODES.has(error.code))
    return undefined;
  return error.message.trim() || undefined;
}
