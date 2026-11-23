import type { Database } from '../db/database.ts';
import { IntegrationError } from './client.ts';
import { integrationPolicy } from './config.ts';
import { isRecord } from '../db/json.ts';

export type SyncIdentity = {
  id: string;
  workspace_id: string;
  connection_id: string;
  mapping_id: string;
  project_id: string;
  property_ref: string;
};

export async function activeSyncTarget(db: Database, run: SyncIdentity) {
  const connection = await db
    .selectFrom('integration_connections')
    .selectAll()
    .where('id', '=', run.connection_id)
    .where('workspace_id', '=', run.workspace_id)
    .forUpdate()
    .executeTakeFirst();
  if (!connection)
    throw new IntegrationError('unmapped_property', 'Integration connection no longer exists');
  const mapping = await db
    .selectFrom('integration_property_mappings')
    .select('id')
    .where('id', '=', run.mapping_id)
    .where('workspace_id', '=', run.workspace_id)
    .where('connection_id', '=', run.connection_id)
    .where('project_id', '=', run.project_id)
    .where('property_ref', '=', run.property_ref)
    .where('provider', '=', connection.provider)
    .where('status', '=', 'active')
    .forShare()
    .executeTakeFirst();
  if (!mapping)
    throw new IntegrationError('unmapped_property', 'Integration mapping is no longer active');
  return connection;
}

export function selectedItemDataset(capabilities: unknown): string {
  const state = isRecord(capabilities) ? capabilities[integrationPolicy.ga4_capability_key] : null;
  return state !== null &&
    typeof state === 'object' &&
    'version' in state &&
    state.version === integrationPolicy.ga4_capability_version &&
    'selected_dataset' in state &&
    state.selected_dataset === 'ga4_item_channel_group_daily'
    ? 'ga4_item_channel_group_daily'
    : 'ga4_item_source_medium_daily';
}

export function artifactOffset(snapshot: unknown): number {
  if (!isRecord(snapshot)) return -1;
  const value = snapshot.startRow ?? snapshot.page_offset;
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : -1;
}
