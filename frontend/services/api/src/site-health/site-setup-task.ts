import { sql } from 'kysely';
import { policy } from '../config.ts';
import { resolveSettingSpec, type SettingSource } from '../config/settings.ts';
import type { Database } from '../db/database.ts';
import { record } from '../db/json.ts';
import type { SiteTask } from '../queue/task-queue.ts';
import { robotsPolicy } from '../web-evidence/acquisition.ts';
import { crawlerRootFacts, crawlerSamplePolicy } from './crawler-policy.ts';
import {
  candidateObservation,
  enqueueCrawlTasks,
  insertObservations,
  insertSitemapEntries,
  upsertSiteUrls,
} from './admission-writes.ts';
import { probeHttpOrigin } from './http-origin.ts';
import { insertRobotsSnapshot } from './robots-snapshots.ts';
import { analyzeSeed, lockRuntime } from './frontier.ts';
import {
  logFetchFailure,
  walkSitemaps,
  type SitemapUrl,
  type SitemapWalk,
} from './sitemap-walk.ts';
import { fillTrackedSet, orderedUnique, trackedRoom } from './tracked-set.ts';
import {
  Abandoned,
  commitTask,
  loadScope,
  prepareTask,
  settleTask,
  type Crawl,
  type SiteTaskContext,
} from './site-task.ts';
import { canonicalIdentity } from './url-identity.ts';

const crawlPolicy = policy.site_health.crawl;
const INVENTORY_CHUNK = 1000;

export function setupSettings(env: SettingSource = process.env) {
  const spec = policy.site_health.settings;
  const number = (name: keyof typeof spec) => Number(resolveSettingSpec(spec[name], env));
  return {
    policySampleSize: number('robots_policy_sample_size'),
    snapshotBytes: number('robots_snapshot_max_bytes'),
    llmsBytes: number('llms_txt_max_decoded_bytes'),
    concurrency: Math.max(1, number('sitemap_fetch_concurrency')),
    maxDocuments: number('max_sitemap_documents'),
    maxSiteUrls: number('max_sitemap_urls'),
    walkRetries: number('sitemap_walk_retries'),
    walkRetryDelay: number('sitemap_walk_retry_delay_seconds'),
    sitemap: {
      maxDecodedBytes: number('max_sitemap_decoded_bytes'),
      maxUrls: number('max_sitemap_document_urls'),
      maxIndexDepth: number('max_sitemap_index_depth'),
    },
  };
}
type Settings = ReturnType<typeof setupSettings>;
type Robots = Awaited<ReturnType<SiteTaskContext['fetcher']['acquirer']['robots']>>;

function robotsStatus(robots: Robots | null) {
  if (robots?.body != null) return crawlPolicy.robots_statuses.fetched;
  if (robots?.restricted) return crawlPolicy.robots_statuses.access_blocked;
  if (!robots?.readable) return crawlPolicy.robots_statuses.fetch_failed;
  return crawlPolicy.robots_statuses.not_found;
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

async function siteEvidence(
  ctx: SiteTaskContext,
  origin: string,
  walks: boolean,
  settings: Settings,
) {
  const robots = origin ? await ctx.fetcher.acquirer.robots(origin) : null;
  const observedAt = new Date().toISOString();
  const llmsUrl = origin ? `${origin}${crawlPolicy.llms_path}` : '';
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
  const httpOrigin = await probeHttpOrigin(ctx, origin);
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
      http_origin: httpOrigin,
      sitemap: { fetched: false, file_count: 0, pending: true },
    },
  };
}
type SiteFacts = Record<string, unknown>;

async function observedIds(trx: Database, crawl: Crawl, hashes: string[]) {
  // One single-table lateral per probe (LIMIT 1 keeps each from flattening), so
  // no plan can drive from the crawl's observations: a new crawl has no
  // statistics, and a join inside one lateral scanned them per hash (quadratic).
  const { rows } = await sql<{ url_hash: string; id: string }>`
    select u.url_hash, u.id
    from unnest(${hashes}::text[]) as h(url_hash)
    cross join lateral (
      select s.id, s.url_hash from site_urls s
      where s.project_id = ${crawl.project_id} and s.url_hash = h.url_hash
        and s.workspace_id = ${crawl.workspace_id}
      limit 1
    ) u
    cross join lateral (
      select 1 from site_url_observations o
      where o.crawl_id = ${crawl.id} and o.site_url_id = u.id
        and o.workspace_id = ${crawl.workspace_id}
      limit 1
    ) o`.execute(trx);
  return new Map(rows.map((row) => [row.url_hash, row.id]));
}

async function saveSitemapInventory(ctx: SiteTaskContext, claimed: SiteTask, listed: SitemapUrl[]) {
  for (let offset = 0; offset < listed.length; offset += INVENTORY_CHUNK) {
    const chunk = listed.slice(offset, offset + INVENTORY_CHUNK);
    // NOSONAR: chunks commit in order, each under the task's lease.
    const committed = await commitTask(ctx, claimed, async (trx, lock) => {
      const { crawl } = await lock();
      if (crawl.discovery_status !== 'pending') return;
      const ids = await observedIds(
        trx,
        crawl,
        chunk.map(({ item }) => item.hash),
      );
      const fresh = chunk.filter(({ item }) => !ids.has(item.hash)).map(({ item }) => item);
      for (const [hash, id] of await upsertSiteUrls(trx, crawl, fresh)) ids.set(hash, id);
      const added = await insertObservations(
        trx,
        crawl,
        fresh.map((item) => candidateObservation(ids.get(item.hash)!, item, null)),
      );
      if (added > 0)
        await trx
          .updateTable('site_crawls')
          .set((eb) => ({
            admitted_url_count: eb('admitted_url_count', '+', added),
            updated_at: new Date(),
          }))
          .where('id', '=', crawl.id)
          .where('workspace_id', '=', crawl.workspace_id)
          .execute();
      await insertSitemapEntries(
        trx,
        crawl,
        chunk.map(({ item, lastmod }) => ({
          siteUrlId: ids.get(item.hash)!,
          listedUrl: item.url,
          lastmod,
        })),
      );
    });
    if (!committed) return false;
  }
  return true;
}

async function trackSitemapPages(ctx: SiteTaskContext, claimed: SiteTask, listed: SitemapUrl[]) {
  const ordered = orderedUnique(listed.map(({ item }) => item));
  for (let offset = 0; offset < ordered.length; offset += INVENTORY_CHUNK) {
    const window = ordered.slice(offset, offset + INVENTORY_CHUNK);
    let full = false;
    // NOSONAR: windows commit in order, each under the task's lease.
    const committed = await commitTask(ctx, claimed, async (trx, lock) => {
      const live = await loadScope(trx, claimed);
      if (live?.task.lease_owner !== ctx.owner) throw new Abandoned();
      const { crawl } = live;
      if (crawl.sample_mode || crawl.discovery_status !== 'pending') {
        full = true;
        return;
      }
      // Membership and task writes take the runtime lock first, in the Site Health lock order.
      await lockRuntime(trx, crawl.workspace_id);
      const { crawl: locked } = await lock();
      const joined = await fillTrackedSet(trx, locked, window);
      await enqueueCrawlTasks(
        trx,
        locked,
        joined.map(({ item, siteUrlId }) => analyzeSeed(siteUrlId, item)),
        'admit',
      );
      full = (await trackedRoom(trx, locked)) <= 0;
    });
    if (!committed) return false;
    if (full) break;
  }
  return true;
}

async function discover(
  trx: Database,
  crawl: Crawl,
  walk: SitemapWalk | null,
): Promise<{ discovered?: number; discoveryStatus?: 'completed' | 'running' }> {
  if (crawl.sample_mode || crawl.discovery_status !== 'pending') return {};
  if (walk?.listed.length) return { discovered: walk.discovered, discoveryStatus: 'completed' };
  if (walk?.unread) return { discoveryStatus: 'completed' };
  await enqueueCrawlTasks(
    trx,
    crawl,
    [{ kind: 'discover', url: crawl.root_url, hash: canonicalIdentity(crawl.root_url).hash }],
    'admit',
  );
  return { discoveryStatus: 'running' };
}

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

async function persist(
  ctx: SiteTaskContext,
  claimed: SiteTask,
  facts: SiteFacts,
  walk: SitemapWalk | null,
  settings: Settings,
) {
  const urls = walk?.listed.map(({ item }) => item.url) ?? [];
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
        // The inventory's size, not a sum: a reconcile between the inventory
        // chunks and this commit may already have counted these observations.
        admitted_url_count:
          discovery.discovered === undefined
            ? eb.ref('admitted_url_count')
            : sql<number>`greatest(${eb.ref('admitted_url_count')}, (select count(*)::int
              from site_url_observations where workspace_id = ${locked.crawl.workspace_id}
              and crawl_id = ${locked.crawl.id}))`,
        ...(discovery.discovered === undefined
          ? {}
          : { discovered_url_count: discovery.discovered }),
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
  if (!scope) return;
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
  const origin = URL.parse(task.requested_url)?.origin ?? '';
  const walks = Boolean(origin) && !crawl.sample_mode;
  let facts: SiteFacts;
  if (published) facts = published;
  else {
    const observed = await siteEvidence(ctx, origin, walks, settings);
    facts = observed.facts;
    const evidence = facts;
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
  if (walks) return walkThenPersist({ ctx, claimed, crawl, origin, facts, settings });
  await persist(ctx, claimed, facts, null, settings);
}

async function walkThenPersist(input: Parameters<typeof sitemapDiscovery>[0]) {
  const found = await sitemapDiscovery(input);
  if (found.kind === 'lost') return;
  if (found.kind === 'retry') return deferWalk(input.ctx, input.claimed, found);
  if (
    found.walk?.listed.length &&
    !(await trackSitemapPages(input.ctx, input.claimed, found.walk.listed))
  )
    return;
  await persist(input.ctx, input.claimed, found.facts, found.walk, input.settings);
}

async function deferWalk(
  ctx: SiteTaskContext,
  claimed: SiteTask,
  retry: { facts: SiteFacts; delaySeconds: number },
) {
  await commitTask(ctx, claimed, async (trx, lock) => {
    const { crawl, task } = await lock();
    await trx
      .updateTable('site_crawls')
      .set({ site_facts: JSON.stringify(retry.facts), updated_at: new Date() })
      .where('id', '=', crawl.id)
      .where('workspace_id', '=', crawl.workspace_id)
      .execute();
    await settleTask(trx, ctx, task, { kind: 'deferred', delaySeconds: retry.delaySeconds });
  });
}

async function sitemapDiscovery(input: {
  ctx: SiteTaskContext;
  claimed: SiteTask;
  crawl: Crawl;
  origin: string;
  facts: SiteFacts;
  settings: Settings;
}) {
  const { ctx, claimed, crawl, origin, settings } = input;
  const declared = record(input.facts.robots).sitemaps;
  const seeds =
    Array.isArray(declared) && declared.length
      ? declared.filter((url): url is string => typeof url === 'string')
      : crawlPolicy.sitemap_default_paths.map((path) => `${origin}${path}`);
  const walk = await walkSitemaps(ctx, crawl, seeds, settings);
  const pending = record(input.facts.sitemap);
  const retries = Number(pending.retries) || 0;
  if (walk.unread && crawl.discovery_status === 'pending' && retries < settings.walkRetries)
    return {
      kind: 'retry' as const,
      facts: { ...input.facts, sitemap: { ...pending, retries: retries + 1 } },
      delaySeconds: settings.walkRetryDelay * 2 ** retries,
    };
  if (
    crawl.discovery_status === 'pending' &&
    !(await saveSitemapInventory(ctx, claimed, walk.listed))
  )
    return { kind: 'lost' as const };
  const facts: SiteFacts = {
    ...input.facts,
    sitemap: {
      fetched: walk.fileCount > 0,
      file_count: walk.fileCount,
      discovered_count: walk.discovered,
      discovered_complete: walk.complete,
      limit_reached: walk.limitReached,
      unread_count: walk.unread,
      invalid_count: walk.invalidCount,
      invalid_documents: walk.invalid,
      ...(retries ? { retries } : {}),
    },
  };
  return { kind: 'walked' as const, walk, facts };
}
