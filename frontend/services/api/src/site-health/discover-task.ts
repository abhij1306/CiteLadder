/**
 * The `discover` task: acquire one page under the crawl's scope, extract its
 * in-scope links and bounded facts from one parse, and commit the artifact,
 * the URL's observation, the admitted frontier and the page's disposition
 * (document, canonical alias, or a page to analyze) with the task outcome.
 * Network I/O happens outside the transaction; the commit takes the runtime
 * lock before the crawl and task, and writes nothing if the lease or crawl
 * was lost meanwhile.
 */
import { randomUUID } from 'node:crypto';

import { policy } from '../config.ts';
import type { Database } from '../db/database.ts';
import { record } from '../db/json.ts';
import type { FetchedPage } from '../projects/safe-fetch.ts';
import type { SiteTask } from '../queue/task-queue.ts';
import { factSettings, type PageFacts } from './analysis/facts.ts';
import { discoverAsync } from './analysis/off-thread.ts';
import type { DiscoveredLink } from './discovery-links.ts';
import { writeArtifact, writeAttempts, type AttemptOutcome } from './analysis-rows.ts';
import { duplicateOf, markDuplicates } from './canonical-alias.ts';
import {
  admitCandidates,
  candidate,
  crawlScope,
  enqueueDiscoveredAnalysis,
  lockRuntime,
  markInventoryDocument,
  type Candidate,
} from './frontier.ts';
import { isBotBlock } from './page-fetch.ts';
import {
  Abandoned,
  ACTIVE_CRAWL,
  finalFailure,
  httpError,
  loadScope,
  lockRunningTask,
  markRunning,
  prepareTask,
  recordCrawlEvent,
  settleTask,
  type SiteTaskContext,
} from './site-task.ts';
import type { Crawl } from './task-fence.ts';
import { classifyUrlAdmission, hardExcluded } from './url-admission.ts';
import { canonicalIdentity } from './url-identity.ts';

const crawlPolicy = policy.site_health.crawl;
const acquisition = policy.site_health.page_analysis.acquisition;
const DOCUMENT_TYPES = new Set(crawlPolicy.document_media_types);
const EXCLUDED = new Set(policy.site_health.reads.corpus_exclusion_error_codes);

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
  if (!siteUrlId) return null;
  await insertObservation(trx, crawl, task, siteUrlId, {
    artifactId,
    finalUrl: page.url,
    statusCode: page.status,
    contentType: page.contentType,
    title: discovery.title,
  });
  return siteUrlId;
}

/** The task URL's identity, created on first sight (a planner seed has none yet). */
async function siteUrlFor(trx: Database, crawl: Crawl, task: SiteTask) {
  const identity = canonicalIdentity(task.requested_url);
  const admission = classifyUrlAdmission(task.requested_url);
  const sourceKind = task.depth === 0 ? 'root' : 'link';
  const now = new Date();
  await trx
    .insertInto('site_urls')
    .values({
      id: randomUUID(),
      workspace_id: crawl.workspace_id,
      project_id: crawl.project_id,
      normalized_url: identity.url,
      url_hash: identity.hash,
      display_url: identity.url,
      host: new URL(identity.url).hostname.slice(0, 255),
      depth: task.depth,
      corpus_disposition: admission.disposition,
      disposition_reason: admission.dispositionReason,
      disposition_version: crawlPolicy.disposition_version,
      item_kind: admission.itemKind,
      discovery_status: 'running',
      latest_source_kind: sourceKind,
      latest_title: '',
      latest_content_type: '',
      first_seen_crawl_id: crawl.id,
      last_seen_crawl_id: crawl.id,
      first_seen_at: now,
      last_seen_at: now,
    })
    .onConflict((conflict) => conflict.columns(['project_id', 'url_hash']).doNothing())
    .execute();
  const url = await trx
    .selectFrom('site_urls')
    .select('id')
    .where('workspace_id', '=', crawl.workspace_id)
    .where('project_id', '=', crawl.project_id)
    .where('url_hash', '=', identity.hash)
    .executeTakeFirst();
  return url?.id ?? null;
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
  await trx
    .insertInto('site_url_observations')
    .values({
      id: randomUUID(),
      workspace_id: crawl.workspace_id,
      project_id: crawl.project_id,
      crawl_id: crawl.id,
      site_url_id: siteUrlId,
      source_kind: task.depth === 0 ? 'root' : 'link',
      parent_site_url_id: task.parent_site_url_id,
      source_artifact_id: fetched.artifactId,
      value_kind: admission.valueKind,
      value_priority: admission.priority,
      rewrite_reason: rewrite?.rewrite_reason ?? '',
      rewrite_version: rewrite?.rewrite_version ?? '',
      depth: task.depth,
      observed_url: task.requested_url,
      final_url: fetched.finalUrl,
      status_code: fetched.statusCode,
      content_type: fetched.contentType.slice(0, 128),
      title: fetched.title,
      created_at: new Date(),
    })
    .onConflict((conflict) => conflict.columns(['crawl_id', 'site_url_id']).doNothing())
    .execute();
}

/**
 * A URL whose fetch failed for good is still part of the crawl: observe it
 * with its status and the page that linked it, so it lists as an error with
 * its source. The root's failure is the crawl's own, and a URL the crawl's
 * policy excluded is not an error.
 */
async function observeFailure(trx: Database, crawl: Crawl, task: SiteTask, outcome: Outcome) {
  const root = canonicalIdentity(crawl.root_url).hash === task.url_hash;
  if (root || EXCLUDED.has(outcome.errorCode)) return;
  let siteUrlId = task.site_url_id;
  if (!siteUrlId) {
    siteUrlId = await siteUrlFor(trx, crawl, task);
    if (!siteUrlId) return;
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
  ctx.signal?.throwIfAborted();
  await ctx.db
    .transaction()
    .execute(async (trx) => {
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
      }
      const locked = await lockRunningTask(trx, claimed, ctx.owner);
      if (!locked || !ACTIVE_CRAWL.has(locked.crawl.status)) throw new Abandoned();
      if (!artifactId && finalFailure(locked.task, outcome.retryable))
        await observeFailure(trx, locked.crawl, locked.task, outcome);
      if (artifactId) {
        await trx
          .updateTable('site_crawls')
          .set((eb) => ({
            admitted_url_count: eb('admitted_url_count', '+', admitted),
            discovered_url_count: eb('discovered_url_count', '+', 1),
            updated_at: new Date(),
            ...(sampleCapped &&
            ['running', 'sample_completed'].includes(locked.crawl.discovery_status)
              ? { discovery_status: 'sample_completed' }
              : {}),
          }))
          .where('id', '=', locked.crawl.id)
          .where('workspace_id', '=', locked.crawl.workspace_id)
          .execute();
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
          ? { succeeded: true, artifactId }
          : {
              succeeded: false,
              retryable: outcome.retryable,
              errorCode: outcome.errorCode,
              errorDetail: outcome.errorDetail,
            },
      );
    })
    .catch((error: unknown) => {
      if (!(error instanceof Abandoned)) throw error;
    });
}

export async function runDiscover(ctx: SiteTaskContext, claimed: SiteTask) {
  const scope = await prepareTask(ctx, claimed);
  if (!scope || !(await markRunning(ctx.db, scope.task, ctx.owner))) return;
  await persist(ctx, claimed, await acquire(ctx, scope.crawl, scope.task));
}
