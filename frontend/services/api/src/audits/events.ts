import type { Database } from '../db/database.ts';
import { RequestValidationError } from '../http/params.ts';
import { slottedEventStream, type StreamOwner } from '../http/stream-slots.ts';
import { parseUuid } from '../http/uuid.ts';
import { waitForPoll } from '../workers/poll.ts';
import { auditPolicy, type AuditRuntime } from './config.ts';
import { auditEvents, authorizedAudit } from './reads.ts';

export function resumeCursor(value: string | undefined) {
  if (value === undefined) return undefined;
  const parsed = parseUuid(value);
  if (!parsed)
    throw new RequestValidationError([
      {
        loc: ['header', 'last-event-id'],
        message: 'Input should be a valid UUID',
        type: 'uuid_parsing',
      },
    ]);
  return parsed;
}
/**
 * Each page finishes its reads before yielding or waiting; no streaming
 * transaction remains open. A stream ends after its maximum duration, so a
 * held connection cannot outlast the caller's access: the client resumes
 * with Last-Event-ID through the full authorization path.
 */
export async function* auditEventFrames(
  db: Database,
  workspaceId: string,
  auditId: string,
  after: string | undefined,
  runtime: AuditRuntime,
  signal: AbortSignal,
  initial?: Awaited<ReturnType<typeof auditEvents>>,
) {
  let cursor = after,
    terminalPolls = 0,
    prepared = initial;
  const deadline = Date.now() + runtime.audits.sse_max_duration_seconds * 1000;
  while (!signal.aborted && Date.now() < deadline) {
    const events =
      prepared ??
      (await auditEvents(db, workspaceId, auditId, cursor, runtime.audits.max_event_page));
    prepared = undefined;
    for (const event of events) {
      if (signal.aborted) return;
      cursor = event.id;
      yield `id: ${event.id}\nevent: ${event.event_type}\ndata: ${JSON.stringify(event)}\n\n`;
    }
    const audit = await authorizedAudit(db, workspaceId, auditId);
    if (events.length === runtime.audits.max_event_page) continue;
    if (auditPolicy.constants.audit_terminal_statuses.includes(audit.status)) {
      terminalPolls++;
      if (terminalPolls >= runtime.audits.sse_terminal_grace_polls) return;
    }
    // Never wait past the stream's deadline, whatever the poll interval.
    await waitForPoll(
      Math.min(runtime.audits.sse_poll_seconds * 1000, Math.max(0, deadline - Date.now())),
      signal,
    );
  }
}
export function eventStreamResponse(
  db: Database,
  workspaceId: string,
  auditId: string,
  after: string | undefined,
  runtime: AuditRuntime,
  requestSignal: AbortSignal,
  initial: Awaited<ReturnType<typeof auditEvents>>,
  owner: StreamOwner,
) {
  const cancellation = new AbortController(),
    signal = AbortSignal.any([cancellation.signal, requestSignal]);
  const encoder = new TextEncoder();
  const open = () => {
    const frames = auditEventFrames(db, workspaceId, auditId, after, runtime, signal, initial);
    return new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const next = await frames.next();
          if (next.done || signal.aborted) controller.close();
          else controller.enqueue(encoder.encode(next.value));
        } catch (error) {
          controller.error(error);
        }
      },
      async cancel() {
        cancellation.abort();
        await frames.return();
      },
    });
  };
  return new Response(slottedEventStream({ ...owner, signal: requestSignal, open }), {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache',
      'x-accel-buffering': 'no',
    },
  });
}
