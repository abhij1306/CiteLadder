import { randomUUID } from 'node:crypto';

import type { Database } from '../db/database.ts';
import { ApiError } from '../errors.ts';
import { IntegrationClient } from '../integrations/client.ts';
import { endpoints, integrationSettings } from '../integrations/config.ts';
import {
  claimRevocation,
  markGrantRevoked,
  pendingRevocations,
  releaseRevocationClaim,
} from '../integrations/grants.ts';
import { enqueueSyncRun } from '../integrations/sync.ts';
import { getLogger } from '../logging.ts';

const logger = getLogger('workers.integration-dispatcher');
const settings = integrationSettings();

export class IntegrationDispatcher {
  readonly #db: Database;
  readonly #client: Pick<IntegrationClient, 'secrets' | 'revoke'>;

  constructor(
    db: Database,
    client: Pick<IntegrationClient, 'secrets' | 'revoke'> = new IntegrationClient(),
  ) {
    this.#db = db;
    this.#client = client;
  }

  async runOnce(canAdmit = () => true): Promise<void> {
    if (canAdmit()) await this.#schedule(canAdmit);
    if (canAdmit()) await this.#revoke(canAdmit);
  }

  async #schedule(canAdmit: () => boolean): Promise<void> {
    const targets = await this.#db
      .selectFrom('integration_property_mappings as mapping')
      .innerJoin('integration_connections as connection', (join) =>
        join
          .onRef('connection.id', '=', 'mapping.connection_id')
          .onRef('connection.workspace_id', '=', 'mapping.workspace_id'),
      )
      .innerJoin('integration_oauth_grants as grant', (join) =>
        join
          .onRef('grant.id', '=', 'connection.grant_id')
          .onRef('grant.workspace_id', '=', 'connection.workspace_id'),
      )
      .select([
        'mapping.id as mapping_id',
        'mapping.workspace_id',
        'mapping.connection_id',
        'mapping.project_id',
      ])
      // Each mapping's newest scheduled run, in the same read.
      .leftJoinLateral(
        (eb) =>
          eb
            .selectFrom('integration_sync_runs as run')
            .select('run.created_at as last_scheduled')
            .whereRef('run.mapping_id', '=', 'mapping.id')
            .whereRef('run.workspace_id', '=', 'mapping.workspace_id')
            .where('run.sync_kind', '=', 'scheduled')
            .orderBy('run.created_at', 'desc')
            .limit(1)
            .as('scheduled'),
        (join) => join.onTrue(),
      )
      .select('scheduled.last_scheduled')
      .where('mapping.status', '=', 'active')
      .where('grant.status', '=', 'connected')
      .where('connection.provider', 'in', ['gsc', 'ga4', 'bing'])
      .execute();
    const now = Date.now();
    for (const target of targets) {
      if (!canAdmit()) break;
      if (
        target.last_scheduled &&
        now - new Date(target.last_scheduled).getTime() < settings.sync_cadence_seconds * 1000
      )
        continue;
      try {
        await enqueueSyncRun(this.#db, {
          workspaceId: target.workspace_id,
          connectionId: target.connection_id,
          mappingId: target.mapping_id,
          projectId: target.project_id,
          // No window: the sync owner re-reads the late-data days after coverage.
          syncKind: 'scheduled',
        });
      } catch (error) {
        if (error instanceof ApiError && error.code === 'sync_active_window_conflict') continue;
        throw error;
      }
    }
  }

  async #revoke(canAdmit: () => boolean): Promise<void> {
    const grants = await pendingRevocations(this.#db, 20);
    for (const candidate of grants) {
      if (!canAdmit()) break;
      await this.#revokeGrant(candidate.id, candidate.workspace_id); // NOSONAR -- Revocations finish sequentially before the next admission check.
    }
  }

  async #revokeGrant(grantId: string, workspaceId: string): Promise<void> {
    const client = this.#client;
    const claim = { workspaceId, grantId, claimId: randomUUID() };
    const grant = await claimRevocation(this.#db, claim);
    if (!grant) return;
    try {
      let token: string | null;
      try {
        token = client.secrets.cipher.decrypt(
          grant.refresh_token_encrypted || grant.access_token_encrypted,
        );
      } catch {
        // A credential which cannot be recovered is resolved locally. Provider
        // failures still use the existing revoke-failed path below.
        token = null;
      }
      if (token !== null) {
        await client.revoke(
          grant.transport as keyof typeof endpoints.INTEGRATION_OAUTH_REVOKE_URLS,
          token,
        );
      }
      await markGrantRevoked(this.#db, { ...claim, tokenRevision: grant.token_revision });
    } catch (error) {
      await releaseRevocationClaim(this.#db, {
        ...claim,
        errorCode: error instanceof Error ? error.name : 'provider_api_error',
      });
      logger.warning('integration_revoke_failed', { grant_id: grantId });
    }
  }
}
