/**
 * The integrations import graph the referral chain projects: grant ->
 * connection -> property mapping -> sync run -> import artifact -> metric
 * rows, seeded directly (no provider I/O). Rows go away with their workspace.
 */
import { randomUUID } from 'node:crypto';

import type { Database } from '../src/db/database.ts';

export const REFERRER_DAILY = 'ga4_referrer_daily';
export const SOURCE_MEDIUM_DAILY = 'ga4_source_medium_daily';
const PROPERTY_REF = 'properties/123456789';

export type ImportSeed = {
  workspaceId: string;
  projectId: string;
  connectionId: string;
  mappingId: string;
  syncRunId: string;
  artifactId: string;
  dataset: string;
};

export async function seedProject(db: Database, workspaceId: string): Promise<string> {
  const id = randomUUID();
  await db
    .insertInto('projects')
    .values({
      id,
      workspace_id: workspaceId,
      name: 'Referrals',
      brand_name: 'Referrals',
      website_url: 'https://example.test',
      industry: 'software',
      subindustry: 'analytics',
      primary_market: 'US',
      country_code: 'US',
      language_code: 'en',
      benchmark_mode: 'standard',
      default_repetitions: 1,
      created_at: new Date(),
      updated_at: new Date(),
    })
    .execute();
  return id;
}

/**
 * One completed sync run and its artifact. Pass `previous` to re-sync on the
 * same connection and mapping at a higher `resyncSeq`.
 */
export async function seedImport(
  db: Database,
  options: {
    workspaceId: string;
    projectId: string;
    dataset: string;
    window: [string, string];
    resyncSeq?: number;
    previous?: ImportSeed;
    provider?: string;
  },
): Promise<ImportSeed> {
  const now = new Date();
  let connectionId = options.previous?.connectionId;
  let mappingId = options.previous?.mappingId;
  if (connectionId === undefined || mappingId === undefined) {
    const grant = await db
      .selectFrom('integration_oauth_grants')
      .select('id')
      .where('workspace_id', '=', options.workspaceId)
      .where('transport', '=', 'google')
      .executeTakeFirst();
    const grantId = grant?.id ?? randomUUID();
    if (!grant)
      await db
        .insertInto('integration_oauth_grants')
        .values({
          id: grantId,
          workspace_id: options.workspaceId,
          transport: 'google',
          access_token_encrypted: 'fernet-access',
          refresh_token_encrypted: 'fernet-refresh',
          granted_scopes: JSON.stringify(['scope-ga4']),
          status: 'connected',
          token_revision: 0,
          created_at: now,
          updated_at: now,
        })
        .execute();
    connectionId = randomUUID();
    await db
      .insertInto('integration_connections')
      .values({
        id: connectionId,
        workspace_id: options.workspaceId,
        grant_id: grantId,
        provider: options.provider ?? 'ga4',
        label: 'GA4',
        account_ref: `ga4-${connectionId}`,
        dataset_capabilities: JSON.stringify({}),
        created_at: now,
        updated_at: now,
      })
      .execute();
    mappingId = randomUUID();
    await db
      .insertInto('integration_property_mappings')
      .values({
        id: mappingId,
        workspace_id: options.workspaceId,
        connection_id: connectionId,
        provider: options.provider ?? 'ga4',
        property_ref: PROPERTY_REF,
        project_id: options.projectId,
        status: 'active',
        created_at: now,
        updated_at: now,
      })
      .execute();
  }
  const syncRunId = randomUUID();
  await db
    .insertInto('integration_sync_runs')
    .values({
      id: syncRunId,
      workspace_id: options.workspaceId,
      connection_id: connectionId,
      mapping_id: mappingId,
      property_ref: PROPERTY_REF,
      project_id: options.projectId,
      window_start: options.window[0],
      window_end: options.window[1],
      resync_seq: options.resyncSeq ?? 0,
      idempotency_key: randomUUID(),
      sync_kind: 'on_demand',
      status: 'succeeded',
      priority: 0,
      randomized_position: 0,
      available_at: now,
      attempt_count: 0,
      max_attempts: 3,
      error_code: '',
      error_detail: '',
      created_at: now,
      updated_at: now,
    })
    .execute();
  const artifactId = randomUUID();
  await db
    .insertInto('integration_import_artifacts')
    .values({
      id: artifactId,
      workspace_id: options.workspaceId,
      sync_run_id: syncRunId,
      connection_id: connectionId,
      provider: options.provider ?? 'ga4',
      dataset: options.dataset,
      query_snapshot: JSON.stringify({}),
      payload_hash: randomUUID().replaceAll('-', '').repeat(2),
      row_count: 0,
      payload: JSON.stringify({ rows: [] }),
      fetched_at: now,
      created_at: now,
    })
    .execute();
  return { ...options, connectionId, mappingId, syncRunId, artifactId };
}

/** One derived row; `values` are the dimension values in template order, date last. */
export async function seedMetricRow(
  db: Database,
  seed: ImportSeed,
  row: { date: string; values: string[]; sessions: number; resyncSeq?: number },
): Promise<string> {
  const id = randomUUID();
  await db
    .insertInto('integration_metric_rows')
    .values({
      id,
      workspace_id: seed.workspaceId,
      project_id: seed.projectId,
      property_ref: PROPERTY_REF,
      provider: 'ga4',
      dataset: seed.dataset,
      date: row.date,
      dimension_key: row.values.join(' | '),
      metrics: JSON.stringify({ sessions: row.sessions }),
      source_artifact_id: seed.artifactId,
      resync_seq: row.resyncSeq ?? 0,
      importer_version: 'test',
      created_at: new Date(),
    })
    .execute();
  return id;
}

/** A queued analytics task, as the post-sync projection enqueues one. */
export async function enqueue(
  db: Database,
  task: { workspaceId: string; projectId: string | null; kind: string; payload: object },
): Promise<string> {
  const id = randomUUID();
  const now = new Date();
  await db
    .insertInto('analytics_tasks')
    .values({
      id,
      workspace_id: task.workspaceId,
      project_id: task.projectId,
      task_kind: task.kind,
      payload: JSON.stringify(task.payload),
      idempotency_key: `test:${id}`,
      status: 'queued',
      priority: 0,
      randomized_position: 0,
      available_at: now,
      attempt_count: 0,
      max_attempts: 3,
      error_code: '',
      error_detail: '',
      created_at: now,
      updated_at: now,
    })
    .execute();
  return id;
}
