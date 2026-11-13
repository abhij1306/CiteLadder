/**
 * The `site_setup` task, one per crawl: resolve robots and the AI-crawler
 * stance, probe llms.txt, and run a full crawl's discovery (SH-B5). It walks
 * the bounded sitemap tree, stores how many admissible URLs it lists (the
 * crawl's discovered count, a lower bound when a safety ceiling cut it short)
 * and fills the tracked set's free slots from them; a site without a sitemap
 * starts the HTML walk from the root instead. It commits twice. The root
 * analysis waits only on robots and llms.txt evidence, so those publish first
 * (with the sitemap marked pending); the walk and discovery land in a second
 * commit under the same lease. A reclaimed task whose facts are published but
 * still pending resumes at the walk.
 */
import { policy } from '../config.ts';
import { resolveSettingSpec, type SettingSource } from '../config/settings.ts';
import type { Database } from '../db/database.ts';
import { record } from '../db/json.ts';
import { failureFacts, getLogger } from '../logging.ts';
import type { SiteTask } from '../queue/task-queue.ts';
import { FetchError } from '../safe-fetch.ts';
import {
  SitemapCollector,
  SitemapParseError,
  sitemapRef,
  type SitemapDocument,
} from '../web-evidence/sitemaps.ts';
import { InterpretationTimeoutError, parseSitemapAsync } from './analysis/off-thread.ts';
import { robotsPolicy } from '../web-evidence/acquisition.ts';
import { crawlerRootFacts, crawlerSamplePolicy } from './crawler-policy.ts';
import { candidateObservation, enqueueCrawlTasks, insertObservations } from './admission-writes.ts';
import { insertRobotsSnapshot } from './robots-snapshots.ts';
import { analyzeSeed, candidate, crawlScope, lockRuntime, type Candidate } from './frontier.ts';
import { fillTrackedSet, trackedOrder } from './tracked-set.ts';
import {
  Abandoned,
  commitTask,
  loadScope,
  markRunning,
  prepareTask,
  settleTask,
  type Crawl,
  type SiteTaskContext,
} from './site-task.ts';
import { classifyUrlAdmission } from './url-admission.ts';
import { canonicalIdentity } from './url-identity.ts';

const crawlPolicy = policy.site_health.crawl;
const logger = getLogger('site_health.setup');

export function setupSettings(env: SettingSource = process.env) {
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

/**
 * A best-effort site document could not be fetched. A stop of the lease or
 * the drain is not a fetch failure: the task's commit re-checks it.
 */
function logFetchFailure(ctx: SiteTaskContext, phase: string, error: unknown, startedAt: number) {
  if (ctx.signal.aborted) return;
  logger.warning('site_health_document_fetch_failed', {
    phase,
    ...failureFacts(error),
    elapsed_ms: Math.round(performance.now() - startedAt),
  });
}

async function wellKnown(ctx: SiteTaskContext, url: string, settings: Settings) {
  const fetch = ctx.fetcher.settings.acquisition;
  const startedAt = performance.now();
  try {
    return await ctx.fetcher.acquirer.fetch(url, {
      signal: ctx.signal,
      maxBytes: settings.llmsBytes,
      maxDecodedBytes: settings.llmsBytes,
      timeoutSeconds: fetch.timeout,
      redirects: fetch.redirects,
      contentTypes: ['*'],
    });
  } catch (error) {
    // Unfetched stays distinct from absent: the llms.txt fact records `fetched: false`.
    logFetchFailure(ctx, 'llms_txt', error, startedAt);
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

/** A rate limit, timeout or server error says nothing about whether the document exists. */
const unavailableStatus = (status: number) => status === 408 || status === 429 || status >= 500;

/**
 * One sitemap document's read: its 2xx response; `absent` when the server
 * answered that it has none (a 4xx, or a response refused as no sitemap type);
 * `unread` when no answer settled it (no response, a timeout, a rate limit or
 * a server error), which is no evidence either way.
 */
type SitemapRead =
  | { kind: 'page'; page: Awaited<ReturnType<SiteTaskContext['fetcher']['acquirer']['fetch']>> }
  | { kind: 'absent' }
  | { kind: 'unread' };

async function sitemapDocument(
  ctx: SiteTaskContext,
  url: string,
  settings: Settings,
): Promise<SitemapRead> {
  const fetch = ctx.fetcher.settings.acquisition;
  const startedAt = performance.now();
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
    if (page.status >= 200 && page.status < 300) return { kind: 'page', page };
    return { kind: unavailableStatus(page.status) ? 'unread' : 'absent' };
  } catch (error) {
    // The walk counts the attempt against its budget and moves on to the next document.
    logFetchFailure(ctx, 'sitemap', error, startedAt);
    // A response that arrived and was refused (say, an HTML page) is the server's answer.
    const refused = error instanceof FetchError ? error.status : null;
    return { kind: refused !== null && !unavailableStatus(refused) ? 'absent' : 'unread' };
  }
}

/**
 * One sitemap document read and parsed off the event loop. A body that does
 * not parse is the server's answer that it serves no sitemap there (`absent`);
 * a parse that overran its time limit settled nothing (`unread`).
 */
type SitemapAnswer =
  | { kind: 'parsed'; document: SitemapDocument }
  | { kind: 'absent' }
  | { kind: 'unread' };

async function readSitemap(
  ctx: SiteTaskContext,
  url: string,
  settings: Settings,
): Promise<SitemapAnswer> {
  const read = await sitemapDocument(ctx, url, settings);
  if (read.kind !== 'page') return read;
  try {
    const { body, contentType } = read.page;
    return {
      kind: 'parsed',
      document: await parseSitemapAsync(body, contentType, settings.sitemap),
    };
  } catch (error) {
    if (error instanceof SitemapParseError) return { kind: 'absent' };
    if (error instanceof InterpretationTimeoutError) return { kind: 'unread' };
    throw error;
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
    unread: 0,
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
    const pages = await Promise.all(wave.map(({ url }) => readSitemap(ctx, url, settings))); // NOSONAR -- Waves are bounded and sequential: a wave's references feed the next one.
    ctx.signal.throwIfAborted();
    for (const [index, entry] of wave.entries()) collect(walk, entry, pages[index]);
  }
  const files = walk.files.slice(0, settings.maxDocuments);
  // A ceiling or a reference left unwalked makes the count a lower bound, as an unread document does.
  const limitReached = walk.queue.length > 0 || walk.collector.truncated;
  const complete = !limitReached && !walk.unread && files.length > 0;
  return {
    files,
    complete,
    limitReached,
    unread: walk.unread,
    ...admittedUrls(walk.collector, crawl, settings),
  };
}

type Walk = {
  collector: SitemapCollector;
  /** Documents read as sitemaps. */
  files: string[];
  queued: Set<string>;
  queue: { url: string; depth: number }[];
  /** Documents no answer settled: unfetched, timed out, rate-limited or failing. */
  unread: number;
};

/** Record one answer and queue its unseen child references. */
function collect(walk: Walk, { url, depth }: { url: string; depth: number }, read?: SitemapAnswer) {
  if (read?.kind !== 'parsed') {
    if (read?.kind !== 'absent') walk.unread++;
    return;
  }
  const refs = walk.collector.add(url, read.document, depth);
  walk.files.push(url);
  for (const ref of refs.filter((item) => !walk.queued.has(item))) {
    walk.queued.add(ref);
    walk.queue.push({ url: ref, depth: depth + 1 });
  }
}

/**
 * The collected URLs that pass the crawl's admission, canonical and unique:
 * how many there are (the crawl's discovered count), and the first
 * `max_sitemap_admitted_urls` of them in the tracked set's stable order as
 * candidates, each with its declared `<lastmod>`.
 */
function admittedUrls(collector: SitemapCollector, crawl: Crawl, settings: Settings) {
  const scope = crawlScope(crawl);
  const found = new Map<string, { item: Candidate; lastmod: string | undefined }>();
  for (const raw of collector.urls) {
    const admission = classifyUrlAdmission(raw, scope);
    if (!admission.accepted || !admission.url || found.has(admission.hash)) continue;
    found.set(admission.hash, {
      item: candidate(admission, {
        url: admission.url,
        hash: admission.hash,
        depth: 1,
        sourceKind: 'sitemap',
        parentPosition: 0,
        linkOrdinal: found.size,
      }),
      lastmod: collector.lastmod.get(raw),
    });
  }
  const kept = [...found.values()]
    .toSorted((a, b) => trackedOrder(a.item, b.item))
    .slice(0, settings.maxAdmitted);
  const lastmod: Record<string, string> = {};
  for (const { item, lastmod: declared } of kept) if (declared) lastmod[item.url] = declared;
  return { discovered: found.size, candidates: kept.map(({ item }) => item), lastmod };
}

/**
 * A sitemap fills the tracked set's free slots in the stable order and queues
 * the new pages' analysis; each joins the inventory as a sparse sitemap
 * sighting. Returns how many joined.
 */
async function trackSitemapPages(trx: Database, crawl: Crawl, candidates: Candidate[]) {
  const joined = await fillTrackedSet(trx, crawl, candidates);
  await insertObservations(
    trx,
    crawl,
    joined.map(({ item, siteUrlId }) => candidateObservation(siteUrlId, item, null)),
  );
  await enqueueCrawlTasks(
    trx,
    crawl,
    joined.map(({ item, siteUrlId }) => analyzeSeed(siteUrlId, item)),
    'admit',
  );
  return joined.length;
}

/**
 * Discovery after the walk: a sitemap that listed admissible URLs is the
 * crawl's discovery, its count stored and the tracked set filled from it; a
 * site without one starts the HTML walk from the root (SH-B5).
 */
async function discover(
  trx: Database,
  crawl: Crawl,
  walk: SitemapWalk | null,
): Promise<{ admitted?: number; discovered?: number; discoveryStatus?: 'completed' | 'running' }> {
  if (crawl.sample_mode || crawl.discovery_status !== 'pending') return {};
  if (walk?.candidates.length) {
    const admitted = await trackSitemapPages(trx, crawl, walk.candidates);
    return { admitted, discovered: walk.discovered, discoveryStatus: 'completed' };
  }
  await enqueueCrawlTasks(
    trx,
    crawl,
    [{ kind: 'discover', url: crawl.root_url, hash: canonicalIdentity(crawl.root_url).hash }],
    'admit',
  );
  return { discoveryStatus: 'running' };
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

type SitemapWalk = Awaited<ReturnType<typeof walkSitemaps>>;

/** The second commit: discovery, the resolved facts and the task outcome. */
async function persist(
  ctx: SiteTaskContext,
  claimed: SiteTask,
  facts: SiteFacts,
  walk: SitemapWalk | null,
  settings: Settings,
) {
  const urls = walk?.candidates.map((item) => item.url) ?? [];
  await commitTask(ctx, claimed, async (trx, lock) => {
    const live = await loadScope(trx, claimed);
    if (live?.task.lease_owner !== ctx.owner) throw new Abandoned();
    const { crawl } = live;
    // Membership and task writes take the runtime lock first, in the Site Health lock order.
    if (!crawl.sample_mode) await lockRuntime(trx, crawl.workspace_id);
    const discovery = await discover(trx, crawl, walk);
    const locked = await lock();
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
        admitted_url_count: eb('admitted_url_count', '+', discovery.admitted ?? 0),
        ...(discovery.discovered === undefined
          ? {}
          : { discovered_url_count: discovery.discovered }),
        // A crawl stopped meanwhile keeps its cancelled discovery.
        ...(discovery.discoveryStatus && locked.crawl.discovery_status === 'pending'
          ? { discovery_status: discovery.discoveryStatus }
          : {}),
        updated_at: new Date(),
      }))
      .where('id', '=', locked.crawl.id)
      .where('workspace_id', '=', locked.crawl.workspace_id)
      .execute();
    await settleTask(trx, ctx, locked.task, { kind: 'succeeded', artifactId: null });
  });
}

export async function runSiteSetup(
  ctx: SiteTaskContext,
  claimed: SiteTask,
  settings = setupSettings(),
) {
  const scope = await prepareTask(ctx, claimed);
  if (!scope || !(await markRunning(ctx, claimed))) return;
  const { crawl, task } = scope;
  const published = crawl.site_facts === null ? null : record(crawl.site_facts);
  const resuming = record(published?.sitemap).pending === true;
  if (published && !resuming) {
    await commitTask(ctx, claimed, async (trx, lock) => {
      const held = await lock();
      await settleTask(trx, ctx, held.task, { kind: 'succeeded', artifactId: null });
    });
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
    const committed = await commitTask(ctx, claimed, async (trx, lock) => {
      const { crawl: locked } = await lock();
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
  let walk: SitemapWalk | null = null;
  if (walks) {
    const declared = record(facts.robots).sitemaps;
    const seeds =
      Array.isArray(declared) && declared.length
        ? declared.filter((url): url is string => typeof url === 'string')
        : crawlPolicy.sitemap_default_paths.map((path) => `${origin}${path}`);
    walk = await walkSitemaps(ctx, crawl, seeds, settings);
    facts = {
      ...facts,
      sitemap: {
        fetched: walk.files.length > 0,
        files: walk.files,
        urls: walk.candidates.map((item) => item.url),
        lastmod: walk.lastmod,
        // "Discovered N", or "at least N" when a safety ceiling or an unread document cut it short.
        discovered_count: walk.discovered,
        discovered_complete: walk.complete,
        limit_reached: walk.limitReached,
        // Documents no answer settled: without a read one, "No sitemap" stays unknown.
        unread_count: walk.unread,
      },
    };
  }
  await persist(ctx, claimed, facts, walk, settings);
}
