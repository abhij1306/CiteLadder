import { createHash } from 'node:crypto';

import { policy } from '../config.ts';
import type { Database } from '../db/database.ts';
import { enqueueCrawlTasks } from './admission-writes.ts';
import type { Assessment } from './crawl-assessment.ts';
import { saveState } from './crawl-assessment.ts';
import { refreshIssueCurrency } from './issue-currency.ts';
import { landIssueStates } from './issue-states.ts';
import { isPageRerun } from './page-rerun.ts';
import { rootFailure } from './reads/crawl.ts';
import { persistCrawlSnapshot } from './snapshot.ts';
import { recordCrawlEvent, type Crawl } from './site-task.ts';
import { persistTerminalCounters } from './terminal-counters.ts';
import { enqueueTerminalAnalyticsRefresh } from './terminal-handoff.ts';

const FINALIZE = policy.site_health.crawl.finalize;
const hashOf = (key: string) => createHash('sha256').update(key).digest('hex');

/**
 * A drained crawl's finalize slot, and the separate one that publishes a
 * cancelled crawl: Stop cancels the first with the crawl's other open tasks,
 * so a crawl stopped mid-finalization is still published once.
 */
export const finalizeHash = (crawl: Pick<Crawl, 'id'>, mode: 'drained' | 'cancelled') =>
  hashOf(mode === 'drained' ? `finalize:${crawl.id}` : `finalize:${crawl.id}:cancelled`);

export async function enqueueFinalize(db: Database, crawl: Crawl, mode: 'drained' | 'cancelled') {
  await enqueueCrawlTasks(
    db,
    crawl,
    [
      {
        kind: 'finalize',
        url: crawl.root_url,
        hash: finalizeHash(crawl, mode),
        priority: FINALIZE.priority,
        maxAttempts: FINALIZE.max_attempts,
      },
    ],
    'once',
  );
}

export function drainedFinalizeTask(db: Database, crawl: Crawl) {
  return db
    .selectFrom('site_crawl_tasks')
    .select(['status', 'error_code'])
    .where('workspace_id', '=', crawl.workspace_id)
    .where('crawl_id', '=', crawl.id)
    .where('task_kind', '=', 'finalize')
    .where('url_hash', '=', finalizeHash(crawl, 'drained'))
    .executeTakeFirst();
}

function partialReason(discoveryPartial: boolean, analysisPartial: boolean) {
  if (discoveryPartial && analysisPartial) return policy.site_health.reads.partial_reasons.both;
  if (discoveryPartial) return policy.site_health.reads.partial_reasons.discovery;
  return analysisPartial ? policy.site_health.reads.partial_reasons.analysis : '';
}

async function enqueueSuccessors(db: Database, crawl: Crawl) {
  const linkVersion = `${crawl.extractor_version}:${policy.site_health.link_metrics.formula_version}`;
  const successors = [
    {
      kind: 'change_intel',
      key: `change-intel:${crawl.id}:${policy.site_health.change_intel.analyzer_version}`,
    },
    { kind: 'link_metrics', key: `link-metrics:${crawl.id}:${linkVersion}` },
  ];
  await enqueueCrawlTasks(
    db,
    crawl,
    successors.map(({ kind, key }) => ({
      kind,
      url: crawl.root_url,
      hash: hashOf(key),
    })),
    'once',
  );
}

async function terminalize(db: Database, crawl: Crawl, assessment: Assessment) {
  const { summary, fullyFailed, discoveryPartial } = assessment;
  crawl.completed_at = new Date();
  if (fullyFailed) {
    crawl.status = 'failed';
    const failure = (await rootFailure(db, crawl)).summary;
    if (failure && !crawl.error_message) crawl.error_message = failure.message;
    await saveState(db, crawl);
    await persistTerminalCounters(db, crawl);
    await recordCrawlEvent(db, crawl, 'crawl.failed', 'crawl failed', {
      status: crawl.status,
      failure,
    });
    return;
  }
  const analysisPartial = summary.analyzeApplicable > 0 && summary.analyzeShortfall > 0;
  crawl.partial_reason = partialReason(discoveryPartial, analysisPartial);
  crawl.status = crawl.partial_reason ? 'partially_completed' : 'completed';
  await saveState(db, crawl);
  await persistTerminalCounters(db, crawl);
  await recordCrawlEvent(db, crawl, 'crawl.completed', 'crawl completed', {
    status: crawl.status,
  });
  if (summary.analyzeSucceeded > 0) await enqueueSuccessors(db, crawl);
  else await enqueueTerminalAnalyticsRefresh(db, crawl, null);
}

async function publishIssues(db: Database, crawl: Crawl) {
  const finalized = await db
    .selectFrom('site_page_analyses')
    .select('id')
    .where('workspace_id', '=', crawl.workspace_id)
    .where('project_id', '=', crawl.project_id)
    .where('crawl_id', '=', crawl.id)
    .where('is_current', '=', true)
    .where('finalized_at', 'is not', null)
    .limit(1)
    .executeTakeFirst();
  if (finalized) await refreshIssueCurrency(db, crawl, { resync: false });
  else await landIssueStates(db, crawl);
}

export async function publishDrainedCrawl(db: Database, crawl: Crawl, assessment: Assessment) {
  await publishIssues(db, crawl);
  await persistCrawlSnapshot(db, crawl, true);
  await terminalize(db, crawl, assessment);
}

export async function publishCancelledCrawl(db: Database, crawl: Crawl) {
  await publishIssues(db, crawl);
  await persistTerminalCounters(db, crawl);
  if (isPageRerun(crawl) || (await persistCrawlSnapshot(db, crawl)))
    await enqueueSuccessors(db, crawl);
}

export async function failFinalization(db: Database, crawl: Crawl, task: { error_code: string }) {
  crawl.completed_at = new Date();
  crawl.status = 'failed';
  // The task keeps its error detail; the crawl names the step and the task's code only.
  const failure = {
    code: FINALIZE.error_code,
    message: FINALIZE.error_message,
    task_error_code: task.error_code || 'task_failed',
  };
  crawl.error_message = failure.message;
  await saveState(db, crawl);
  await persistTerminalCounters(db, crawl);
  await recordCrawlEvent(db, crawl, 'crawl.failed', 'crawl failed', {
    status: crawl.status,
    failure,
  });
}
