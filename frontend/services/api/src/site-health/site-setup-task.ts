/**
 * The `site_setup` task, one per crawl: resolve robots and the AI-crawler
 * stance, probe llms.txt, walk the bounded sitemap tree, and admit its URLs.
 * It commits twice. The root analysis waits only on robots and llms.txt
 * evidence, so those publish first (with the sitemap marked pending); the
 * walk and its admission land in a second commit under the same lease. A
 * reclaimed task whose facts are published but still pending resumes at the walk.
 */
import { randomUUID } from 'node:crypto';

import { policy, resolveSettingSpec } from '../config.ts';
import type { Database } from '../db/database.ts';
import { record } from '../db/json.ts';
import type { SiteTask } from '../queue/task-queue.ts';
import { SitemapCollector, SitemapParseError, sitemapRef } from '../web-evidence/sitemaps.ts';
import { robotsPolicy } from '../web-evidence/acquisition.ts';
import { crawlerRootFacts, crawlerSamplePolicy } from './crawler-policy.ts';
import { insertRobotsSnapshot } from './robots-snapshots.ts';
import { admitCandidates, candidate, crawlScope, lockRuntime, type Candidate } from './frontier.ts';
import {
  Abandoned,
  ACTIVE_CRAWL,
  loadScope,
  lockRunningTask,
  markRunning,
  prepareTask,
  settleTask,
  type SiteTaskContext,
} from './site-task.ts';
import type { Crawl } from './task-fence.ts';
import { classifyUrlAdmission } from './url-admission.ts';
import { canonicalIdentity } from './url-identity.ts';

const crawlPolicy = policy.site_health.crawl;

export function setupSettings(env: Record<string, string | undefined> = process.env) {
  const spec = policy.site_health.settings;
  const number = (name: keyof typeof spec) => Number(resolveSettingSpec(spec[name], env));
  return {
    policySampleSize: number('robots_policy_sample_size'),
    snapshotBytes: number('robots_snapshot_max_bytes'),
    llmsBytes: number('llms_txt_max_decoded_bytes'),
    maxDocuments: number('max_sitemap_documents'),
    concurrency: Math.max(1, number('sitemap_fetch_concurrency')),
    maxAdmitted: number('max_sitemap_admitted_urls'),
    batch: Math.max(1, number('admission_batch_size')),
    sitemap: {
      maxDecodedBytes: number('max_sitemap_decoded_bytes'),
      maxUrls: number('max_sitemap_urls'),
      maxIndexDepth: number('max_sitemap_index_depth'),
    },
  };
}
type Settings = ReturnType<typeof setupSettings>;
type Robots = Awaited<ReturnType<SiteTaskContext['fetcher']['acquirer']['robots']>>;

/** How the robots.txt response reads in the dashboard: a missing file is not a failure. */
function robotsStatus(robots: Robots | null) {
  if (robots?.body != null) return crawlPolicy.robots_statuses.fetched;
  if (robots?.restricted) return crawlPolicy.robots_statuses.access_blocked;
  // Unreachable, rate-limited, failing or unresolved redirects pause the crawl; other 4xx is a missing file.
  if (!robots?.readable) return crawlPolicy.robots_statuses.fetch_failed;
  return crawlPolicy.robots_statuses.not_found;
}

async function wellKnown(ctx: SiteTaskContext, url: string, settings: Settings) {
  const fetch = ctx.fetcher.settings.acquisition;
  try {
    return await ctx.fetcher.acquirer.fetch(url, {
      signal: ctx.signal,
      maxBytes: settings.llmsBytes,
      maxDecodedBytes: settings.llmsBytes,
      timeoutSeconds: fetch.timeout,
      redirects: fetch.redirects,
      contentTypes: ['*'],
    });
  } catch {
    return null;
  }
}

/** The facts the root analysis waits on; the sitemap section is dashboard evidence only. */
async function siteEvidence(
  ctx: SiteTaskContext,
  origin: string,
  walks: boolean,
  settings: Settings,
) {
  const robots = origin ? await ctx.fetcher.acquirer.robots(origin) : null;
  const observedAt = new Date().toISOString();
  const llmsUrl = origin ? `${origin}${crawlPolicy.llms_path}` : '';
  // A sample crawl ingests no sitemap, so it makes no llms.txt request it would not act on.
  const llms = { fetched: false, url: llmsUrl, status_code: null as number | null, present: false };
  if (walks && llmsUrl && robots?.permits(llmsUrl) !== false) {
    const page = await wellKnown(ctx, llmsUrl, settings);
    if (page) {
      llms.fetched = true;
      llms.status_code = page.status;
      llms.present =
        page.status >= 200 && page.status < 300 && page.body.toString('utf8').trim() !== '';
    }
  }
  return {
    body: robots?.body ?? null,
    facts: {
      robots: {
        observed_at: observedAt,
        fetched: robots?.body != null,
        status: robotsStatus(robots),
        url: origin ? `${origin}${crawlPolicy.robots_path}` : '',
        status_code: robots?.status || null,
        catalog_version: policy.crawlers.catalog_version,
        robots_snapshot_id: null as string | null,
        bots: crawlerRootFacts(robots ?? robotsPolicy(origin, 0, ''), origin),
        sitemaps: (robots?.sitemaps ?? []).slice(0, crawlPolicy.max_declared_sitemaps),
      },
      llms_txt: llms,
      sitemap: { fetched: false, files: [] as string[], pending: true },
    },
  };
}
type SiteFacts = Record<string, unknown>;

async function sitemapDocument(ctx: SiteTaskContext, url: string, settings: Settings) {
  const fetch = ctx.fetcher.settings.acquisition;
  try {
    const page = await ctx.fetcher.acquirer.fetch(url, {
      signal: ctx.signal,
      maxBytes: settings.sitemap.maxDecodedBytes,
      maxDecodedBytes: settings.sitemap.maxDecodedBytes,
      timeoutSeconds: fetch.timeout,
      redirects: fetch.redirects,
      contentTypes: crawlPolicy.sitemap_content_types,
      // Sitemaps may live off-scope, but never at a non-content endpoint.
      admit: (hop) => {
        if (!classifyUrlAdmission(hop.href, { infrastructure: 'sitemap' }).accepted)
          throw new Error('sitemap URL rejected by admission policy');
      },
    });
    return page.status >= 200 && page.status < 300 ? page : null;
  } catch {
    return null;
  }
}

/**
 * Walk the sitemap tree breadth-first in bounded concurrent waves, counting
 * attempts (not successes) against the document budget. Each wave is consumed
 * in queue order, so response timing cannot change which URLs fit the cap.
 */
async function walkSitemaps(
  ctx: SiteTaskContext,
  crawl: Crawl,
  seeds: string[],
  settings: Settings,
) {
  const walk: Walk = {
    collector: new SitemapCollector(settings.sitemap),
    files: [],
    queued: new Set(
      seeds.flatMap((seed) =>
        seed.length <= crawlPolicy.max_url_chars ? (sitemapRef(seed) ?? []) : [],
      ),
    ),
    queue: [],
  };
  walk.queue = [...walk.queued].map((url) => ({ url, depth: 0 }));
  let attempted = 0;
  // A full collector cannot gain a URL from any further document.
  while (
    walk.queue.length &&
    attempted < settings.maxDocuments &&
    walk.collector.urls.length < settings.sitemap.maxUrls
  ) {
    const wave = walk.queue.splice(
      0,
      Math.min(settings.concurrency, settings.maxDocuments - attempted),
    );
    attempted += wave.length;
    // Waves are bounded and sequential: a wave's references feed the next one.
    const pages = await Promise.all(wave.map(({ url }) => sitemapDocument(ctx, url, settings))); // NOSONAR
    ctx.signal?.throwIfAborted();
    for (const [index, entry] of wave.entries()) collect(walk, entry, pages[index] ?? null);
  }
  return {
    files: walk.files.slice(0, settings.maxDocuments),
    ...admittedUrls(walk.collector, crawl, settings),
  };
}

type Walk = {
  collector: SitemapCollector;
  files: string[];
  queued: Set<string>;
  queue: { url: string; depth: number }[];
};

/** Record one fetched document and queue its unseen child references. */
function collect(
  walk: Walk,
  { url, depth }: { url: string; depth: number },
  page: Awaited<ReturnType<typeof sitemapDocument>>,
) {
  if (!page) return;
  walk.files.push(url);
  let refs: string[] = [];
  try {
    refs = walk.collector.add(url, page.body, page.contentType, depth);
  } catch (error) {
    if (!(error instanceof SitemapParseError)) throw error;
  }
  for (const ref of refs.filter((item) => !walk.queued.has(item))) {
    walk.queued.add(ref);
    walk.queue.push({ url: ref, depth: depth + 1 });
  }
}

/**
 * The collected URLs that pass the crawl's admission, canonical and unique, up
 * to the cap, with each admitted URL's declared `<lastmod>`.
 */
function admittedUrls(collector: SitemapCollector, crawl: Crawl, settings: Settings) {
  const scope = crawlScope(crawl);
  const urls: string[] = [];
  const lastmod: Record<string, string> = {};
  const seen = new Set<string>();
  for (const raw of collector.urls) {
    if (urls.length >= settings.maxAdmitted) break;
    const admission = classifyUrlAdmission(raw, scope);
    if (!admission.accepted || !admission.url || seen.has(admission.hash)) continue;
    seen.add(admission.hash);
    urls.push(admission.url);
    const declared = collector.lastmod.get(raw);
    if (declared) lastmod[admission.url] = declared;
  }
  return { urls, lastmod };
}

/** Sitemap URLs as depth-1 candidates in sitemap document order. */
function sitemapCandidates(urls: string[]): Candidate[] {
  return urls.flatMap((url, ordinal) => {
    let identity: { url: string; hash: string };
    try {
      identity = canonicalIdentity(url);
    } catch {
      return [];
    }
    return [
      candidate(classifyUrlAdmission(identity.url), {
        url: identity.url,
        hash: identity.hash,
        depth: 1,
        sourceKind: 'sitemap',
        parentPosition: 0,
        linkOrdinal: ordinal,
      }),
    ];
  });
}

/**
 * Sparse observations so a sitemap-only URL is visible to the inventory
 * before its own discover task runs; a richer discovery observation wins.
 */
async function observeSitemapUrls(
  trx: Database,
  crawl: Crawl,
  candidates: Candidate[],
  siteUrlIds: Map<string, string>,
  settings: Settings,
) {
  const now = new Date();
  const rows = candidates.flatMap((item) => {
    const siteUrlId = siteUrlIds.get(item.hash);
    return siteUrlId
      ? [
          {
            id: randomUUID(),
            workspace_id: crawl.workspace_id,
            project_id: crawl.project_id,
            crawl_id: crawl.id,
            site_url_id: siteUrlId,
            source_kind: 'sitemap',
            value_kind: 'other',
            value_priority: 0,
            rewrite_reason: '',
            rewrite_version: '',
            depth: item.depth,
            observed_url: item.url,
            final_url: item.url,
            content_type: '',
            title: '',
            created_at: now,
          },
        ]
      : [];
  });
  for (let offset = 0; offset < rows.length; offset += settings.batch)
    await trx // NOSONAR: batches bound each insert's bind parameters, in order in one transaction.
      .insertInto('site_url_observations')
      .values(rows.slice(offset, offset + settings.batch))
      .onConflict((conflict) => conflict.columns(['crawl_id', 'site_url_id']).doNothing())
      .execute();
}

/** Run `body` inside a transaction that holds crawl and task; false when the lease or crawl was lost. */
function underLease(
  ctx: SiteTaskContext,
  claimed: SiteTask,
  body: (trx: Database, crawl: Crawl, task: SiteTask) => Promise<void>,
): Promise<boolean> {
  return ctx.db
    .transaction()
    .execute(async (trx) => {
      ctx.signal?.throwIfAborted();
      const locked = await lockRunningTask(trx, claimed, ctx.owner);
      if (!locked || !ACTIVE_CRAWL.has(locked.crawl.status)) throw new Abandoned();
      await body(trx, locked.crawl, locked.task);
      ctx.signal?.throwIfAborted();
      return true;
    })
    .catch((error: unknown) => {
      if (error instanceof Abandoned) return false;
      throw error;
    });
}

/** Same-origin known URLs, root first: sitemap URLs, then those the crawl has observed. */
async function policySample(
  trx: Database,
  crawl: Crawl,
  origin: string,
  urls: string[],
  size: number,
) {
  const sample = new Set([`${origin}/`]);
  const add = (values: Iterable<string>) => {
    for (const url of values) {
      if (sample.size >= size) return;
      if (URL.parse(url)?.origin === origin) sample.add(url);
    }
  };
  add(urls);
  if (sample.size < size) {
    const discovered = await trx
      .selectFrom('site_url_observations')
      .select('final_url')
      .where('workspace_id', '=', crawl.workspace_id)
      .where('crawl_id', '=', crawl.id)
      .orderBy('created_at')
      .orderBy('id')
      .limit(size)
      .execute();
    add(discovered.map((row) => row.final_url));
  }
  return [...sample].slice(0, size);
}

/** The second commit: sitemap admission, the resolved facts and the task outcome. */
async function persist(
  ctx: SiteTaskContext,
  claimed: SiteTask,
  facts: SiteFacts,
  urls: string[],
  settings: Settings,
) {
  await ctx.db
    .transaction()
    .execute(async (trx) => {
      const live = await loadScope(trx, claimed);
      if (live?.task.lease_owner !== ctx.owner) throw new Abandoned();
      const { crawl } = live;
      let admitted = 0;
      const exact = record(crawl.configuration).input_mode === 'exact_urls';
      if (urls.length && !crawl.sample_mode && !exact) {
        const runtime = await lockRuntime(trx, crawl.workspace_id);
        const candidates = sitemapCandidates(urls);
        const admission = await admitCandidates(trx, crawl, candidates, runtime);
        await observeSitemapUrls(trx, crawl, candidates, admission.siteUrlIds, settings);
        admitted = admission.admitted;
      }
      const locked = await lockRunningTask(trx, claimed, ctx.owner);
      if (!locked || !ACTIVE_CRAWL.has(locked.crawl.status)) throw new Abandoned();
      const { pending: _pending, ...sitemap } = record(facts.sitemap);
      const robots = record(facts.robots);
      const snapshot = crawl.robots_snapshot_id
        ? await trx
            .selectFrom('robots_snapshots')
            .select(['body', 'truncated'])
            .where('workspace_id', '=', crawl.workspace_id)
            .where('project_id', '=', crawl.project_id)
            .where('id', '=', crawl.robots_snapshot_id)
            .executeTakeFirst()
        : undefined;
      const origin = new URL(crawl.root_url).origin;
      const sample = await policySample(trx, crawl, origin, urls, settings.policySampleSize);
      const parsed = robotsPolicy(origin, Number(robots.status_code ?? 0), snapshot?.body ?? '');
      const tokens = new Map(policy.crawlers.bots.map((bot) => [bot.bot_id, bot.robots_tokens]));
      // Root access and the matched group were published in commit one and stay frozen.
      const bots = (Array.isArray(robots.bots) ? robots.bots.map(record) : []).map((bot) => ({
        ...bot,
        ...crawlerSamplePolicy(
          parsed,
          tokens.get(String(bot.bot_id)) ?? [],
          tokens.has(String(bot.bot_id)) ? sample : [],
          snapshot?.truncated,
        ),
      }));
      await trx
        .updateTable('site_crawls')
        .set((eb) => ({
          site_facts: JSON.stringify({ ...facts, sitemap, robots: { ...robots, bots } }),
          admitted_url_count: eb('admitted_url_count', '+', admitted),
          updated_at: new Date(),
        }))
        .where('id', '=', locked.crawl.id)
        .where('workspace_id', '=', locked.crawl.workspace_id)
        .execute();
      await settleTask(trx, ctx, locked.task, { succeeded: true, artifactId: null });
    })
    .catch((error: unknown) => {
      if (!(error instanceof Abandoned)) throw error;
    });
}

export async function runSiteSetup(
  ctx: SiteTaskContext,
  claimed: SiteTask,
  settings = setupSettings(),
) {
  const scope = await prepareTask(ctx, claimed);
  if (!scope || !(await markRunning(ctx.db, scope.task, ctx.owner))) return;
  const { crawl, task } = scope;
  const published = crawl.site_facts === null ? null : record(crawl.site_facts);
  const resuming = record(published?.sitemap).pending === true;
  if (published && !resuming) {
    await underLease(ctx, claimed, (trx, _crawl, locked) =>
      settleTask(trx, ctx, locked, { succeeded: true, artifactId: null }),
    );
    return;
  }
  let origin = '';
  try {
    origin = new URL(task.requested_url).origin;
  } catch {
    origin = '';
  }
  const walks = Boolean(origin) && !crawl.sample_mode;
  let facts: SiteFacts;
  if (published) facts = published;
  else {
    const observed = await siteEvidence(ctx, origin, walks, settings);
    facts = observed.facts;
    const evidence = facts;
    // Commit one: the root page's wait clears here, before the walk.
    const committed = await underLease(ctx, claimed, async (trx, locked) => {
      const snapshot =
        origin && observed.body !== null
          ? await insertRobotsSnapshot(
              trx,
              locked,
              origin,
              observed.body,
              observed.facts.robots.status_code,
              settings.snapshotBytes,
            )
          : null;
      observed.facts.robots.robots_snapshot_id = snapshot?.id ?? null;
      await trx
        .updateTable('site_crawls')
        .set({
          site_facts: JSON.stringify(evidence),
          robots_snapshot_id: snapshot?.id ?? null,
          robots_observed_at: new Date(observed.facts.robots.observed_at),
          updated_at: new Date(),
        })
        .where('id', '=', locked.id)
        .where('workspace_id', '=', locked.workspace_id)
        .execute();
    });
    if (!committed) return;
  }
  let urls: string[] = [];
  if (walks) {
    const declared = record(facts.robots).sitemaps;
    const seeds =
      Array.isArray(declared) && declared.length
        ? declared.filter((url): url is string => typeof url === 'string')
        : crawlPolicy.sitemap_default_paths.map((path) => `${origin}${path}`);
    const walk = await walkSitemaps(ctx, crawl, seeds, settings);
    urls = walk.urls;
    facts = {
      ...facts,
      sitemap: { fetched: walk.files.length > 0, files: walk.files, urls, lastmod: walk.lastmod },
    };
  }
  await persist(ctx, claimed, facts, urls, settings);
}
