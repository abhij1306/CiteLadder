import { z } from 'zod';

const responseObject = <Shape extends z.ZodRawShape>(shape: Shape) => z.object(shape);
const uuid = () => z.uuid();

// ---------------------------------------------------------------------------
// Audit events — the discriminated envelope shared by `GET /audits/{id}/events`
// and its SSE stream. On the wire SSE `event:` IS `event_type` and SSE `id:` IS
// the event UUID (the `Last-Event-ID` resume cursor).
//
// This is a DISCRIMINATED UNION, not a permissive envelope: an unknown
// `event_type` fails parsing rather than reaching a handler as a partial
// object. Payloads are invalidation signals only — never treat one as a row.
// ---------------------------------------------------------------------------

const eventEnvelope = <Type extends string, Payload extends z.ZodTypeAny>(
  eventType: Type,
  payload: Payload,
) =>
  responseObject({
    id: uuid(),
    audit_id: uuid(),
    occurred_at: z.string(),
    event_type: z.literal(eventType),
    payload,
  });

export const auditEventSchema = z.discriminatedUnion('event_type', [
  eventEnvelope(
    'audit.created',
    responseObject({
      requested_count: z.number().int(),
      engines: z.array(z.string()),
    }),
  ),
  eventEnvelope('audit.queued', responseObject({ task_count: z.number().int() })),
  eventEnvelope('audit.running', z.null()),
  eventEnvelope(
    'audit.status',
    responseObject({
      status: z.string(),
      completed: z.number().int().nullable().default(null),
      failed: z.number().int().nullable().default(null),
    }),
  ),
  eventEnvelope(
    'audit.cancelled',
    responseObject({
      status: z.string(),
      completed: z.number().int().nullable().default(null),
      failed: z.number().int().nullable().default(null),
    }),
  ),
  eventEnvelope(
    'audit.completed',
    responseObject({
      status: z.string(),
      completed: z.number().int(),
      failed: z.number().int(),
      visibility_score: z.number(),
    }),
  ),
  eventEnvelope('task.succeeded', responseObject({ task_id: uuid() })),
  eventEnvelope('task.failed', responseObject({ task_id: uuid(), error_code: z.string() })),
  eventEnvelope('task.retry', responseObject({ task_id: uuid(), error_code: z.string() })),
  eventEnvelope(
    'task.capacity_wait',
    responseObject({
      task_id: uuid(),
      code: z.string(),
      pool_kind: z.string(),
      available_at: z.string().default(''),
      retry_after_seconds: z.number().default(0),
    }),
  ),
]);
