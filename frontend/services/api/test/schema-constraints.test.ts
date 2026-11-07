/**
 * Schema decisions the writers rely on, enforced by PostgreSQL itself:
 * uniqueness that makes replays idempotent, composite foreign keys that pin a
 * child row to its parent's workspace, the delete rules that keep or remove
 * dependants, and the status vocabularies each owner declares. Writer
 * behaviour is covered by each owner's tests.
 */
import { randomUUID } from 'node:crypto';

import { actionStatusSchema } from '@citeladder/contracts/actions';
import { auditStatusSchema } from '@citeladder/contracts/audits';
import { promptStatusSchema } from '@citeladder/contracts/project';
import { searchRunStatusSchema } from '@citeladder/contracts/search-intelligence';
import {
  crawlAnalysisStatusSchema,
  crawlDiscoveryStatusSchema,
  crawlOverallStatusSchema,
} from '@citeladder/contracts/site-health/crawl';
import { sql } from 'kysely';
import { afterAll, describe, expect, it } from 'vitest';

import { policy } from '../src/config.ts';
import type { DB } from '../src/generated/db-schema.ts';
import { seedImport, seedMetricRow } from './referral-fixtures.ts';
import { SiteFixtures } from './site-health-fixtures.ts';
import { testDatabase } from './support.ts';

const db = testDatabase();
const fixtures = new SiteFixtures(db);
afterAll(async () => {
  await fixtures.cleanup();
  await db.destroy();
});

const UNIQUE = { code: '23505' };
const FOREIGN_KEY = { code: '23503' };

/** Insert a copy of one row with a fresh id and the given column overrides. */
function clone(table: keyof DB, id: string, overrides: Record<string, unknown> = {}) {
  const values = JSON.stringify({ id: randomUUID(), ...overrides });
  return sql`insert into ${sql.table(table)}
    select (jsonb_populate_record(null::${sql.table(table)}, to_jsonb(t) || ${values}::jsonb)).*
    from ${sql.table(table)} t where t.id = ${id}`.execute(db);
}

async function count(table: keyof DB, column: string, value: string) {
  const result = await sql<{ n: number }>`select count(*)::int as n from ${sql.table(table)}
    where ${sql.ref(column)} = ${value}`.execute(db);
  return result.rows[0]!.n;
}

describe('Site Health', () => {
  it('keeps one URL identity per project, one task slot per generation and one key per task', async () => {
    const seed = await fixtures.crawl();
    const page = await fixtures.analyzable(seed, '/a');
    await expect(clone('site_urls', page.siteUrlId)).rejects.toMatchObject(UNIQUE);
    await clone('site_urls', page.siteUrlId, { url_hash: 'b'.repeat(64) });

    await expect(
      clone('site_crawl_tasks', page.taskId, { idempotency_key: 'k2' }),
    ).rejects.toMatchObject(UNIQUE);
    await clone('site_crawl_tasks', page.taskId, { idempotency_key: 'k3', generation: 1 });
    const key = randomUUID();
    await clone('site_crawl_tasks', page.taskId, {
      idempotency_key: key,
      url_hash: 'c'.repeat(64),
    });
    const keyed = await db
      .selectFrom('site_crawl_tasks')
      .select('id')
      .where('idempotency_key', '=', key)
      .executeTakeFirstOrThrow();
    await expect(
      clone('site_crawl_tasks', keyed.id, { url_hash: 'd'.repeat(64) }),
    ).rejects.toMatchObject(UNIQUE);

    const monitored = await db
      .selectFrom('monitored_site_urls')
      .select('id')
      .where('site_url_id', '=', page.siteUrlId)
      .executeTakeFirstOrThrow();
    await expect(clone('monitored_site_urls', monitored.id)).rejects.toMatchObject(UNIQUE);
  });

  it('rejects crawl evidence bound to another workspace', async () => {
    const seed = await fixtures.crawl();
    const other = await fixtures.crawl();
    const page = await fixtures.page(seed, '/', {}, { observed: true });
    const second = await fixtures.page(seed, '/b', {});
    const foreign = await fixtures.page(other, '/', {});
    const observation = await db
      .selectFrom('site_url_observations')
      .select('id')
      .where('site_url_id', '=', page.id)
      .executeTakeFirstOrThrow();
    await expect(
      // A distinct URL, so only the workspace-scoped key can reject it.
      clone('site_url_observations', observation.id, {
        workspace_id: other.workspaceId,
        site_url_id: second.id,
      }),
    ).rejects.toMatchObject(FOREIGN_KEY);

    const now = new Date();
    const metric = {
      workspace_id: seed.workspaceId,
      project_id: seed.projectId,
      crawl_id: seed.crawlId,
      inbound_count: 1,
      outbound_count: 1,
      main_content_inbound_count: 1,
      main_content_outbound_count: 1,
      nofollow_inbound_count: 0,
      source_page_count: 1,
      authority_share: 1,
      authority_rank: 1,
      extractor_version: 'test',
      formula_version: 'fixture-1',
      created_at: now,
    };
    await db
      .insertInto('site_page_link_metrics')
      .values({ ...metric, id: randomUUID(), site_url_id: page.id })
      .execute();
    await expect(
      db
        .insertInto('site_page_link_metrics')
        .values({ ...metric, id: randomUUID(), site_url_id: foreign.id })
        .execute(),
    ).rejects.toMatchObject(FOREIGN_KEY);

    const snapshotId = await fixtures.snapshot(seed);
    const architectureId = randomUUID();
    await db
      .insertInto('site_observed_architectures')
      .values({
        id: architectureId,
        workspace_id: seed.workspaceId,
        project_id: seed.projectId,
        crawl_id: seed.crawlId,
        source_snapshot_id: snapshotId,
        coverage_state: 'partial',
        page_count: 1,
        extractor_version: 'fixture-1',
        analyzer_version: 'fixture-1',
        rule_version: 'fixture-1',
        architecture_formula_version: 'fixture-1',
        archetype_policy_version: 'fixture-1',
        created_at: now,
      })
      .execute();
    await expect(
      clone('site_observed_architectures', architectureId, { crawl_id: other.crawlId }),
    ).rejects.toMatchObject(FOREIGN_KEY);
  });
});

describe('cited source pages', () => {
  it('keeps one page per project and URL, independently per project', async () => {
    const tenant = await fixtures.tenant();
    await fixtures.sourcePage(tenant, {
      urlHash: 'a'.repeat(64),
      url: 'https://publisher.example/a',
    });
    const page = await db
      .selectFrom('source_pages')
      .select('id')
      .where('project_id', '=', tenant.projectId)
      .executeTakeFirstOrThrow();
    await expect(clone('source_pages', page.id)).rejects.toMatchObject(UNIQUE);
    const sibling = await fixtures.project(tenant.workspaceId, 'https://sibling.example');
    await clone('source_pages', page.id, { project_id: sibling });
    expect(await count('source_pages', 'url_hash', 'a'.repeat(64))).toBe(2);
  });

  it('holds one verdict per entity and snapshot, and removes all evidence with its project', async () => {
    const tenant = await fixtures.tenant();
    const scope = { workspace_id: tenant.workspaceId, project_id: tenant.projectId };
    await fixtures.sourcePage(tenant, {
      urlHash: 'c'.repeat(64),
      url: 'https://publisher.example/c',
    });
    const page = await db
      .selectFrom('source_pages')
      .select('id')
      .where('project_id', '=', tenant.projectId)
      .executeTakeFirstOrThrow();
    const now = new Date();
    const snapshotId = randomUUID();
    await db
      .insertInto('source_page_snapshots')
      .values({
        ...scope,
        id: snapshotId,
        source_page_id: page.id,
        requested_url: 'https://publisher.example/c',
        final_url: 'https://publisher.example/c',
        body_bytes: 1200,
        extracted_chars: 1200,
        outcome: 'inspected',
        fetched_at: now,
        created_at: now,
      })
      .execute();
    const presenceId = randomUUID();
    await db
      .insertInto('source_page_entity_presences')
      .values({
        ...scope,
        id: presenceId,
        source_page_id: page.id,
        snapshot_id: snapshotId,
        entity_kind: 'brand',
        entity_name: 'Acme',
        presence: 'present',
        match_method: 'exact_alias',
        match_count: 2,
        roster_version: 'roster-1',
        created_at: now,
      })
      .execute();
    await expect(clone('source_page_entity_presences', presenceId)).rejects.toMatchObject(UNIQUE);
    await db
      .insertInto('source_page_inspection_spend')
      .values({
        ...scope,
        id: randomUUID(),
        source_page_id: page.id,
        spend_kind: 'page',
        units: 1,
        idempotency_key: `spend:${page.id}`,
        created_at: now,
      })
      .execute();

    await db.deleteFrom('projects').where('id', '=', tenant.projectId).execute();
    for (const table of [
      'source_pages',
      'source_page_snapshots',
      'source_page_entity_presences',
      'source_page_inspection_spend',
    ] as const)
      expect([table, await count(table, 'project_id', tenant.projectId)]).toEqual([table, 0]);
  });
});

describe('traffic projections', () => {
  async function snapshot(seed: { workspaceId: string; projectId: string }, granularity = 'day') {
    const id = randomUUID();
    await db
      .insertInto('traffic_snapshots')
      .values({
        id,
        workspace_id: seed.workspaceId,
        project_id: seed.projectId,
        window_start: '2026-07-01',
        window_end: '2026-07-28',
        granularity,
        formula_version: 'formula-1',
        normalization_version: 'normalization-1',
        created_at: new Date(),
      })
      .execute();
    return id;
  }
  function stat(seed: { workspaceId: string; projectId: string }, snapshotId: string) {
    return {
      id: randomUUID(),
      workspace_id: seed.workspaceId,
      project_id: seed.projectId,
      snapshot_id: snapshotId,
      created_at: new Date(),
    };
  }

  it('keeps one snapshot per window and granularity, and one stat per page or query', async () => {
    const seed = await fixtures.tenant();
    const snapshotId = await snapshot(seed);
    await expect(clone('traffic_snapshots', snapshotId)).rejects.toMatchObject(UNIQUE);
    await clone('traffic_snapshots', snapshotId, { granularity: 'week' });
    await clone('traffic_snapshots', snapshotId, {
      window_start: '2026-06-01',
      window_end: '2026-06-28',
    });

    const page = stat(seed, snapshotId);
    await db
      .insertInto('traffic_page_stats')
      .values({ ...page, canonical_url: 'https://example.com/pricing' })
      .execute();
    await expect(clone('traffic_page_stats', page.id)).rejects.toMatchObject(UNIQUE);
    await clone('traffic_page_stats', page.id, { canonical_url: 'https://example.com/about' });
    const query = stat(seed, snapshotId);
    await db
      .insertInto('traffic_query_stats')
      .values({ ...query, normalized_query: 'best running shoes' })
      .execute();
    await expect(clone('traffic_query_stats', query.id)).rejects.toMatchObject(UNIQUE);
    await clone('traffic_query_stats', query.id, { normalized_query: 'trail shoes' });
  });

  it('pins stats to their snapshot workspace, keeps a page when its URL goes and cascades deletes', async () => {
    const seed = await fixtures.crawl();
    const other = await fixtures.tenant();
    const site = await fixtures.analyzable(seed, '/pricing');
    const snapshotId = await snapshot(seed);
    const page = stat(seed, snapshotId);
    await db
      .insertInto('traffic_page_stats')
      .values({
        ...page,
        canonical_url: 'https://example.com/pricing',
        site_url_id: site.siteUrlId,
      })
      .execute();
    const query = stat(seed, snapshotId);
    await db
      .insertInto('traffic_query_stats')
      .values({ ...query, normalized_query: 'pricing' })
      .execute();
    const foreign = {
      workspace_id: other.workspaceId,
      project_id: other.projectId,
      site_url_id: null,
      canonical_url: 'https://example.com/other',
    };
    await expect(clone('traffic_page_stats', page.id, foreign)).rejects.toMatchObject(FOREIGN_KEY);
    await expect(
      clone('traffic_query_stats', query.id, {
        workspace_id: other.workspaceId,
        project_id: other.projectId,
        normalized_query: 'other',
      }),
    ).rejects.toMatchObject(FOREIGN_KEY);

    await db.deleteFrom('site_urls').where('id', '=', site.siteUrlId).execute();
    expect(
      await db
        .selectFrom('traffic_page_stats')
        .select(['site_url_id', 'canonical_url'])
        .where('id', '=', page.id)
        .executeTakeFirst(),
    ).toEqual({ site_url_id: null, canonical_url: 'https://example.com/pricing' });

    await db.deleteFrom('traffic_snapshots').where('id', '=', snapshotId).execute();
    expect([
      await count('traffic_page_stats', 'snapshot_id', snapshotId),
      await count('traffic_query_stats', 'snapshot_id', snapshotId),
    ]).toEqual([0, 0]);

    const kept = await snapshot(seed);
    await db
      .insertInto('traffic_page_stats')
      .values({ ...stat(seed, kept), canonical_url: 'https://example.com/' })
      .execute();
    await db.deleteFrom('workspaces').where('id', '=', seed.workspaceId).execute();
    expect([
      await count('traffic_snapshots', 'workspace_id', seed.workspaceId),
      await count('traffic_page_stats', 'workspace_id', seed.workspaceId),
    ]).toEqual([0, 0]);
  });
});

describe('integrations', () => {
  const WINDOW: [string, string] = ['2026-07-20', '2026-07-22'];

  async function imported() {
    const tenant = await fixtures.tenant();
    return seedImport(db, {
      ...tenant,
      dataset: 'gsc_page_daily',
      window: WINDOW,
      provider: 'gsc',
    });
  }

  it('dedupes in-flight runs per mapping, kind and window, and keeps each revision once', async () => {
    const seed = await imported();
    const run = (overrides: Record<string, unknown>) =>
      clone('integration_sync_runs', seed.syncRunId, {
        idempotency_key: randomUUID(),
        ...overrides,
      });

    // The succeeded run keeps its revision but frees the window.
    await expect(run({ status: 'succeeded' })).rejects.toMatchObject(UNIQUE);
    await run({ status: 'queued', resync_seq: 1 });
    await expect(run({ status: 'queued', resync_seq: 2 })).rejects.toMatchObject(UNIQUE);
    await run({ status: 'queued', resync_seq: 2, sync_kind: 'scheduled' });
    await run({
      status: 'queued',
      resync_seq: 3,
      window_start: '2026-07-17',
      window_end: '2026-07-19',
    });

    // A second property on the same connection is an independent import.
    const secondMapping = randomUUID();
    await clone('integration_property_mappings', seed.mappingId, {
      id: secondMapping,
      property_ref: 'gsc-account-2',
    });
    await run({
      status: 'queued',
      resync_seq: 4,
      mapping_id: secondMapping,
      property_ref: 'gsc-account-2',
    });
    await expect(
      run({
        status: 'queued',
        resync_seq: 5,
        mapping_id: secondMapping,
        property_ref: 'gsc-account-2',
      }),
    ).rejects.toMatchObject(UNIQUE);

    const keyed = await db
      .selectFrom('integration_sync_runs')
      .select(['id', 'idempotency_key'])
      .where('id', '=', seed.syncRunId)
      .executeTakeFirstOrThrow();
    await expect(
      clone('integration_sync_runs', keyed.id, {
        idempotency_key: keyed.idempotency_key,
        resync_seq: 9,
        window_start: '2026-07-10',
        window_end: '2026-07-12',
      }),
    ).rejects.toMatchObject(UNIQUE);
  });

  it('stores one grant per transport, one connection per provider and one active owner per property', async () => {
    const seed = await imported();
    const { grant_id: grantId } = await db
      .selectFrom('integration_connections')
      .select('grant_id')
      .where('id', '=', seed.connectionId)
      .executeTakeFirstOrThrow();
    await expect(clone('integration_oauth_grants', grantId)).rejects.toMatchObject(UNIQUE);
    await clone('integration_oauth_grants', grantId, { transport: 'microsoft' });

    await expect(clone('integration_connections', seed.connectionId)).rejects.toMatchObject(UNIQUE);
    const ga4 = randomUUID();
    await clone('integration_connections', seed.connectionId, {
      id: ga4,
      provider: 'ga4',
      account_ref: 'ga4-1',
    });

    await expect(clone('integration_property_mappings', seed.mappingId)).rejects.toMatchObject(
      UNIQUE,
    );
    await clone('integration_property_mappings', seed.mappingId, { status: 'disabled' });
    await clone('integration_property_mappings', seed.mappingId, {
      connection_id: ga4,
      provider: 'ga4',
    });
  });

  it('keeps one metric row per identity and revision, retaining older revisions', async () => {
    const seed = await imported();
    const row = {
      date: '2026-07-21',
      values: ['https://example.com/page', '20260721'],
      sessions: 3,
    };
    await seedMetricRow(db, seed, row);
    await expect(seedMetricRow(db, seed, row)).rejects.toMatchObject(UNIQUE);
    await seedMetricRow(db, seed, { ...row, resyncSeq: 1 });
    expect(
      (
        await db
          .selectFrom('integration_metric_rows')
          .select('resync_seq')
          .where('project_id', '=', seed.projectId)
          .orderBy('resync_seq')
          .execute()
      ).map((r) => r.resync_seq),
    ).toEqual([0, 1]);
  });

  it('rejects references into another workspace', async () => {
    const seed = await imported();
    const other = await fixtures.tenant();
    const { grant_id: grantId } = await db
      .selectFrom('integration_connections')
      .select('grant_id')
      .where('id', '=', seed.connectionId)
      .executeTakeFirstOrThrow();
    await expect(
      clone('integration_connections', seed.connectionId, {
        workspace_id: other.workspaceId,
        grant_id: grantId,
        provider: 'ga4',
      }),
    ).rejects.toMatchObject(FOREIGN_KEY);
    await expect(
      clone('integration_sync_runs', seed.syncRunId, {
        workspace_id: other.workspaceId,
        project_id: other.projectId,
        idempotency_key: randomUUID(),
        resync_seq: 7,
      }),
    ).rejects.toMatchObject(FOREIGN_KEY);
    await expect(
      clone('integration_property_mappings', seed.mappingId, {
        workspace_id: other.workspaceId,
        project_id: other.projectId,
        property_ref: 'other-property',
      }),
    ).rejects.toMatchObject(FOREIGN_KEY);
    await expect(
      clone('integration_import_artifacts', seed.artifactId, { workspace_id: other.workspaceId }),
    ).rejects.toMatchObject(FOREIGN_KEY);
  });

  it('keeps OAuth states single-use, events past a disconnect, and nothing past the workspace', async () => {
    const seed = await imported();
    const userId = await fixtures.user();
    const state = {
      jti: `jti-${randomUUID()}`,
      workspace_id: seed.workspaceId,
      user_id: userId,
      provider: 'gsc',
      expires_at: new Date(Date.now() + 600_000),
      created_at: new Date(),
    };
    await db
      .insertInto('integration_oauth_states')
      .values({ ...state, id: randomUUID() })
      .execute();
    await expect(
      db
        .insertInto('integration_oauth_states')
        .values({ ...state, id: randomUUID() })
        .execute(),
    ).rejects.toMatchObject(UNIQUE);

    const { grant_id: grantId } = await db
      .selectFrom('integration_connections')
      .select('grant_id')
      .where('id', '=', seed.connectionId)
      .executeTakeFirstOrThrow();
    const disconnected = randomUUID();
    await clone('integration_connections', seed.connectionId, {
      id: disconnected,
      provider: 'ga4',
      account_ref: 'ga4-2',
    });
    const eventId = randomUUID();
    await db
      .insertInto('integration_events')
      .values({
        id: eventId,
        workspace_id: seed.workspaceId,
        connection_id: disconnected,
        grant_id: grantId,
        event_type: 'integration.connected',
        message: 'connected',
        created_at: new Date(),
      })
      .execute();
    await db.deleteFrom('integration_connections').where('id', '=', disconnected).execute();
    expect(
      await db
        .selectFrom('integration_events')
        .select(['connection_id', 'grant_id', 'event_type'])
        .where('id', '=', eventId)
        .executeTakeFirst(),
    ).toEqual({ connection_id: null, grant_id: grantId, event_type: 'integration.connected' });

    await db.deleteFrom('workspaces').where('id', '=', seed.workspaceId).execute();
    for (const table of [
      'integration_oauth_grants',
      'integration_connections',
      'integration_sync_runs',
      'integration_import_artifacts',
    ] as const)
      expect([table, await count(table, 'workspace_id', seed.workspaceId)]).toEqual([table, 0]);
  });
});

describe('status vocabularies', () => {
  const CHECK = '23514';
  const UNKNOWN = 'not_a_state';

  /**
   * The values a table's own CHECK constraints refuse for one column. Each
   * value goes into a scratch copy of the table that keeps its CHECKs but no
   * NOT NULLs, keys or foreign keys, so only the column's vocabulary decides.
   */
  async function refused(table: keyof DB, column: string, values: readonly string[]) {
    return db.transaction().execute(async (trx) => {
      await sql`create temp table status_probe
        (like ${sql.table(`public.${table}`)} including constraints) on commit drop`.execute(trx);
      const required = await sql<{ name: string }>`select attname as name from pg_attribute
        where attrelid = 'status_probe'::regclass and attnum > 0 and attnotnull`.execute(trx);
      for (const { name } of required.rows)
        await sql`alter table status_probe alter column ${sql.ref(name)} drop not null`.execute(
          trx,
        );
      const out: string[] = [];
      for (const value of values) {
        await sql`savepoint probe`.execute(trx);
        try {
          await sql`insert into status_probe (${sql.ref(column)}) values (${value})`.execute(trx);
        } catch (error) {
          if (!(error instanceof Error && 'code' in error && error.code === CHECK)) throw error;
          out.push(value);
        }
        await sql`rollback to savepoint probe`.execute(trx);
      }
      return out;
    });
  }

  const queue = Object.values(policy.task_queue.statuses);
  const candidate = policy.prompts.candidate;
  const columns: [keyof DB, string, readonly string[]][] = [
    ['agent_runs', 'status', queue],
    ['analytics_tasks', 'status', queue],
    // An audit task is a queue row that may also wait for its reservation.
    ['audit_tasks', 'status', [...queue, 'pending_reservation']],
    ['brand_discovery_tasks', 'status', queue],
    ['integration_sync_runs', 'status', queue],
    ['site_crawl_tasks', 'status', queue],
    ['audits', 'status', auditStatusSchema.options],
    ['site_crawls', 'status', crawlOverallStatusSchema.options],
    ['site_crawls', 'discovery_status', crawlDiscoveryStatusSchema.options],
    ['site_crawls', 'analysis_status', crawlAnalysisStatusSchema.options],
    ['search_intelligence_runs', 'status', searchRunStatusSchema.options],
    [
      'search_intelligence_calls',
      'status',
      ['intent', 'dispatched', 'succeeded', 'failed', 'uncertain'],
    ],
    ['search_intelligence_datasets', 'status', ['collecting', 'published', 'failed']],
    [
      'integration_oauth_grants',
      'status',
      ['connected', 'needs_reauth', 'pending_revocation', 'revoked', 'error'],
    ],
    ['actions', 'status', actionStatusSchema.options],
    ['prompts', 'status', promptStatusSchema.options],
    [
      'prompt_candidates',
      'disposition',
      [candidate.pending, candidate.accepted, candidate.rejected, ...candidate.outcomes],
    ],
  ];

  it.each(columns)(
    '%s.%s accepts every declared value and refuses an unknown one',
    async (table, column, values) => {
      expect(await refused(table, column, [...values, UNKNOWN])).toEqual([UNKNOWN]);
    },
  );
});
