/**
 * Run/execution status view-model helpers.
 *
 * Maps the backend audit + task statuses and citation classifications
 * onto the `Badge` value spaces, and answers "is this run still active?" so
 * the detail screen knows whether to keep polling. Pure functions — no
 * transport, no React — so they are trivially unit-testable.
 */
import type {
  Audit,
  AuditStatus,
  CitationClassification,
  ExecutionStatus,
} from '@citeladder/contracts';
import type { ClassificationValue, RunStatusValue, StatusValue } from '@/components/ui/status-mark';
import { ACTIVE_RUN_POLL_MS } from '@/lib/config/operational';
import { pollWhileActive, type JobStates } from '@/lib/jobs/poll';
import { formatDisplayDate } from '@/lib/format';

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

export const pollAudits = (statuses: AuditStatus | readonly AuditStatus[] | undefined) =>
  pollWhileActive(AUDIT_STATES, ACTIVE_RUN_POLL_MS, statuses);

export const EXECUTION_STATES = {
  pending_reservation: { label: 'Pending Reservation', badge: 'info', active: true },
  queued: { label: 'Queued', badge: 'info', active: true },
  leased: { label: 'Leased', badge: 'info', active: true },
  running: { label: 'Running', badge: 'info', active: true },
  succeeded: { label: 'Succeeded', badge: 'success', active: false },
  retry_wait: { label: 'Retry Wait', badge: 'warning', active: true },
  capacity_wait: { label: 'Capacity Wait', badge: 'warning', active: true },
  awaiting_provider_result: { label: 'Waiting for the provider', badge: 'info', active: true },
  submission_uncertain: { label: 'Reconciling', badge: 'warning', active: true },
  failed: { label: 'Failed', badge: 'danger', active: false },
  cancelled: { label: 'Cancelled', badge: 'danger', active: false },
} as const satisfies JobStates<ExecutionStatus, StatusValue>;

export function executionStatusLabel(status: ExecutionStatus, engine?: string): string {
  if (status === 'awaiting_provider_result' && engine) return `Waiting for ${engine}`;
  return EXECUTION_STATES[status].label;
}

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
  answer_unfinished:
    'The engine reported that it failed, was cancelled or paused before finishing the answer. Run it again.',
  run_deadline_exceeded: 'The run reached its time limit before this answer finished.',
  poll_ceiling_exceeded: 'Google did not return a result within the polling limit.',
  submission_unreconciled: 'The provider result could not be matched to this answer.',
  keyword_too_long: 'The prompt is too long for this search surface. Shorten it.',
  cancelled: 'The run was cancelled.',
};
const GENERIC_FAILURE = 'The answer could not be collected. Try running it again.';

export function executionFailureReason(errorCode: string, unknown = GENERIC_FAILURE): string {
  return FAILURE_REASONS[errorCode] ?? unknown;
}

const SCHEDULE_PAUSE_REASONS: Record<string, string> = {
  execution_credentials_unavailable: 'no provider key is connected for its engines',
  manual_run_rate_exceeded: 'the daily run allowance was reached',
};

export function schedulePauseReason(lastError: string): string {
  return SCHEDULE_PAUSE_REASONS[lastError] ?? 'runs could not be started';
}

export function classificationBadgeValue(
  classification: CitationClassification,
): ClassificationValue {
  switch (classification) {
    case 'owned':
    case 'unintended':
      return 'owned';
    case 'competitor':
      return 'competitor';
    case 'third_party':
      return 'third-party';
    default:
      return classification satisfies never;
  }
}

const RUN_SCOPES: Record<Audit['audit_scope'], string> = {
  brand: 'Brand',
  commerce: 'Commerce',
  probe: 'Market',
};

export function runTitle(
  audit: Pick<Audit, 'audit_scope' | 'parent_audit_id' | 'created_at'>,
  timeZone = 'UTC',
): string {
  const scope = RUN_SCOPES[audit.audit_scope];
  const noun = audit.audit_scope === 'probe' ? 'probe' : 'audit';
  const kind = audit.parent_audit_id ? `${scope} repair run` : `${scope} ${noun}`;
  return `${kind} · ${formatDisplayDate(audit.created_at, timeZone)}`;
}
