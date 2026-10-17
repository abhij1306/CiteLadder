/**
 * Multi-row writes for one admission batch. The frontier decides which URLs
 * to admit, in order, from state it reads once; these statements then apply
 * those decisions in a fixed number of round trips, whatever the batch size.
 */
import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import type { Database } from '../db/database.ts';
import type { Candidate } from './frontier.ts';
import { ACTIVE_CRAWL } from './site-task.ts';
import type { Crawl } from './task-fence.ts';

/** What admission already finds for a batch, keyed by URL hash or site URL id. */
export type AdmissionState = {
  siteUrlIds: Map<string, string>;
  activeMembers: Set<string>;
  observed: Set<string>;
  discovering: Set<string>;
};

export async function readAdmissionState(
  trx: Database,
  crawl: Crawl,
  hashes: string[],
): Promise<AdmissionState> {
  const state: AdmissionState = {
    siteUrlIds: new Map(),
    activeMembers: new Set(),
    observed: new Set(),
    discovering: new Set(),
  };
  if (!hashes.length) return state;
  const urls = await trx
    .selectFrom('site_urls')
    .select(['id', 'url_hash', 'workspace_id'])
    .where('project_id', '=', crawl.project_id)
    .where('url_hash', '=', (eb) => eb.fn.any(eb.val(hashes)))
    .execute();
  for (const row of urls) {
    if (row.workspace_id !== crawl.workspace_id)
      throw new Error(`SiteUrl ${row.url_hash} belongs to another workspace`);
    state.siteUrlIds.set(row.url_hash, row.id);
  }
  const ids = [...state.siteUrlIds.values()];
  if (ids.length) {
    // One transaction is one connection: these run in sequence either way.
    const members = await trx
      .selectFrom('monitored_site_urls')
      .select('site_url_id')
      .where('workspace_id', '=', crawl.workspace_id)
      .where('project_id', '=', crawl.project_id)
      .where('active', '=', true)
      .where('site_url_id', '=', (eb) => eb.fn.any(eb.val(ids)))
      .execute();
    const observations = await trx
      .selectFrom('site_url_observations')
      .select('site_url_id')
      .where('workspace_id', '=', crawl.workspace_id)
      .where('crawl_id', '=', crawl.id)
      .where('site_url_id', '=', (eb) => eb.fn.any(eb.val(ids)))
      .execute();
    for (const row of members) state.activeMembers.add(row.site_url_id);
    for (const row of observations) state.observed.add(row.site_url_id);
  }
  const discovering = await trx
    .selectFrom('site_crawl_tasks')
    .select('url_hash')
    .where('workspace_id', '=', crawl.workspace_id)
    .where('crawl_id', '=', crawl.id)
    .where('task_kind', '=', 'discover')
    .where('generation', '=', 0)
    .where('url_hash', '=', (eb) => eb.fn.any(eb.val(hashes)))
    .execute();
  for (const row of discovering) state.discovering.add(row.url_hash);
  return state;
}

/** Conflict-safe identity upserts; a new sighting resets an earlier crawl's disposition. */
export async function upsertSiteUrls(
  trx: Database,
  crawl: Crawl,
  items: Candidate[],
  dispositionVersion: string,
) {
  if (!items.length) return new Map<string, string>();
  const now = new Date();
  const rows = await trx
    .insertInto('site_urls')
    .values(
      items.map((item) => ({
        id: randomUUID(),
        workspace_id: crawl.workspace_id,
        project_id: crawl.project_id,
        normalized_url: item.url,
        url_hash: item.hash,
        display_url: item.url,
        host: new URL(item.url).hostname.slice(0, 255),
        depth: item.depth,
        corpus_disposition: item.disposition,
        disposition_reason: item.dispositionReason,
        disposition_version: dispositionVersion,
        item_kind: item.itemKind,
        discovery_status: 'running',
        latest_source_kind: item.sourceKind,
        latest_title: '',
        latest_content_type: '',
        first_seen_crawl_id: crawl.id,
        last_seen_crawl_id: crawl.id,
        first_seen_at: now,
        last_seen_at: now,
      })),
    )
    .onConflict((conflict) =>
      conflict
        .columns(['project_id', 'url_hash'])
        .doUpdateSet((eb) => ({
          display_url: eb.ref('excluded.display_url'),
          host: eb.ref('excluded.host'),
          depth: eb.ref('excluded.depth'),
          corpus_disposition: eb.ref('excluded.corpus_disposition'),
          disposition_reason: eb.ref('excluded.disposition_reason'),
          disposition_version: eb.ref('excluded.disposition_version'),
          item_kind: eb.ref('excluded.item_kind'),
          discovery_status: eb.ref('excluded.discovery_status'),
          latest_source_kind: eb.ref('excluded.latest_source_kind'),
          last_seen_crawl_id: eb.ref('excluded.last_seen_crawl_id'),
          last_seen_at: eb.ref('excluded.last_seen_at'),
        }))
        .where('site_urls.workspace_id', '=', crawl.workspace_id),
    )
    .returning(['id', 'url_hash'])
    .execute();
  const ids = new Map(rows.map((row) => [row.url_hash, row.id]));
  const foreign = items.find((item) => !ids.has(item.hash));
  if (foreign) throw new Error(`SiteUrl ${foreign.hash} belongs to another workspace`);
  return ids;
}

/** Insert or reactivate system memberships; returns how many became active now. */
export async function activateMemberships(
  trx: Database,
  crawl: Crawl,
  siteUrlIds: string[],
  source: string,
) {
  if (!siteUrlIds.length) return 0;
  const now = new Date();
  const rows = await trx
    .insertInto('monitored_site_urls')
    .values(
      siteUrlIds.map((siteUrlId) => ({
        id: randomUUID(),
        workspace_id: crawl.workspace_id,
        project_id: crawl.project_id,
        profile_id: crawl.profile_id,
        site_url_id: siteUrlId,
        active: true,
        selection_source: source,
        selected_at: now,
        created_at: now,
        updated_at: now,
      })),
    )
    .onConflict((conflict) =>
      conflict
        .columns(['project_id', 'site_url_id'])
        .doUpdateSet({
          active: true,
          selection_source: source,
          selected_at: now,
          deselected_at: null,
          updated_at: now,
        })
        .where('monitored_site_urls.active', '=', false),
    )
    .returning('id')
    .execute();
  return rows.length;
}

/** Record this crawl's sightings; returns how many were new. */
export async function insertObservations(
  trx: Database,
  crawl: Crawl,
  observed: { siteUrlId: string; item: Candidate }[],
  artifactId: string | null,
) {
  if (!observed.length) return 0;
  const now = new Date();
  const rows = await trx
    .insertInto('site_url_observations')
    .values(
      observed.map(({ siteUrlId, item }) => ({
        id: randomUUID(),
        workspace_id: crawl.workspace_id,
        project_id: crawl.project_id,
        crawl_id: crawl.id,
        site_url_id: siteUrlId,
        source_kind: item.sourceKind,
        value_kind: item.valueKind,
        value_priority: item.priority,
        rewrite_reason: item.rewriteReason,
        rewrite_version: item.rewriteVersion,
        depth: item.depth,
        observed_url: item.url,
        final_url: item.url,
        source_artifact_id: artifactId,
        parent_site_url_id: item.referrerId,
        content_type: '',
        title: '',
        created_at: now,
      })),
    )
    .onConflict((conflict) => conflict.columns(['crawl_id', 'site_url_id']).doNothing())
    .returning('id')
    .execute();
  return rows.length;
}

export type TaskSeed = {
  siteUrlId: string;
  item: Candidate;
  priority: number;
  position: number;
};

/**
 * Enqueue tasks of one kind for an active crawl. A conflicting queued row only
 * has its priority raised (and its wake-up pulled forward), so discovery's
 * boost reaches a pre-seeded analyze task. Returns the URL hashes of the new rows.
 */
export async function enqueueSiteTasks(
  trx: Database,
  crawl: Crawl,
  kind: 'discover' | 'analyze',
  seeds: TaskSeed[],
  maxAttempts: number,
): Promise<string[]> {
  if (!seeds.length) return [];
  const column = <T>(pick: (seed: TaskSeed) => T) => seeds.map(pick);
  const { rows } = await sql<{ inserted: boolean; url_hash: string }>`
    INSERT INTO site_crawl_tasks (
      id, crawl_id, workspace_id, site_url_id, parent_site_url_id, task_kind, requested_url,
      url_hash, depth, generation, idempotency_key, status, priority, randomized_position,
      max_attempts, attempt_count, conflict_count, available_at, created_at,
      updated_at, error_code, error_detail, classification_expected
    )
    SELECT v.id, c.id, c.workspace_id, v.site_url_id, v.parent_site_url_id, ${kind}, v.url,
      v.hash, v.depth, 0, v.idempotency_key, 'queued', v.priority, v.position, ${maxAttempts},
      0, 0, now(), now(), now(), '', '', false
    FROM unnest(
      ${column(() => randomUUID())}::uuid[],
      ${column((seed) => seed.siteUrlId)}::uuid[],
      ${column((seed) => seed.item.referrerId)}::uuid[],
      ${column((seed) => seed.item.url)}::text[],
      ${column((seed) => seed.item.hash)}::text[],
      ${column((seed) => seed.item.depth)}::int[],
      ${column((seed) => seed.priority)}::int[],
      ${column((seed) => seed.position)}::int[],
      ${column((seed) => `${crawl.id}:${kind}:${seed.item.hash}:0`)}::text[]
    ) AS v(id, site_url_id, parent_site_url_id, url, hash, depth, priority, position,
      idempotency_key)
    CROSS JOIN site_crawls c
    WHERE c.id = ${crawl.id}::uuid AND c.workspace_id = ${crawl.workspace_id}::uuid
      AND c.status = ANY(${[...ACTIVE_CRAWL]})
    ON CONFLICT (crawl_id, task_kind, url_hash, generation) DO UPDATE
      SET priority = excluded.priority,
          available_at = least(site_crawl_tasks.available_at, now())
      WHERE site_crawl_tasks.status = 'queued' AND site_crawl_tasks.priority < excluded.priority
    RETURNING (xmax = 0) AS inserted, url_hash`.execute(trx);
  return rows.flatMap((row) => (row.inserted ? [row.url_hash] : []));
}

export async function markFrontierAdmitted(
  trx: Database,
  crawl: Crawl,
  frontierIds: string[],
  status: string,
) {
  if (!frontierIds.length) return;
  await trx
    .updateTable('site_discovery_frontier')
    .set({ status, admitted_at: new Date() })
    .where('workspace_id', '=', crawl.workspace_id)
    .where('id', '=', (eb) => eb.fn.any(eb.val(frontierIds)))
    .execute();
}
