/** Explicit crawl admission freezes policy and commits all initial work together. */
import { randomUUID } from 'node:crypto';
import { ACTIVE_CRAWL_STATUSES } from '@citeladder/contracts/site-health';
import type { Selectable } from 'kysely';
import { policy } from '../config.ts';
import { measuredTargetPages } from '../opportunities/enqueue.ts';
import type { Database } from '../db/database.ts';
import { notFound } from '../errors.ts';
import { record, strings } from '../db/json.ts';
import type {
  SiteHealthProfiles,
  SiteUrls,
  WorkspaceSiteHealthRuntime,
} from '../generated/db-schema.ts';
import { enqueueCrawlTasks, insertObservations } from './admission-writes.ts';
import { addAutomaticRoot, crawlScope, lockRuntime } from './frontier.ts';
import { siteHealthRuntime } from './reads/runtime.ts';
import {
  controls,
  crawlError,
  crawlSetting,
  frozenConfiguration,
  normalizeGlobs,
  normalizedSeed,
  projectWebsiteRoot,
  type CreateCrawlRequest,
} from './planner-policy.ts';
import { inventoryCrawlIds } from './reads/crawl.ts';
import { recordCrawlEvent } from './site-task.ts';
import type { Crawl } from './task-fence.ts';
import { classifyUrlAdmission, type Scope } from './url-admission.ts';
import { canonicalIdentity } from './url-identity.ts';

/** Persists the workspace's current runtime projection and locks it for admission. */
export async function admissionRuntime(db: Database, workspaceId: string) {
  const now = new Date();
  const projection = siteHealthRuntime();
  await db
    .insertInto('workspace_site_health_runtime')
    .values({
      id: randomUUID(),
      workspace_id: workspaceId,
      ...projection,
      // Legacy NOT NULL provenance columns; a self-hosted runtime has one fixed source.
      resolved_registry_revision: 'self-hosted',
      resolved_entitlement_lifecycle_version: 0,
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

export async function enqueueCrawlTask(
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
  rows.sort((left, right) => rank(left) - rank(right));
  // The budget is in pages, not tasks: site setup is no page, and the root's
  // discover already holds the root's slot, so its analysis spends nothing more.
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
    seed?: string | null;
    rerun: boolean;
  },
) {
  const now = new Date();
  return db
    .insertInto('site_crawls')
    .values({
      id: randomUUID(),
      workspace_id: input.workspaceId,
      project_id: input.projectId,
      profile_id: input.profileId,
      root_url: input.root,
      random_seed: normalizedSeed(input.seed),
      configuration: JSON.stringify(input.configuration),
      sample_mode: input.runtime.discovery_mode === 'sample',
      status: 'queued',
      analysis_status: 'pending',
      discovery_status: input.rerun ? 'completed' : 'running',
      inventory_complete: input.rerun,
      discovery_requested_count: input.rerun ? 0 : Number(input.configuration.requested_page_limit),
      analysis_requested_count: 0,
      discovered_url_count: input.rerun ? 1 : 0,
      admitted_url_count: input.rerun ? 1 : 0,
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

async function creationEvents(db: Database, crawl: Crawl, rerunSiteUrlId?: string) {
  await recordCrawlEvent(
    db,
    crawl,
    'crawl.created',
    rerunSiteUrlId ? 'page rerun crawl created' : 'crawl created',
    {
      root_url: crawl.root_url,
      sample_mode: crawl.sample_mode,
      source_kind: 'root',
      ...(rerunSiteUrlId ? { rerun_site_url_id: rerunSiteUrlId } : {}),
    },
  );
  await recordCrawlEvent(db, crawl, 'crawl.queued', 'crawl queued', {});
}

function refreshProfile(
  db: Database,
  workspaceId: string,
  projectId: string,
  root: string,
  scope: Scope,
) {
  const now = new Date();
  const values = {
    root_url: root,
    root_host: new URL(root).hostname,
    registrable_domain: scope.domain!,
    include_globs: JSON.stringify(scope.include),
    exclude_globs: JSON.stringify(scope.exclude),
    updated_at: now,
  };
  return db
    .insertInto('site_health_profiles')
    .values({
      id: randomUUID(),
      workspace_id: workspaceId,
      project_id: projectId,
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

/** Caller owns the transaction: workspace -> project -> capacity/account -> runtime -> profile. */
export async function createCrawl(db: Database, workspaceId: string, request: CreateCrawlRequest) {
  if (crawlSetting('advanced_controls_enabled') !== true)
    await db
      .selectFrom('workspaces')
      .select('id')
      .where('id', '=', workspaceId)
      .forShare()
      .executeTakeFirst();
  const project = await db
    .selectFrom('projects')
    .select('website_url')
    .where('workspace_id', '=', workspaceId)
    .where('id', '=', request.project_id)
    .forUpdate()
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
  const scope = {
    domain,
    include: normalizeGlobs(request.include_globs),
    exclude: normalizeGlobs(request.exclude_globs),
  };
  if (!classifyUrlAdmission(root, scope).accepted)
    crawlError('crawl root is not admissible', 'invalid_root');
  // The self-hosted operator always has the advanced crawl controls.
  const selected = controls(request, true);
  const seeds = [
    ...new Set(
      selected.seeds.map((url) => {
        const decision = classifyUrlAdmission(url, scope);
        if (!decision.accepted || !decision.url)
          crawlError('seed URL is not admissible', decision.reason ?? 'invalid_crawl_request');
        return decision.url;
      }),
    ),
  ];
  const runtime = await admissionRuntime(db, workspaceId);
  const requested =
    runtime.discovery_url_cap == null
      ? selected.limit
      : Math.min(selected.limit, runtime.discovery_url_cap);
  const profile = await refreshProfile(db, workspaceId, request.project_id, root, scope);
  const configuration = frozenConfiguration(scope, runtime, {
    ...selected,
    limit: requested,
    seeds,
  });
  if (runtime.discovery_mode !== 'sample') {
    const previous = await db
      .selectFrom('site_crawls')
      .selectAll()
      .where('workspace_id', '=', workspaceId)
      .where('project_id', '=', request.project_id)
      .where('sample_mode', '=', false)
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
    seed: request.seed,
    rerun: false,
  });
  const initial = (selected.mode === 'exact_urls' ? seeds : [root, ...seeds]).slice(0, requested);
  await Promise.all(
    [...new Set(initial)].map((url, position) =>
      enqueueCrawlTask(db, crawl, { kind: 'discover', url, position }),
    ),
  );
  await enqueueCrawlTask(db, crawl, {
    kind: 'site_setup',
    url: root,
    priority: policy.site_health.crawl.site_setup_priority_boost,
    position: -1,
  });
  await seedMonitored(db, crawl);
  if (selected.mode === 'auto') await addAutomaticRoot(db, crawl, runtime);
  await creationEvents(db, crawl);
  return crawl;
}

/** Project/runtime/profile are already locked by rerun admission; reuse that frozen scope. */
export async function createPageRerunCrawl(
  db: Database,
  workspaceId: string,
  projectId: string,
  profile: Profile,
  url: Selectable<SiteUrls>,
  runtime: Runtime,
) {
  const scope = {
    domain: profile.registrable_domain || undefined,
    include: strings(profile.include_globs),
    exclude: strings(profile.exclude_globs),
  };
  const decision = classifyUrlAdmission(url.normalized_url, scope);
  if (!decision.accepted)
    crawlError('page is not admissible for rerun', decision.reason ?? 'invalid_crawl_request');
  const configuration = {
    ...frozenConfiguration(scope, runtime, {
      mode: 'auto',
      limit: 1,
      seeds: [],
      kinds: [],
    }),
    // Marks a page re-read, which Changes never compares as a site crawl.
    page_rerun: true,
  };
  const crawl = await insertCrawl(db, {
    workspaceId,
    projectId,
    profileId: profile.id,
    root: profile.root_url || url.normalized_url,
    configuration,
    runtime,
    rerun: true,
  });
  await seedObservation(db, crawl, url, true);
  await enqueueCrawlTask(db, crawl, {
    kind: 'analyze',
    url: url.normalized_url,
    siteUrlId: url.id,
  });
  await creationEvents(db, crawl, url.id);
  return crawl;
}
