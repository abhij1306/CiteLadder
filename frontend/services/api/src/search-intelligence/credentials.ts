/**
 * The workspace's own DataForSEO connection a Search Intelligence analysis
 * runs on, and its decrypted login pair.
 */
import { asApiErrorCode } from '@citeladder/contracts/error-codes';
import type { Selectable } from 'kysely';

import { ProviderError } from '../answer-engines/contracts.ts';
import type { Database } from '../db/database.ts';
import type { WorkspaceScope } from '../db/workspace-scope.ts';
import { ApiError } from '../errors.ts';
import type { ProviderConnections, SearchIntelligenceRuns } from '../generated/db-schema.ts';
import { createSecretCipher } from '../integrations/fernet.ts';
import { onlyOf } from '../lists.ts';
import { dataforseoSecretIdentity } from '../providers/dataforseo-identity.ts';
import { si } from './requests.ts';

type Connection = Selectable<ProviderConnections>;
type Run = Selectable<SearchIntelligenceRuns>;

/** The workspace's own DataForSEO connections a review may use: active, tested ok and keyed. */
export function workspaceConnections(db: Database, workspace: WorkspaceScope) {
  return workspace
    .selectFrom(db, 'provider_connections')
    .selectAll()
    .where('transport_provider', '=', si.transport_provider)
    .where('credential_source', '=', 'byok')
    .where('active', '=', true)
    .where('last_test_status', '=', si.connection_test_ok)
    .where('api_key_encrypted', '!=', '')
    .orderBy('created_at')
    .execute();
}

/** The connection a new review freezes; refused unless exactly one is usable. */
export async function reviewConnection(
  db: Database,
  workspace: WorkspaceScope,
  connectionId: string | null,
): Promise<Connection> {
  const eligible = (await workspaceConnections(db, workspace)).filter(
    (item) => !connectionId || item.id === connectionId,
  );
  const connection = onlyOf(eligible);
  if (!connection)
    throw new ApiError(422, 'Select one eligible DataForSEO connection', {
      code: asApiErrorCode(
        eligible.length ? 'dataforseo_connection_ambiguous' : 'dataforseo_connection_required',
      ),
    });
  return connection;
}

/** The run's frozen connection while it is still the one reviewed; undefined once it changed. */
export function runConnection(db: Database, run: Run) {
  return db
    .selectFrom('provider_connections')
    .selectAll()
    .where('id', '=', run.connection_id)
    .where('workspace_id', '=', run.workspace_id)
    .where('transport_provider', '=', si.transport_provider)
    .where('credential_source', '=', run.credential_source)
    .where('active', '=', true)
    .where('credential_revision', '=', run.connection_revision)
    .executeTakeFirst();
}

/** The connection's DataForSEO login pair as JSON; refused as an auth failure when unreadable. */
export function connectionSecret(connection: Connection, encryptionKey: string) {
  let secret: string | null;
  try {
    secret = createSecretCipher(encryptionKey).decrypt(connection.api_key_encrypted);
  } catch {
    secret = null;
  }
  if (secret === null) throw new ProviderError('auth_failure');
  return secret;
}

/** The quota-pool identity of the connection's DataForSEO account. */
export function connectionIdentity(connection: Connection, encryptionKey: string) {
  return dataforseoSecretIdentity(connectionSecret(connection, encryptionKey), encryptionKey);
}
