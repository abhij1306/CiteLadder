/**
 * The `discover` task: acquire one page under the crawl's scope, extract its
 * in-scope links and bounded facts from one parse, and commit the artifact,
 * the URL's observation, the admitted frontier and the page's disposition
 * (document, canonical alias, or a page to analyze) with the task outcome.
 * Network I/O happens outside the transaction; the commit takes the runtime
 * lock before the crawl and task, and writes nothing if the lease or crawl
 * was lost meanwhile.
 */
import { policy } from '../config.ts';
import type { Database } from '../db/database.ts';
import { record } from '../db/json.ts';
import type { FetchedPage } from '../safe-fetch.ts';
import type { SiteTask } from '../queue/task-queue.ts';
import { factSettings, type PageFacts } from './analysis/facts.ts';
import { discoverAsync } from './analysis/off-thread.ts';
import type { DiscoveredLink } from './discovery-links.ts';
import { insertObservations, upsertSiteUrls } from './admission-writes.ts';
import { writeArtifact, writeAttempts, type AttemptOutcome } from './analysis-rows.ts';
import { duplicateOf, markDuplicates } from './canonical-alias.ts';
import {
  admitCandidates,
  candidate,
  crawlScope,
  enqueueDiscoveredAnalysis,
  lockRuntime,
  markInventoryDocument,
  releaseNonPage,
  type Candidate,
} from './frontier.ts';
import { isBotBlock } from './page-fetch.ts';
import {
  Abandoned,
  commitTask,
  finalFailure,
  httpError,
  loadScope,
  markRunning,
  prepareTask,
  recordCrawlEvent,
  settleTask,
  type Crawl,
  type SiteTaskContext,
} from './site-task.ts';
import { taskOutcome } from './task-outcome.ts';
import { classifyUrlAdmission, hardExcluded } from './url-admission.ts';
import { canonicalIdentity } from './url-identity.ts';

const crawlPolicy = policy.site_health.crawl;
const acquisition = policy.site_health.page_analysis.acquisition;
const DOCUMENT_TYPES = new Set(crawlPolicy.document_media_types);

type Discovery = { title: string; links: DiscoveredLink[] };
type Outcome = AttemptOutcome & {
  page: FetchedPage | null;
  discovery: Discovery | null;
  facts: PageFacts | null;
  retryable: boolean;
  errorDetail: string;
};

async function acquire(ctx: SiteTaskContext, crawl: Crawl, task: SiteTask): Promise<Outcome> {
  const scope = crawlScope(crawl);
  const fetched = await ctx.fetcher.fetch(task.requested_url, {
    signal: ctx.signal,
    // Redirects may not leave the crawl's scope any more than links may.
    admit: scope.domain
      ? (hop) => classifyUrlAdmission(hop.href, scope).accepted
      : (hop) => !hardExcluded(hop),
    contentTypes: [...acquisition.html_content_types, ...crawlPolicy.document_media_types],
  });
  const empty = { page: null, discovery: null, facts: null };
  if (!fetched.ok)
    return {
      ...empty,
      succeeded: false,
      errorCode: fetched.code,
      errorDetail: fetched.detail,
      retryable: fetched.retryable,
      statusCode: null,
      latencyMs: fetched.latencyMs,
      calls: fetched.calls,
    };
  const { page } = fetched;
  const common = {
    page,
    statusCode: page.status,
    latencyMs: fetched.latencyMs,
    calls: fetched.calls,
  };
  const failure = isBotBlock(page)
    ? ([acquisition.error_codes.bot_blocked, false] as const)
    : httpError(page.status);
  if (failure)
    return {
      ...empty,
      ...common,
      succeeded: false,
      errorCode: failure[0],
      errorDetail: '',
      retryable: failure[1],
    };
  const success = { ...common, succeeded: true, errorCode: '', errorDetail: '', retryable: false };
  if (DOCUMENT_TYPES.has(page.contentType))
    return { ...success, discovery: { title: '', links: [] }, facts: null };
  // One parse, off the event loop: discovery reads every anchor of the whole
  // document before fact extraction bounds it.
  const { discovery, facts } = await discoverAsync(
    page.body,
    {
      finalUrl: page.url,
      contentType: page.contentType,
      charset: page.charset,
      statusCode: page.status,
      headers: page.headers,
      httpVersion: page.httpVersion,
      ttfbMs: page.ttfbMs,
      latencyMs: fetched.latencyMs,
      wireBytes: page.wireBytes,
      decodedBytes: page.body.length,
    },
    factSettings(),
    scope,
  );
  return { ...success, discovery, facts };
}

/**
 * The fetched URL's latest state. Written after admission, whose upsert of
 * the root's own candidate would otherwise reset it to `running`.
 */
async function refreshFetchedUrl(
  trx: Database,
  crawl: Crawl,
  task: SiteTask,
  page: FetchedPage,
  discovery: Discovery,
) {
  await trx
    .updateTable('site_urls')
    .set({
      latest_title: discovery.title,
      latest_content_type: page.contentType.slice(0, 128),
      last_seen_crawl_id: crawl.id,
      discovery_status: 'completed',
    })
    .where('workspace_id', '=', crawl.workspace_id)
    .where('project_id', '=', crawl.project_id)
    .where('url_hash', '=', canonicalIdentity(task.requested_url).hash)
    .execute();
}

/** The fetched URL's identity and its observation, before admission adds sparse ones. */
async function writeObservation(
  trx: Database,
  crawl: Crawl,
  task: SiteTask,
  page: FetchedPage,
  discovery: Discovery,
  artifactId: string,
) {
  const siteUrlId = await siteUrlFor(trx, crawl, task);
  await insertObservation(trx, crawl, task, siteUrlId, {
    artifactId,
    finalUrl: page.url,
    statusCode: page.status,
    contentType: page.contentType,
    title: discovery.title,
  });
  return siteUrlId;
}

/**
 * The task URL's identity. An admitted task names the one its admission wrote
 * in this crawl. A planner seed names none: its discover is the crawl's
 * sighting of the URL, recorded like any admission's (a seed seen again in a
 * later crawl has its identity refreshed for this crawl).
 */
async function siteUrlFor(trx: Database, crawl: Crawl, task: SiteTask) {
  if (task.site_url_id) return task.site_url_id;
  const identity = canonicalIdentity(task.requested_url);
  const item = candidate(classifyUrlAdmission(task.requested_url), {
    url: identity.url,
    hash: identity.hash,
    depth: task.depth,
    sourceKind: task.depth === 0 ? 'root' : 'link',
    parentPosition: 0,
    linkOrdinal: 0,
  });
  return (await upsertSiteUrls(trx, crawl, [item])).get(identity.hash)!;
}

/** The task's observation of its URL in this crawl, with the frontier's rewrite provenance. */
async function insertObservation(
  trx: Database,
  crawl: Crawl,
  task: SiteTask,
  siteUrlId: string,
  fetched: {
    artifactId: string | null;
    finalUrl: string;
    statusCode: number | null;
    contentType: string;
    title: string;
  },
) {
  const admission = classifyUrlAdmission(task.requested_url);
  const rewrite = await trx
    .selectFrom('site_discovery_frontier')
    .where('workspace_id', '=', crawl.workspace_id)
    .select(['rewrite_reason', 'rewrite_version'])
    .where('crawl_id', '=', crawl.id)
    .where('url_hash', '=', task.url_hash)
    .executeTakeFirst();
  await insertObservations(trx, crawl, [
    {
      siteUrlId,
      sourceKind: task.depth === 0 ? 'root' : 'link',
      valueKind: admission.valueKind,
      valuePriority: admission.priority,
      rewriteReason: rewrite?.rewrite_reason ?? '',
      rewriteVersion: rewrite?.rewrite_version ?? '',
      depth: task.depth,
      observedUrl: task.requested_url,
      finalUrl: fetched.finalUrl,
      artifactId: fetched.artifactId,
      parentSiteUrlId: task.parent_site_url_id,
      statusCode: fetched.statusCode,
      contentType: fetched.contentType,
      title: fetched.title,
    },
  ]);
}

/**
 * A URL whose fetch failed for good is still part of the crawl: observe it
 * with its status and the page that linked it, so it lists as an error with
 * its source. The root's failure is the crawl's own, and a URL the crawl's
 * policy excluded is not an error. Either way the URL's discovery is settled
 * `failed`, as a fetched URL's is settled `completed`.
 */
async function observeFailure(trx: Database, crawl: Crawl, task: SiteTask, outcome: Outcome) {
  const root = canonicalIdentity(crawl.root_url).hash === task.url_hash;
  if (!root && taskOutcome(outcome) !== 'excluded')
    await observeFailedUrl(trx, crawl, task, outcome);
  await trx
    .updateTable('site_urls')
    .set({ discovery_status: 'failed' })
    .where('workspace_id', '=', crawl.workspace_id)
    .where('project_id', '=', crawl.project_id)
    .where('url_hash', '=', canonicalIdentity(task.requested_url).hash)
    .execute();
}
async function observeFailedUrl(trx: Database, crawl: Crawl, task: SiteTask, outcome: Outcome) {
  const siteUrlId = await siteUrlFor(trx, crawl, task);
  if (!task.site_url_id) {
    // The failed task is the row's status, so it must name the identity it failed for.
    await trx
      .updateTable('site_crawl_tasks')
      .set({ site_url_id: siteUrlId })
      .where('id', '=', task.id)
      .where('workspace_id', '=', crawl.workspace_id)
      .execute();
  }
  await insertObservation(trx, crawl, task, siteUrlId, {
    artifactId: null,
    finalUrl: outcome.page?.url ?? task.requested_url,
    statusCode: outcome.statusCode,
    contentType: outcome.page?.contentType ?? '',
    title: '',
  });
}

/**
 * The page's links as frontier candidates, each naming this page as its
 * referrer. The root also admits itself: a sample's allowance is filled from
 * admitted identities, and the root has no inventory row before its first fetch.
 */
function candidatesFor(
  task: SiteTask,
  discovery: Discovery,
  options: { exact: boolean; referrerId: string | null },
): Candidate[] {
  if (options.exact) return [];
  const links = discovery.links.map((link) =>
    candidate(link.admission, {
      url: link.admission.url,
      hash: link.admission.hash,
      depth: task.depth + 1,
      sourceKind: 'link',
      parentPosition: 0,
      linkOrdinal: link.ordinal,
      rewriteReason: link.rewriteReason,
      rewriteVersion: link.rewriteVersion,
      referrerId: options.referrerId,
    }),
  );
  if (task.depth !== 0) return links;
  const root = candidate(classifyUrlAdmission(task.requested_url), {
    url: task.requested_url,
    hash: canonicalIdentity(task.requested_url).hash,
    depth: 0,
    sourceKind: 'root',
    parentPosition: -1,
    linkOrdinal: -1,
  });
  return [...links, root];
}

/** A document is inventory, an alias of an active page is excluded, anything else is analyzed. */
async function dispose(
  trx: Database,
  crawl: Crawl,
  task: SiteTask,
  page: FetchedPage,
  facts: PageFacts | null,
) {
  const isDocument = DOCUMENT_TYPES.has(page.contentType);
  if (isDocument) await markInventoryDocument(trx, crawl, task.url_hash);
  const declared = typeof facts?.canonical_url === 'string' ? facts.canonical_url : '';
  const alias = await duplicateOf(trx, crawl, {
    hash: task.url_hash,
    declaredCanonical: declared,
    baseUrl: page.url || task.requested_url,
  });
  if (alias) await markDuplicates(trx, crawl, [task.url_hash]);
  else if (!isDocument)
    await enqueueDiscoveredAnalysis(trx, crawl, {
      siteUrlId: task.site_url_id,
      url: task.requested_url,
      hash: task.url_hash,
      depth: task.depth,
      priority: task.priority,
      parentSiteUrlId: task.parent_site_url_id,
    });
}

async function persist(ctx: SiteTaskContext, claimed: SiteTask, outcome: Outcome) {
  await commitTask(ctx, claimed, async (trx, lock) => {
    const live = await loadScope(trx, claimed);
    if (live?.task.lease_owner !== ctx.owner) throw new Abandoned();
    const { crawl, task } = live;
    let artifactId: string | null = null;
    let admitted = 0;
    let sampleCapped = false;
    const { page, discovery } = outcome;
    if (page && discovery) {
      // First rung of the lock DAG, before any URL write or frontier admission.
      const runtime = await lockRuntime(trx, crawl.workspace_id);
      artifactId = await writeArtifact(trx, crawl, task, page, outcome.facts, {
        policyVersion: ctx.fetcher.settings.policyVersion,
        latencyMs: outcome.latencyMs ?? 0,
        purpose: 'discover',
      });
      const referrerId = await writeObservation(trx, crawl, task, page, discovery, artifactId);
      const exact = record(crawl.configuration).input_mode === 'exact_urls';
      const admission = await admitCandidates(
        trx,
        crawl,
        candidatesFor(task, discovery, { exact, referrerId }),
        runtime,
        { enqueueChildren: !exact, sourceArtifactId: artifactId },
      );
      admitted = admission.admitted;
      sampleCapped = admission.sampleCapped;
      await refreshFetchedUrl(trx, crawl, task, page, discovery);
      await dispose(trx, crawl, task, page, outcome.facts);
    } else if (finalFailure(task, outcome.retryable)) {
      // Membership before the crawl and task, in the Site Health lock order.
      const runtime = await lockRuntime(trx, crawl.workspace_id);
      // The freed slot goes to the frontier's next best URL, or the crawl ends a
      // page short. An exact URL list has no frontier to refill from.
      const exact = record(crawl.configuration).input_mode === 'exact_urls';
      const released = await releaseNonPage(trx, crawl, task.url_hash, outcome, {
        record: true,
      });
      if (released && !exact)
        ({ admitted, sampleCapped } = await admitCandidates(trx, crawl, [], runtime, {
          releasing: 1,
        }));
    }
    const locked = await lock();
    if (!artifactId && finalFailure(locked.task, outcome.retryable))
      await observeFailure(trx, locked.crawl, locked.task, outcome);
    if (artifactId || admitted) {
      await trx
        .updateTable('site_crawls')
        .set((eb) => ({
          admitted_url_count: eb('admitted_url_count', '+', admitted),
          discovered_url_count: eb('discovered_url_count', '+', artifactId ? 1 : 0),
          updated_at: new Date(),
          ...(sampleCapped &&
          ['running', 'sample_completed'].includes(locked.crawl.discovery_status)
            ? { discovery_status: 'sample_completed' }
            : {}),
        }))
        .where('id', '=', locked.crawl.id)
        .where('workspace_id', '=', locked.crawl.workspace_id)
        .execute();
      if (artifactId)
        await recordCrawlEvent(trx, locked.crawl, 'discovery.progress', 'discovery progress', {
          admitted,
          depth: task.depth,
        });
    }
    await writeAttempts(
      trx,
      locked.crawl,
      locked.task,
      outcome,
      artifactId,
      ctx.fetcher.settings.policyVersion,
    );
    await settleTask(
      trx,
      ctx,
      locked.task,
      artifactId
        ? { kind: 'succeeded', artifactId }
        : {
            kind: 'failed',
            retryable: outcome.retryable,
            errorCode: outcome.errorCode,
            errorDetail: outcome.errorDetail,
          },
    );
  });
}

export async function runDiscover(ctx: SiteTaskContext, claimed: SiteTask) {
  const scope = await prepareTask(ctx, claimed);
  if (!scope || !(await markRunning(ctx, scope.task))) return;
  await persist(ctx, claimed, await acquire(ctx, scope.crawl, scope.task));
}
