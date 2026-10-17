/** Explicit fixture custody + sync owner; never performs OAuth or provider I/O. */
import { randomUUID } from 'node:crypto';
import type { Database } from '../db/database.ts';
import { createSecretCipher } from '../integrations/fernet.ts';
import { enqueueSyncRun } from '../integrations/sync.ts';
import { integrationSettings } from '../integrations/config.ts';
import { IntegrationWorker } from '../workers/integration-worker.ts';
import { seedIntegrationClient } from './seed-transports.ts';
import { drainSeed } from './seed-runs.ts';
import type { StaticSeed } from './seed-static.ts';

export async function seedIntegrations(
  db: Database,
  project: StaticSeed['primary'],
  encryptionKey: string,
  metricDate = '2026-09-01',
) {
  const ids: string[] = [];
  for (const provider of ['gsc', 'ga4'] as const) {
    const label = `Recorded seed ${provider}`;
    let connection = await db
      .selectFrom('integration_connections')
      .select('id')
      .where('workspace_id', '=', project.workspaceId)
      .where('label', '=', label)
      .executeTakeFirst();
    if (!connection)
      connection = await db.transaction().execute(async (trx) => {
        const now = new Date(),
          id = randomUUID();
        const priorGrant = await trx
          .selectFrom('integration_oauth_grants')
          .select('id')
          .where('workspace_id', '=', project.workspaceId)
          .where('transport', '=', 'google_oauth')
          .executeTakeFirst();
        const grantId = priorGrant?.id ?? randomUUID();
        const cipher = createSecretCipher(encryptionKey);
        if (!priorGrant)
          await trx
            .insertInto('integration_oauth_grants')
            .values({
              id: grantId,
              workspace_id: project.workspaceId,
              transport: 'google_oauth',
              access_token_encrypted: cipher.encrypt('recorded-seed-access'),
              refresh_token_encrypted: cipher.encrypt('recorded-seed-refresh'),
              token_expires_at: new Date(now.getTime() + 3600000),
              token_revision: 1,
              granted_scopes: '[]',
              status: 'connected',
              created_at: now,
              updated_at: now,
            })
            .execute();
        await trx
          .insertInto('integration_connections')
          .values({
            id,
            workspace_id: project.workspaceId,
            grant_id: grantId,
            provider,
            label,
            account_ref: '',
            dataset_capabilities: '{}',
            created_at: now,
            updated_at: now,
          })
          .execute();
        await trx
          .insertInto('integration_property_mappings')
          .values({
            id: randomUUID(),
            workspace_id: project.workspaceId,
            connection_id: id,
            provider,
            property_ref: provider === 'gsc' ? 'https://acme-outdoor.example/' : '123456789',
            project_id: project.projectId,
            status: 'active',
            created_at: now,
            updated_at: now,
          })
          .execute();
        return { id };
      });
    const run = await enqueueSyncRun(db, {
      workspaceId: project.workspaceId,
      connectionId: connection.id,
      projectId: project.projectId,
      windowStart: metricDate,
      windowEnd: metricDate,
    });
    const worker = new IntegrationWorker(
      db,
      seedIntegrationClient(metricDate),
      integrationSettings({}),
      () => Promise.resolve('recorded-seed-access'),
      { workspaceId: project.workspaceId, runId: run.sync_run_id },
    );
    await drainSeed(
      [{ name: provider, run: () => worker.runOnce() }],
      async () =>
        (
          await db
            .selectFrom('integration_sync_runs')
            .select('status')
            .where('workspace_id', '=', project.workspaceId)
            .where('id', '=', run.sync_run_id)
            .executeTakeFirstOrThrow()
        ).status,
      ['succeeded'],
    );
    ids.push(run.sync_run_id);
  }
  return ids;
}
