/**
 * The one writer of `integration_events`: the audit trail of grant and sync
 * lifecycle changes. Callers pass the transaction that made the change, so an
 * event commits with the state it describes.
 */
import { randomUUID } from 'node:crypto';
import type { Database } from '../db/database.ts';

type IntegrationEventType =
  | 'integration.connected'
  | 'integration.disconnected'
  | 'integration.tested'
  | 'integration.revoked'
  | 'integration.revoke_failed'
  | 'integration.reauth_required'
  | 'integration.sync_started'
  | 'integration.sync_finished';

type IntegrationEvent = {
  workspaceId: string;
  type: IntegrationEventType;
  message: string;
  connectionId?: string | null;
  grantId?: string | null;
  payload?: Record<string, unknown> | null;
  at?: Date;
};

export async function recordIntegrationEvents(
  db: Database,
  events: readonly IntegrationEvent[],
): Promise<void> {
  if (events.length === 0) return;
  await db
    .insertInto('integration_events')
    .values(
      events.map((event) => ({
        id: randomUUID(),
        workspace_id: event.workspaceId,
        connection_id: event.connectionId ?? null,
        grant_id: event.grantId ?? null,
        event_type: event.type,
        message: event.message,
        payload: event.payload ? JSON.stringify(event.payload) : null,
        created_at: event.at ?? new Date(),
      })),
    )
    .execute();
}
