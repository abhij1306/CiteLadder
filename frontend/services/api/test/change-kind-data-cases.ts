import { randomUUID } from 'node:crypto';
import { policy } from '../src/config.ts';
import { resolveSettingSpec } from '../src/config/settings.ts';
import { auditRuntime } from '../src/audits/config.ts';
import { createAudits } from '../src/audits/creation.ts';
import { auditInput } from '../src/audits/inputs.ts';
import type { Database } from '../src/db/database.ts';
import { createSecretCipher } from '../src/integrations/fernet.ts';
import { auditTenant } from './audit-fixtures.ts';
import type { KindRow, KindScope, TabledKind } from './change-kind-cases.ts';
import type { SiteFixtures } from './site-health-fixtures.ts';
import { testConfig } from './support.ts';

type DataKind = Extract<
  TabledKind,
  | 'create_keyword_review'
  | 'confirm_keyword_run'
  | 'cancel_keyword_run'
  | 'save_keyword_preferences'
  | 'derive_citation_matches'
  | 'recompute_demand'
  | 'override_query_classification'
  | 'sync_performance'
  | 'sync_integration'
  | 'request_performance_range'
>;

const encryptionKey = String(
  resolveSettingSpec(policy.settings.encryption_key, testConfig().settings),
);

export function dataCases(db: Database, fixtures: SiteFixtures): Record<DataKind, KindRow> {
  const count = (query: { execute: () => Promise<unknown[]> }) =>
    query.execute().then((found) => found.length);

  async function tenant() {
    const t = await auditTenant(db, fixtures);
    await db
      .updateTable('projects')
      .set({ website_url: 'https://www.example.com', serp_language_code: 'en' })
      .where('id', '=', t.projectId)
      .execute();
    return t;
  }

  async function dataForSeo(workspaceId: string) {
    const at = new Date();
    return db
      .insertInto('provider_connections')
      .values({
        id: randomUUID(),
        workspace_id: workspaceId,
        label: 'DataForSEO',
        transport_provider: 'dataforseo',
        credential_source: 'byok',
        api_key_encrypted: createSecretCipher(encryptionKey).encrypt(
          JSON.stringify({ login: 'own@example.com', password: 'own' }),
        ),
        base_url: '',
        credential_revision: randomUUID(),
        active: true,
        last_test_status: 'ok',
        created_at: at,
        updated_at: at,
      })
      .returning(['id', 'credential_revision'])
      .executeTakeFirstOrThrow();
  }

  async function keywordRun(t: KindScope, status: 'reviewed' | 'queued') {
    const connection = await dataForSeo(t.workspaceId);
    const id = randomUUID();
    const at = new Date();
    await db
      .insertInto('search_intelligence_runs')
      .values({
        id,
        workspace_id: t.workspaceId,
        project_id: t.projectId,
        actor_user_id: t.userId,
        connection_id: connection.id,
        connection_revision: connection.credential_revision,
        account_identity: 'account',
        credential_source: 'byok',
        status,
        action: 'analysis',
        idempotency_key: id,
        frozen_scope: '{}',
        call_plan: JSON.stringify([{ page: 0 }]),
        reused_datasets: '[]',
        pricing_version: policy.search_intelligence.price_version,
        estimated_cost_usd: '0.040000',
        planned_calls: 1,
        completed_calls: 0,
        planned_rows: 10,
        received_rows: 0,
        uncertain_calls: 0,
        error_code: '',
        error_detail: '',
        expires_at: new Date(at.getTime() + 3_600_000),
        confirmed_at: status === 'queued' ? at : null,
        created_at: at,
        updated_at: at,
      })
      .execute();
    const observe = () =>
      db
        .selectFrom('search_intelligence_runs')
        .select('status')
        .where('id', '=', id)
        .executeTakeFirst()
        .then((row) => row?.status);
    return { id, observe };
  }

  async function referringDomains(t: Awaited<ReturnType<typeof tenant>>) {
    const run = await keywordRun(t, 'queued');
    const id = randomUUID();
    const at = new Date();
    await db
      .insertInto('search_intelligence_datasets')
      .values({
        id,
        workspace_id: t.workspaceId,
        project_id: t.projectId,
        run_id: run.id,
        parent_dataset_id: null,
        dataset_kind: 'referring_domains',
        scope_hash: randomUUID().replaceAll('-', ''),
        target_domain: 'example.com',
        target_hostname: 'www.example.com',
        target_origin: 'https://www.example.com',
        comparison_origin: '',
        location_code: null,
        language_code: 'en',
        status: 'published',
        coverage: 'complete',
        requested_rows: 10,
        raw_rows_received: 0,
        unique_rows_saved: 0,
        provider_total: 0,
        truncated: false,
        summary: '{}',
        provider_filters: '{}',
        parser_version: 'test',
        collection_started_at: at,
        collection_ended_at: at,
        published_at: at,
        created_at: at,
      })
      .execute();
    const [auditId] = await createAudits(
      db,
      t.workspaceId,
      auditInput.parse({ project_id: t.projectId, prompt_set_id: t.setId, engines: ['chatgpt'] }),
      {},
      auditRuntime({}),
    );
    return { id, auditId: auditId! };
  }

  async function property(t: KindScope) {
    const grantId = randomUUID();
    const connectionId = randomUUID();
    const now = new Date();
    await db
      .insertInto('integration_oauth_grants')
      .values({
        id: grantId,
        workspace_id: t.workspaceId,
        transport: 'google_oauth',
        access_token_encrypted: 'recorded-access-token',
        refresh_token_encrypted: 'recorded-refresh-token',
        token_expires_at: new Date(Date.now() + 3_600_000),
        token_revision: 1,
        refresh_claim_id: null,
        refresh_claim_expires_at: null,
        granted_scopes: JSON.stringify(['https://www.googleapis.com/auth/webmasters.readonly']),
        status: 'connected',
        created_at: now,
        updated_at: now,
      })
      .execute();
    await db
      .insertInto('integration_connections')
      .values({
        id: connectionId,
        workspace_id: t.workspaceId,
        grant_id: grantId,
        provider: 'gsc',
        label: 'Search Console',
        account_ref: 'https://www.example.com',
        dataset_capabilities: '{}',
        last_synced_at: null,
        created_at: now,
        updated_at: now,
      })
      .execute();
    await db
      .insertInto('integration_property_mappings')
      .values({
        id: randomUUID(),
        workspace_id: t.workspaceId,
        connection_id: connectionId,
        provider: 'gsc',
        property_ref: 'https://www.example.com/',
        project_id: t.projectId,
        status: 'active',
        created_at: now,
        updated_at: now,
      })
      .execute();
    const syncs = () =>
      count(
        db.selectFrom('integration_sync_runs').select('id').where('project_id', '=', t.projectId),
      );
    return { connectionId, syncs };
  }

  const tasks = (t: KindScope, kind: string) =>
    count(
      db
        .selectFrom('analytics_tasks')
        .select('id')
        .where('project_id', '=', t.projectId)
        .where('task_kind', '=', kind),
    );

  return {
    create_keyword_review: {
      foreign: 'none',
      live: true,
      async arrange() {
        const t = await tenant();
        await dataForSeo(t.workspaceId);
        return {
          scope: t,
          payload: { datasets: [{ kind: 'footprint' }] },
          observe: () =>
            count(
              db
                .selectFrom('search_intelligence_runs')
                .select('id')
                .where('project_id', '=', t.projectId),
            ),
          before: 0,
          after: 0,
        };
      },
    },
    confirm_keyword_run: {
      foreign: 404,
      async arrange() {
        const t = await tenant();
        const run = await keywordRun(t, 'reviewed');
        return {
          scope: t,
          payload: { run_id: run.id },
          observe: run.observe,
          before: 'reviewed',
          after: 'queued',
        };
      },
    },
    cancel_keyword_run: {
      foreign: 404,
      async arrange() {
        const t = await tenant();
        const run = await keywordRun(t, 'queued');
        return {
          scope: t,
          payload: { run_id: run.id },
          observe: run.observe,
          before: 'queued',
          after: 'cancelled',
        };
      },
    },
    save_keyword_preferences: {
      foreign: 'none',
      async arrange() {
        const t = await tenant();
        return {
          scope: t,
          payload: { research_scope: 'exact_host', reuse_recent: false },
          observe: () =>
            db
              .selectFrom('projects')
              .select('search_intelligence_preferences')
              .where('id', '=', t.projectId)
              .executeTakeFirstOrThrow()
              .then((row) =>
                JSON.stringify(row.search_intelligence_preferences).includes('exact_host'),
              ),
          before: false,
          after: true,
        };
      },
    },
    derive_citation_matches: {
      foreign: 404,
      async arrange() {
        const t = await tenant();
        const parent = await referringDomains(t);
        return {
          scope: t,
          payload: { backlink_dataset_id: parent.id, audit_ids: [parent.auditId] },
          observe: () =>
            count(
              db
                .selectFrom('search_intelligence_datasets')
                .select('id')
                .where('parent_dataset_id', '=', parent.id),
            ),
          before: 0,
          after: 1,
        };
      },
    },
    recompute_demand: {
      foreign: 'none',
      async arrange() {
        const t = await tenant();
        await db
          .insertInto('demand_snapshots')
          .values({
            id: randomUUID(),
            workspace_id: t.workspaceId,
            project_id: t.projectId,
            window_start: new Date('2026-10-01T00:00:00Z'),
            window_end: new Date('2026-10-28T00:00:00Z'),
            source_hash: 'a'.repeat(64),
            prior_snapshot_id: null,
            source_artifact_ids: '[]',
            source_metric_row_ids: '[]',
            coverage: '{}',
            summary: '{}',
            comparison: null,
            formula_version: 'test',
            analyzer_version: 'test',
            created_at: new Date(),
          })
          .execute();
        return {
          scope: t,
          payload: { window_start: '2026-10-01', window_end: '2026-10-28' },
          observe: () => tasks(t, 'demand_snapshot_refresh'),
          before: 0,
          after: 1,
        };
      },
    },
    override_query_classification: {
      foreign: 'none',
      async arrange() {
        const t = await tenant();
        return {
          scope: t,
          payload: { query: 'Acme trail shoes', classification: 'non_branded' },
          observe: () =>
            db
              .selectFrom('branded_query_overrides')
              .select('classification')
              .where('project_id', '=', t.projectId)
              .execute()
              .then((found) => found.map((row) => row.classification)),
          before: [],
          after: ['non_branded'],
        };
      },
    },
    sync_performance: {
      foreign: 'none',
      async arrange() {
        const t = await tenant();
        const { syncs } = await property(t);
        return { scope: t, payload: {}, observe: syncs, before: 0, after: 1 };
      },
    },
    sync_integration: {
      foreign: 404,
      async arrange() {
        const t = await tenant();
        const { connectionId, syncs } = await property(t);
        return {
          scope: t,
          payload: { connection_id: connectionId },
          observe: syncs,
          before: 0,
          after: 1,
        };
      },
    },
    request_performance_range: {
      foreign: 'none',
      async arrange() {
        const t = await tenant();
        return {
          scope: t,
          payload: { from: '2026-10-01', to: '2026-10-07' },
          observe: () => tasks(t, 'performance_range_projection'),
          before: 0,
          after: 1,
        };
      },
    },
  };
}
