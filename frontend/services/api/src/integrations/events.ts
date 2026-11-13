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
  | 'integration.mapping_retired'
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

/** A property mapping as its retirement records it. */
type RetiredMapping = {
  id: string;
  connection_id: string;
  project_id: string;
  provider: string;
  property_ref: string;
};

/**
 * Record each mapping a write retired, in the transaction that retired it:
 * a removal, or a replacement by another property for the same project.
 */
export async function recordRetiredMappings(
  db: Database,
  workspaceId: string,
  retired: readonly RetiredMapping[],
  at: Date,
): Promise<void> {
  await recordIntegrationEvents(
    db,
    retired.map((mapping) => ({
      workspaceId,
      connectionId: mapping.connection_id,
      type: 'integration.mapping_retired',
      message: 'Integration property mapping removed',
      payload: {
        mapping_id: mapping.id,
        project_id: mapping.project_id,
        provider: mapping.provider,
        property_ref: mapping.property_ref,
      },
      at,
    })),
  );
}
