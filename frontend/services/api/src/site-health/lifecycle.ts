/**
 * A crawl goes terminal here and nowhere else. Every entry point holds the
 * crawl row FOR UPDATE and short-circuits on a crawl that is no longer
 * active, so the per-task reconcile, terminal lease recovery, the stalled
 * backstop and the overdue watchdog are idempotent and safe to run
 * concurrently. The finalize pass, final page revisions and the snapshot
 * commit with the status transition: a terminal crawl without them is a state
 * no retry can repair, because the snapshot is written once per crawl.
 */
import { createHash, randomUUID } from 'node:crypto';
import { sql } from 'kysely';

import { policy, resolveSettingSpec } from '../config.ts';
import type { Database } from '../db/database.ts';
import { getLogger } from '../logging.ts';
import { reconcileDuplicateAliases } from './canonical-alias.ts';
import { finalizeCrawlAnalyses } from './lifecycle-finalize.ts';
import { rootFailure } from './reads/crawl.ts';
import type { SiteWorkerSettings } from './runtime.ts';
import { recordCrawlEvent } from './site-task.ts';
import { persistCrawlSnapshot, refreshLiveScoreSummary } from './snapshot.ts';
import type { Crawl } from './task-fence.ts';
import { publishFinalPageAnalyses } from './terminal-analysis.ts';
import { enqueueTerminalAnalyticsRefresh } from './terminal-handoff.ts';

const logger = getLogger('app.workers.site_health.lifecycle');
const TERMINAL_TASK = policy.task_queue.terminal;
/** `paused` is never written; a crawl in it is left alone rather than terminalized. */
const ACTIVE = ['draft', 'validating', 'queued', 'running'];
const LIFECYCLE_KINDS = ['discover', 'site_setup', 'analyze'];
const EXCLUSIONS = policy.site_health.reads.corpus_exclusion_error_codes;
const OVERDUE = policy.site_health.page_analysis.acquisition.error_codes.crawl_overdue;

type Counts = {
  total: number;
  open: number;
  succeeded: number;
  cancelled: number;
  failed: number;
  excluded: number;
};
const NONE: Counts = { total: 0, open: 0, succeeded: 0, cancelled: 0, failed: 0, excluded: 0 };

/** Task outcomes that drive one locked reconcile, from one grouped scan. */
type Summary = {
  discoverOpen: number;
  discoverFailed: number;
  analyzeOpen: number;
  analyzeTotal: number;
  analyzeSucceeded: number;
  /** Pages the crawl could ever analyze: cancelled tasks and policy exclusions are not failures. */
  analyzeApplicable: number;
};

async function taskSummary(db: Database, crawl: Crawl): Promise<Summary> {
  const rows = await db
    .selectFrom('site_crawl_tasks')
    .select([
      'task_kind',
      sql<number>`count(*)::int`.as('total'),
      sql<number>`count(*) filter (where status <> all(${TERMINAL_TASK}::text[]))::int`.as('open'),
      sql<number>`count(*) filter (where status = 'succeeded')::int`.as('succeeded'),
      sql<number>`count(*) filter (where status = 'cancelled')::int`.as('cancelled'),
      sql<number>`count(*) filter (where status = 'failed')::int`.as('failed'),
      sql<number>`count(*) filter (where status = 'failed' and error_code = any(${EXCLUSIONS}::text[]))::int`.as(
        'excluded',
      ),
    ])
    .where('workspace_id', '=', crawl.workspace_id)
    .where('crawl_id', '=', crawl.id)
    .where('task_kind', 'in', LIFECYCLE_KINDS)
    .groupBy('task_kind')
    .execute();
  const kind = (name: string): Counts => rows.find((row) => row.task_kind === name) ?? NONE;
  const [discover, setup, analyze] = [kind('discover'), kind('site_setup'), kind('analyze')];
  return {
    discoverOpen: discover.open + setup.open,
    discoverFailed: Math.max(discover.failed - discover.excluded, 0) + setup.failed,
    analyzeOpen: analyze.open,
    analyzeTotal: analyze.total,
    analyzeSucceeded: analyze.succeeded,
    analyzeApplicable: analyze.total - analyze.cancelled - analyze.excluded,
  };
}

/** Distinct URLs with a terminally failed fetch or analysis; exclusions and blank hashes are not pages that failed. */
async function failedUrlCount(db: Database, crawl: Crawl) {
  const row = await db
    .selectFrom('site_crawl_tasks')
    .select(sql<number>`count(distinct url_hash)::int`.as('count'))
    .where('workspace_id', '=', crawl.workspace_id)
    .where('crawl_id', '=', crawl.id)
    .where('status', '=', 'failed')
    .where('task_kind', 'in', ['discover', 'analyze'])
    .where('url_hash', '!=', '')
    .where(sql<boolean>`error_code <> all(${EXCLUSIONS}::text[])`)
    .executeTakeFirstOrThrow();
  return row.count;
}

/** Repair counters from their task and observation authorities; admission never moves down. */
async function refreshCounters(db: Database, crawl: Crawl, summary: Summary) {
  const observed = await db
    .selectFrom('site_url_observations')
    .select(sql<number>`count(*)::int`.as('count'))
    .where('workspace_id', '=', crawl.workspace_id)
    .where('project_id', '=', crawl.project_id)
    .where('crawl_id', '=', crawl.id)
    .executeTakeFirstOrThrow();
  crawl.failed_url_count = await failedUrlCount(db, crawl);
  crawl.analyzed_url_count = summary.analyzeSucceeded;
  // A parent page reserves its children before they are fetched, so the live
  // admission counter runs ahead of observations; lowering it would reopen
  // the requested budget for every sibling.
  crawl.admitted_url_count = Math.max(crawl.admitted_url_count, observed.count);
}

/** Progressive discovery state; returns whether the crawl failed outright and whether discovery fell short. */
function reconcileDiscovery(crawl: Crawl, summary: Summary) {
  const discoveryFailed = crawl.discovered_url_count === 0;
  // A recrawl that analyzed monitored pages after its root was blocked holds
  // useful partial evidence; it is not a failed crawl.
  const fullyFailed = discoveryFailed && summary.analyzeSucceeded === 0;
  if (!summary.discoverOpen) {
    if (crawl.discovery_status === 'running')
      crawl.discovery_status = discoveryFailed ? 'failed' : 'completed';
    crawl.inventory_complete = !discoveryFailed;
  }
  return { fullyFailed, discoveryPartial: summary.discoverFailed > 0 && !fullyFailed };
}

function analysisOutcome(summary: Summary, fullyFailed: boolean) {
  if (summary.analyzeTotal > 0 && summary.analyzeApplicable === 0) return 'cancelled';
  if (fullyFailed) return 'failed';
  if (summary.analyzeSucceeded === summary.analyzeApplicable) return 'completed';
  return summary.analyzeSucceeded > 0 ? 'partially_completed' : 'failed';
}

/** Analysis starts with its first admitted task and settles once discovery and analysis drain. */
function reconcileAnalysis(crawl: Crawl, summary: Summary, fullyFailed: boolean) {
  if (summary.analyzeTotal > 0 && crawl.analysis_status === 'pending')
    crawl.analysis_status = 'running';
  if (summary.discoverOpen || summary.analyzeOpen) return;
  if (crawl.analysis_status === 'pending') crawl.analysis_status = 'running';
  if (crawl.analysis_status === 'running')
    crawl.analysis_status = analysisOutcome(summary, fullyFailed);
}

/** Name what fell short, so a crawl that met one dead link is not reported as unanalyzed. */
function partialReason(discoveryPartial: boolean, analysisPartial: boolean) {
  if (discoveryPartial && analysisPartial) return policy.site_health.reads.partial_reasons.both;
  if (discoveryPartial) return policy.site_health.reads.partial_reasons.discovery;
  return analysisPartial ? policy.site_health.reads.partial_reasons.analysis : '';
}

/** Change analysis and link metrics follow every crawl whose evidence a snapshot published. */
async function enqueueSuccessors(db: Database, crawl: Crawl) {
  const linkVersion = `${crawl.extractor_version}:${policy.site_health.link_metrics.formula_version}`;
  const successors = [
    {
      kind: 'change_intel',
      key: `change-intel:${crawl.id}:${policy.site_health.change_intel.analyzer_version}`,
    },
    { kind: 'link_metrics', key: `link-metrics:${crawl.id}:${linkVersion}` },
  ];
  const idempotency = {
    change_intel: `${crawl.id}:change_intel:${policy.site_health.change_intel.analyzer_version}`,
    link_metrics: `${crawl.id}:link_metrics:${linkVersion}`,
  };
  const now = new Date();
  await db
    .insertInto('site_crawl_tasks')
    .values(
      successors.map(({ kind, key }) => ({
        id: randomUUID(),
        workspace_id: crawl.workspace_id,
        crawl_id: crawl.id,
        task_kind: kind,
        requested_url: crawl.root_url,
        url_hash: createHash('sha256').update(key).digest('hex'),
        idempotency_key: idempotency[kind as keyof typeof idempotency],
        status: 'queued',
        max_attempts: Number(
          resolveSettingSpec(policy.site_health.settings.max_attempts, process.env),
        ),
        depth: 0,
        generation: 0,
        priority: 0,
        randomized_position: 0,
        attempt_count: 0,
        conflict_count: 0,
        classification_expected: false,
        error_code: '',
        error_detail: '',
        available_at: now,
        created_at: now,
        updated_at: now,
      })),
    )
    .onConflict((conflict) => conflict.column('idempotency_key').doNothing())
    .execute();
}

async function saveState(db: Database, crawl: Crawl) {
  await db
    .updateTable('site_crawls')
    .set({
      status: crawl.status,
      discovery_status: crawl.discovery_status,
      analysis_status: crawl.analysis_status,
      inventory_complete: crawl.inventory_complete,
      failed_url_count: crawl.failed_url_count,
      analyzed_url_count: crawl.analyzed_url_count,
      admitted_url_count: crawl.admitted_url_count,
      partial_reason: crawl.partial_reason,
      error_message: crawl.error_message,
      completed_at: crawl.completed_at,
      updated_at: new Date(),
    })
    .where('workspace_id', '=', crawl.workspace_id)
    .where('id', '=', crawl.id)
    .execute();
}

/** Classify the drained crawl, settle its fetch allowance, and queue what follows it. */
async function terminalize(
  db: Database,
  crawl: Crawl,
  summary: Summary,
  fullyFailed: boolean,
  discoveryPartial: boolean,
) {
  crawl.completed_at = new Date();
  if (fullyFailed) {
    crawl.status = 'failed';
    const failure = (await rootFailure(db, crawl)).summary;
    if (failure && !crawl.error_message) crawl.error_message = failure.message;
    await saveState(db, crawl);
    await recordCrawlEvent(db, crawl, 'crawl.failed', 'crawl failed', {
      status: crawl.status,
      failure,
    });
    return;
  }
  const analysisPartial =
    summary.analyzeApplicable > 0 && summary.analyzeSucceeded < summary.analyzeApplicable;
  crawl.partial_reason = partialReason(discoveryPartial, analysisPartial);
  crawl.status = crawl.partial_reason ? 'partially_completed' : 'completed';
  await saveState(db, crawl);
  await recordCrawlEvent(db, crawl, 'crawl.completed', 'crawl completed', { status: crawl.status });
  if (summary.analyzeSucceeded > 0) await enqueueSuccessors(db, crawl);
  else await enqueueTerminalAnalyticsRefresh(db, crawl, null);
}

type ReconcileOptions = {
  /**
   * Rebuild the provisional score while work remains. Only a new analysis can
   * change it, and the rebuild reloads the whole measurement projection under
   * the crawl lock, so a settled discover or failed analysis skips it.
   */
  refreshScore?: boolean;
};

/** Reconcile one crawl whose row the caller holds FOR UPDATE. */
async function reconcileLockedCrawl(db: Database, crawl: Crawl, options: ReconcileOptions = {}) {
  if (!ACTIVE.includes(crawl.status)) return;
  const summary = await taskSummary(db, crawl);
  await refreshCounters(db, crawl, summary);
  const { fullyFailed, discoveryPartial } = reconcileDiscovery(crawl, summary);
  reconcileAnalysis(crawl, summary, fullyFailed);
  if (summary.discoverOpen || summary.analyzeOpen) {
    await saveState(db, crawl);
    if (options.refreshScore ?? true) await refreshLiveScoreSummary(db, crawl);
    return;
  }
  // Cross-page rules read persisted facts and run before the snapshot so
  // their issues enter its rollups.
  await reconcileDuplicateAliases(db, crawl);
  await finalizeCrawlAnalyses(db, crawl);
  await persistCrawlSnapshot(db, crawl, true);
  await terminalize(db, crawl, summary, fullyFailed, discoveryPartial);
}

function lockCrawl(db: Database, workspaceId: string, crawlId: string) {
  return db
    .selectFrom('site_crawls')
    .selectAll()
    .where('workspace_id', '=', workspaceId)
    .where('id', '=', crawlId)
    .forUpdate()
    .executeTakeFirst();
}

export async function reconcileCrawl(
  db: Database,
  workspaceId: string,
  crawlId: string,
  options: ReconcileOptions = {},
) {
  await db.transaction().execute(async (trx) => {
    const crawl = await lockCrawl(trx, workspaceId, crawlId);
    if (crawl) await reconcileLockedCrawl(trx, crawl, options);
  });
}

/**
 * Rebuilding the live summary reloads the whole measurement projection under
 * the crawl and profile locks cancellation competes for, so intermediate
 * analyses refresh it after a growing batch or an elapsed-time bound. The mark
 * is display cadence, not a fact: terminalization rebuilds from persisted
 * evidence regardless, so a lost mark only refreshes more often.
 */
export class ScoreRefreshCadence {
  readonly #marks = new Map<string, { refreshedAt: number; observed: number; pending: number }>();
  readonly #settings: SiteWorkerSettings['scoreRefresh'];
  constructor(settings: SiteWorkerSettings['scoreRefresh']) {
    this.#settings = settings;
  }
  admits(crawlId: string, now = performance.now()) {
    const { pageInterval, minIntervalSeconds, pageFraction } = this.#settings;
    if (pageInterval <= 0 && minIntervalSeconds <= 0) return true;
    const mark = this.#marks.get(crawlId);
    if (!mark) {
      // A crawl's first analysis always refreshes, so its first score card is prompt.
      this.#marks.set(crawlId, { refreshedAt: now, observed: 1, pending: 0 });
      this.#prune();
      return true;
    }
    mark.observed++;
    mark.pending++;
    const growing = Math.max(
      pageInterval,
      Math.ceil((mark.observed - mark.pending) * pageFraction),
    );
    const due =
      (pageInterval > 0 && mark.pending >= growing) ||
      (minIntervalSeconds > 0 && now - mark.refreshedAt >= minIntervalSeconds * 1000);
    if (due) {
      mark.refreshedAt = now;
      mark.pending = 0;
    }
    this.#prune();
    return due;
  }
  /** Bound the table: a forgotten crawl simply refreshes once more than it owed. */
  #prune() {
    const cap = this.#settings.maxTrackedCrawls;
    if (cap <= 0 || this.#marks.size <= cap) return;
    const stale = [...this.#marks].sort((a, b) => a[1].refreshedAt - b[1].refreshedAt);
    for (const [id] of stale.slice(0, this.#marks.size - cap)) this.#marks.delete(id);
  }
}

type SettledTask = { id: string; crawl_id: string; workspace_id: string };

/**
 * Reconcile after a lifecycle task settles, unless its row cannot have moved
 * a boundary. A row still non-terminal (deferred, re-queued, lease lost) is
 * itself the outstanding work; a successful analysis while siblings remain
 * only refreshes the live summary on cadence. Taking the crawl lock for
 * either is pure contention with the user's Stop. Other settlements update
 * counters and sub-states without rebuilding the score they cannot change.
 */
export async function reconcileAfterTask(
  db: Database,
  task: SettledTask,
  cadence: ScoreRefreshCadence,
) {
  const row = await db
    .selectFrom('site_crawl_tasks as t')
    .innerJoin('site_crawls as c', (join) =>
      join.onRef('c.id', '=', 't.crawl_id').onRef('c.workspace_id', '=', 't.workspace_id'),
    )
    .select([
      't.task_kind',
      't.status',
      't.result_artifact_id',
      'c.status as crawl_status',
      'c.analysis_status',
      sql<boolean>`exists (
        select 1 from site_crawl_tasks o
        where o.crawl_id = t.crawl_id and o.workspace_id = t.workspace_id
          and o.task_kind = any(${LIFECYCLE_KINDS}::text[])
          and o.status <> all(${TERMINAL_TASK}::text[]))`.as('outstanding'),
    ])
    .where('t.id', '=', task.id)
    .where('t.crawl_id', '=', task.crawl_id)
    .where('t.workspace_id', '=', task.workspace_id)
    .executeTakeFirst();
  if (!row || !TERMINAL_TASK.includes(row.status)) return;
  const intermediate =
    row.task_kind === 'analyze' &&
    row.status === 'succeeded' &&
    row.result_artifact_id !== null &&
    row.crawl_status === 'running' &&
    row.analysis_status === 'running' &&
    row.outstanding;
  if (!intermediate)
    return reconcileCrawl(db, task.workspace_id, task.crawl_id, {
      refreshScore: row.task_kind === 'analyze' && row.status === 'succeeded',
    });
  if (!cadence.admits(task.crawl_id)) return;
  await db.transaction().execute(async (trx) => {
    const crawl = await lockCrawl(trx, task.workspace_id, task.crawl_id);
    if (crawl && ACTIVE.includes(crawl.status)) await refreshLiveScoreSummary(trx, crawl);
  });
}

/**
 * Run one backstop's per-crawl work in order. A crawl that fails is logged and
 * skipped so the rest of the batch still settles; it is retried next pass.
 * Returns how many crawls the work acted on (`false` means it skipped one).
 */
async function eachCrawl<T extends { id: string }>(
  crawls: T[],
  failure: string,
  work: (crawl: T) => Promise<unknown>,
) {
  let acted = 0;
  for (const crawl of crawls)
    try {
      // One crawl lock at a time: a bounded batch never holds several crawl rows.
      if ((await work(crawl)) !== false) acted++; // NOSONAR
    } catch (error) {
      logger.exception(failure, error, { crawl_id: crawl.id });
    }
  return acted;
}

/**
 * The terminalization backstop: an active crawl with no outstanding work and
 * no write for the stall threshold. Any route that drains a crawl's last task
 * without reconciling it (a process killed between acknowledgement and
 * reconcile, a recovered lease) would otherwise leave it active forever.
 */
export async function reconcileStalled(db: Database, settings: SiteWorkerSettings['lifecycle']) {
  if (settings.stalledSeconds <= 0) return 0;
  const cutoff = new Date(Date.now() - settings.stalledSeconds * 1000);
  const stalled = await db
    .selectFrom('site_crawls as c')
    .select(['c.id', 'c.workspace_id'])
    .where('c.status', 'in', ACTIVE)
    .where('c.updated_at', '<', cutoff)
    // Retired kinds left in an old database are not work any worker will claim.
    .where(({ not, exists, selectFrom }) =>
      not(
        exists(
          selectFrom('site_crawl_tasks as t')
            .select('t.id')
            .whereRef('t.crawl_id', '=', 'c.id')
            .whereRef('t.workspace_id', '=', 'c.workspace_id')
            .where('t.task_kind', 'in', policy.site_health.ts_owned_task_kinds)
            .where('t.status', 'not in', TERMINAL_TASK),
        ),
      ),
    )
    .orderBy('c.updated_at')
    .limit(settings.batch)
    .execute();
  return eachCrawl(stalled, 'stalled crawl reconcile failed', async (crawl) => {
    logger.warning('reconciling stalled crawl with no outstanding tasks', { crawl_id: crawl.id });
    await reconcileCrawl(db, crawl.workspace_id, crawl.id);
  });
}

/**
 * Terminalize crawls that outran their wall-clock budget. The stall backstop
 * only sees drained crawls; one task held non-terminal forever is invisible
 * to it. The scan is a candidate list: each crawl is re-checked under its own
 * lock, its outstanding tasks fail with `crawl_overdue` (a real failure to
 * analyze those pages), and the same transaction reconciles what it gathered.
 */
export async function reconcileOverdue(db: Database, settings: SiteWorkerSettings['lifecycle']) {
  if (settings.overdueSeconds <= 0) return 0;
  const cutoff = new Date(Date.now() - settings.overdueSeconds * 1000);
  const candidates = await db
    .selectFrom('site_crawls')
    .select(['id', 'workspace_id'])
    .where('status', 'in', ACTIVE)
    .where(sql<Date>`coalesce(started_at, created_at)`, '<', cutoff)
    .orderBy('created_at')
    .limit(settings.batch)
    .execute();
  return eachCrawl(candidates, 'overdue crawl reconcile failed', async (candidate) => {
    const abandoned = await db.transaction().execute(async (trx) => {
      const crawl = await lockCrawl(trx, candidate.workspace_id, candidate.id);
      if (!crawl || !ACTIVE.includes(crawl.status)) return null;
      if (new Date(crawl.started_at ?? crawl.created_at) >= cutoff) return null;
      const now = new Date();
      const failed = await trx
        .updateTable('site_crawl_tasks')
        .set({
          status: 'failed',
          lease_owner: null,
          lease_expires_at: null,
          heartbeat_at: null,
          completed_at: now,
          updated_at: now,
          error_code: OVERDUE,
          error_detail: 'crawl exceeded its wall-clock budget',
        })
        .where('workspace_id', '=', crawl.workspace_id)
        .where('crawl_id', '=', crawl.id)
        .where('status', 'not in', TERMINAL_TASK)
        .returning('id')
        .execute();
      await reconcileLockedCrawl(trx, crawl);
      return failed.length;
    });
    if (abandoned === null) return false;
    logger.warning('terminalized overdue crawl', {
      crawl_id: candidate.id,
      abandoned_tasks: abandoned,
    });
    return true;
  });
}

/**
 * A cancelled crawl's measurement evidence, published by the same locked
 * owner as every other terminal crawl. Cancellation commits only the stop, so
 * Stop stays responsive under a busy crawl; this publishes the final revisions
 * and the snapshot once. The selection mirrors the snapshot writer's own
 * condition (a completed analysis or classification-expected task of an
 * active monitored page), so a crawl with nothing to publish is never chosen.
 */
export async function publishCancelledCrawls(db: Database, batch: number) {
  const pending = await db
    .selectFrom('site_crawls as c')
    .select(['c.id', 'c.workspace_id'])
    .where('c.status', '=', 'cancelled')
    .where(({ not, exists, selectFrom }) =>
      not(
        exists(
          selectFrom('site_health_snapshots as s')
            .select('s.id')
            .whereRef('s.crawl_id', '=', 'c.id')
            .whereRef('s.workspace_id', '=', 'c.workspace_id'),
        ),
      ),
    )
    .where(sql<boolean>`(
      exists (
        select 1 from site_page_analyses p
        join monitored_site_urls m on m.site_url_id = p.site_url_id
          and m.workspace_id = p.workspace_id and m.project_id = p.project_id and m.active
        where p.crawl_id = c.id and p.workspace_id = c.workspace_id and p.status = 'completed')
      or exists (
        select 1 from (
          select distinct on (t.site_url_id) t.classification_expected
          from site_crawl_tasks t
          join monitored_site_urls m on m.site_url_id = t.site_url_id
            and m.workspace_id = t.workspace_id and m.project_id = c.project_id and m.active
          where t.crawl_id = c.id and t.workspace_id = c.workspace_id and t.task_kind = 'analyze'
          order by t.site_url_id, t.generation desc, t.id desc) latest
        where latest.classification_expected))`)
    .orderBy('c.completed_at', 'desc')
    .limit(batch)
    .execute();
  return eachCrawl(pending, 'cancelled crawl publication failed', (target) =>
    db.transaction().execute(async (trx) => {
      const crawl = await lockCrawl(trx, target.workspace_id, target.id);
      if (crawl?.status !== 'cancelled') return false;
      await publishFinalPageAnalyses(trx, crawl);
      if (await persistCrawlSnapshot(trx, crawl)) await enqueueSuccessors(trx, crawl);
      return true;
    }),
  );
}
