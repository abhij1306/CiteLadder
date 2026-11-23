import { policy } from '../config.ts';
import type { Database } from '../db/database.ts';
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
  crawlAdmit,
  crawlScope,
  enqueueDiscoveredAnalysis,
  lockRuntime,
  markInventoryDocument,
  releaseNonPage,
  type Candidate,
} from './frontier.ts';
import { crawlRobotsHandling, isBotBlock } from './page-fetch.ts';
import {
  commitTask,
  finalFailure,
  httpError,
  prepareTask,
  recordCrawlEvent,
  settleTask,
  type Crawl,
  type SiteTaskContext,
  type TaskScope,
} from './site-task.ts';
import { taskOutcome } from './task-outcome.ts';
import { classifyUrlAdmission } from './url-admission.ts';
import { canonicalIdentity } from './url-identity.ts';

const crawlPolicy = policy.site_health.crawl;
const acquisition = policy.site_health.page_analysis.acquisition;
const DOCUMENT_TYPES = new Set(crawlPolicy.document_media_types);

type Discovery = { title: string; links: DiscoveredLink[] };
type Outcome = AttemptOutcome & {
  page: FetchedPage | null;
  discovery: Discovery | null;
  facts: PageFacts | null;
  robotsExcluded: boolean;
  retryable: boolean;
  errorDetail: string;
};

async function acquire(ctx: SiteTaskContext, crawl: Crawl, task: SiteTask): Promise<Outcome> {
  const fetched = await ctx.fetcher.fetch(task.requested_url, {
    signal: ctx.signal,
    admit: crawlAdmit(crawl),
    contentTypes: [...acquisition.html_content_types, ...crawlPolicy.document_media_types],
    robots: crawlRobotsHandling(crawl.configuration),
  });
  const empty = { page: null, discovery: null, facts: null, robotsExcluded: false };
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
  const success = {
    ...common,
    robotsExcluded: fetched.robotsExcluded,
    succeeded: true,
    errorCode: '',
    errorDetail: '',
    retryable: false,
  };
  if (DOCUMENT_TYPES.has(page.contentType))
    return { ...success, discovery: { title: '', links: [] }, facts: null };
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
    crawlScope(crawl),
  );
  return { ...success, discovery, facts };
}

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
    })
    .where('workspace_id', '=', crawl.workspace_id)
    .where('project_id', '=', crawl.project_id)
    .where('url_hash', '=', canonicalIdentity(task.requested_url).hash)
    .execute();
}

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

async function observeFailure(trx: Database, crawl: Crawl, task: SiteTask, outcome: Outcome) {
  const root = canonicalIdentity(crawl.root_url).hash === task.url_hash;
  if (!root && taskOutcome(outcome) !== 'excluded')
    await observeFailedUrl(trx, crawl, task, outcome);
}
async function observeFailedUrl(trx: Database, crawl: Crawl, task: SiteTask, outcome: Outcome) {
  const siteUrlId = await siteUrlFor(trx, crawl, task);
  if (!task.site_url_id) {
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

function candidatesFor(
  task: SiteTask,
  discovery: Discovery,
  referrerId: string | null,
): Candidate[] {
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
      referrerId,
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

async function persist(
  ctx: SiteTaskContext,
  claimed: SiteTask,
  { crawl, task }: TaskScope,
  outcome: Outcome,
) {
  await commitTask(ctx, claimed, async (trx, lock) => {
    let artifactId: string | null = null;
    let admitted = 0;
    let sampleCapped = false;
    const { page, discovery } = outcome;
    if (page && discovery) {
      const runtime = await lockRuntime(trx, crawl.workspace_id);
      artifactId = await writeArtifact(trx, crawl, task, page, outcome.facts, {
        policyVersion: ctx.fetcher.settings.policyVersion,
        latencyMs: outcome.latencyMs ?? 0,
        purpose: 'discover',
        robotsExcluded: outcome.robotsExcluded,
      });
      const referrerId = await writeObservation(trx, crawl, task, page, discovery, artifactId);
      const admission = await admitCandidates(
        trx,
        crawl,
        candidatesFor(task, discovery, referrerId),
        runtime,
        { sourceArtifactId: artifactId },
      );
      admitted = admission.admitted;
      sampleCapped = admission.sampleCapped;
      await refreshFetchedUrl(trx, crawl, task, page, discovery);
      await dispose(trx, crawl, task, page, outcome.facts);
    } else if (finalFailure(task, outcome.retryable)) {
      await lockRuntime(trx, crawl.workspace_id);
      await releaseNonPage(trx, crawl, task.url_hash, outcome, { record: true });
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
      if (artifactId && ctx.cadence.discoveryEvent.admits(locked.crawl.id))
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
  if (!scope) return;
  await persist(ctx, claimed, scope, await acquire(ctx, scope.crawl, scope.task));
}
