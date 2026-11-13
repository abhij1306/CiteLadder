/**
 * The single writer of Site Health crawl tasks, URL identities, observations
 * and system memberships. The frontier decides which URLs to admit, in order,
 * from state it reads once; these statements then apply those decisions in a
 * fixed number of round trips, whatever the batch size. The planner, the
 * executors and the crawl's successors write the same rows through here.
 */
import { randomUUID } from 'node:crypto';
import { ACTIVE_CRAWL_STATUSES } from '@citeladder/contracts/site-health';
import { sql } from 'kysely';
import { policy } from '../config.ts';
import { resolveSettingSpec } from '../config/settings.ts';
import type { Database } from '../db/database.ts';
import type { Candidate } from './frontier.ts';
import type { Crawl } from './site-task.ts';

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

/**
 * The only writer of URL identities. Every sighting, an admission or a planner
 * seed's own discover, records the URL as this crawl saw it: a new identity, or
 * an existing one refreshed, which resets an earlier crawl's depth, source and
 * disposition so this crawl re-decides them. Returns the id per URL hash.
 */
export async function upsertSiteUrls(trx: Database, crawl: Crawl, items: Candidate[]) {
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
        disposition_version: policy.site_health.crawl.disposition_version,
        item_kind: item.itemKind,
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

/**
 * Append pages to the project's tracked set, in the given order, after its last
 * fill position. A page tracked before keeps its row and position (it is never
 * re-picked); a sample membership, which has no position, is taken over.
 * Returns the site URL ids that joined.
 */
export async function joinTrackedSet(trx: Database, crawl: Crawl, siteUrlIds: string[]) {
  if (!siteUrlIds.length) return [];
  const now = new Date();
  const { rows } = await sql<{ site_url_id: string }>`
    INSERT INTO monitored_site_urls (
      id, workspace_id, project_id, profile_id, site_url_id, active, selection_source,
      fill_order, selected_at, created_at, updated_at
    )
    SELECT v.id, ${crawl.workspace_id}::uuid, ${crawl.project_id}::uuid, ${crawl.profile_id}::uuid,
      v.site_url_id, true, 'bootstrap', last.position + v.ordinal::int, ${now}, ${now}, ${now}
    FROM unnest(${siteUrlIds.map(() => randomUUID())}::uuid[], ${siteUrlIds}::uuid[])
      WITH ORDINALITY AS v(id, site_url_id, ordinal)
    CROSS JOIN (
      SELECT coalesce(max(fill_order), -1) AS position FROM monitored_site_urls
      WHERE workspace_id = ${crawl.workspace_id}::uuid AND project_id = ${crawl.project_id}::uuid
    ) AS last
    ON CONFLICT (project_id, site_url_id) DO UPDATE
      SET active = true, selection_source = excluded.selection_source,
          fill_order = excluded.fill_order, selected_at = excluded.selected_at,
          deselected_at = NULL, updated_at = excluded.updated_at
      WHERE monitored_site_urls.fill_order IS NULL
        AND monitored_site_urls.workspace_id = ${crawl.workspace_id}::uuid
    RETURNING site_url_id`.execute(trx);
  return rows.map((row) => row.site_url_id);
}

/**
 * Fit the tracked set to the monitored-URL limit: the first `limit` pages in fill
 * order are active, the rest have left (`deselected_at` is when). A lower limit
 * trims the set from its end and a higher one restores those pages first. A full
 * crawl tracks nothing else, so a leftover sample membership is released.
 * The caller holds the project's membership rows.
 */
export async function fitTrackedSet(
  trx: Database,
  scope: { workspaceId: string; projectId: string },
  limit: number,
  options: { releaseSample: boolean },
) {
  const now = new Date();
  await sql`
    UPDATE monitored_site_urls m
    SET active = r.rank <= ${limit},
        deselected_at = CASE WHEN r.rank <= ${limit} THEN NULL ELSE ${now}::timestamptz END,
        updated_at = ${now}
    FROM (
      SELECT id, row_number() OVER (ORDER BY fill_order) AS rank FROM monitored_site_urls
      WHERE workspace_id = ${scope.workspaceId}::uuid AND project_id = ${scope.projectId}::uuid
        AND fill_order IS NOT NULL
    ) AS r
    WHERE m.id = r.id AND m.active <> (r.rank <= ${limit})`.execute(trx);
  if (options.releaseSample)
    await trx
      .updateTable('monitored_site_urls')
      .set({ active: false, deselected_at: now, updated_at: now })
      .where('workspace_id', '=', scope.workspaceId)
      .where('project_id', '=', scope.projectId)
      .where('fill_order', 'is', null)
      .where('active', '=', true)
      .execute();
}

/** One sighting of a URL in a crawl, as `site_url_observations` keeps it. */
export type Observation = {
  siteUrlId: string;
  sourceKind: string;
  valueKind: string;
  valuePriority: number;
  rewriteReason: string;
  rewriteVersion: string;
  depth: number;
  observedUrl: string;
  finalUrl: string;
  artifactId: string | null;
  parentSiteUrlId: string | null;
  statusCode: number | null;
  contentType: string;
  title: string;
};

/** An admitted candidate's sighting, before any fetch of its own. */
export function candidateObservation(
  siteUrlId: string,
  item: Candidate,
  artifactId: string | null,
): Observation {
  return {
    siteUrlId,
    sourceKind: item.sourceKind,
    valueKind: item.valueKind,
    valuePriority: item.priority,
    rewriteReason: item.rewriteReason,
    rewriteVersion: item.rewriteVersion,
    depth: item.depth,
    observedUrl: item.url,
    finalUrl: item.url,
    artifactId,
    parentSiteUrlId: item.referrerId,
    statusCode: null,
    contentType: '',
    title: '',
  };
}

/** Rows per insert, so a large sitemap stays under PostgreSQL's bind-parameter limit. */
const OBSERVATIONS_PER_INSERT = 1000;

/**
 * The only writer of observations. A crawl keeps its first sighting of each
 * URL: a later one, however rich, is dropped. Returns how many were new.
 */
export async function insertObservations(trx: Database, crawl: Crawl, observed: Observation[]) {
  const now = new Date();
  let inserted = 0;
  for (let offset = 0; offset < observed.length; offset += OBSERVATIONS_PER_INSERT) {
    const rows = await trx // NOSONAR: chunks bound each insert's bind parameters, in order in one transaction.
      .insertInto('site_url_observations')
      .values(
        observed.slice(offset, offset + OBSERVATIONS_PER_INSERT).map((row) => ({
          id: randomUUID(),
          workspace_id: crawl.workspace_id,
          project_id: crawl.project_id,
          crawl_id: crawl.id,
          site_url_id: row.siteUrlId,
          source_kind: row.sourceKind,
          value_kind: row.valueKind,
          value_priority: row.valuePriority,
          rewrite_reason: row.rewriteReason,
          rewrite_version: row.rewriteVersion,
          depth: row.depth,
          observed_url: row.observedUrl,
          final_url: row.finalUrl,
          source_artifact_id: row.artifactId,
          parent_site_url_id: row.parentSiteUrlId,
          status_code: row.statusCode,
          content_type: row.contentType.slice(0, 128),
          title: row.title,
          created_at: now,
        })),
      )
      .onConflict((conflict) => conflict.columns(['crawl_id', 'site_url_id']).doNothing())
      .returning('id')
      .execute();
    inserted += rows.length;
  }
  return inserted;
}

/** One `site_crawl_tasks` row to enqueue; unset fields are a root-level first-generation task. */
export type CrawlTaskSeed = {
  kind: string;
  url: string;
  hash: string;
  siteUrlId?: string | null;
  parentSiteUrlId?: string | null;
  depth?: number;
  generation?: number;
  priority?: number;
  position?: number;
  delaySeconds?: number;
};

/**
 * How an enqueue meets an existing row for the same task:
 * - `admit`, the crawl's URL admission: lands only in an active crawl, and a
 *   conflicting queued row has its priority raised (its wake-up pulled
 *   forward), so discovery's boost reaches a pre-seeded analyze task.
 * - `once`, planner seeds and crawl successors: the existing row is kept as is.
 */
export type EnqueueMode = 'admit' | 'once';

/**
 * The only writer of `site_crawl_tasks`: one idempotency key format, the Site
 * Health attempt budget, and the two conflict modes. Returns the new rows.
 */
export async function enqueueCrawlTasks(
  trx: Database,
  crawl: Crawl,
  seeds: CrawlTaskSeed[],
  mode: EnqueueMode,
): Promise<{ id: string; url_hash: string }[]> {
  if (!seeds.length) return [];
  const column = <T>(pick: (seed: CrawlTaskSeed) => T) => seeds.map(pick);
  const maxAttempts = Number(
    resolveSettingSpec(policy.site_health.settings.max_attempts, process.env),
  );
  const active =
    mode === 'admit' ? sql`AND c.status = ANY(${[...ACTIVE_CRAWL_STATUSES]}::text[])` : sql``;
  const conflict =
    mode === 'admit'
      ? sql`ON CONFLICT (crawl_id, task_kind, url_hash, generation) DO UPDATE
      SET priority = excluded.priority,
          available_at = least(site_crawl_tasks.available_at, now())
      WHERE site_crawl_tasks.status = 'queued' AND site_crawl_tasks.priority < excluded.priority`
      : sql`ON CONFLICT DO NOTHING`;
  const { rows } = await sql<{ id: string; url_hash: string; inserted: boolean }>`
    INSERT INTO site_crawl_tasks (
      id, crawl_id, workspace_id, site_url_id, parent_site_url_id, task_kind, requested_url,
      url_hash, depth, generation, idempotency_key, status, priority, randomized_position,
      max_attempts, attempt_count, conflict_count, available_at, created_at,
      updated_at, error_code, error_detail, classification_expected
    )
    SELECT v.id, c.id, c.workspace_id, v.site_url_id, v.parent_site_url_id, v.kind, v.url,
      v.hash, v.depth, v.generation, ${crawl.id}::text || ':' || v.kind || ':' || v.hash || ':'
        || v.generation::text, 'queued', v.priority, v.position, ${maxAttempts},
      0, 0, now() + make_interval(secs => v.delay), now(), now(), '', '', false
    FROM unnest(
      ${column(() => randomUUID())}::uuid[],
      ${column((seed) => seed.siteUrlId ?? null)}::uuid[],
      ${column((seed) => seed.parentSiteUrlId ?? null)}::uuid[],
      ${column((seed) => seed.kind)}::text[],
      ${column((seed) => seed.url)}::text[],
      ${column((seed) => seed.hash)}::text[],
      ${column((seed) => seed.depth ?? 0)}::int[],
      ${column((seed) => seed.generation ?? 0)}::int[],
      ${column((seed) => seed.priority ?? 0)}::int[],
      ${column((seed) => seed.position ?? 0)}::int[],
      ${column((seed) => seed.delaySeconds ?? 0)}::float8[]
    ) AS v(id, site_url_id, parent_site_url_id, kind, url, hash, depth, generation, priority,
      position, delay)
    CROSS JOIN site_crawls c
    WHERE c.id = ${crawl.id}::uuid AND c.workspace_id = ${crawl.workspace_id}::uuid ${active}
    ${conflict}
    RETURNING id, url_hash, (xmax = 0) AS inserted`.execute(trx);
  return rows.flatMap((row) => (row.inserted ? [{ id: row.id, url_hash: row.url_hash }] : []));
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
