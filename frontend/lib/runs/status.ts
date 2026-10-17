/**
 * Run/execution status view-model helpers.
 *
 * Maps the backend audit + task statuses and citation classifications
 * onto the `Badge` value spaces, and answers "is this run still active?" so
 * the detail screen knows whether to keep polling. Pure functions — no
 * transport, no React — so they are trivially unit-testable.
 */
import type { AuditStatus, CitationClassification, ExecutionStatus } from '@/lib/api/types';
import type { ClassificationValue, RunStatusValue } from '@/components/ui/badge-variants';
import { availabilityLabel, formatDisplayTimestamp } from '@/lib/format';
import { titleCaseStatus } from '@/lib/utils';

/**
 * Audit statuses that are terminal — the run has stopped and needs no further
 * polling. Every other status means the run is still progressing.
 */
const TERMINAL_AUDIT_STATUSES: ReadonlySet<AuditStatus> = new Set<AuditStatus>([
  'completed',
  'partially_completed',
  'failed',
  'cancelled',
]);

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
 * True while `/runs/[runId]` should keep polling `GET /audits/{id}`: the run is
 * not yet terminal (including `reporting`, which still transitions on its own).
 */
export function shouldPollAudit(status: AuditStatus): boolean {
  return !TERMINAL_AUDIT_STATUSES.has(status);
}

/**
 * True when the run can still be cancelled cooperatively. `reporting` and every
 * terminal status return false — the backend would reject the cancel.
 */
export function isAuditCancelable(status: AuditStatus): boolean {
  return CANCELABLE_AUDIT_STATUSES.has(status);
}

/**
 * Map an audit lifecycle status onto a run-status badge value. The badge family
 * has eight values; the extra backend statuses fold onto the
 * nearest visual: validating→queued, reporting→analyzing,
 * partially_completed→partial.
 */
export function auditBadgeValue(status: AuditStatus): RunStatusValue {
  switch (status) {
    case 'validating':
      return 'queued';
    case 'reporting':
      return 'analyzing';
    case 'partially_completed':
      return 'partial';
    default:
      return status;
  }
}

/** Human-readable label for an audit status. */
export function auditStatusLabel(status: AuditStatus): string {
  return titleCaseStatus(status);
}

/**
 * Map an execution/queue status onto a status badge value (success/warning/
 * danger/info). Succeeded is success; failed/cancelled are danger; the two wait
 * states are warning; everything in flight is info.
 */
export function executionBadgeValue(
  status: ExecutionStatus,
): 'success' | 'warning' | 'danger' | 'info' {
  switch (status) {
    case 'succeeded':
      return 'success';
    case 'failed':
    case 'cancelled':
      return 'danger';
    case 'retry_wait':
    // Parked on a full provider pool: nothing is wrong, but the row is not
    // progressing either, so it reads like a retry wait rather than in-flight.
    case 'capacity_wait':
    // A submission whose fate is unknown. Warning rather than info: it needs
    // reconciling before it can progress, and presenting it as ordinary
    // in-flight work would hide that.
    case 'submission_uncertain':
      return 'warning';
    // Waiting on a task the provider is genuinely working on. This IS
    // in-flight work, just not in this process, so it must not read as a
    // problem — the run is progressing normally.
    case 'awaiting_provider_result':
      return 'info';
    default:
      return 'info';
  }
}

/**
 * Human-readable label for an execution status.
 *
 * The provider-wait state names the engine being waited on ("Waiting for
 * ChatGPT search"), not our plumbing; someone watching a run needs to know
 * what is actually happening.
 */
export function executionStatusLabel(status: ExecutionStatus, engine?: string): string {
  switch (status) {
    case 'awaiting_provider_result':
      return engine ? `Waiting for ${engine}` : 'Waiting for the provider';
    case 'submission_uncertain':
      return 'Reconciling';
    default:
      return titleCaseStatus(status);
  }
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
  connection_changed: 'The provider key changed during the run. Run it again.',
  rate_limit: 'The provider kept rate-limiting requests. Try again later.',
  timeout: 'The provider did not answer in time. Try again later.',
  connection: 'The provider could not be reached. Try again later.',
  server_error: 'The provider had an error. Try again later.',
  content_filter: "The engine's safety filter declined to answer this prompt.",
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
