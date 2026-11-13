import type { Database } from '../db/database.ts';
import { ApiError } from '../errors.ts';
import { eventStreamResponse, eventTailStream, type EventTail } from '../http/event-stream.ts';
import { slottedEventStream, type StreamOwner } from '../http/stream-slots.ts';
import { auditPolicy, type AuditRuntime } from './config.ts';
import { auditEvents, authorizedAudit } from './reads.ts';

type AuditEvent = Awaited<ReturnType<typeof auditEvents>>[number];

const frame = (event: AuditEvent) => ({ id: event.id, event: event.event_type, data: event });

/**
 * An audit's events as a tail. A stream ends after its maximum duration, or
 * sooner when the stream slot finds the caller's access ended: the client
 * resumes with Last-Event-ID through the full authorization path.
 */
export function auditEventTail(
  db: Database,
  stream: {
    workspaceId: string;
    auditId: string;
    after: string | undefined;
    initial?: readonly AuditEvent[];
  },
  runtime: AuditRuntime,
): EventTail {
  const { workspaceId, auditId, after, initial } = stream;
  const pageSize = runtime.audits.max_event_page;
  return {
    stream: 'audit',
    subjectId: auditId,
    after,
    first: initial?.map(frame),
    page: async (cursor) =>
      (await auditEvents(db, workspaceId, auditId, cursor, pageSize)).map(frame),
    poll: async () => {
      try {
        const audit = await authorizedAudit(db, workspaceId, auditId);
        return auditPolicy.constants.audit_terminal_statuses.includes(audit.status)
          ? 'terminal'
          : 'open';
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) return 'gone';
        throw error;
      }
    },
    settings: {
      pageSize,
      pollSeconds: runtime.audits.sse_poll_seconds,
      maxSeconds: runtime.audits.sse_max_duration_seconds,
      terminalGracePolls: runtime.audits.sse_terminal_grace_polls,
    },
  };
}

export function auditEventStreamResponse(
  db: Database,
  stream: Parameters<typeof auditEventTail>[1],
  runtime: AuditRuntime,
  requestSignal: AbortSignal,
  owner: StreamOwner,
) {
  const tail = auditEventTail(db, stream, runtime);
  return eventStreamResponse(
    slottedEventStream({
      ...owner,
      signal: requestSignal,
      open: (held) => eventTailStream(tail, held),
    }),
  );
}
