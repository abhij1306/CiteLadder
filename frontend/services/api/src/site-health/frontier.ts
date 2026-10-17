/**
 * Durable, deterministic frontier admission. A batch of candidates is ordered
 * by value then document position, persisted to the crawl's frontier, and
 * admitted up to the requested and frontier budgets: each admission upserts
 * the URL identity, its crawl observation, any system membership the
 * automatic or sample allowance grants, and the child discover task. Callers
 * hold the workspace runtime lock (the first rung of the Site Health lock
 * order) and own the transaction.
 */
import { createHash, randomUUID } from 'node:crypto';
import { sql, type Selectable } from 'kysely';

import { policy, resolveSettingSpec } from '../config.ts';
import type { Database } from '../db/database.ts';
import { record } from '../db/json.ts';
import type { WorkspaceSiteHealthRuntime } from '../generated/db-schema.ts';
import { compareText } from '../text-order.ts';
import { classifyUrlAdmission, type Admission, type Scope } from './url-admission.ts';
import { hostTwinHash } from './url-identity.ts';
import { ACTIVE_CRAWL } from './site-task.ts';
import type { Crawl } from './task-fence.ts';
import {
  activateMemberships,
  enqueueSiteTasks,
  insertObservations,
  markFrontierAdmitted,
  readAdmissionState,
  upsertSiteUrls,
  type AdmissionState,
} from './admission-writes.ts';

const crawlPolicy = policy.site_health.crawl;
type Runtime = Selectable<WorkspaceSiteHealthRuntime>;

function frontierSettings(env: Record<string, string | undefined> = process.env) {
  const spec = policy.site_health.settings;
  const number = (name: keyof typeof spec) => Number(resolveSettingSpec(spec[name], env));
  return {
    batch: Math.max(1, number('admission_batch_size')),
    maxDepth: number('max_crawl_depth'),
    automaticPageLimit: number('automatic_page_limit'),
    sampleCap: number('sample_discovery_url_cap'),
    maxFrontier: number('max_frontier_urls'),
    maxAttempts: number('max_attempts'),
  };
}
type Settings = ReturnType<typeof frontierSettings>;

export type Candidate = {
  url: string;
  hash: string;
  depth: number;
  sourceKind: 'root' | 'link' | 'sitemap';
  priority: number;
  parentPosition: number;
  linkOrdinal: number;
  valueKind: string;
  disposition: Admission['disposition'];
  dispositionReason: string;
  itemKind: string;
  rewriteReason: string;
  rewriteVersion: string;
  /** The page whose link found this URL; null for the root and sitemap entries. */
  referrerId: string | null;
};

/** A candidate carrying one admission decision's whole verdict, so priority and disposition never drift. */
export function candidate(
  admission: Admission,
  fields: Pick<
    Candidate,
    'url' | 'hash' | 'depth' | 'sourceKind' | 'parentPosition' | 'linkOrdinal'
  > &
    Partial<Pick<Candidate, 'rewriteReason' | 'rewriteVersion' | 'referrerId'>>,
): Candidate {
  return {
    rewriteReason: '',
    rewriteVersion: '',
    referrerId: null,
    ...fields,
    priority: admission.priority,
    valueKind: admission.valueKind,
    disposition: admission.disposition,
    dispositionReason: admission.dispositionReason,
    itemKind: admission.itemKind,
  };
}

export function crawlScope(crawl: Crawl): Scope {
  const config = record(crawl.configuration);
  const list = (value: unknown) =>
    Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : null;
  return {
    domain:
      typeof config.root_registrable_domain === 'string' ? config.root_registrable_domain : '',
    include: list(config.include_globs),
    exclude: list(config.exclude_globs),
  };
}

/**
 * Value tier first, then a per-crawl seeded shuffle: the sample within a tier is
 * random but reproducible from the crawl, never biased to header and footer links.
 */
const seededRank = (seed: string, hash: string) =>
  createHash('sha256').update(`${seed}${hash}`).digest('hex');
/** One candidate per URL, and one of each www/apex twin pair. */
export function orderedUnique(candidates: Candidate[], seed: string) {
  // One hash per candidate, not two per comparison.
  const rank = new Map(candidates.map((item) => [item.hash, seededRank(seed, item.hash)]));
  const byOrder = (a: Candidate, b: Candidate) =>
    b.priority - a.priority ||
    compareText(rank.get(a.hash) ?? '', rank.get(b.hash) ?? '') ||
    compareText(a.hash, b.hash);
  const unique = new Map<string, Candidate>();
  for (const item of candidates.toSorted(byOrder)) {
    const twin = hostTwinHash(item.url);
    if (!unique.has(item.hash) && !(twin && unique.has(twin))) unique.set(item.hash, item);
  }
  return [...unique.values()];
}
const PAGE_KIND_OF_VALUE: Record<string, string> = crawlPolicy.value_kind_page_kinds;
function allowed(item: Candidate, crawl: Crawl, settings: Settings) {
  if (!classifyUrlAdmission(item.url, crawlScope(crawl)).accepted || item.depth > settings.maxDepth)
    return false;
  const kinds = record(crawl.configuration).page_kinds;
  const selected = Array.isArray(kinds) ? kinds : [];
  // Value tiers are finer than page kinds (about and contact are both `about_contact`).
  const pageKind = PAGE_KIND_OF_VALUE[item.valueKind] ?? item.valueKind;
  return !selected.length || ['root', 'other', ...selected].includes(pageKind);
}

const requestedTarget = (crawl: Crawl, settings: Settings) =>
  crawl.discovery_requested_count ||
  Number(record(crawl.configuration).requested_page_limit) ||
  settings.automaticPageLimit;
function frontierLimit(crawl: Crawl, settings: Settings) {
  if (crawl.sample_mode) return settings.sampleCap;
  return Number(record(crawl.configuration).max_frontier_urls) || settings.maxFrontier;
}

export function lockRuntime(trx: Database, workspaceId: string) {
  return trx
    .selectFrom('workspace_site_health_runtime')
    .selectAll()
    .where('workspace_id', '=', workspaceId)
    .forUpdate()
    .executeTakeFirst();
}

/** Explicit admission seeds root analysis independently of the root discover. */
export async function addAutomaticRoot(trx: Database, crawl: Crawl, runtime: Runtime) {
  const remaining = await automaticRemaining(trx, crawl, runtime);
  if (remaining === null || remaining <= 0) return;
  const decision = classifyUrlAdmission(crawl.root_url, crawlScope(crawl));
  if (!decision.accepted || !decision.url) return;
  const item = candidate(decision, {
    url: decision.url,
    hash: decision.hash,
    depth: 0,
    sourceKind: 'root',
    parentPosition: 0,
    linkOrdinal: 0,
  });
  const siteUrlId = await upsertSiteUrl(trx, crawl, item);
  await observe(
    trx,
    crawl,
    siteUrlId,
    item,
    { analyze: true, source: 'bootstrap' },
    frontierSettings(),
  );
}

/** Conflict-safe identity upsert; a new sighting resets an earlier crawl's document or alias disposition. */
async function upsertSiteUrl(trx: Database, crawl: Crawl, item: Candidate) {
  const now = new Date();
  const row = await trx
    .insertInto('site_urls')
    .values({
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
      disposition_version: crawlPolicy.disposition_version,
      item_kind: item.itemKind,
      discovery_status: 'running',
      latest_source_kind: item.sourceKind,
      latest_title: '',
      latest_content_type: '',
      first_seen_crawl_id: crawl.id,
      last_seen_crawl_id: crawl.id,
      first_seen_at: now,
      last_seen_at: now,
    })
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
    .returning('id')
    .executeTakeFirst();
  if (!row) throw new Error(`SiteUrl ${item.hash} belongs to another workspace`);
  return row.id;
}

/**
 * Enqueue one task of an active crawl. A conflicting queued row only ever has
 * its priority raised (and its wake-up pulled forward), so discovery's boost
 * reaches a pre-seeded analyze task. Returns the id of a newly inserted row.
 */
async function enqueueSiteTask(
  trx: Database,
  crawl: Crawl,
  task: {
    kind: 'discover' | 'analyze';
    siteUrlId: string | null;
    url: string;
    hash: string;
    depth: number;
    priority: number;
    position?: number;
    parentSiteUrlId: string | null;
  },
  settings: Settings,
) {
  const { rows } = await sql<{ id: string; inserted: boolean }>`
    INSERT INTO site_crawl_tasks (
      id, crawl_id, workspace_id, site_url_id, parent_site_url_id, task_kind, requested_url,
      url_hash, depth, generation, idempotency_key, status, priority, randomized_position,
      max_attempts, attempt_count, conflict_count, available_at, created_at,
      updated_at, error_code, error_detail, classification_expected
    )
    SELECT ${randomUUID()}::uuid, c.id, c.workspace_id, ${task.siteUrlId}::uuid,
      ${task.parentSiteUrlId}::uuid, ${task.kind}, ${task.url}, ${task.hash}, ${task.depth}, 0,
      ${`${crawl.id}:${task.kind}:${task.hash}:0`}, 'queued', ${task.priority},
      ${task.position ?? 0}, ${settings.maxAttempts}, 0, 0, now(), now(), now(), '', '', false
    FROM site_crawls c
    WHERE c.id = ${crawl.id}::uuid AND c.workspace_id = ${crawl.workspace_id}::uuid
      AND c.status = ANY(${[...ACTIVE_CRAWL]})
    ON CONFLICT (crawl_id, task_kind, url_hash, generation) DO UPDATE
      SET priority = excluded.priority,
          available_at = least(site_crawl_tasks.available_at, now())
      WHERE site_crawl_tasks.status = 'queued' AND site_crawl_tasks.priority < excluded.priority
    RETURNING id, (xmax = 0) AS inserted`.execute(trx);
  return rows[0]?.inserted ? rows[0].id : null;
}

/** Insert or reactivate a system membership; the id only when it became active now. */
async function activateMembership(trx: Database, crawl: Crawl, siteUrlId: string, source: string) {
  const now = new Date();
  const row = await trx
    .insertInto('monitored_site_urls')
    .values({
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
    })
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
    .executeTakeFirst();
  return Boolean(row);
}

/**
 * Observe a URL in this crawl and optionally monitor and analyze it. A URL
 * about to be discovered gets its analyze task from that fetch instead, so the
 * task never wakes before its artifact exists. Returns [activated, observed].
 */
async function observe(
  trx: Database,
  crawl: Crawl,
  siteUrlId: string,
  item: Candidate,
  options: {
    analyze: boolean;
    afterDiscovery?: boolean;
    source: string;
    artifactId?: string | null;
  },
  settings: Settings,
) {
  const activated = options.analyze
    ? await activateMembership(trx, crawl, siteUrlId, options.source)
    : false;
  const observation = await trx
    .insertInto('site_url_observations')
    .values({
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
      source_artifact_id: options.artifactId ?? null,
      parent_site_url_id: item.referrerId,
      content_type: '',
      title: '',
      created_at: new Date(),
    })
    .onConflict((conflict) => conflict.columns(['crawl_id', 'site_url_id']).doNothing())
    .returning('id')
    .executeTakeFirst();
  if (options.analyze && !options.afterDiscovery)
    await enqueueSiteTask(
      trx,
      crawl,
      {
        kind: 'analyze',
        siteUrlId,
        url: item.url,
        hash: item.hash,
        depth: item.depth,
        priority: item.priority + crawlPolicy.analyze_priority_boost,
        parentSiteUrlId: item.referrerId,
      },
      settings,
    );
  return [activated, Boolean(observation)] as const;
}

async function sampleRemaining(trx: Database, crawl: Crawl, runtime: Runtime | undefined) {
  const used = await trx
    .selectFrom('monitored_site_urls')
    .select((eb) => eb.fn.countAll<string>().as('count'))
    .where('workspace_id', '=', crawl.workspace_id)
    .where('active', '=', true)
    .where('selection_source', '=', 'free_sample')
    .executeTakeFirstOrThrow();
  return Math.max(0, (runtime?.sample_url_limit ?? 0) - Number(used.count));
}

/**
 * How many more URLs this crawl may select for analysis: null when it has no
 * automatic allowance (a full crawl analyzes only what the user monitors).
 * Counted from this crawl's membership admissions, not its analyze tasks,
 * since a discovered URL's task arrives only after its fetch.
 */
async function automaticRemaining(trx: Database, crawl: Crawl, runtime: Runtime | undefined) {
  const requested =
    Number(record(crawl.configuration)[crawlPolicy.automatic_monitor_limit_key]) || 0;
  if (requested <= 0) return crawl.sample_mode ? sampleRemaining(trx, crawl, runtime) : null;
  if (!runtime) return 0;
  const limit = crawl.sample_mode ? runtime.sample_url_limit : runtime.monitored_url_limit;
  const active = await trx
    .selectFrom('monitored_site_urls')
    .select((eb) => eb.fn.countAll<string>().as('count'))
    .where('workspace_id', '=', crawl.workspace_id)
    .where('active', '=', true)
    .executeTakeFirstOrThrow();
  const used = await trx
    .selectFrom('site_url_observations as o')
    .innerJoin('monitored_site_urls as m', (join) =>
      join
        .onRef('m.site_url_id', '=', 'o.site_url_id')
        .onRef('m.workspace_id', '=', 'o.workspace_id'),
    )
    .select((eb) => eb.fn.count<string>('o.site_url_id').distinct().as('count'))
    .where('o.crawl_id', '=', crawl.id)
    .where('o.workspace_id', '=', crawl.workspace_id)
    .where('m.project_id', '=', crawl.project_id)
    .where('m.active', '=', true)
    .executeTakeFirstOrThrow();
  return Math.max(0, Math.min(requested - Number(used.count), limit - Number(active.count)));
}

/** Persist admissible candidates to the frontier, under its capacity, before budgeting this batch. */
async function storeFrontier(
  trx: Database,
  crawl: Crawl,
  candidates: Candidate[],
  settings: Settings,
) {
  // Filter before choosing a twin, so a too-deep twin never displaces an admissible one.
  const eligible = orderedUnique(
    candidates.filter((item) => allowed(item, crawl, settings)),
    crawl.id,
  );
  if (!eligible.length) return;
  const existing = await trx
    .selectFrom('site_discovery_frontier')
    .select((eb) => eb.fn.countAll<string>().as('count'))
    .where('workspace_id', '=', crawl.workspace_id)
    .where('crawl_id', '=', crawl.id)
    .executeTakeFirstOrThrow();
  const capacity = Math.max(0, frontierLimit(crawl, settings) - Number(existing.count));
  // One array parameter, so a sitemap-sized batch stays clear of the driver's bind limit.
  const known = new Set(
    (
      await trx
        .selectFrom('site_discovery_frontier')
        .select('url_hash')
        .where('workspace_id', '=', crawl.workspace_id)
        .where('crawl_id', '=', crawl.id)
        .where('url_hash', '=', (eb) =>
          eb.fn.any(eb.val(eligible.flatMap((item) => [item.hash, hostTwinHash(item.url) ?? '']))),
        )
        .execute()
    ).map((row) => row.url_hash),
  );
  const twinKnown = (item: Candidate) => known.has(hostTwinHash(item.url) ?? '');
  await addReferrers(
    trx,
    crawl,
    eligible.filter((item) => known.has(item.hash) || twinKnown(item)),
  );
  if (!capacity) return;
  const fresh = eligible
    .filter((item) => !known.has(item.hash) && !twinKnown(item))
    .slice(0, capacity);
  const now = new Date();
  for (let offset = 0; offset < fresh.length; offset += settings.batch)
    await trx // NOSONAR: batches bound each insert's bind parameters, in order in one transaction.
      .insertInto('site_discovery_frontier')
      .values(
        fresh.slice(offset, offset + settings.batch).map((item) => ({
          id: randomUUID(),
          workspace_id: crawl.workspace_id,
          crawl_id: crawl.id,
          normalized_url: item.url,
          url_hash: item.hash,
          depth: item.depth,
          source_kind: item.sourceKind,
          value_kind: item.valueKind,
          value_priority: item.priority,
          parent_position: item.parentPosition,
          link_ordinal: item.linkOrdinal,
          referrer_site_url_ids: item.referrerId ? [item.referrerId] : [],
          rewrite_reason: item.rewriteReason,
          rewrite_version: item.rewriteVersion,
          status: crawlPolicy.frontier_statuses.pending,
          created_at: now,
        })),
      )
      .onConflict((conflict) => conflict.columns(['crawl_id', 'url_hash']).doNothing())
      .execute();
}

/**
 * Another page links a URL the frontier already holds: remember that page too,
 * up to the policy's bound, so a failing URL can name the pages that link it.
 */
async function addReferrers(trx: Database, crawl: Crawl, seen: Candidate[]) {
  const byReferrer = new Map<string, string[]>();
  for (const item of seen) {
    if (!item.referrerId) continue;
    const hashes = byReferrer.get(item.referrerId) ?? [];
    hashes.push(item.hash, hostTwinHash(item.url) ?? '');
    byReferrer.set(item.referrerId, hashes);
  }
  // A discovered page's links share one referrer, so this is one statement per page.
  for (const [referrer, hashes] of byReferrer)
    await trx // NOSONAR: one statement per referring page, in order in one transaction.
      .updateTable('site_discovery_frontier')
      .set({
        referrer_site_url_ids: sql`array_append(referrer_site_url_ids, ${referrer}::uuid)`,
      })
      .where('workspace_id', '=', crawl.workspace_id)
      .where('crawl_id', '=', crawl.id)
      .where('url_hash', '=', (eb) => eb.fn.any(eb.val(hashes)))
      .where(sql<boolean>`not (${referrer}::uuid = any(referrer_site_url_ids))`)
      .where(
        sql<boolean>`cardinality(referrer_site_url_ids) < ${crawlPolicy.max_referrers_per_url}`,
      )
      .execute();
}

/** The next pending frontier rows under the remaining requested budget, rebuilt as candidates. */
async function pendingFrontier(trx: Database, crawl: Crawl, settings: Settings) {
  const remaining = Math.max(0, requestedTarget(crawl, settings) - crawl.admitted_url_count);
  if (!remaining) return [];
  const rows = await trx
    .selectFrom('site_discovery_frontier')
    .where('workspace_id', '=', crawl.workspace_id)
    .selectAll()
    .where('crawl_id', '=', crawl.id)
    .where('status', '=', crawlPolicy.frontier_statuses.pending)
    .orderBy('value_priority', 'desc')
    .orderBy(sql`sha256(convert_to(${crawl.id} || url_hash, 'UTF8'))`)
    .orderBy('url_hash')
    .limit(Math.min(remaining, settings.batch))
    .forUpdate()
    .skipLocked()
    .execute();
  // Disposition is a pure function of the path; the value kind was decided under the crawl's scope.
  return rows.map((row) => ({
    frontierId: row.id,
    item: candidate(
      {
        ...classifyUrlAdmission(row.normalized_url),
        priority: row.value_priority,
        valueKind: row.value_kind,
      },
      {
        url: row.normalized_url,
        hash: row.url_hash,
        depth: row.depth,
        sourceKind: row.source_kind as Candidate['sourceKind'],
        parentPosition: row.parent_position,
        linkOrdinal: row.link_ordinal,
        rewriteReason: row.rewrite_reason,
        rewriteVersion: row.rewrite_version,
        referrerId: row.referrer_site_url_ids[0] ?? null,
      },
    ),
  }));
}

export type AdmissionResult = {
  admitted: number;
  observed: number;
  sampleCapped: boolean;
  siteUrlIds: Map<string, string>;
};
type AdmissionOptions = {
  enqueueChildren?: boolean;
  sourceArtifactId?: string;
  settings?: Settings;
};
type Entry = { frontierId: string | null; item: Candidate };

/** A sample admits its candidates directly; a full crawl persists them and takes the frontier's best. */
async function admissionBatch(
  trx: Database,
  crawl: Crawl,
  candidates: Candidate[],
  settings: Settings,
): Promise<Entry[]> {
  if (crawl.sample_mode)
    return orderedUnique(
      candidates.filter((item) => allowed(item, crawl, settings)),
      crawl.id,
    )
      .slice(0, settings.batch)
      .map((item) => ({ frontierId: null, item }));
  await storeFrontier(trx, crawl, candidates, settings);
  return pendingFrontier(trx, crawl, settings);
}

/** One admitted URL and the writes its admission implies. */
type Planned = Entry & {
  position: number;
  /** Selected for analysis: membership, crawl observation and (unless discovery follows) analysis. */
  selected: boolean;
  observe: boolean;
  analyze: boolean;
  discover: boolean;
  /** Already observed in this crawl, as a recrawl's monitored pages are from its start. */
  seen: boolean;
};

/** The batch's known state, in URL-hash space, updated as each admission is decided. */
class AdmissionLedger {
  readonly active: Set<string>;
  readonly observed: Set<string>;
  readonly discovering: Set<string>;
  remaining: number | null;
  admitted = 0;
  constructor(known: AdmissionState, remaining: number | null) {
    const hashOf = new Map([...known.siteUrlIds].map(([hash, id]) => [id, hash]));
    const hashes = (ids: Set<string>) => new Set([...ids].map((id) => hashOf.get(id)!));
    this.active = hashes(known.activeMembers);
    this.observed = hashes(known.observed);
    this.discovering = new Set(known.discovering);
    this.remaining = remaining;
  }
  /** Select for analysis while the allowance lasts; only a new activation spends it. */
  select(item: Candidate) {
    const selected = item.disposition === 'analyze' && (this.remaining ?? 0) > 0;
    if (!selected) return false;
    if (!this.active.has(item.hash) && this.remaining !== null) this.remaining--;
    this.active.add(item.hash);
    return true;
  }
  /**
   * Count toward the ceiling only what is new: a sample's observation, otherwise
   * its discover task, unless the crawl already observed (and so counted) it.
   */
  count(hash: string, seen: boolean, sample: boolean, discover: boolean) {
    const known = sample ? seen : discover && (seen || this.discovering.has(hash));
    if (!known) this.admitted++;
  }
}

/**
 * Decide admissions in order, as the budgets require: a URL spends the
 * automatic allowance only when its membership newly activates, and counts
 * toward the ceiling only when its observation (sample) or discover task is new.
 */
function planAdmission(
  crawl: Crawl,
  batch: Entry[],
  known: AdmissionState,
  options: { ceiling: number; remaining: number | null; enqueueChildren: boolean },
) {
  const ledger = new AdmissionLedger(known, options.remaining);
  const sample = crawl.sample_mode;
  const discover = !sample && options.enqueueChildren;
  const planned: Planned[] = [];
  for (const [position, entry] of batch.entries()) {
    if (crawl.admitted_url_count + ledger.admitted >= options.ceiling) break;
    const { hash } = entry.item;
    // A sample has no stored frontier to dedupe against: an observed twin is the same page.
    const twin = hostTwinHash(entry.item.url);
    if (sample && twin && ledger.observed.has(twin)) continue;
    const selected = ledger.select(entry.item);
    const observe = sample || selected;
    const seen = ledger.observed.has(hash);
    ledger.count(hash, seen, sample, discover);
    if (observe) ledger.observed.add(hash);
    if (discover) ledger.discovering.add(hash);
    planned.push({
      ...entry,
      position,
      selected,
      observe,
      analyze: selected && (sample || !options.enqueueChildren),
      discover,
      seen,
    });
  }
  return { planned, remaining: ledger.remaining };
}

/** Apply a plan in a fixed number of statements; counts come from what the writes changed. */
async function writeAdmission(
  trx: Database,
  crawl: Crawl,
  planned: Planned[],
  settings: Settings,
  options: { source: string; artifactId: string | null; enqueueChildren: boolean },
) {
  const ids = await upsertSiteUrls(
    trx,
    crawl,
    planned.map((entry) => entry.item),
    crawlPolicy.disposition_version,
  );
  const withId = (entry: Planned) => ({ siteUrlId: ids.get(entry.item.hash)!, item: entry.item });
  await activateMemberships(
    trx,
    crawl,
    planned.filter((entry) => entry.selected).map((entry) => withId(entry).siteUrlId),
    options.source,
  );
  const observedNew = await insertObservations(
    trx,
    crawl,
    planned.filter((entry) => entry.observe).map(withId),
    options.artifactId,
  );
  await enqueueSiteTasks(
    trx,
    crawl,
    'analyze',
    planned
      .filter((entry) => entry.analyze)
      .map((entry) => ({
        ...withId(entry),
        priority: entry.item.priority + crawlPolicy.analyze_priority_boost,
        position: 0,
      })),
    settings.maxAttempts,
  );
  const discovering = await enqueueSiteTasks(
    trx,
    crawl,
    'discover',
    planned
      .filter((entry) => entry.discover)
      .map((entry) => ({
        ...withId(entry),
        priority: entry.item.priority,
        position: entry.position,
      })),
    settings.maxAttempts,
  );
  // The crawl's observation counter already holds the pages it had observed.
  const seen = new Set(planned.flatMap((entry) => (entry.seen ? [entry.item.hash] : [])));
  const discoverNew = discovering.filter((hash) => !seen.has(hash)).length;
  await markFrontierAdmitted(
    trx,
    crawl,
    planned.flatMap((entry) => (entry.frontierId ? [entry.frontierId] : [])),
    crawlPolicy.frontier_statuses.admitted,
  );
  let admitted = planned.length;
  if (crawl.sample_mode) admitted = observedNew;
  else if (options.enqueueChildren) admitted = discoverNew;
  return { ids, admitted };
}

/**
 * Admit one batch. A full crawl persists it to the frontier and admits the
 * frontier's best pending rows, queueing child discovery; a sample crawl
 * admits directly until its workspace-wide allowance is spent. Callers hold the
 * workspace runtime lock and add `admitted` to the crawl's count.
 */
export async function admitCandidates(
  trx: Database,
  crawl: Crawl,
  candidates: Candidate[],
  runtime: Runtime | undefined,
  options: AdmissionOptions = {},
): Promise<AdmissionResult> {
  const settings = options.settings ?? frontierSettings();
  // Budgets read the count only after the caller's runtime lock, which serializes every admission
  // of the workspace: a sibling commit that raised it is visible by now.
  const live = await trx
    .selectFrom('site_crawls')
    .select('admitted_url_count')
    .where('id', '=', crawl.id)
    .where('workspace_id', '=', crawl.workspace_id)
    .executeTakeFirstOrThrow();
  const current = { ...crawl, admitted_url_count: live.admitted_url_count };
  const enqueueChildren = options.enqueueChildren ?? true;
  const remaining = await automaticRemaining(trx, current, runtime);
  const ceiling = Math.min(requestedTarget(current, settings), frontierLimit(current, settings));
  const batch = await admissionBatch(trx, current, candidates, settings);
  const known = await readAdmissionState(
    trx,
    current,
    batch.flatMap((entry) => [entry.item.hash, hostTwinHash(entry.item.url) ?? '']).filter(Boolean),
  );
  const plan = planAdmission(current, batch, known, { ceiling, remaining, enqueueChildren });
  const automatic =
    Number(record(current.configuration)[crawlPolicy.automatic_monitor_limit_key]) || 0;
  const { ids, admitted } = await writeAdmission(trx, current, plan.planned, settings, {
    source: current.sample_mode && automatic <= 0 ? 'free_sample' : 'bootstrap',
    artifactId: options.sourceArtifactId ?? null,
    enqueueChildren,
  });
  return {
    admitted,
    observed: plan.planned.length,
    sampleCapped: current.sample_mode && plan.remaining !== null && plan.remaining <= 0,
    siteUrlIds: ids,
  };
}

/** Queue analysis for a URL whose discover artifact now exists, if it is still an active member. */
export async function enqueueDiscoveredAnalysis(
  trx: Database,
  crawl: Crawl,
  page: {
    siteUrlId: string | null;
    url: string;
    hash: string;
    depth: number;
    priority: number;
    parentSiteUrlId: string | null;
  },
  settings = frontierSettings(),
) {
  const siteUrlId =
    page.siteUrlId ??
    (
      await trx
        .selectFrom('site_urls')
        .select('id')
        .where('project_id', '=', crawl.project_id)
        .where('workspace_id', '=', crawl.workspace_id)
        .where('url_hash', '=', page.hash)
        .executeTakeFirst()
    )?.id;
  if (!siteUrlId) return null;
  const member = await trx
    .selectFrom('monitored_site_urls')
    .select('id')
    .where('project_id', '=', crawl.project_id)
    .where('workspace_id', '=', crawl.workspace_id)
    .where('site_url_id', '=', siteUrlId)
    .where('active', '=', true)
    .executeTakeFirst();
  if (!member) return null;
  return enqueueSiteTask(
    trx,
    crawl,
    {
      kind: 'analyze',
      siteUrlId,
      url: page.url,
      hash: page.hash,
      depth: page.depth,
      priority: page.priority + crawlPolicy.analyze_priority_boost,
      parentSiteUrlId: page.parentSiteUrlId,
    },
    settings,
  );
}

/** A fetched document is inventory only: it frees any system-managed analysis allowance. */
export async function markInventoryDocument(trx: Database, crawl: Crawl, hash: string) {
  const url = await trx
    .updateTable('site_urls')
    .set({
      corpus_disposition: 'inventory_only',
      disposition_reason: 'document',
      disposition_version: crawlPolicy.disposition_version,
      item_kind: 'document',
    })
    .where('workspace_id', '=', crawl.workspace_id)
    .where('project_id', '=', crawl.project_id)
    .where('url_hash', '=', hash)
    .returning('id')
    .executeTakeFirst();
  if (url) await deactivateSystemMemberships(trx, crawl, [url.id]);
}

export async function deactivateSystemMemberships(
  trx: Database,
  crawl: Crawl,
  siteUrlIds: string[],
) {
  if (!siteUrlIds.length) return;
  await trx
    .updateTable('monitored_site_urls')
    .set({ active: false, updated_at: new Date() })
    .where('workspace_id', '=', crawl.workspace_id)
    .where('project_id', '=', crawl.project_id)
    .where('site_url_id', 'in', siteUrlIds)
    .where('selection_source', '!=', 'user')
    .execute();
}
