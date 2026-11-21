import { sql } from 'kysely';

import { policy } from '../config.ts';
import type { Database } from '../db/database.ts';
import { expectedTaskFailure, inventoryComplete } from './coverage.ts';
import type { Crawl } from './site-task.ts';
import { failedAs } from './task-outcome.ts';

const TERMINAL_TASK = policy.task_queue.terminal;
export const LIFECYCLE_KINDS = ['discover', 'site_setup', 'analyze'];
const EXCLUDED = failedAs('site_crawl_tasks', ['excluded']);
const LATEST_GENERATION = sql<boolean>`not exists (
  select 1 from site_crawl_tasks newer
  where newer.workspace_id = site_crawl_tasks.workspace_id
    and newer.crawl_id = site_crawl_tasks.crawl_id
    and newer.task_kind = site_crawl_tasks.task_kind
    and newer.url_hash = site_crawl_tasks.url_hash
    and newer.generation > site_crawl_tasks.generation)`;

type Counts = {
  total: number;
  open: number;
  succeeded: number;
  cancelled: number;
  failed: number;
  excluded: number;
  expected: number;
};
const NONE: Counts = {
  total: 0,
  open: 0,
  succeeded: 0,
  cancelled: 0,
  failed: 0,
  excluded: 0,
  expected: 0,
};

type Summary = {
  discoverOpen: number;
  discoverFailed: number;
  analyzeOpen: number;
  analyzeTotal: number;
  analyzeSucceeded: number;
  analyzeApplicable: number;
  analyzeShortfall: number;
};

async function taskSummary(
  db: Database,
  crawl: Pick<Crawl, 'workspace_id' | 'id'>,
): Promise<Summary> {
  const rows = await db
    .selectFrom('site_crawl_tasks')
    .select([
      'task_kind',
      sql<number>`count(*)::int`.as('total'),
      sql<number>`count(*) filter (where status <> all(${TERMINAL_TASK}::text[]))::int`.as('open'),
      sql<number>`count(*) filter (where status = 'succeeded')::int`.as('succeeded'),
      sql<number>`count(*) filter (where status = 'cancelled')::int`.as('cancelled'),
      sql<number>`count(*) filter (where status = 'failed')::int`.as('failed'),
      sql<number>`count(*) filter (where status = 'failed' and ${EXCLUDED})::int`.as('excluded'),
      sql<number>`count(*) filter (where status = 'failed' and ${expectedTaskFailure})::int`.as(
        'expected',
      ),
    ])
    .where('workspace_id', '=', crawl.workspace_id)
    .where('crawl_id', '=', crawl.id)
    .where('task_kind', 'in', LIFECYCLE_KINDS)
    .where(LATEST_GENERATION)
    .groupBy('task_kind')
    .execute();
  const kind = (name: string): Counts => rows.find((row) => row.task_kind === name) ?? NONE;
  const [discover, setup, analyze] = [kind('discover'), kind('site_setup'), kind('analyze')];
  return {
    discoverOpen: discover.open + setup.open,
    discoverFailed: Math.max(discover.failed - discover.expected, 0) + setup.failed,
    analyzeOpen: analyze.open,
    analyzeTotal: analyze.total,
    analyzeSucceeded: analyze.succeeded,
    analyzeApplicable: analyze.total - analyze.cancelled - analyze.excluded,
    analyzeShortfall: analyze.total - analyze.cancelled - analyze.succeeded - analyze.expected,
  };
}

async function failedUrlCount(db: Database, crawl: Crawl) {
  const row = await db
    .selectFrom('site_crawl_tasks')
    .select(sql<number>`count(distinct url_hash)::int`.as('count'))
    .where('workspace_id', '=', crawl.workspace_id)
    .where('crawl_id', '=', crawl.id)
    .where('status', '=', 'failed')
    .where('task_kind', 'in', ['discover', 'analyze'])
    .where('url_hash', '!=', '')
    .where(sql<boolean>`not ${EXCLUDED}`)
    .where(LATEST_GENERATION)
    .executeTakeFirstOrThrow();
  return row.count;
}

export async function analyzedPageCount(db: Database, crawl: Pick<Crawl, 'workspace_id' | 'id'>) {
  return (await taskSummary(db, crawl)).analyzeSucceeded;
}

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

function reconcileDiscovery(crawl: Crawl, summary: Summary) {
  const discoveryFailed = crawl.discovered_url_count === 0;
  // A recrawl that analyzed monitored pages after its root was blocked holds
  // useful partial evidence; it is not a failed crawl.
  const fullyFailed =
    summary.analyzeSucceeded === 0 && (discoveryFailed || summary.analyzeApplicable > 0);
  if (!summary.discoverOpen && ['pending', 'running'].includes(crawl.discovery_status))
    crawl.discovery_status = discoveryFailed ? 'failed' : 'completed';
  return {
    fullyFailed,
    discoveryPartial: summary.discoverFailed > 0 && !fullyFailed,
  };
}

async function reconcileInventory(
  db: Database,
  crawl: Crawl,
  summary: Summary,
  discoveryWasRunning: boolean,
) {
  if (summary.discoverOpen) return;
  if (!discoveryWasRunning && summary.analyzeOpen) return;
  crawl.inventory_complete = crawl.discovered_url_count > 0 && (await inventoryComplete(db, crawl));
}

function analysisOutcome(summary: Summary, fullyFailed: boolean) {
  if (summary.analyzeTotal > 0 && summary.analyzeApplicable === 0) return 'cancelled';
  if (fullyFailed) return 'failed';
  if (summary.analyzeShortfall === 0) return 'completed';
  return summary.analyzeSucceeded > 0 ? 'partially_completed' : 'failed';
}

function reconcileAnalysis(crawl: Crawl, summary: Summary, fullyFailed: boolean) {
  if (summary.analyzeTotal > 0 && crawl.analysis_status === 'pending')
    crawl.analysis_status = 'running';
  if (summary.discoverOpen || summary.analyzeOpen) return;
  if (crawl.analysis_status === 'pending') crawl.analysis_status = 'running';
  if (crawl.analysis_status === 'running')
    crawl.analysis_status = analysisOutcome(summary, fullyFailed);
}

export async function assessCrawl(db: Database, crawl: Crawl) {
  const summary = await taskSummary(db, crawl);
  await refreshCounters(db, crawl, summary);
  const discoveryWasRunning = ['pending', 'running'].includes(crawl.discovery_status);
  const { fullyFailed, discoveryPartial } = reconcileDiscovery(crawl, summary);
  await reconcileInventory(db, crawl, summary, discoveryWasRunning);
  reconcileAnalysis(crawl, summary, fullyFailed);
  const drained = !summary.discoverOpen && !summary.analyzeOpen;
  return { summary, fullyFailed, discoveryPartial, drained };
}

export type Assessment = Awaited<ReturnType<typeof assessCrawl>>;

export async function saveState(db: Database, crawl: Crawl) {
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
