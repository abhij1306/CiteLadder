import type { RawSseFrame } from '@/lib/sse/frames';

import { auditEventSchema } from '@citeladder/contracts/audit-events';
import type { AuditEvent } from '@citeladder/contracts';

export type { RawSseFrame };

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

export type RunInvalidation = 'audit' | 'executions' | 'visibility';

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
    case 'audit.created':
    case 'audit.queued':
    case 'audit.running':
    case 'audit.status':
      return ['audit'];
    default: {
      const unhandled: never = event;
      return unhandled;
    }
  }
}
