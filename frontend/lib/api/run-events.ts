/**
 * Audit run-event SSE parsing (transport half; the React hook lives in
 * `lib/runs/use-run-events.ts`).
 *
 * The stream is an INVALIDATION ACCELERATOR, never a data source. A parsed
 * event tells the UI that something changed and which queries are now stale —
 * it never becomes an execution row. Payloads carry opaque ids, statuses and
 * retry timing only, so building a row from one would mean inventing the
 * fields it deliberately omits, and replayed or out-of-order events would then
 * corrupt the table. Refetching through the normal endpoint keeps strict
 * whole-response validation on the only path that produces rows.
 *
 * `apiClient` is JSON-only, so this module owns a direct `fetch` — with the
 * same credentials + workspace-header contract, exactly as `use-crawl-events`
 * does for Site Health.
 */
import type { RawSseFrame } from '@/lib/sse/frames';

import { auditEventSchema } from '@citeladder/contracts/audit-events';
import type { AuditEvent } from './types';

export type { RawSseFrame };

/**
 * Validate one frame's data against the discriminated event contract.
 *
 * Returns null for anything that is not a well-formed known event — an
 * unknown `event_type`, a payload that does not match its variant, or
 * unparseable JSON. Returning null (rather than a partial object) is what
 * keeps an unrecognised event from reaching a handler that would treat its
 * missing fields as real values; the caller still invalidates, so an
 * unparseable frame degrades to "something changed", never to bad data.
 */
export function parseAuditEvent(frame: RawSseFrame): AuditEvent | null {
  if (!frame.data) return null;
  let json: unknown;
  try {
    json = JSON.parse(frame.data);
  } catch {
    return null;
  }
  const result = auditEventSchema.safeParse(json);
  return result.success ? result.data : null;
}

/** Every query family one event can invalidate. */
export type RunInvalidation = 'audit' | 'executions' | 'visibility';

/**
 * Which queries an event makes stale.
 *
 * Task-level events move rows, so they invalidate the audit summary and the
 * executions list. Terminal audit events additionally invalidate Visibility,
 * whose projections only exist once analysis has run.
 */
export function invalidationsFor(event: AuditEvent): RunInvalidation[] {
  switch (event.event_type) {
    case 'audit.completed':
    case 'audit.cancelled':
      return ['audit', 'executions', 'visibility'];
    case 'task.succeeded':
    case 'task.failed':
    case 'task.retry':
    case 'task.capacity_wait':
      return ['audit', 'executions'];
    default:
      return ['audit'];
  }
}
