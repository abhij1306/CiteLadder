/** Explicit crawl admission freezes policy and commits all initial work together. */
import { randomUUID } from 'node:crypto';
import { ACTIVE_CRAWL_STATUSES } from '@citeladder/contracts/site-health';
import { sql, type Selectable } from 'kysely';
import { policy } from '../config.ts';
import { measuredTargetPages } from '../opportunities/enqueue.ts';
import type { Database } from '../db/database.ts';
import { notFound } from '../errors.ts';
import { record } from '../db/json.ts';
import type {
  SiteHealthProfiles,
  SiteUrls,
  WorkspaceSiteHealthRuntime,
} from '../generated/db-schema.ts';
import { enqueueCrawlTasks, fitTrackedSet, insertObservations } from './admission-writes.ts';
import { addAutomaticRoot, candidate, crawlScope, lockRuntime } from './frontier.ts';
import { siteHealthRuntime } from './reads/runtime.ts';
import {
  controls,
  crawlError,
  crawlSetting,
  frozenConfiguration,
  projectWebsiteRoot,
  type CrawlAdmission,
} from './planner-policy.ts';
import { fillTrackedSet, lockTrackedSet } from './tracked-set.ts';
import { pageRerunSql } from './page-rerun.ts';
import { inventoryCrawlIds } from './reads/crawl.ts';
import { recordCrawlEvent } from './site-task.ts';
import type { Crawl } from './site-task.ts';
import { classifyUrlAdmission } from './url-admission.ts';
import { canonicalIdentity } from './url-identity.ts';

/**
 * Persist the workspace's current runtime projection and lock its row. The
 * runtime row is the first Site Health lock after the project, so callers take
 * it before membership, the active crawl and the profile.
 */
export async function admissionRuntime(db: Database, workspaceId: string) {
  const now = new Date();
  const projection = siteHealthRuntime();
  await db
    .insertInto('workspace_site_health_runtime')
    .values({
      id: randomUUID(),
      workspace_id: workspaceId,
      ...projection,
      // Legacy NOT NULL provenance column; a self-hosted runtime has one fixed source.
      resolved_registry_revision: 'self-hosted',
      created_at: now,
      updated_at: now,
    })
    .onConflict((conflict) =>
      conflict.column('workspace_id').doUpdateSet({ ...projection, updated_at: now }),
    )
    .execute();
  const runtime = await lockRuntime(db, workspaceId);
  if (!runtime) throw new Error('Site Health runtime missing');
  return runtime;
}

async function enqueueCrawlTask(
  db: Database,
  crawl: Crawl,
  input: {
    kind: string;
    url: string;
    siteUrlId?: string;
    depth?: number;
    position?: number;
    priority?: number;
    generation?: number;
    delay?: number;
  },
) {
  const [row] = await enqueueCrawlTasks(
    db,
    crawl,
    [
      {
        kind: input.kind,
        url: input.url,
        hash: canonicalIdentity(input.url).hash,
        siteUrlId: input.siteUrlId ?? null,
        depth: input.depth,
        generation: input.generation,
        position: input.position,
        priority: input.priority,
        delaySeconds: input.delay,
      },
    ],
    'once',
  );
  return row?.id ?? null;
}

async function seedObservation(
  db: Database,
  crawl: Crawl,
  url: Selectable<SiteUrls>,
  rerun = false,
) {
  await insertObservations(db, crawl, [
    {
      siteUrlId: url.id,
      sourceKind: rerun ? 'root' : url.latest_source_kind || 'link',
      valueKind: '',
      valuePriority: 0,
      rewriteReason: '',
      rewriteVersion: '',
      depth: rerun ? 0 : url.depth,
      observedUrl: url.normalized_url,
      finalUrl: url.normalized_url,
      artifactId: null,
      parentSiteUrlId: null,
      statusCode: null,
      contentType: rerun ? '' : url.latest_content_type || '',
      title: url.latest_title || '',
    },
  ]);
}

/** Queue analysis of the active members, in fill order, within the crawl's page limit. */
async function seedMonitored(db: Database, crawl: Crawl) {
  const rows = await db
    .selectFrom('site_urls as u')
    .innerJoin('monitored_site_urls as m', (join) =>
      join
        .onRef('m.site_url_id', '=', 'u.id')
        .onRef('m.workspace_id', '=', 'u.workspace_id')
        .onRef('m.project_id', '=', 'u.project_id'),
    )
    .selectAll('u')
    .where('u.workspace_id', '=', crawl.workspace_id)
    .where('u.project_id', '=', crawl.project_id)
    .where('m.active', '=', true)
    .orderBy(sql`m.fill_order asc nulls last`)
    .orderBy('u.normalized_url')
    .execute();
  // Pages with a declared change still being measured go first, so a budget
  // smaller than the monitored set never drops the page a verification awaits.
  const declared = new Set(
    await measuredTargetPages(db, { workspaceId: crawl.workspace_id, projectId: crawl.project_id }),
  );
  // The root keeps its slot: site checks read its facts.
  const rank = (url: { id: string; normalized_url: string }) => {
    if (url.normalized_url === crawl.root_url) return 0;
    return declared.has(url.id) ? 1 : 2;
  };
  // A stable sort: fill order holds within each rank.
  rows.sort((left, right) => rank(left) - rank(right));
  // The budget is in pages, not tasks: site setup is no page, and a URL that
  // already has a discover task (a sample's root) spends nothing more.
  const held = new Set(
    (
      await db
        .selectFrom('site_crawl_tasks')
        .select('url_hash')
        .where('workspace_id', '=', crawl.workspace_id)
        .where('crawl_id', '=', crawl.id)
        .where('task_kind', 'in', ['discover', 'analyze'])
        .execute()
    ).map((task) => task.url_hash),
  );
  let free = Math.max(0, Number(record(crawl.configuration).requested_page_limit) - held.size);
  const seeded: typeof rows = [];
  let boundary: (typeof rows)[number] | undefined;
  for (const url of rows) {
    if (!classifyUrlAdmission(url.normalized_url, crawlScope(crawl)).accepted) continue;
    if (held.has(url.url_hash)) seeded.push(url);
    else if (free > 0) {
      seeded.push(url);
      free -= 1;
    } else boundary ??= url;
  }
  // Preserve the boundary observation even when no further task fits the budget.
  await Promise.all(
    [...seeded, ...(boundary ? [boundary] : [])].map((url) => seedObservation(db, crawl, url)),
  );
  await Promise.all(
    seeded.map((url, position) =>
      enqueueCrawlTask(db, crawl, {
        kind: 'analyze',
        url: url.normalized_url,
        siteUrlId: url.id,
        position,
        delay: Math.min(
          position * Number(crawlSetting('monitored_seed_stagger_seconds')),
          Number(crawlSetting('monitored_seed_stagger_max_seconds')),
        ),
      }),
    ),
  );
}

type Runtime = Selectable<WorkspaceSiteHealthRuntime>;
type Profile = Selectable<SiteHealthProfiles>;

function insertCrawl(
  db: Database,
  input: {
    workspaceId: string;
    projectId: string;
    profileId: string;
    root: string;
    configuration: Record<string, unknown>;
    runtime: Runtime;
    /** How many URLs discovery may admit: a sample's cap or a full crawl's HTML-walk bound. */
    discoveryLimit: number;
    /** How many pages a re-audit names; 0 for a crawl of the site. */
    rerunPages: number;
  },
) {
  const now = new Date();
  const sample = input.runtime.discovery_mode === 'sample';
  const rerun = input.rerunPages > 0;
  // A full crawl's discovery waits for site setup: its sitemap, or an HTML walk without one.
  let discovery = sample ? 'running' : 'pending';
  if (rerun) discovery = 'completed';
  return db
    .insertInto('site_crawls')
    .values({
      id: randomUUID(),
      workspace_id: input.workspaceId,
      project_id: input.projectId,
      profile_id: input.profileId,
      root_url: input.root,
      // Unread since the tracked set (SH-B6) made every crawl's order stable; the column is
      // NOT NULL until a later release drops it (expand/contract).
      random_seed: '0',
      configuration: JSON.stringify(input.configuration),
      sample_mode: sample,
      status: 'queued',
      analysis_status: 'pending',
      discovery_status: discovery,
      inventory_complete: false,
      discovery_requested_count: rerun ? 0 : input.discoveryLimit,
      analysis_requested_count: 0,
      discovered_url_count: input.rerunPages,
      admitted_url_count: input.rerunPages,
      analyzed_url_count: 0,
      failed_url_count: 0,
      partial_reason: '',
      error_message: '',
      extractor_version: policy.site_health.versions.extractor,
      analyzer_version: policy.site_health.versions.analyzer,
      rule_catalog_version: policy.site_health.versions.rules,
      scoring_version: policy.site_health.reads.scoring_version,
      created_at: now,
      updated_at: now,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
}

async function creationEvents(db: Database, crawl: Crawl, rerunSiteUrlIds?: readonly string[]) {
  await recordCrawlEvent(
    db,
    crawl,
    'crawl.created',
    rerunSiteUrlIds ? 'page rerun crawl created' : 'crawl created',
    {
      root_url: crawl.root_url,
      sample_mode: crawl.sample_mode,
      source_kind: 'root',
      ...(rerunSiteUrlIds ? { rerun_site_url_ids: rerunSiteUrlIds } : {}),
    },
  );
  await recordCrawlEvent(db, crawl, 'crawl.queued', 'crawl queued', {});
}

function refreshProfile(
  db: Database,
  workspaceId: string,
  projectId: string,
  root: string,
  domain: string,
) {
  const now = new Date();
  const values = {
    root_url: root,
    root_host: new URL(root).hostname,
    registrable_domain: domain,
    updated_at: now,
  };
  return db
    .insertInto('site_health_profiles')
    .values({
      id: randomUUID(),
      workspace_id: workspaceId,
      project_id: projectId,
      // Unused since SH-B13; the column is NOT NULL until a later release drops it (expand/contract).
      selection_version: 0,
      created_at: now,
      ...values,
    })
    .onConflict((conflict) =>
      conflict
        .column('project_id')
        .doUpdateSet(values)
        .where('site_health_profiles.workspace_id', '=', workspaceId),
    )
    .returningAll()
    .executeTakeFirstOrThrow();
}

/** The root as the first tracked page: site checks read its facts. */
async function trackRoot(db: Database, crawl: Crawl) {
  const decision = classifyUrlAdmission(crawl.root_url, crawlScope(crawl));
  if (!decision.accepted || !decision.url) return;
  const root = candidate(decision, {
    url: decision.url,
    hash: decision.hash,
    depth: 0,
    sourceKind: 'root',
    parentPosition: 0,
    linkOrdinal: 0,
  });
  await fillTrackedSet(db, crawl, [root]);
}

/**
 * Caller owns the transaction: project -> runtime -> membership -> profile.
 * A full crawl audits the tracked set: admission fits it to the monitored-URL
 * limit (SH-B6), tracks the root on a first crawl and queues every tracked
 * page's analysis within the crawl's page limit; site setup then reads the
 * sitemap and fills any free slots, or starts an HTML walk without one (SH-B5).
 */
export async function createCrawl(db: Database, workspaceId: string, request: CrawlAdmission) {
  const project = await db
    .selectFrom('projects')
    .select('website_url')
    .where('workspace_id', '=', workspaceId)
    .where('id', '=', request.project_id)
    .forNoKeyUpdate()
    .executeTakeFirst();
  if (!project) throw notFound('Project');
  const existing = await db
    .selectFrom('site_crawls')
    .select('id')
    .where('workspace_id', '=', workspaceId)
    .where('project_id', '=', request.project_id)
    .where('status', 'in', ACTIVE_CRAWL_STATUSES)
    .executeTakeFirst();
  if (existing) crawlError('Project already has an active crawl', 'crawl_already_active', 409);
  const { root, domain } = projectWebsiteRoot(project.website_url);
  const scope = { domain };
  if (!classifyUrlAdmission(root, scope).accepted)
    crawlError('crawl root is not admissible', 'invalid_root');
  const runtime = await admissionRuntime(db, workspaceId);
  await lockTrackedSet(db, workspaceId, request.project_id);
  const profile = await refreshProfile(db, workspaceId, request.project_id, root, domain);
  const selected = controls(request);
  const sample = runtime.discovery_mode === 'sample';
  const discoveryCap = runtime.discovery_url_cap ?? selected.limit;
  // A sample's tracked set is empty; a full crawl's is the monitored-URL limit.
  const tracked = sample ? 0 : runtime.monitored_url_limit;
  await fitTrackedSet(db, { workspaceId, projectId: request.project_id }, tracked, {
    releaseSample: !sample,
  });
  const limit = sample ? Math.min(selected.limit, discoveryCap) : tracked;
  const configuration = frozenConfiguration(scope, runtime, { ...selected, limit });
  if (!sample) {
    // The newest full site crawl's inventory: a page rerun holds no site inventory (SH-B1).
    const previous = await db
      .selectFrom('site_crawls')
      .selectAll()
      .where('workspace_id', '=', workspaceId)
      .where('project_id', '=', request.project_id)
      .where('sample_mode', '=', false)
      .where(pageRerunSql, '=', false)
      .orderBy('created_at', 'desc')
      .orderBy('id', 'desc')
      .executeTakeFirst();
    if (previous)
      configuration[policy.site_health.reads.inventory_source_crawl_ids_key] = inventoryCrawlIds(
        previous,
      ).slice(0, Number(crawlSetting('inventory_history_crawl_limit')));
  }
  const crawl = await insertCrawl(db, {
    workspaceId,
    projectId: request.project_id,
    profileId: profile.id,
    root,
    configuration,
    runtime,
    // The HTML walk may discover past the tracked set, so it reaches pages to fill it with.
    discoveryLimit: sample ? limit : Math.max(discoveryCap, limit),
    rerunPages: 0,
  });
  if (sample && limit > 0)
    await enqueueCrawlTask(db, crawl, { kind: 'discover', url: root, position: 0 });
  await enqueueCrawlTask(db, crawl, {
    kind: 'site_setup',
    url: root,
    priority: policy.site_health.crawl.site_setup_priority_boost,
    position: -1,
  });
  if (!sample) await trackRoot(db, crawl);
  await seedMonitored(db, crawl);
  if (sample) await addAutomaticRoot(db, crawl, runtime);
  await creationEvents(db, crawl);
  return crawl;
}

/**
 * A re-audit of named pages as its own crawl: one page, or every tracked page
 * an issue affects (Re-run all), one page fetch per page. It keeps the
 * project's robots choice (`crawlRequest`), as every crawl that names none does.
 * Project/runtime/profile are already locked by rerun admission; reuse that frozen scope.
 */
export async function createPageRerunCrawl(
  db: Database,
  workspaceId: string,
  projectId: string,
  profile: Profile,
  urls: readonly [Selectable<SiteUrls>, ...Selectable<SiteUrls>[]],
  runtime: Runtime,
  robots: Pick<ReturnType<typeof controls>, 'robots' | 'robotsDecision'>,
) {
  const scope = { domain: profile.registrable_domain || undefined };
  for (const url of urls) {
    const decision = classifyUrlAdmission(url.normalized_url, scope);
    if (!decision.accepted)
      crawlError('page is not admissible for rerun', decision.reason ?? 'invalid_crawl_request');
  }
  const configuration = {
    ...frozenConfiguration(scope, runtime, { ...robots, limit: urls.length }),
    // Marks a page re-read, which Changes never compares as a site crawl.
    page_rerun: true,
  };
  const crawl = await insertCrawl(db, {
    workspaceId,
    projectId,
    profileId: profile.id,
    root: profile.root_url || urls[0].normalized_url,
    configuration,
    runtime,
    discoveryLimit: 0,
    rerunPages: urls.length,
  });
  await Promise.all(urls.map((url) => seedObservation(db, crawl, url, true)));
  await Promise.all(
    urls.map((url, position) =>
      enqueueCrawlTask(db, crawl, {
        kind: 'analyze',
        url: url.normalized_url,
        siteUrlId: url.id,
        position,
      }),
    ),
  );
  await creationEvents(
    db,
    crawl,
    urls.map((url) => url.id),
  );
  return crawl;
}
