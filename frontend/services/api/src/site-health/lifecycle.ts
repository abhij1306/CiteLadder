import { ACTIVE_CRAWL_STATUSES, isActiveCrawl } from '@citeladder/contracts/site-health';
import { sql } from 'kysely';

import { policy } from '../config.ts';
import type { Database } from '../db/database.ts';
import { getLogger } from '../logging.ts';
import { assessCrawl, LIFECYCLE_KINDS, saveState } from './crawl-assessment.ts';
import { pageRerunSql } from './page-rerun.ts';
import type { CrawlCadences } from './refresh-cadence.ts';
import type { SiteWorkerSettings } from './runtime.ts';
import { publishRunningIssues } from './issue-catalog.ts';
import {
  provisionalSummary,
  refreshLiveScoreSummary,
  refreshRunningScoreSummary,
  writeScoreSummary,
  type LiveSummary,
} from './snapshot.ts';
import { CRAWL_COLUMNS, type Crawl } from './site-task.ts';
import { persistLiveCounters, persistTerminalCounters } from './terminal-counters.ts';
import { drainedFinalizeTask, enqueueFinalize, failFinalization } from './terminal-publication.ts';

const logger = getLogger('app.workers.site_health.lifecycle');
const TERMINAL_TASK = policy.task_queue.terminal;
const DISCOVERY_KINDS = ['discover', 'site_setup'];
// Literals, not a bound array: the planner then proves ix_site_crawl_tasks_open's predicate.
const TERMINAL_STATUSES = sql.join(TERMINAL_TASK.map((status) => sql.lit(status)));
const OVERDUE = policy.site_health.page_analysis.acquisition.error_codes.crawl_overdue;

type ReconcileOptions = {
  refreshScore?: boolean;
};

type Score = () => Promise<LiveSummary | null>;

async function settleDrained(db: Database, crawl: Crawl, score: Score) {
  const task = await drainedFinalizeTask(db, crawl);
  if (task && TERMINAL_TASK.includes(task.status)) return failFinalization(db, crawl, task);
  await saveState(db, crawl);
  if (task) return;
  const payload = await score();
  if (payload) await writeScoreSummary(db, crawl, payload);
  await enqueueFinalize(db, crawl, 'drained');
}

async function reconcileLockedCrawl(db: Database, crawl: Crawl, options: ReconcileOptions = {}) {
  if (crawl.status === 'cancelled') return persistTerminalCounters(db, crawl);
  if (!isActiveCrawl(crawl.status)) return;
  const rescore = options.refreshScore ?? true;
  const { drained } = await assessCrawl(db, crawl);
  if (drained)
    return settleDrained(db, crawl, async () => (rescore ? provisionalSummary(db, crawl) : null));
  await saveState(db, crawl);
  if (rescore) await refreshLiveScoreSummary(db, crawl);
}

/**
 * A reconcile's crawl-wide reads, made from an unlocked copy of the row. A
 * cancelled crawl recounts under the lock: its counter writes move no state
 * column, so an earlier unlocked count could overwrite a later one.
 */
type Assessed =
  | { kind: 'settled' }
  | { kind: 'recount' }
  | { kind: 'active'; crawl: Crawl; drained: boolean; score: LiveSummary | null };

async function assessUnlocked(
  db: Database,
  read: Crawl,
  options: ReconcileOptions,
): Promise<Assessed> {
  const crawl = { ...read };
  if (crawl.status === 'cancelled') return { kind: 'recount' };
  if (!isActiveCrawl(crawl.status)) return { kind: 'settled' };
  const { drained } = await assessCrawl(db, crawl);
  const rescore =
    (options.refreshScore ?? true) && !(drained && (await drainedFinalizeTask(db, crawl)));
  return {
    kind: 'active',
    crawl,
    drained,
    score: rescore ? await provisionalSummary(db, crawl) : null,
  };
}

async function applyAssessed(db: Database, assessed: Extract<Assessed, { kind: 'active' }>) {
  const { crawl, score } = assessed;
  if (assessed.drained) return settleDrained(db, crawl, async () => score);
  await saveState(db, crawl);
  if (score) await writeScoreSummary(db, crawl, score);
}

/** NO KEY UPDATE: FOR UPDATE would block the FK checks of every child insert in the crawl. */
function lockCrawl(db: Database, workspaceId: string, crawlId: string) {
  return db
    .selectFrom('site_crawls')
    .select(CRAWL_COLUMNS)
    .where('workspace_id', '=', workspaceId)
    .where('id', '=', crawlId)
    .forNoKeyUpdate()
    .executeTakeFirst();
}

const stateMoved = (read: Crawl, locked: Crawl) =>
  locked.updated_at.getTime() !== read.updated_at.getTime() ||
  (
    [
      'status',
      'discovery_status',
      'analysis_status',
      'admitted_url_count',
      'discovered_url_count',
    ] as const
  ).some((column) => locked[column] !== read[column]);

export async function reconcileCrawl(
  db: Database,
  workspaceId: string,
  crawlId: string,
  options: ReconcileOptions = {},
) {
  const read = await db
    .selectFrom('site_crawls')
    .select(CRAWL_COLUMNS)
    .where('workspace_id', '=', workspaceId)
    .where('id', '=', crawlId)
    .executeTakeFirst();
  if (!read) return;
  const assessed = await assessUnlocked(db, read, options);
  if (assessed.kind === 'settled') return;
  await db.transaction().execute(async (trx) => {
    const crawl = await lockCrawl(trx, workspaceId, crawlId);
    if (!crawl) return;
    await (assessed.kind === 'active' && !stateMoved(read, crawl)
      ? applyAssessed(trx, assessed)
      : reconcileLockedCrawl(trx, crawl, options));
  });
}

type SettledTask = { id: string; crawl_id: string; workspace_id: string };

function settledRow(db: Database, task: SettledTask) {
  return db
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
      'c.admitted_url_count',
      sql<boolean>`exists (
        select 1 from site_crawl_tasks o
        where o.crawl_id = t.crawl_id and o.workspace_id = t.workspace_id
          and o.task_kind = any(${LIFECYCLE_KINDS}::text[])
          and o.status not in (${TERMINAL_STATUSES}))`.as('outstanding'),
      sql<boolean>`exists (
        select 1 from site_crawl_tasks o
        where o.crawl_id = t.crawl_id and o.workspace_id = t.workspace_id
          and o.task_kind = any(${DISCOVERY_KINDS}::text[])
          and o.status not in (${TERMINAL_STATUSES}))`.as('discovering'),
    ])
    .where('t.id', '=', task.id)
    .where('t.crawl_id', '=', task.crawl_id)
    .where('t.workspace_id', '=', task.workspace_id)
    .executeTakeFirst();
}

function settlement(row: NonNullable<Awaited<ReturnType<typeof settledRow>>>) {
  const running = row.crawl_status === 'running';
  if (row.task_kind === 'discover' && running && row.discovering) return 'discovery_progress';
  const analyzed =
    row.task_kind === 'analyze' && (row.status !== 'succeeded' || row.result_artifact_id !== null);
  return analyzed && running && row.analysis_status === 'running' && row.outstanding
    ? 'analysis_progress'
    : 'boundary';
}

async function publishAnalysisProgress(
  db: Database,
  { task, cadence, pages }: { task: SettledTask; cadence: CrawlCadences; pages: number },
) {
  if (cadence.score.admits(task.crawl_id, { pages })) await refreshRunningScoreSummary(db, task);
  if (cadence.issues.admits(task.crawl_id)) await publishRunningIssues(db, task);
}

export async function reconcileAfterTask(db: Database, task: SettledTask, cadence: CrawlCadences) {
  const row = await settledRow(db, task);
  if (!row || !TERMINAL_TASK.includes(row.status)) return;
  const kind = settlement(row);
  switch (kind) {
    case 'boundary':
      await reconcileCrawl(db, task.workspace_id, task.crawl_id, {
        refreshScore: row.task_kind === 'analyze' && row.status === 'succeeded',
      });
      break;
    case 'discovery_progress':
      if (cadence.discovery.admits(task.crawl_id))
        await reconcileCrawl(db, task.workspace_id, task.crawl_id, {
          refreshScore: false,
        });
      break;
    case 'analysis_progress':
      await publishAnalysisProgress(db, { task, cadence, pages: row.admitted_url_count });
      break;
    default: {
      const unhandled: never = kind;
      return unhandled;
    }
  }
  if (kind === 'boundary' || cadence.counters.admits(task.crawl_id))
    await persistLiveCounters(db, task);
}

async function eachCrawl<T extends { id: string }>(
  crawls: T[],
  failure: string,
  work: (crawl: T) => Promise<unknown>,
) {
  let acted = 0;
  for (const crawl of crawls)
    try {
      if ((await work(crawl)) !== false) acted++; // NOSONAR -- One crawl lock at a time: a batch never holds several crawl rows.
    } catch (error) {
      logger.exception(failure, error, { crawl_id: crawl.id });
    }
  return acted;
}

export async function reconcileStalled(db: Database, settings: SiteWorkerSettings['lifecycle']) {
  if (settings.stalledSeconds <= 0) return 0;
  const cutoff = new Date(Date.now() - settings.stalledSeconds * 1000);
  const stalled = await db
    .selectFrom('site_crawls as c')
    .select(['c.id', 'c.workspace_id'])
    .where('c.status', 'in', ACTIVE_CRAWL_STATUSES)
    .where('c.updated_at', '<', cutoff)
    .where(({ not, exists, selectFrom }) =>
      not(
        exists(
          selectFrom('site_crawl_tasks as t')
            .select('t.id')
            .whereRef('t.crawl_id', '=', 'c.id')
            .whereRef('t.workspace_id', '=', 'c.workspace_id')
            .where('t.status', 'not in', TERMINAL_TASK),
        ),
      ),
    )
    .orderBy('c.updated_at')
    .limit(settings.batch)
    .execute();
  return eachCrawl(stalled, 'stalled crawl reconcile failed', async (crawl) => {
    logger.warning('reconciling stalled crawl with no outstanding tasks', {
      crawl_id: crawl.id,
    });
    await reconcileCrawl(db, crawl.workspace_id, crawl.id);
  });
}

function overdueCrawls(db: Database, settings: SiteWorkerSettings['lifecycle'], crawlId?: string) {
  const at = (seconds: number) => new Date(Date.now() - seconds * 1000);
  const started = sql<Date>`coalesce(c.started_at, c.created_at)`;
  // A running finalize settles once after many batch commits: its heartbeat is progress.
  const progressed = sql<Date>`greatest(${started}, (select max(greatest(t.completed_at,
      case when t.task_kind = 'finalize' then t.heartbeat_at end))
    from site_crawl_tasks t where t.workspace_id = c.workspace_id and t.crawl_id = c.id))`;
  return db
    .selectFrom('site_crawls as c')
    .select(['c.id', 'c.workspace_id'])
    .where('c.status', 'in', ACTIVE_CRAWL_STATUSES)
    .$if(crawlId !== undefined, (query) => query.where('c.id', '=', crawlId ?? ''))
    .where((eb) =>
      eb.or([
        eb(started, '<', at(settings.overdueSeconds)),
        eb(progressed, '<', at(settings.noProgressSeconds)),
      ]),
    )
    .orderBy('c.created_at')
    .limit(settings.batch)
    .execute();
}

export async function reconcileOverdue(db: Database, settings: SiteWorkerSettings['lifecycle']) {
  if (settings.overdueSeconds <= 0) return 0;
  const candidates = await overdueCrawls(db, settings);
  return eachCrawl(candidates, 'overdue crawl reconcile failed', async (candidate) => {
    const abandoned = await db.transaction().execute(async (trx) => {
      const crawl = await lockCrawl(trx, candidate.workspace_id, candidate.id);
      if (!crawl || !isActiveCrawl(crawl.status)) return null;
      if (!(await overdueCrawls(trx, settings, crawl.id)).length) return null;
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
          error_detail: 'crawl stopped making progress or exceeded its wall-clock cap',
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

export async function publishCancelledCrawls(db: Database, batch: number) {
  const pending = await db
    .selectFrom('site_crawls as c')
    .select(['c.id', 'c.workspace_id'])
    .where('c.status', '=', 'cancelled')
    .where(
      sql<boolean>`not exists (
      select 1 from site_health_snapshots s
      where s.crawl_id = c.id and s.workspace_id = c.workspace_id)`,
    )
    .where(
      sql<boolean>`not exists (
      select 1 from site_crawl_tasks t
      where t.crawl_id = c.id and t.workspace_id = c.workspace_id
        and t.task_kind = 'finalize' and t.status <> 'cancelled')`,
    )
    .where(
      sql<boolean>`not (${pageRerunSql} and exists (
      select 1 from site_crawl_tasks t
      where t.crawl_id = c.id and t.workspace_id = c.workspace_id
        and t.task_kind = 'change_intel'))`,
    )
    .where(
      sql<boolean>`(
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
        where latest.classification_expected))`,
    )
    .orderBy('c.completed_at', 'desc')
    .limit(batch)
    .execute();
  return eachCrawl(pending, 'cancelled crawl publication failed', (target) =>
    db.transaction().execute(async (trx) => {
      const crawl = await lockCrawl(trx, target.workspace_id, target.id);
      if (crawl?.status !== 'cancelled') return false;
      await enqueueFinalize(trx, crawl, 'cancelled');
      return true;
    }),
  );
}
