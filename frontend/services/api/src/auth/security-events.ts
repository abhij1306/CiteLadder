import { randomUUID } from 'node:crypto';
import type { Database } from '../db/database.ts';
import type { McpWriteKind } from '../mcp/write-tools.ts';

type SecurityEvent =
  | 'acquisition.control'
  | 'api_key.create'
  | 'api_key.revoke'
  | 'api_key.rejected_revoked'
  | 'api_key.rejected_expired'
  | 'crawl_log.create'
  | 'crawl_log.rotate'
  | 'crawl_log.revoke'
  | 'credential.create'
  | 'credential.update'
  | 'credential.delete'
  | `mcp.write.${McpWriteKind}`;

/** Append in the mutation transaction; no arbitrary payload or secrets. */
export async function recordSecurityEvent(
  db: Database,
  event: SecurityEvent,
  actorId: string,
  workspaceId: string | null = null,
  targetId: string | null = null,
): Promise<void> {
  await db
    .insertInto('security_events')
    .values({
      id: randomUUID(),
      event,
      actor_id: actorId,
      workspace_id: workspaceId,
      target_id: targetId,
      occurred_at: new Date(),
    })
    .execute();
}
