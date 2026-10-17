/**
 * One Pub/Sub message from a Cloud Logging sink → one log line in the
 * `gcp_log_entry` preset's field names, before `ingest()` admits it.
 *
 * Only load balancer and Cloud Run request entries carry a request; any other
 * entry, or a message that is not a readable LogEntry, is unusable and is
 * counted as a rejected line rather than failing the batch.
 */
import { z } from 'zod';
import { base64Text } from './base64-text.ts';

const SUPPORTED_RESOURCES: ReadonlySet<string> = new Set([
  'http_load_balancer',
  'cloud_run_revision',
]);
/** A Cloud Logging entry is at most 256 KB; anything larger is not one. */
const MAX_ENTRY_BYTES = 262_144;
const logEntrySchema = z.object({
  timestamp: z.string().min(1),
  insertId: z.string().optional(),
  resource: z.object({ type: z.string() }),
  httpRequest: z.object({
    requestMethod: z.string().optional(),
    requestUrl: z.string().min(1),
    status: z.number().int().optional(),
    userAgent: z.string().min(1),
    remoteIp: z.string().optional(),
  }),
});

function decoded(data: string): unknown {
  const text = base64Text(data, MAX_ENTRY_BYTES);
  if (text === null) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** The NDJSON line for a message's base64 `data`, or null when it holds no usable request. */
export function gcpLogLine(data: string): string | null {
  const entry = logEntrySchema.safeParse(decoded(data));
  if (!entry.success || !SUPPORTED_RESOURCES.has(entry.data.resource.type)) return null;
  const request = entry.data.httpRequest;
  let url: URL;
  try {
    url = new URL(request.requestUrl);
  } catch {
    return null;
  }
  // The query and fragment never leave this function; host scope drops IP hosts.
  return JSON.stringify({
    timestamp: entry.data.timestamp,
    host: url.hostname,
    path: url.pathname,
    method: request.requestMethod,
    status: request.status,
    user_agent: request.userAgent,
    client_ip: request.remoteIp,
    request_id: entry.data.insertId,
  });
}
