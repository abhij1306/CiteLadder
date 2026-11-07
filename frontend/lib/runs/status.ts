/**
 * Run/execution status view-model helpers.
 *
 * Maps the backend audit + task statuses and citation classifications
 * onto the `Badge` value spaces, and answers "is this run still active?" so
 * the detail screen knows whether to keep polling. Pure functions — no
 * transport, no React — so they are trivially unit-testable.
 */
import type { AuditStatus, CitationClassification, ExecutionStatus } from '@citeladder/contracts';
import type { ClassificationValue, RunStatusValue, StatusValue } from '@/components/ui/badge';
import { ACTIVE_RUN_POLL_MS } from '@/lib/config/operational';
import { pollWhileActive, type JobStates } from '@/lib/jobs/poll';
import { availabilityLabel, formatDisplayTimestamp } from '@/lib/format';

/**
 * Every audit status: its label, its run-status badge, and whether the run is
 * still progressing on its own (so the run views keep polling). The badge
 * family has fewer values than the lifecycle; the extra statuses fold onto the
 * nearest visual (validating→queued, reporting→analyzing,
 * partially_completed→partial). `reporting` stays active: it still
 * transitions on its own.
 */
export const AUDIT_STATES = {
  draft: { label: 'Draft', badge: 'draft', active: true },
  validating: { label: 'Validating', badge: 'queued', active: true },
  queued: { label: 'Queued', badge: 'queued', active: true },
  running: { label: 'Running', badge: 'running', active: true },
  analyzing: { label: 'Analyzing', badge: 'analyzing', active: true },
  reporting: { label: 'Reporting', badge: 'analyzing', active: true },
  completed: { label: 'Completed', badge: 'completed', active: false },
  partially_completed: { label: 'Partially Completed', badge: 'partial', active: false },
  failed: { label: 'Failed', badge: 'failed', active: false },
  cancelled: { label: 'Cancelled', badge: 'cancelled', active: false },
} as const satisfies JobStates<AuditStatus, RunStatusValue>;

/** The run views' poll cadence: while any of `statuses` is still progressing. */
export const pollAudits = (statuses: AuditStatus | readonly AuditStatus[] | undefined) =>
  pollWhileActive(AUDIT_STATES, ACTIVE_RUN_POLL_MS, statuses);

/**
 * Audit statuses at which a cooperative cancel is still meaningful. Mirrors the
 * API's `audit_active_statuses` (`services/api/src/config/audits.json`): `reporting` is
 * intentionally EXCLUDED — by then execution + analysis are done and the state
 * machine rejects REPORTING → CANCELLED, so the cancel button must be disabled.
 */
const CANCELABLE_AUDIT_STATUSES: ReadonlySet<AuditStatus> = new Set<AuditStatus>([
  'draft',
  'validating',
  'queued',
  'running',
  'analyzing',
]);

/**
 * True when the run can still be cancelled cooperatively. `reporting` and every
 * terminal status return false — the backend would reject the cancel.
 */
export function isAuditCancelable(status: AuditStatus): boolean {
  return CANCELABLE_AUDIT_STATUSES.has(status);
}

/**
 * Every execution/queue status. Succeeded is success; failed/cancelled are
 * danger; the wait states are warning; everything in flight is info.
 * Executions are never polled on their own (the run's progress re-reads
 * them), so `active` only says whether the row can still change.
 */
export const EXECUTION_STATES = {
  pending_reservation: { label: 'Pending Reservation', badge: 'info', active: true },
  queued: { label: 'Queued', badge: 'info', active: true },
  leased: { label: 'Leased', badge: 'info', active: true },
  running: { label: 'Running', badge: 'info', active: true },
  succeeded: { label: 'Succeeded', badge: 'success', active: false },
  retry_wait: { label: 'Retry Wait', badge: 'warning', active: true },
  // Parked on a full provider pool: nothing is wrong, but the row is not
  // progressing either, so it reads like a retry wait rather than in-flight.
  capacity_wait: { label: 'Capacity Wait', badge: 'warning', active: true },
  // Waiting on a task the provider is genuinely working on. This IS in-flight
  // work, just not in this process, so it must not read as a problem. The
  // label names the engine when there is one (`executionStatusLabel`).
  awaiting_provider_result: { label: 'Waiting for the provider', badge: 'info', active: true },
  // A submission whose fate is unknown. Warning rather than info: it needs
  // reconciling before it can progress, and presenting it as ordinary
  // in-flight work would hide that.
  submission_uncertain: { label: 'Reconciling', badge: 'warning', active: true },
  failed: { label: 'Failed', badge: 'danger', active: false },
  cancelled: { label: 'Cancelled', badge: 'danger', active: false },
} as const satisfies JobStates<ExecutionStatus, StatusValue>;

/**
 * Human-readable label for an execution status. The provider-wait state names
 * the engine being waited on ("Waiting for ChatGPT search"), not our plumbing;
 * someone watching a run needs to know what is actually happening.
 */
export function executionStatusLabel(status: ExecutionStatus, engine?: string): string {
  if (status === 'awaiting_provider_result' && engine) return `Waiting for ${engine}`;
  return EXECUTION_STATES[status].label;
}

/**
 * Why an execution failed, in the reader's terms, with what to do next.
 * Unknown codes fall back to a generic reason rather than leaking the token.
 */
const FAILURE_REASONS: Record<string, string> = {
  provider_connection_missing: 'No provider key is connected for this engine. Add one in Settings.',
  credential_unavailable_for_retrieval:
    'The provider key used for this answer was removed or changed. Reconnect it in Settings.',
  auth_failure: 'The provider rejected the key. Check it in Settings.',
  provider_account_unavailable:
    'The provider account is paused or out of funds, so this engine was stopped for the run. Try again later.',
  connection_changed: 'The provider key changed during the run. Run it again.',
  rate_limit: 'The provider kept rate-limiting requests. Try again later.',
  timeout: 'The provider did not answer in time. Try again later.',
  connection: 'The provider could not be reached. Try again later.',
  server_error: 'The provider had an error. Try again later.',
  content_filter: "The engine's safety filter declined to answer this prompt.",
  truncated_before_answer:
    'The engine used its output allowance before writing an answer. Run it again.',
  empty_answer: 'The engine returned no answer text. Run it again.',
  run_deadline_exceeded: 'The run reached its time limit before this answer finished.',
  poll_ceiling_exceeded: 'Google did not return a result within the polling limit.',
  submission_unreconciled: 'The provider result could not be matched to this answer.',
  keyword_too_long: 'The prompt is too long for this search surface. Shorten it.',
  cancelled: 'The run was cancelled.',
};
const GENERIC_FAILURE = 'The answer could not be collected. Try running it again.';

export function executionFailureReason(errorCode: string): string {
  return FAILURE_REASONS[errorCode] ?? GENERIC_FAILURE;
}

/** Why the scheduler paused a schedule after repeated failures to start a run. */
const SCHEDULE_PAUSE_REASONS: Record<string, string> = {
  execution_credentials_unavailable: 'no provider key is connected for its engines',
  manual_run_rate_exceeded: 'the daily run allowance was reached',
};

export function schedulePauseReason(lastError: string): string {
  return SCHEDULE_PAUSE_REASONS[lastError] ?? 'runs could not be started';
}

/**
 * Map a citation classification onto the citation badge value space. The badge
 * family has three values (owned / competitor / third-party); the backend's
 * fourth class, `unintended` (an owned-but-unwanted domain), is surfaced under
 * the `owned` visual since it is still an owned-domain citation.
 */
export function classificationBadgeValue(
  classification: CitationClassification,
): ClassificationValue {
  switch (classification) {
    case 'owned':
    case 'unintended':
      return 'owned';
    case 'competitor':
      return 'competitor';
    default:
      return 'third-party';
  }
}

/** Short, stable date/time label for a timestamp (falls back to the raw value). */
export function formatDateTime(timestamp: string | null, timeZone = 'UTC'): string {
  if (!timestamp) return availabilityLabel('unknown');
  return formatDisplayTimestamp(timestamp, timeZone);
}

/** Human-readable label for a citation classification. */
export function classificationLabel(classification: CitationClassification): string {
  switch (classification) {
    case 'owned':
      return 'Owned';
    case 'unintended':
      return 'Owned (unintended)';
    case 'competitor':
      return 'Competitor';
    default:
      return 'Third-party';
  }
}
