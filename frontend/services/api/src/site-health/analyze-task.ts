/**
 * The `analyze` task: acquire one monitored page (or reuse its discover
 * artifact), extract and analyze it, and commit the evidence together with the
 * task's own outcome. Network I/O happens outside any transaction; the commit
 * re-checks lease, crawl, membership and the monitored-URL limit under the Site Health
 * lock order (runtime, membership, crawl, task) so a cancelled or lost task
 * writes nothing.
 */
import { policy } from '../config.ts';
import type { Database } from '../db/database.ts';
import { record } from '../db/json.ts';
import type { SiteTask } from '../queue/task-queue.ts';
import { enqueueCatalogProjection } from '../commerce/projection.ts';
import { factSettings } from './analysis/facts.ts';
import { analyzePageAsync, extractFactsAsync } from './analysis/off-thread.ts';
import type { Facts } from './analysis/read-facts.ts';
import {
  writeArtifact,
  writeAttempts,
  writePageAnalysis,
  pageAnalysisContext,
  type AttemptOutcome,
} from './analysis-rows.ts';
import { isBotBlock } from './page-fetch.ts';
import {
  ACTIVE_CRAWL,
  cancelTask,
  httpError,
  loadScope,
  lockRunningTask,
  markRunning,
  owned,
  recordCrawlEvent,
  retryAfterSeconds,
  settleTask,
  startCrawl,
  statuses,
  type SiteTaskContext,
  type SiteTaskSettings,
} from './site-task.ts';
import type { Crawl } from './task-fence.ts';
import { canonicalIdentity } from './url-identity.ts';

const codes = policy.site_health.page_analysis.acquisition.error_codes;
const BODYLESS = new Set(policy.site_health.page_analysis.acquisition.bodyless_status_codes);
const ACTIVE_TASK = [statuses.queued, statuses.leased, statuses.running, statuses.retry_wait];

type Outcome = AttemptOutcome & {
  facts: Facts | null;
  page: Parameters<typeof writeArtifact>[3] | null;
  reusedArtifactId: string | null;
  retryable: boolean;
  errorDetail: string;
  retryAfterSeconds?: number;
};

/** Backoff for a prerequisite recheck: doubles with the wait, clamped, never past the bound. */
function dependencyDelay(settings: SiteTaskSettings, waited: number) {
  const base = Math.max(0, settings.dependencyRetry);
  const backoff = base
    ? Math.min(base * 2 ** Math.min(waited / base, 16), settings.dependencyRetryMax)
    : 0;
  return Math.min(backoff, Math.max(0, settings.dependencyMaxWait - waited));
}

type GuardRows = {
  monitored: { active: boolean; selection_source: string } | undefined;
  runtime: { monitored_url_limit: number } | undefined;
};
async function guardRows(
  db: Database,
  crawl: Crawl,
  task: SiteTask,
  lock: boolean,
): Promise<GuardRows> {
  const runtimeQuery = db
    .selectFrom('workspace_site_health_runtime')
    .select('monitored_url_limit')
    .where('workspace_id', '=', crawl.workspace_id);
  const runtime = await (lock ? runtimeQuery.forUpdate() : runtimeQuery).executeTakeFirst();
  const monitoredQuery = db
    .selectFrom('monitored_site_urls')
    .select(['active', 'selection_source'])
    .where('workspace_id', '=', crawl.workspace_id)
    .where('project_id', '=', crawl.project_id)
    .where('site_url_id', '=', task.site_url_id ?? '00000000-0000-0000-0000-000000000000');
  const monitored = await (lock ? monitoredQuery.forUpdate() : monitoredQuery).executeTakeFirst();
  return { runtime, monitored };
}
/** Live crawl, active membership, and a monitored-URL limit that still allows analysis. */
function guardAllows(crawl: Crawl, rows: GuardRows) {
  if (!ACTIVE_CRAWL.has(crawl.status) || !rows.monitored?.active || !rows.runtime) return false;
  return rows.runtime.monitored_url_limit > 0;
}

/** A discover artifact of this URL to reuse, or whether its discover task is still in flight. */
async function reusableArtifact(db: Database, crawl: Crawl, task: SiteTask) {
  const artifact = await db
    .selectFrom('site_fetch_artifacts as f')
    .innerJoin('site_crawl_tasks as t', (join) =>
      join.onRef('t.id', '=', 'f.task_id').onRef('t.workspace_id', '=', 'f.workspace_id'),
    )
    .select(['f.id', 'f.normalized_facts'])
    .where('f.workspace_id', '=', crawl.workspace_id)
    .where('f.crawl_id', '=', crawl.id)
    .where('f.fetch_purpose', '=', 'discover')
    .where(
      'f.extractor_version',
      '=',
      crawl.extractor_version || policy.site_health.versions.extractor,
    )
    .where('f.normalized_facts', 'is not', null)
    .where('t.url_hash', '=', task.url_hash)
    .orderBy('f.fetched_at', 'desc')
    .limit(1)
    .executeTakeFirst();
  if (artifact)
    return {
      artifact: { id: artifact.id, facts: record(artifact.normalized_facts) },
      pending: false,
    };
  return { artifact: null, pending: await activeTask(db, crawl, task.url_hash, 'discover') };
}
async function activeTask(db: Database, crawl: Crawl, urlHash: string, kind: string) {
  const row = await db
    .selectFrom('site_crawl_tasks')
    .select('id')
    .where('workspace_id', '=', crawl.workspace_id)
    .where('crawl_id', '=', crawl.id)
    .where('task_kind', '=', kind)
    .where('url_hash', '=', urlHash)
    .where('status', 'in', ACTIVE_TASK)
    .limit(1)
    .executeTakeFirst();
  return Boolean(row);
}
/** The root's analysis waits for the site-level setup evidence it reads. */
async function setupPending(db: Database, crawl: Crawl, task: SiteTask) {
  if (crawl.site_facts !== null) return false;
  let rootHash = '';
  try {
    rootHash = canonicalIdentity(crawl.root_url).hash;
  } catch {
    return false;
  }
  if (task.url_hash !== rootHash) return false;
  const row = await db
    .selectFrom('site_crawl_tasks')
    .select('id')
    .where('workspace_id', '=', crawl.workspace_id)
    .where('crawl_id', '=', crawl.id)
    .where('task_kind', '=', 'site_setup')
    .where('status', 'in', ACTIVE_TASK)
    .limit(1)
    .executeTakeFirst();
  return Boolean(row);
}

/** Commit the supported-HTML classification cohort before parsing. */
const expectClassification = (db: Database, task: SiteTask, owner: string) =>
  owned(db, task, owner).set({ classification_expected: true, updated_at: new Date() }).execute();

async function acquire(ctx: SiteTaskContext, task: SiteTask): Promise<Outcome> {
  const fetched = await ctx.fetcher.fetch(task.requested_url, { signal: ctx.signal });
  const base = { facts: null, page: null, reusedArtifactId: null };
  if (!fetched.ok)
    return {
      ...base,
      succeeded: false,
      errorCode: fetched.code,
      errorDetail: fetched.detail,
      retryable: fetched.retryable,
      statusCode: null,
      latencyMs: fetched.latencyMs,
      calls: fetched.calls,
    };
  const { page } = fetched;
  const failure = isBotBlock(page) ? ([codes.bot_blocked, false] as const) : httpError(page.status);
  const common = {
    statusCode: page.status,
    latencyMs: fetched.latencyMs,
    calls: fetched.calls,
    page,
  };
  if (failure)
    return {
      ...base,
      ...common,
      succeeded: false,
      errorCode: failure[0],
      errorDetail: '',
      retryable: failure[1],
      retryAfterSeconds: retryAfterSeconds(page.headers?.['retry-after']),
    };
  if (!BODYLESS.has(page.status)) await expectClassification(ctx.db, task, ctx.owner);
  const facts = await extractFactsAsync(
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
  );
  return {
    ...base,
    ...common,
    facts,
    succeeded: true,
    errorCode: '',
    errorDetail: '',
    retryable: false,
  };
}

/** Lock in Site Health order and re-check; null when this worker no longer owns the task. */
async function lockForCommit(trx: Database, claimed: SiteTask, owner: string) {
  const scope = await loadScope(trx, claimed);
  if (!scope) return null;
  const rows = await guardRows(trx, scope.crawl, scope.task, true);
  const locked = await lockRunningTask(trx, claimed, owner);
  if (!locked) return null;
  return { ...locked, allowed: guardAllows(locked.crawl, rows) };
}

async function recordProgress(trx: Database, crawl: Crawl) {
  const analyzed = crawl.analyzed_url_count + 1;
  await trx
    .updateTable('site_crawls')
    .set({ analyzed_url_count: analyzed, updated_at: new Date() })
    .where('id', '=', crawl.id)
    .where('workspace_id', '=', crawl.workspace_id)
    .execute();
  await recordCrawlEvent(trx, crawl, 'analysis.progress', 'analysis progress', { analyzed });
}

/** Stage the evidence and settle the task in one transaction. */
async function persist(ctx: SiteTaskContext, claimed: SiteTask, outcome: Outcome) {
  ctx.signal?.throwIfAborted();
  // Load the provisional page context and evaluate before taking commit locks.
  const scope = outcome.facts ? await loadScope(ctx.db, claimed) : null;
  const context = scope?.task.site_url_id
    ? await pageAnalysisContext(ctx.db, scope.crawl, {
        ...scope.task,
        site_url_id: scope.task.site_url_id,
      })
    : null;
  const result = context && outcome.facts ? await analyzePageAsync(outcome.facts, context) : null;
  await ctx.db.transaction().execute(async (trx) => {
    const locked = await lockForCommit(trx, claimed, ctx.owner);
    if (!locked) return;
    const { crawl, task } = locked;
    if (!locked.allowed) {
      await cancelTask(trx, task, ctx.owner);
      return;
    }
    let artifactId = outcome.reusedArtifactId;
    if (outcome.facts && task.site_url_id && result) {
      // Setup/discovery may publish context while interpretation runs. Interpret
      // the new snapshot once under the crawl lock without spending another attempt.
      const currentContext = await pageAnalysisContext(trx, crawl, {
        ...task,
        site_url_id: task.site_url_id,
      });
      const currentResult =
        JSON.stringify(currentContext) === JSON.stringify(context)
          ? result
          : await analyzePageAsync(outcome.facts, currentContext);
      artifactId ??= await writeArtifact(trx, crawl, task, outcome.page!, outcome.facts, {
        policyVersion: ctx.fetcher.settings.policyVersion,
        latencyMs: outcome.latencyMs ?? 0,
        purpose: 'analyze',
      });
      const analysis = await writePageAnalysis(
        trx,
        crawl,
        { ...task, site_url_id: task.site_url_id },
        artifactId,
        outcome.facts,
        currentResult,
      );
      if (analysis.pageKind === 'category' || analysis.pageKind === 'product')
        await enqueueCatalogProjection(
          trx,
          { workspaceId: crawl.workspace_id, projectId: crawl.project_id },
          analysis.id,
        );
    } else artifactId = null;
    if (!outcome.reusedArtifactId)
      await writeAttempts(
        trx,
        crawl,
        task,
        outcome,
        artifactId,
        ctx.fetcher.settings.policyVersion,
      );
    if (artifactId) {
      await recordProgress(trx, crawl);
      await settleTask(trx, ctx, task, { succeeded: true, artifactId });
      return;
    }
    await settleTask(trx, ctx, task, {
      succeeded: false,
      retryable: outcome.retryable,
      errorCode: outcome.errorCode,
      errorDetail: outcome.errorDetail,
      retryAfterSeconds: outcome.retryAfterSeconds,
    });
  });
}

/** Reused evidence or a fresh acquisition; null when the task should not run now. */
async function prepare(
  ctx: SiteTaskContext,
  claimed: SiteTask,
): Promise<Outcome | 'deferred' | null> {
  ctx.signal?.throwIfAborted();
  const scope = await loadScope(ctx.db, claimed);
  if (!scope || !ACTIVE_CRAWL.has(scope.crawl.status)) {
    await cancelTask(ctx.db, claimed, ctx.owner);
    return null;
  }
  const { crawl, task } = scope;
  if (task.lease_owner !== ctx.owner) return null;
  if (!guardAllows(crawl, await guardRows(ctx.db, crawl, task, false))) {
    await cancelTask(ctx.db, task, ctx.owner);
    return null;
  }
  await startCrawl(ctx.db, crawl);
  const { artifact, pending } = await reusableArtifact(ctx.db, crawl, task);
  const waited = Math.max(0, (Date.now() - new Date(task.created_at).getTime()) / 1000);
  if (
    (pending || (await setupPending(ctx.db, crawl, task))) &&
    waited < ctx.settings.dependencyMaxWait
  ) {
    // Waiting costs no attempt; past the bound this analyze acquires the page itself.
    await owned(ctx.db, task, ctx.owner)
      .set({
        status: statuses.queued,
        lease_owner: null,
        lease_expires_at: null,
        available_at: new Date(Date.now() + dependencyDelay(ctx.settings, waited) * 1000),
        error_code: '',
        error_detail: '',
        updated_at: new Date(),
      })
      .execute();
    return 'deferred';
  }
  if (!(await markRunning(ctx.db, task, ctx.owner))) return null;
  if (!artifact) return acquire(ctx, task);
  if (artifact.facts.has_html) await expectClassification(ctx.db, task, ctx.owner);
  return {
    facts: artifact.facts,
    page: null,
    reusedArtifactId: artifact.id,
    succeeded: true,
    errorCode: '',
    errorDetail: '',
    retryable: false,
    statusCode: null,
    latencyMs: null,
    calls: [],
  };
}

export async function runAnalyze(ctx: SiteTaskContext, claimed: SiteTask) {
  const outcome = await prepare(ctx, claimed);
  if (outcome && outcome !== 'deferred') await persist(ctx, claimed, outcome);
}
